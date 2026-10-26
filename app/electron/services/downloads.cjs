const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { allowedMediaURL, USER_AGENT } = require('./e621.cjs');

function safeName(value) {
  return String(value || 'unknown').normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 72) || 'unknown';
}

async function md5File(filename) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function expectedMD5(value) {
  return typeof value === 'string' && /^[a-f\d]{32}$/i.test(value) ? value.toLowerCase() : null;
}

function translateSavedResult(value) {
  const exact = {
    'Сохранено': 'Saved', 'Файл уже сохранён': 'Already saved',
    'Апвоут': 'Upvoted', 'Избранное': 'Favorited',
    'Прервано при закрытии приложения': 'Interrupted when the app closed',
    'Оригинал недоступен': 'Original file is unavailable',
    'Загрузка остановилась': 'Download stalled', 'Загрузка отменена': 'Download cancelled',
    'Не удалось записать файл': 'Could not write the file',
    'Получен пустой файл': 'Received an empty file',
    'Получен неполный файл': 'Received an incomplete file',
    'Контрольная сумма файла не совпала': 'File checksum did not match',
    'Существующий файл повреждён': 'Existing file is damaged',
  };
  if (exact[value]) return exact[value];
  return value.replace(/^Сохранение: /, 'Download: ')
    .replace(/^Апвоут: /, 'Upvote: ')
    .replace(/^Избранное: /, 'Favorite: ')
    .replace(/аккаунт изменился/g, 'account changed')
    .replace(/Сохранение: /g, 'Download: ')
    .replace(/Загрузка: /g, 'Download: ')
    .replace(/Оригинал недоступен/g, 'Original file is unavailable')
    .replace(/Загрузка остановилась/g, 'Download stalled')
    .replace(/Загрузка отменена/g, 'Download cancelled')
    .replace(/Не удалось записать файл/g, 'Could not write the file')
    .replace(/Получен пустой файл/g, 'Received an empty file')
    .replace(/Получен неполный файл/g, 'Received an incomplete file')
    .replace(/Контрольная сумма файла не совпала/g, 'File checksum did not match')
    .replace(/Существующий файл повреждён/g, 'Existing file is damaged')
    .replace(/Существующий файл #(\d+) повреждён/g, 'Existing file #$1 is damaged')
    .replace(/Существующий файл #(\d+) неполный/g, 'Existing file #$1 is incomplete');
}

class Downloads {
  constructor(api, changed, accountCurrent = () => true) {
    this.api = api;
    this.changed = changed;
    this.accountCurrent = accountCurrent;
    this.jobs = new Map();
    this.queue = [];
    this.active = 0;
    this.activeParts = new Set();
  }

  async cleanupOrphans(folder) {
    if (!folder) return;
    let names;
    try { names = await fs.readdir(folder); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await Promise.all(names.filter(name => /^\..+_e621_\d+\.[^.]+\.[a-f\d-]{36}\.part$/i.test(name))
      .map(async name => {
        const filename = path.join(folder, name);
        if (!this.activeParts.has(filename)) await fs.rm(filename, { force: true });
      }));
  }

  list() { return Array.from(this.jobs.values()).map(job => { const copy = { ...job }; delete copy.controller; delete copy.accountToken; return copy; }); }

  restore(saved) {
    if (!Array.isArray(saved)) return;
    for (const value of saved.slice(-100)) {
      if (!value || typeof value.id !== 'string' || !Number.isSafeInteger(value.postId) ||
          !['waiting', 'running', 'complete', 'failed', 'cancelled'].includes(value.status)) continue;
      const interrupted = value.status === 'waiting' || value.status === 'running';
      this.jobs.set(value.id, {
        id: value.id, postId: value.postId, folder: typeof value.folder === 'string' ? value.folder : '',
        combined: Boolean(value.combined), status: interrupted ? 'failed' : value.status,
        accountRevision: Number.isSafeInteger(value.accountRevision) ? value.accountRevision : null,
        fraction: Number(value.fraction) || 0, receivedBytes: Number(value.receivedBytes) || 0,
        totalBytes: Number(value.totalBytes) || 0,
        result: [...(Array.isArray(value.result) ? value.result.filter(item => typeof item === 'string').map(translateSavedResult) : []),
          ...(interrupted ? ['Interrupted when the app closed'] : [])],
      });
    }
    this.pruneFinished();
  }

  emit(job) {
    const copy = { ...job };
    delete copy.controller;
    delete copy.accountToken;
    this.changed(copy);
    if (['complete', 'failed', 'cancelled'].includes(job.status)) this.pruneFinished();
  }

  pruneFinished() {
    const finished = [...this.jobs].filter(([, job]) => ['complete', 'failed', 'cancelled'].includes(job.status));
    for (const [id] of finished.slice(0, -100)) this.jobs.delete(id);
  }

  start(post, folder, combined, accountToken = null, accountRevision = null) {
    const existing = [...this.jobs.values()].find(job => job.postId === post.id && job.folder === folder &&
      ['waiting', 'running'].includes(job.status) && !job.controller.signal.aborted &&
      (combined ? !job.combined || job.accountToken === accountToken
        : !job.combined || this.accountCurrent(job.accountToken)));
    if (existing) {
      if (combined && !existing.combined) {
        existing.combined = true;
        existing.accountToken = accountToken;
        existing.accountRevision = accountRevision;
        this.emit(existing);
      }
      return existing.id;
    }
    const job = {
      id: randomUUID(), postId: Number(post.id), folder, combined: Boolean(combined),
      status: 'waiting', fraction: 0, receivedBytes: 0, totalBytes: 0, result: [], controller: new AbortController(),
      accountToken: combined ? accountToken : null,
      accountRevision: combined ? accountRevision : null,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.emit(job);
    this.pump();
    return job.id;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || !['waiting', 'running'].includes(job.status)) return;
    job.controller.abort();
    if (job.status === 'waiting') {
      this.queue = this.queue.filter(item => item !== job);
      job.status = 'cancelled';
      this.emit(job);
    }
  }

  pump() {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      void this.run(job).finally(() => { this.active--; this.pump(); });
    }
  }

  async save(job) {
    const detail = await this.api.detail(job.postId, job.controller.signal);
    const fileURL = detail?.file?.url;
    if (!allowedMediaURL(fileURL)) throw new Error('Original file is unavailable');
    await fs.mkdir(job.folder, { recursive: true });
    const candidates = (await fs.readdir(job.folder)).filter(name =>
      new RegExp(`_e621_${job.postId}\\.[^.]+$`).test(name));
    const reportedSize = Number(detail.file.size);
    const expectedSize = Number.isFinite(reportedSize) && reportedSize > 0 ? reportedSize : 0;
    const md5 = expectedMD5(detail.file.md5);
    let invalidExisting = null;
    for (const name of candidates) {
      let stat;
      try { stat = await fs.stat(path.join(job.folder, name)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const sizeMatches = stat.isFile() && stat.size > 0 && (!expectedSize || stat.size === expectedSize);
      const hashMatches = sizeMatches && (!md5 || await md5File(path.join(job.folder, name)) === md5);
      if (hashMatches) {
        job.result.push('Already saved');
        break;
      }
      invalidExisting ||= { name, damaged: Boolean(sizeMatches && md5) };
    }
    if (invalidExisting && !job.result.length) {
      throw new Error(`Existing file #${job.postId} is ${invalidExisting.damaged ? 'damaged' : 'incomplete'}: ${invalidExisting.name}`);
    }
    if (!job.result.length) {
      const artist = detail.tags?.artist?.find(name => name !== 'unknown_artist') || detail.uploader;
      const species = detail.tags?.species?.[0];
      const extension = safeName(detail.file.ext || new URL(fileURL).pathname.split('.').pop()).toLowerCase();
      const filename = `${safeName(artist)}_${safeName(species)}_e621_${job.postId}.${extension}`;
      const destination = path.join(job.folder, filename);
      const part = path.join(job.folder, `.${filename}.${randomUUID()}.part`);
      this.activeParts.add(part);
      let handle;
      const stalled = new AbortController();
      let stallTimer;
      const resetStallTimer = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => stalled.abort(new Error('Download stalled')), 30_000);
      };
      try {
        resetStallTimer();
        const response = await fetch(fileURL, { headers: { 'User-Agent': USER_AGENT, Referer: 'https://e621.net/' }, signal: AbortSignal.any([job.controller.signal, stalled.signal]) });
        if (!response.ok || !response.body) throw new Error(`Download: ${response.status}`);
        handle = await fs.open(part, 'wx', 0o600);
        const reportedTotal = Number(response.headers.get('content-length') || 0);
        const total = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : 0;
        job.totalBytes = total || expectedSize || 0;
        let received = 0;
        const receivedHash = md5 ? createHash('md5') : null;
        let lastUpdate = 0;
        for await (const chunk of response.body) {
          if (job.controller.signal.aborted) throw new Error('Download cancelled');
          resetStallTimer();
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
            if (!bytesWritten) throw new Error('Could not write the file');
            offset += bytesWritten;
          }
          received += chunk.length;
          receivedHash?.update(chunk);
          job.receivedBytes = received;
          if (Date.now() - lastUpdate > 100) {
            if (job.totalBytes) job.fraction = Math.min(1, received / job.totalBytes);
            this.emit(job);
            lastUpdate = Date.now();
          }
        }
        await handle.close();
        handle = null;
        if (!received) throw new Error('Received an empty file');
        if ((expectedSize > 0 && received !== expectedSize) || (total > 0 && received !== total)) {
          throw new Error('Received an incomplete file');
        }
        if (receivedHash && receivedHash.digest('hex') !== md5) throw new Error('File checksum did not match');
        if (job.controller.signal.aborted) throw new Error('Download cancelled');
        try {
          await fs.link(part, destination);
          job.result.push('Saved');
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const existing = await fs.stat(destination);
          if (!existing.isFile() || !existing.size || (expectedSize && existing.size !== expectedSize) ||
              (md5 && await md5File(destination) !== md5)) throw new Error('Existing file is damaged');
          job.result.push('Already saved');
        }
        await fs.rm(part, { force: true });
      } catch (error) {
        await handle?.close().catch(() => {});
        await fs.rm(part, { force: true }).catch(() => {});
        throw stalled.signal.aborted ? stalled.signal.reason : error;
      } finally {
        clearTimeout(stallTimer);
        this.activeParts.delete(part);
      }
    }
  }

  async run(job) {
    job.status = 'running';
    this.emit(job);
    let failed = false;
    try {
      await this.save(job);
      job.fraction = 1;
    } catch (error) {
      failed = true;
      job.result.push(`${job.combined ? 'Download: ' : ''}${error.message}`);
      this.emit(job);
    }
    if (job.controller.signal.aborted) {
      job.status = 'cancelled';
      this.emit(job);
      return;
    }
    if (job.combined) {
      for (const [label, action] of [
        ['Upvoted', () => this.api.upvote(job.postId)],
        ['Favorited', () => this.api.favorite(job.postId)],
      ]) {
        if (job.controller.signal.aborted) {
          job.status = 'cancelled';
          this.emit(job);
          return;
        }
        if (!this.accountCurrent(job.accountToken)) {
          failed = true;
          job.result.push(`${label}: account changed`);
          this.emit(job);
          continue;
        }
        try { await action(); job.result.push(label); }
        catch (error) { failed = true; job.result.push(`${label}: ${error.message}`); }
        this.emit(job);
      }
    }
    job.status = failed ? 'failed' : 'complete';
    this.emit(job);
  }
}

module.exports = { Downloads };
