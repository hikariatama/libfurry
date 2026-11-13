const fs = require('node:fs/promises');
const { renameSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

function dataPath(name) {
  return path.join(app.getPath('userData'), name);
}

async function readJSON(name, fallback, maxBytes = 128 * 1024 * 1024) {
  try {
    const handle = await fs.open(dataPath(name), 'r');
    try {
      if ((await handle.stat()).size > maxBytes) throw new Error('Stored JSON exceeds the size limit');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('Stored JSON exceeds the size limit');
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
    } finally { await handle.close(); }
  }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function recoverJSON(name, fallback, valid, maxBytes) {
  try {
    const value = await readJSON(name, fallback, maxBytes);
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

async function writeAtomic(name, data, canCommit) {
  const destination = dataPath(name);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.writeFile(temporary, data, { mode: 0o600 });
    if (canCommit) {
      if (!canCommit()) throw new Error('Sign-in was cancelled by an account change');
      // Keep the intent check and the atomic credential commit in one JS turn.
      renameSync(temporary, destination);
    } else await fs.rename(temporary, destination);
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

async function saveCredentials(value, canCommit) {
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
  await writeAtomic('credentials.bin', encrypted, canCommit);
}

async function clearCredentials() {
  await fs.rm(dataPath('credentials.bin'), { force: true });
}

module.exports = { dataPath, readJSON, recoverJSON, saveJSON, writeAtomic, loadCredentials, saveCredentials, clearCredentials };
