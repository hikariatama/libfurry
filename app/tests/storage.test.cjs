const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function storageFor(root) {
  const electronModule = require.resolve('electron');
  const storageModule = require.resolve('../electron/services/storage.cjs');
  require.cache[electronModule] = {
    id: electronModule, filename: electronModule, loaded: true,
    exports: { app: { getPath: () => root }, safeStorage: {} },
  };
  delete require.cache[storageModule];
  return require('../electron/services/storage.cjs');
}

test('missing JSON uses the default, while damaged JSON is preserved for recovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-storage-'));
  try {
    const storage = storageFor(root);
    assert.deepEqual(await storage.recoverJSON('settings.json', { columns: 8 }, value => value?.columns === 8),
      { value: { columns: 8 }, issue: null, writable: true });

    await fs.writeFile(path.join(root, 'settings.json'), '{broken json');
    await assert.rejects(storage.readJSON('settings.json', {}), SyntaxError);
    const result = await storage.recoverJSON('settings.json', { columns: 8 }, value => value?.columns === 8);
    assert.deepEqual(result.value, { columns: 8 });
    assert.equal(result.writable, true);
    assert.match(result.issue, /settings\.json:.*Original file saved/);
    const backup = (await fs.readdir(root)).find(name => name.startsWith('settings.json.damaged-'));
    assert.equal(await fs.readFile(path.join(root, backup), 'utf8'), '{broken json');
    await assert.rejects(fs.access(path.join(root, 'settings.json')), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a failed backup leaves damaged data untouched and disables writes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-storage-'));
  const originalRename = fs.rename;
  try {
    const storage = storageFor(root);
    await fs.writeFile(path.join(root, 'downloads.json'), '{}');
    fs.rename = async () => { throw new Error('disk unavailable'); };
    const result = await storage.recoverJSON('downloads.json', [], Array.isArray);
    assert.deepEqual(result.value, []);
    assert.equal(result.writable, false);
    assert.match(result.issue, /Could not create a backup/);
    assert.equal(await fs.readFile(path.join(root, 'downloads.json'), 'utf8'), '{}');
  } finally {
    fs.rename = originalRename;
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('a changed credential intent cannot commit encrypted bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'libfurry-credential-guard-'));
  try {
    const storage = storageFor(root);
    let current = true;
    const electron = require('electron');
    electron.safeStorage.encryptStringAsync = async () => { current = false; return Buffer.from('synthetic encrypted bytes'); };
    await assert.rejects(storage.saveCredentials({ username: 'test', apiKey: 'test-only' }, () => current), /cancelled/);
    assert.deepEqual(await fs.readdir(root), []);
    current = true;
    electron.safeStorage.encryptStringAsync = async () => Buffer.from('synthetic encrypted bytes');
    await storage.saveCredentials({ username: 'test', apiKey: 'test-only' }, () => current);
    assert.equal(await fs.readFile(path.join(root, 'credentials.bin'), 'utf8'), 'synthetic encrypted bytes');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('oversized stored JSON is preserved as damaged before parsing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'libfurry-json-limit-'));
  try {
    const storage = storageFor(root);
    await fs.writeFile(path.join(root, 'settings.json'), '123456789');
    const result = await storage.recoverJSON('settings.json', {}, () => true, 8);
    assert.match(result.issue, /size limit/);
    const backup = (await fs.readdir(root)).find(name => name.startsWith('settings.json.damaged-'));
    assert.equal(await fs.readFile(path.join(root, backup), 'utf8'), '123456789');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
