const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

function dataPath(name) {
  return path.join(app.getPath('userData'), name);
}

async function readJSON(name, fallback) {
  try { return JSON.parse(await fs.readFile(dataPath(name), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function recoverJSON(name, fallback, valid) {
  try {
    const value = await readJSON(name, fallback);
    if (!valid(value)) throw new Error('Invalid data format');
    return { value, issue: null, writable: true };
  } catch (error) {
    const original = dataPath(name);
    const backup = `${original}.damaged-${Date.now()}-${crypto.randomUUID()}`;
    const reason = String(error.message || error);
    try {
      await fs.rename(original, backup);
      return { value: fallback, issue: `${name}: ${reason}. Original file saved to ${backup}`, writable: true };
    } catch (backupError) {
      return { value: fallback, issue: `${name}: ${reason}. Could not create a backup: ${String(backupError.message || backupError)}`, writable: false };
    }
  }
}

async function writeAtomic(name, data) {
  const destination = dataPath(name);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.writeFile(temporary, data, { mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function saveJSON(name, value) {
  await writeAtomic(name, JSON.stringify(value));
}

async function loadCredentials() {
  try {
    const encrypted = await fs.readFile(dataPath('credentials.bin'));
    const { result } = await safeStorage.decryptStringAsync(encrypted);
    const value = JSON.parse(result);
    if (typeof value.username === 'string' && typeof value.apiKey === 'string') return value;
    throw new Error('Invalid saved credentials');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveCredentials(value) {
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
  await writeAtomic('credentials.bin', encrypted);
}

async function clearCredentials() {
  await fs.rm(dataPath('credentials.bin'), { force: true });
}

module.exports = { dataPath, readJSON, recoverJSON, saveJSON, writeAtomic, loadCredentials, saveCredentials, clearCredentials };
