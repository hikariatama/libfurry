const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const { E621Client, USER_AGENT } = require('./services/e621.cjs');
const { Downloads } = require('./services/downloads.cjs');
const { recoverJSON, saveJSON, loadCredentials, saveCredentials, clearCredentials } = require('./services/storage.cjs');
const { SearchSessionStore } = require('./services/search-session.cjs');
const { validateSettings, defaults: defaultSettings, SETTINGS_BYTES } = require('./services/settings.cjs');
const { installPermissions } = require('./services/permissions.cjs');

// Keep the existing profile and single-instance lock across the product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'e322'));
app.setName('libfurry');
const singleInstance = app.requestSingleInstanceLock();
const api = new E621Client();
const sessionStore = new SearchSessionStore({ recoverJSON, saveJSON });
let pendingSessionClose = null;
let quitting = false;
let window;
let profile = null;
let accountIssue = null;
let accountRevision = 0;
let credentialGeneration = 0;
let credentialRestoreBlocked = false;
let accountTransitioning = false;
let initialRestoreStarted = false;
let initialRestoreTimer = null;
let settings = null;
let storageIssues = [];
let settingsWritable = true;
let downloadsWritable = true;
let pendingSettingsWrite = null;
let pendingDownloadWrite = null;
let downloadPersistVersion = 0;
let credentialWriteTail = Promise.resolve();
let downloadWriteTimer = null;
const searchControllers = new Set();
const backgroundSearchControllers = new Set();
function emit(channel, value) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
const downloads = new Downloads(api, job => {
  emit('download:changed', job);
  queueDownloadPersist(['complete', 'failed', 'cancelled'].includes(job.status));
}, token => token !== null && Boolean(profile) && token === `${credentialGeneration}:${profile.id}`);

function reportStorageWrite(name, error = null) {
  const prefix = `${name}: could not save`;
  const previous = storageIssues.filter(issue => !issue.startsWith(prefix));
  if (error) previous.push(`${prefix}: ${String(error.message || error)}`);
  if (previous.length === storageIssues.length && previous.every((issue, index) => issue === storageIssues[index])) return;
  storageIssues = previous;
  emit('storage:issues', storageIssues);
}

function persistDownloads() {
  if (!downloadsWritable) return Promise.reject(new Error('Download history is read-only'));
  downloadPersistVersion++;
  if (pendingDownloadWrite) return pendingDownloadWrite;
  pendingDownloadWrite = (async () => {
    let version;
    do {
      version = downloadPersistVersion;
      await saveJSON('downloads.json', downloads.list());
    } while (version !== downloadPersistVersion);
    reportStorageWrite('downloads.json');
  })().catch(error => { reportStorageWrite('downloads.json', error); throw error; })
    .finally(() => { pendingDownloadWrite = null; });
  return pendingDownloadWrite;
}

function queueDownloadPersist(immediate = false) {
  if (immediate) {
    if (downloadWriteTimer) clearTimeout(downloadWriteTimer);
    downloadWriteTimer = null;
    void persistDownloads().catch(() => {});
    return;
  }
  if (downloadWriteTimer) return;
  downloadWriteTimer = setTimeout(() => {
    downloadWriteTimer = null;
    void persistDownloads().catch(() => {});
  }, 1000);
}

let accountRestore = null;
async function restoreAccount() {
  initialRestoreStarted = true;
  if (initialRestoreTimer) clearTimeout(initialRestoreTimer);
  initialRestoreTimer = null;
  if (accountRestore) return accountRestore;
  accountRestore = (async () => {
    const restoreGeneration = credentialGeneration;
    const restoreRevision = accountRevision;
    // A login can commit within the same intent if this restore began during validation.
    const stale = () => restoreGeneration !== credentialGeneration || restoreRevision !== accountRevision;
    await credentialWriteTail;
    if (stale()) return { profile, accountIssue, revision: accountRevision, stale: true };
    if (credentialRestoreBlocked) {
      accountIssue = 'Could not finish saving the API key. Sign in again or sign out.';
      accountRevision++;
      return { profile, accountIssue, revision: accountRevision };
    }
    let credentials;
    try { credentials = await loadCredentials(); }
    catch {
      if (stale()) return { profile, accountIssue, revision: accountRevision, stale: true };
      profile = null;
      api.setCredentials(null);
      accountIssue = 'Could not open the saved API key. Try again or sign in again.';
      accountRevision++;
      return { profile, accountIssue, revision: accountRevision };
    }
    if (stale()) return { profile, accountIssue, revision: accountRevision, stale: true };
    if (!credentials) {
      profile = null;
      api.setCredentials(null);
      accountIssue = null;
      accountRevision++;
      return { profile, accountIssue, revision: accountRevision };
    }
    try {
      const checked = await api.profile(credentials);
      if (stale()) return { profile, accountIssue, revision: accountRevision, stale: true };
      api.setCredentials(credentials);
      profile = checked;
      accountIssue = null;
    } catch (error) {
      if (stale()) return { profile, accountIssue, revision: accountRevision, stale: true };
      profile = null;
      api.setCredentials(null);
      accountIssue = /^e621: (401|403)\b/.test(String(error?.message))
        ? 'e621 rejected the saved API key. Check it in your account.'
        : 'Could not verify the e621 account. Try again.';
    }
    accountRevision++;
    return { profile, accountIssue, revision: accountRevision };
  })();
  try {
    const result = await accountRestore;
    if (!result.stale) emit('account:changed', result);
    return result;
  }
  finally { accountRestore = null; }
}

function persistSettings() {
  if (!settingsWritable) return Promise.reject(new Error('Settings are read-only'));
  if (pendingSettingsWrite) return pendingSettingsWrite;
  pendingSettingsWrite = (async () => {
    let saved;
    do {
      saved = settings;
      await saveJSON('settings.json', saved);
    } while (saved !== settings);
    reportStorageWrite('settings.json');
  })().catch(error => { reportStorageWrite('settings.json', error); throw error; })
    .finally(() => { pendingSettingsWrite = null; });
  return pendingSettingsWrite;
}

function writeCredentials(action) {
  const write = credentialWriteTail.then(action, action);
  credentialWriteTail = write.catch(() => {});
  return write;
}

function send(command) { emit('menu:command', command); }

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'libfurry', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'Search', accelerator: 'CommandOrControl+L', click: () => send('search') },
      { label: 'Refresh', accelerator: 'CommandOrControl+R', click: () => send('refresh') },
      { label: 'Downloads', accelerator: 'CommandOrControl+J', click: () => send('downloads') },
      { type: 'separator' }, { role: 'close' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Post', submenu: [
      { label: 'Download', accelerator: 'CommandOrControl+D', click: () => send('download') },
      { label: 'Upvote', accelerator: 'CommandOrControl+U', click: () => send('upvote') },
      { label: 'Favorite', accelerator: 'CommandOrControl+F', click: () => send('favorite') },
      { label: 'Download, Upvote & Favorite', accelerator: 'CommandOrControl+S', click: () => send('all') },
    ] },
    { label: 'View', submenu: [
      { label: 'Blacklist', accelerator: 'CommandOrControl+B', click: () => send('blacklist') },
      { label: 'Watched Tags', accelerator: 'CommandOrControl+T', click: () => send('watchlist') },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { label: 'Help', submenu: [
      { label: 'Keyboard Shortcuts', accelerator: 'CommandOrControl+/', click: () => send('shortcuts') },
    ] },
  ]));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 580, minHeight: 440,
    title: 'libfurry', backgroundColor: '#202020',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 15, y: 15 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true,
    },
  });
  installPermissions(window.webContents.session, window.webContents, path.join(__dirname, '../dist/index.html'));
  const createdWindow = window;
  let closeAllowed = false;
  createdWindow.on('close', event => {
    if (closeAllowed) return;
    event.preventDefault();
    if (pendingSessionClose) return;
    let finishing = null;
    let timeout;
    const finish = () => {
      if (finishing) return finishing;
      clearTimeout(timeout);
      finishing = sessionStore.flush().then(() => {
        pendingSessionClose = null;
        closeAllowed = true;
        if (quitting) app.quit();
        else if (!createdWindow.isDestroyed()) createdWindow.close();
      });
      return finishing;
    };
    pendingSessionClose = { finish };
    timeout = setTimeout(() => { void finish(); }, 2000);
    createdWindow.webContents.send('session:flush-request');
  });
  createdWindow.once('ready-to-show', () => { if (!createdWindow.isDestroyed()) createdWindow.show(); });
  createdWindow.webContents.once('did-finish-load', () => { if (!createdWindow.isDestroyed()) createdWindow.show(); });
  setTimeout(() => {
    if (!createdWindow.isDestroyed() && !createdWindow.isVisible()) createdWindow.show();
  }, 3000);
  window.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['https://*.e621.net/data/*', 'https://*.e926.net/data/*'] }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders, 'User-Agent': USER_AGENT, Referer: 'https://e621.net/' };
    callback({ requestHeaders });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const devURL = process.env.LIBFURRY_DEV_URL || process.env.E322_DEV_URL;
  if (devURL) window.loadURL(devURL);
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
}

function validID(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid post ID');
  return id;
}

function fromWindow(event) {
  if (event.sender !== window?.webContents) throw new Error('Unauthorized source');
}

const pendingIPC = new Map();
let pendingIPCTotal = 0;
function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    fromWindow(event);
    const count = pendingIPC.get(channel) || 0;
    if (count >= (channel === 'settings:save' ? 8 : 2048) || pendingIPCTotal >= 4096) throw new Error('Too many pending operations. Try again shortly.');
    pendingIPC.set(channel, count + 1);
    pendingIPCTotal++;
    try { return await action(...args); }
    finally { pendingIPC.set(channel, pendingIPC.get(channel) - 1); pendingIPCTotal--; }
  });
}

function registerIPC() {
  handle('app:bootstrap', () => ({ settings, session: sessionStore.value, profile, accountIssue, accountRevision, storageIssues, downloads: downloads.list() }));
  handle('session:save', async value => {
    try {
      const saved = await sessionStore.write(value);
      api.pinPersistedSnapshots(saved.pages.map(page => page.snapshotKey));
      reportStorageWrite('session.json');
    } catch (error) { reportStorageWrite('session.json', error); throw error; }
  });
  handle('session:flushed', () => pendingSessionClose?.finish());
  handle('account:retry', () => restoreAccount());
  handle('settings:save', async value => {
    const candidate = { ...value, downloadFolder: settings.downloadFolder };
    validateSettings(candidate);
    settings = candidate;
    await persistSettings();
    return settings;
  });
  handle('api:search', async (query, cursor, refresh, background) => {
    const nextCursor = String(cursor || '').slice(0, 32);
    if (!background && !nextCursor) {
      for (const active of searchControllers) active.abort();
    }
    const controller = new AbortController();
    searchControllers.add(controller);
    if (background) backgroundSearchControllers.add(controller);
    try {
      return await api.search(String(query).slice(0, 500), nextCursor, Boolean(refresh), controller.signal, Boolean(background));
    } finally {
      searchControllers.delete(controller);
      backgroundSearchControllers.delete(controller);
      if (!background && !nextCursor && !initialRestoreStarted) void restoreAccount();
    }
  });
  handle('api:cancelBackgroundSearch', () => {
    for (const controller of backgroundSearchControllers) controller.abort();
  });
  handle('api:snapshotPage', key => api.snapshotPage(String(key)));
  handle('api:pinSnapshots', keys => {
    if (!Array.isArray(keys) || keys.length > 10000) throw new Error('Invalid snapshot list');
    api.pinSnapshots(keys);
  });
  handle('api:restorePage', (key, query, cursor) => api.restorePage(String(key), String(query).slice(0, 500), String(cursor || '').slice(0, 32)));
  handle('api:autocomplete', prefix => api.autocomplete(String(prefix).slice(0, 100)));
  handle('api:detail', id => api.detail(validID(id)));
  handle('account:login', async (username, apiKey) => {
    const credentials = { username: String(username).trim(), apiKey: String(apiKey).trim() };
    if (!credentials.username || !credentials.apiKey) throw new Error('Enter a username and API key');
    if (credentials.username.length > 256 || credentials.apiKey.length > 4096) throw new Error('Account credentials are too long');
    const intent = ++credentialGeneration;
    api.invalidateCredentials();
    accountTransitioning = true;
    try {
      const checked = await api.validate(credentials);
      if (intent !== credentialGeneration) throw new Error('Sign-in was cancelled by an account change');
      await writeCredentials(async () => {
        if (intent !== credentialGeneration) throw new Error('Sign-in was cancelled by an account change');
        try {
          await saveCredentials(credentials, () => intent === credentialGeneration);
          if (intent !== credentialGeneration) {
            await clearCredentials();
            throw new Error('Sign-in was cancelled by an account change');
          }
        } catch (error) {
          // A failed/stale transaction must not be restored until a later durable write.
          credentialRestoreBlocked = true;
          throw error;
        }
        credentialRestoreBlocked = false;
      });
      if (intent !== credentialGeneration) throw new Error('Sign-in was cancelled by an account change');
      api.setCredentials(credentials);
      profile = checked;
      accountIssue = null;
      accountRevision++;
      return { profile, revision: accountRevision };
    } catch (error) {
      if (intent === credentialGeneration && !profile && initialRestoreStarted) {
        const pendingRestore = accountRestore;
        void (async () => {
          if (pendingRestore) await pendingRestore.catch(() => {});
          await Promise.resolve();
          if (intent === credentialGeneration && !profile) await restoreAccount();
        })().catch(() => {});
      }
      throw error;
    } finally {
      if (intent === credentialGeneration) accountTransitioning = false;
    }
  });
  handle('account:logout', async () => {
    const intent = ++credentialGeneration;
    api.invalidateCredentials();
    accountTransitioning = true;
    try {
      await writeCredentials(async () => {
        await clearCredentials();
        credentialRestoreBlocked = false;
      });
      if (intent !== credentialGeneration) return { revision: accountRevision, stale: true };
      api.setCredentials(null); profile = null; accountIssue = null;
      accountRevision++;
      return { revision: accountRevision };
    } finally {
      if (intent === credentialGeneration) accountTransitioning = false;
    }
  });
  handle('account:blacklist', async rules => {
    if (accountTransitioning) throw new Error('Wait for the account to switch');
    if (!profile) throw new Error('Sign in first');
    const generation = credentialGeneration;
    const accountId = profile.id;
    const text = String(rules).slice(0, 50000);
    await api.updateBlacklist(accountId, text);
    if (generation !== credentialGeneration || profile?.id !== accountId) throw new Error('Account changed during sync');
    profile = { ...profile, blacklisted_tags: text };
    return profile;
  });
  handle('post:upvote', async id => {
    if (accountTransitioning) throw new Error('Wait for the account to switch');
    if (!profile) throw new Error('Sign in first');
    const revision = accountRevision;
    await api.upvote(validID(id));
    if (revision !== accountRevision) throw new Error('Account changed after the upvote was sent');
  });
  handle('post:favorite', async (id, active) => {
    if (accountTransitioning) throw new Error('Wait for the account to switch');
    if (!profile) throw new Error('Sign in first');
    const revision = accountRevision;
    if (active) await api.favorite(validID(id));
    else await api.unfavorite(validID(id));
    if (revision !== accountRevision) throw new Error('Account changed after the favorite request was sent');
  });
  handle('download:chooseFolder', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Choose' });
    if (result.canceled) return null;
    await downloads.cleanupOrphans(result.filePaths[0]);
    settings = { ...settings, downloadFolder: result.filePaths[0] };
    await persistSettings();
    return settings.downloadFolder;
  });
  handle('download:start', (post, combined) => {
    if (!settings.downloadFolder) throw new Error('Choose a download folder');
    if (combined && accountTransitioning) throw new Error('Wait for the account to switch');
    if (combined && !profile) throw new Error('Sign in first');
    return downloads.start({ id: validID(post?.id) }, settings.downloadFolder, combined,
      combined ? `${credentialGeneration}:${profile.id}` : null, combined ? accountRevision : null);
  });
  handle('download:cancel', id => downloads.cancel(String(id)));
  handle('post:openExternal', id => shell.openExternal(`https://e621.net/posts/${validID(id)}`));
  handle('post:copyLink', id => clipboard.writeText(`https://e621.net/posts/${validID(id)}`));
  handle('post:copyText', value => clipboard.writeText(String(value).slice(0, 4000)));
}

if (!singleInstance) app.quit();
else app.whenReady().then(async () => {
  const settingsLoad = await recoverJSON('settings.json', defaultSettings(), value => {
    try { validateSettings(value); return true; } catch { return false; }
  }, SETTINGS_BYTES);
  settings = settingsLoad.value;
  settingsWritable = settingsLoad.writable;
  const sessionLoad = await sessionStore.load();
  api.pinPersistedSnapshots(sessionLoad.value?.pages.map(page => page.snapshotKey) || []);
  const downloadsLoad = await recoverJSON('downloads.json', [], Array.isArray);
  downloadsWritable = downloadsLoad.writable;
  storageIssues = [settingsLoad.issue, sessionLoad.issue, downloadsLoad.issue].filter(Boolean);
  downloads.restore(downloadsLoad.value);
  if (downloads.list().some(job => job.result.includes('Interrupted when the app closed'))) queueDownloadPersist(true);
  if (settings.downloadFolder) await downloads.cleanupOrphans(settings.downloadFolder).catch(() => {});
  registerIPC();
  createMenu();
  createWindow();
  initialRestoreTimer = setTimeout(() => { if (!initialRestoreStarted) void restoreAccount(); }, 3000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

if (singleInstance) app.on('second-instance', () => {
  if (!window || window.isDestroyed()) { createWindow(); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { quitting = true; });
