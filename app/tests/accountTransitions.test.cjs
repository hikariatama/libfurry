const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function mainHarness({ validate, profile, upvote, favorite, unfavorite, loadCredentials, saveCredentials, clearCredentials, saveJSON = async () => {} } = {}) {
  const handlers = new Map();
  const messages = [];
  const appEvents = new Map();
  const timers = new Set();
  let currentWindow;
  let quitCount = 0;
  const appPaths = { appData: '/test/Application Support' };
  let appName;
  let lockPath;
  let ready;
  const appReady = new Promise(resolve => { ready = resolve; });
  let windowCreated;
  const windowReady = new Promise(resolve => { windowCreated = resolve; });
  const webContents = {
    send(...args) { messages.push(args); }, once() {}, on() {}, setWindowOpenHandler() {},
    session: { webRequest: { onBeforeSendHeaders() {} } },
  };
  const api = {
    pinPersistedSnapshots() {},
    credentials: null,
    validate,
    profile,
    upvote: upvote || (async () => {}),
    favorite: favorite || (async () => {}),
    unfavorite: unfavorite || (async () => {}),
    setCredentials(value) { this.credentials = value; },
  };
  class BrowserWindow {
    constructor(options) { this.options = options; this.webContents = webContents; this.events = new Map(); this.closed = false; currentWindow = this; windowCreated(); }
    once() {}
    on(name, callback) { this.events.set(name, callback); }
    close() {
      let prevented = false;
      this.events.get('close')?.({ preventDefault() { prevented = true; } });
      if (!prevented) this.closed = true;
    }
    loadFile() {}
    isDestroyed() { return this.closed; }
    isVisible() { return true; }
    show() {}
  }
  BrowserWindow.getAllWindows = () => [];
  const electron = {
    app: {
      setName(name) { appName = name; },
      getPath: name => appPaths[name], setPath: (name, value) => { appPaths[name] = value; },
      requestSingleInstanceLock() { lockPath = appPaths.userData; return true; }, whenReady: () => appReady,
      on: (name, callback) => appEvents.set(name, callback),
      quit() { quitCount++; currentWindow.close(); },
    },
    BrowserWindow,
    Menu: { buildFromTemplate: value => value, setApplicationMenu() {} },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    dialog: {}, shell: {}, clipboard: {},
  };
  const storage = {
    recoverJSON: async (_name, fallback) => ({ value: fallback, issue: null, writable: true }),
    saveJSON, loadCredentials: loadCredentials || (async () => null),
    saveCredentials, clearCredentials,
  };
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  vm.runInNewContext(source, {
    require: name => {
      if (name === 'electron') return electron;
      if (name === './services/e621.cjs') return { E621Client: class { constructor() { return api; } }, USER_AGENT: 'test' };
      if (name === './services/downloads.cjs') return { Downloads: class { list() { return []; } restore() {} cleanupOrphans() {} } };
      if (name === './services/storage.cjs') return storage;
      if (name === './services/search-session.cjs') return require('../electron/services/search-session.cjs');
      return require(name);
    },
    process: { env: {}, platform: 'darwin', pid: 1 },
    __dirname: path.join(__dirname, '../electron'),
    setTimeout(callback, delay) { const timer = { callback, delay }; timers.add(timer); return timer; },
    clearTimeout: timer => timers.delete(timer), AbortController, Buffer, console,
  }, { filename: 'electron/main.cjs' });
  ready();
  await windowReady;
  assert.equal(handlers.has('account:login'), true);
  const invoke = (name, ...args) => handlers.get(name)({ sender: webContents }, ...args);
  return { invoke, api, messages, window: currentWindow, appEvents, timers, handlers, quitCount: () => quitCount, appPaths, appName, lockPath };
}

test('libfurry uses the existing profile and single-instance lock after the rename', async () => {
  const harness = await mainHarness();
  assert.equal(harness.appName, 'libfurry');
  assert.equal(harness.appPaths.userData, path.join(harness.appPaths.appData, 'e322'));
  assert.equal(harness.lockPath, harness.appPaths.userData);
  assert.equal(harness.window.options.title, 'libfurry');
});

test('logout during login validation cannot restore the old account', async () => {
  let releaseValidation;
  const validation = new Promise(resolve => { releaseValidation = resolve; });
  let stored = null;
  const { invoke, api } = await mainHarness({
    validate: async credentials => { await validation; return { id: 1, name: credentials.username }; },
    saveCredentials: async value => { stored = value; },
    clearCredentials: async () => { stored = null; },
  });
  const login = invoke('account:login', 'first', 'key');
  await invoke('account:logout');
  releaseValidation();
  await assert.rejects(login, /Sign-in was cancelled by an account change/);
  assert.equal(stored, null);
  assert.equal(api.credentials, null);
});

test('logout clears a credential write already in progress', async () => {
  let releaseSave;
  let saveStarted;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const started = new Promise(resolve => { saveStarted = resolve; });
  let stored = null;
  const { invoke, api } = await mainHarness({
    validate: async credentials => ({ id: 1, name: credentials.username }),
    saveCredentials: async value => { saveStarted(); await saveGate; stored = value; },
    clearCredentials: async () => { stored = null; },
  });
  const login = invoke('account:login', 'first', 'key');
  await started;
  const logout = invoke('account:logout');
  releaseSave();
  await assert.rejects(login, /Sign-in was cancelled by an account change/);
  await logout;
  assert.equal(stored, null);
  assert.equal(api.credentials, null);
});

test('a later login wins over an earlier validation that finishes late', async () => {
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const writes = [];
  const { invoke, api } = await mainHarness({
    validate: async credentials => {
      if (credentials.username === 'first') await firstGate;
      return { id: credentials.username === 'first' ? 1 : 2, name: credentials.username };
    },
    saveCredentials: async value => { writes.push(value.username); },
    clearCredentials: async () => {},
  });
  const first = invoke('account:login', 'first', 'key-one');
  const second = invoke('account:login', 'second', 'key-two');
  const latest = await second;
  releaseFirst();
  await assert.rejects(first, /Sign-in was cancelled by an account change/);
  assert.equal(latest.profile.name, 'second');
  assert.equal(api.credentials.username, 'second');
  assert.deepEqual(writes, ['second']);
});

test('account actions are blocked while logout is waiting for credential storage', async () => {
  let releaseClear;
  let clearStarted;
  const clearGate = new Promise(resolve => { releaseClear = resolve; });
  const started = new Promise(resolve => { clearStarted = resolve; });
  const { invoke, api } = await mainHarness({
    validate: async credentials => ({ id: 1, name: credentials.username }),
    saveCredentials: async () => {},
    clearCredentials: async () => { clearStarted(); await clearGate; },
  });
  await invoke('account:login', 'first', 'key');
  const logout = invoke('account:logout');
  await started;
  await assert.rejects(invoke('post:upvote', 1), /Wait for the account to switch/);
  releaseClear();
  await logout;
  assert.equal(api.credentials, null);
  await assert.rejects(invoke('post:upvote', 1), /Sign in first/);
});

test('an action completed for the old account cannot report success after account switch', async () => {
  let releaseVote;
  let voteStarted;
  const gate = new Promise(resolve => { releaseVote = resolve; });
  const started = new Promise(resolve => { voteStarted = resolve; });
  const { invoke } = await mainHarness({
    validate: async credentials => ({ id: credentials.username === 'first' ? 1 : 2, name: credentials.username }),
    saveCredentials: async () => {}, clearCredentials: async () => {},
    upvote: async () => { voteStarted(); await gate; },
  });
  await invoke('account:login', 'first', 'first-key');
  const pending = invoke('post:upvote', 42);
  await started;
  await invoke('account:login', 'second', 'second-key');
  releaseVote();
  await assert.rejects(pending, /Account changed/);
});

test('favorite completed for the old account cannot report success after account switch', async () => {
  let releaseFavorite;
  let favoriteStarted;
  const gate = new Promise(resolve => { releaseFavorite = resolve; });
  const started = new Promise(resolve => { favoriteStarted = resolve; });
  const { invoke } = await mainHarness({
    validate: async credentials => ({ id: credentials.username === 'first' ? 1 : 2, name: credentials.username }),
    saveCredentials: async () => {}, clearCredentials: async () => {},
    favorite: async () => { favoriteStarted(); await gate; },
  });
  await invoke('account:login', 'first', 'first-key');
  const pending = invoke('post:favorite', 42, true);
  await started;
  await invoke('account:login', 'second', 'second-key');
  releaseFavorite();
  await assert.rejects(pending, /Account changed/);
});

test('saved credentials are activated only after the profile check succeeds', async () => {
  let releaseProfile;
  let profileStarted;
  const gate = new Promise(resolve => { releaseProfile = resolve; });
  const started = new Promise(resolve => { profileStarted = resolve; });
  const { invoke, api } = await mainHarness({
    validate: async () => ({ id: 2, name: 'other' }),
    profile: async credentials => {
      assert.equal(credentials.username, 'saved');
      profileStarted();
      await gate;
      return { id: 1, name: 'saved' };
    },
    loadCredentials: async () => ({ username: 'saved', apiKey: 'saved-key' }),
    saveCredentials: async () => {}, clearCredentials: async () => {},
  });
  const pending = invoke('account:retry');
  await started;
  assert.equal(api.credentials, null);
  releaseProfile();
  await pending;
  assert.equal(api.credentials.username, 'saved');
});

test('a failed login resumes an interrupted restore of saved credentials', async () => {
  let releaseFirstProfile;
  let firstProfileStarted;
  const profileGate = new Promise(resolve => { releaseFirstProfile = resolve; });
  const started = new Promise(resolve => { firstProfileStarted = resolve; });
  let profileCalls = 0;
  const { invoke, api, messages } = await mainHarness({
    validate: async () => { throw new Error('Incorrect key'); },
    profile: async () => {
      profileCalls++;
      if (profileCalls === 1) { firstProfileStarted(); await profileGate; }
      return { id: 1, name: 'saved' };
    },
    loadCredentials: async () => ({ username: 'saved', apiKey: 'saved-key' }),
    saveCredentials: async () => {}, clearCredentials: async () => {},
  });
  const firstRestore = invoke('account:retry');
  await started;
  await assert.rejects(invoke('account:login', 'wrong', 'wrong-key'), /Incorrect key/);
  releaseFirstProfile();
  await firstRestore;
  for (let attempt = 0; attempt < 10 && profileCalls < 2; attempt++) await new Promise(setImmediate);
  assert.equal(profileCalls, 2);
  assert.equal(api.credentials.username, 'saved');
  assert.equal(messages.some(([channel, value]) => channel === 'account:changed' && value.profile?.name === 'saved'), true);
});

function savedSession(offset = 0) {
  return {
    version: 1, query: 'fox', draft: 'fox -cat', rating: 's', accountId: null,
    pages: [{ cursor: '', snapshotKey: 'a'.repeat(64), slots: [{ id: 17, ratio: 1, reacted: false }] }],
    nextCursor: null, anchor: { id: 17, offset },
    counts: { raw: 1, available: 1, blacklisted: 0, reacted: 0 }, reactions: [],
  };
}

test('window close waits for the last scroll checkpoint before closing or quitting', async () => {
  const writes = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const harness = await mainHarness({ saveJSON: async (name, value) => { await gate; writes.push({ name, value }); } });
  harness.window.close();
  assert.equal(harness.window.closed, false);
  assert.ok(harness.messages.some(([name]) => name === 'session:flush-request'));
  const write = harness.invoke('session:save', savedSession(-27));
  const close = harness.invoke('session:flushed');
  await new Promise(setImmediate);
  assert.equal(harness.window.closed, false);
  release();
  await Promise.all([write, close]);
  assert.equal(harness.window.closed, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'session.json');
  assert.deepEqual(writes[0].value.anchor, { id: 17, offset: -27 });
  assert.equal(harness.quitCount(), 0);

  const quitting = await mainHarness();
  quitting.appEvents.get('before-quit')();
  quitting.window.close();
  await quitting.invoke('session:save', savedSession(12));
  await quitting.invoke('session:flushed');
  assert.equal(quitting.quitCount(), 1);
  assert.equal(quitting.window.closed, true);
});

test('a non-responsive renderer cannot prevent closing, and other senders cannot replace the session', async () => {
  const harness = await mainHarness();
  await harness.invoke('session:save', savedSession(5));
  await assert.rejects(harness.handlers.get('session:save')({ sender: {} }, savedSession(10)), /Unauthorized source/);
  harness.window.close();
  const timeout = [...harness.timers].find(timer => timer.delay === 2000);
  assert.ok(timeout);
  timeout.callback();
  await new Promise(setImmediate);
  assert.equal(harness.window.closed, true);
  const boot = await harness.invoke('app:bootstrap');
  assert.equal(boot.session.anchor.offset, 5);
});
