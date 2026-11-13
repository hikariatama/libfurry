const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { API_BODY_BYTES } = require('./network.cjs');

const CACHE_BYTES = 40 * 1024 * 1024 * 1024;
const CACHE_FILES = 100000;
const CACHE_ENTRY_BYTES = API_BODY_BYTES + 1024 * 1024;

class CacheStorage {
  constructor(root, protectedSnapshots, { maxBytes = CACHE_BYTES, maxFiles = CACHE_FILES, maxEntryBytes = CACHE_ENTRY_BYTES, maxPendingWrites = 8 } = {}) {
    this.root = root;
    this.protectedSnapshots = protectedSnapshots;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.maxEntryBytes = maxEntryBytes;
    this.tail = Promise.resolve();
    this.entries = null;
    this.pendingWrites = 0;
    this.maxPendingWrites = maxPendingWrites;
  }

  async read(filename) {
    const handle = await fs.open(filename, 'r');
    try {
      if ((await handle.stat()).size > this.maxEntryBytes) throw new Error('Cache entry exceeds the size limit');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        bytes += chunk.length;
        if (bytes > this.maxEntryBytes) throw new Error('Cache entry exceeds the size limit');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, bytes).toString('utf8');
    } finally { await handle.close(); }
  }

  write(destination, data) {
    if (this.pendingWrites >= this.maxPendingWrites) return Promise.reject(new Error('Cache write queue is full. Try again shortly.'));
    const bytes = Buffer.byteLength(data);
    if (bytes > this.maxEntryBytes) return Promise.reject(new Error('Cache entry exceeds the size limit'));
    const save = async () => {
      if (!this.entries) {
        const indexed = new Map();
        for (const directory of ['search-cache', 'page-snapshots']) {
          const folder = path.join(this.root, directory);
          await fs.mkdir(folder, { recursive: true });
          for await (const item of await fs.opendir(folder)) {
            if (!item.name.endsWith('.json')) continue;
            if (indexed.size > this.maxFiles) throw new Error('Cache file limit reached. Refresh or clear unused cache.');
            const file = path.join(folder, item.name);
            let stat;
            try { stat = await fs.stat(file); }
            catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            indexed.set(file, { file, bytes: stat.size, time: stat.mtimeMs,
              snapshot: directory === 'page-snapshots' ? item.name.slice(0, -5) : null });
          }
        }
        this.entries = indexed;
      }
      const indexed = this.entries;
      const entries = [...indexed.values()];
      let total = entries.reduce((sum, entry) => sum + (entry.file === destination ? 0 : entry.bytes), 0) + bytes;
      let count = entries.length + (entries.some(entry => entry.file === destination) ? 0 : 1);
      const protectedKeys = this.protectedSnapshots();
      if (total > this.maxBytes || count > this.maxFiles) entries.sort((a, b) => a.time - b.time);
      for (const entry of entries) {
        if (total <= this.maxBytes && count <= this.maxFiles) break;
        if (protectedKeys.has(entry.snapshot) || entry.file === destination) continue;
        await fs.rm(entry.file, { force: true });
        indexed.delete(entry.file);
        total -= entry.bytes;
        count--;
      }
      if (total > this.maxBytes || count > this.maxFiles) throw new Error('Cache is full; saved gallery pages were preserved');
      const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, data);
        await fs.rename(temporary, destination);
        indexed.set(destination, { file: destination, bytes, time: Date.now(),
          snapshot: path.basename(path.dirname(destination)) === 'page-snapshots' ? path.basename(destination, '.json') : null });
      }
      finally { await fs.rm(temporary, { force: true }); }
    };
    this.pendingWrites++;
    const result = this.tail.then(save).finally(() => { this.pendingWrites--; });
    this.tail = result.catch(() => {});
    return result;
  }
}

module.exports = { CacheStorage, CACHE_BYTES, CACHE_FILES, CACHE_ENTRY_BYTES };
