const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { dataPath } = require('./storage.cjs');
const { USER_AGENT, allowedMediaURL, fetchAllowed, readJSON, readText, discard, ERROR_BODY_BYTES } = require('./network.cjs');
const { CacheStorage } = require('./cache-storage.cjs');
const MAX_PENDING_REQUESTS = 2048;

const BASE = 'https://e621.net';
const PAGE_SIZE = 160;
const AUTOCOMPLETE_CACHE_LIMIT = 128;
const AUTOCOMPLETE_CACHE_MS = 10 * 60_000;

function recoverableSearchError(error) {
  const status = /^e621: (\d{3})\b/.exec(String(error?.message || error));
  if (status) return Number(status[1]) === 408 || Number(status[1]) === 429 || Number(status[1]) >= 500;
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError ||
    error?.message === 'e621 did not respond';
}

class E621Client {
  constructor({ maxPendingRequests = MAX_PENDING_REQUESTS } = {}) {
    this.credentials = null;
    this.authGeneration = 0;
    this.pendingRequests = 0;
    this.maxPendingRequests = maxPendingRequests;
    this.nextRequest = 0;
    this.requestTail = Promise.resolve();
    this.lastCachePrune = 0;
    this.cachePruneRunning = false;
    this.autocompleteController = null;
    this.autocompleteCache = new Map();
    this.activeSnapshots = new Set();
    this.persistedSnapshots = new Set();
    this.cacheStorage = new CacheStorage(dataPath(''), () => new Set([...this.activeSnapshots, ...this.persistedSnapshots]));
  }

  invalidateCredentials() { this.authGeneration++; }

  setCredentials(value) { this.invalidateCredentials(); this.credentials = value; }

  pinSnapshots(keys) {
    this.activeSnapshots = new Set(keys.filter(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)));
  }

  pinPersistedSnapshots(keys) {
    this.persistedSnapshots = new Set(keys.filter(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)));
  }

  async request(route, { method = 'GET', form, auth = this.credentials, headers = {}, signal, timeoutMs = 15000, allowStaleAuth = false } = {}) {
    if (this.pendingRequests >= this.maxPendingRequests) throw new Error('API queue is full. Try again shortly.');
    const generation = this.authGeneration;
    const check = () => {
      signal?.throwIfAborted();
      if (auth && !allowStaleAuth && generation !== this.authGeneration) throw new Error('Account changed before the request was sent');
    };
    const perform = async () => {
      check();
      const delay = Math.max(0, this.nextRequest - Date.now());
      if (delay) await wait(delay, undefined, { signal });
      check();
      this.nextRequest = Date.now() + 1100;
      const requestHeaders = { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers };
      if (auth) requestHeaders.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.apiKey}`).toString('base64')}`;
      let body;
      if (form) {
        body = new URLSearchParams(form);
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        check();
        const timeout = AbortSignal.timeout(timeoutMs);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetchAllowed(new URL(route, BASE), { method, headers: requestHeaders, body, signal: requestSignal });
        if (response.status === 429 || response.status === 503) {
          if (attempt === 0) {
            await discard(response);
            await wait(Math.min(5000, Math.max(500, Number(response.headers.get('retry-after') || 1) * 1000)), undefined, { signal });
            continue;
          }
        }
        if (!response.ok && response.status !== 304) {
          throw new Error(`e621: ${response.status} ${String(await readText(response, ERROR_BODY_BYTES)).slice(0, 160)}`);
        }
        return response;
      }
      throw new Error('e621 did not respond');
    };
    this.pendingRequests++;
    const result = this.requestTail.then(perform, perform).finally(() => { this.pendingRequests--; });
    this.requestTail = result.then(() => {}, () => {});
    return result;
  }

  cachePath(query, cursor, account = this.credentials?.username.toLowerCase() || 'guest') {
    const key = crypto.createHash('sha256').update(`${account}\n${PAGE_SIZE}\n${query}\n${cursor}`).digest('hex');
    return dataPath(path.join('search-cache', `${key}.json`));
  }

  async saveSnapshot(posts, replace = false) {
    const data = JSON.stringify(posts);
    const key = crypto.createHash('sha256').update(data).digest('hex');
    const destination = dataPath(path.join('page-snapshots', `${key}.json`));
    let exists = false;
    try { await fs.access(destination); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (replace || !exists) {
      await this.cacheStorage.write(destination, data);
    }
    return key;
  }

  async snapshotPage(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid page snapshot');
    const data = await this.cacheStorage.read(dataPath(path.join('page-snapshots', `${key}.json`)));
    if (crypto.createHash('sha256').update(data).digest('hex') !== key) throw new Error('Page snapshot is damaged');
    const posts = JSON.parse(data);
    if (!Array.isArray(posts)) throw new Error('Page snapshot is damaged');
    return { posts, fromCache: true, snapshotKey: key };
  }

  async restorePage(key, query, cursor) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid page snapshot');
    try { return await this.snapshotPage(key); }
    catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError) && error.message !== 'Page snapshot is damaged') throw error;
    }
    const cached = await this.cachedSearch(query, cursor);
    if (cached && crypto.createHash('sha256').update(JSON.stringify(cached.posts)).digest('hex') === key) {
      return { posts: cached.posts, fromCache: true, snapshotKey: await this.saveSnapshot(cached.posts, true) };
    }
    const recovered = await this.search(query, cursor, false, undefined, true);
    if (recovered.snapshotKey !== key) throw new Error('Page snapshot was lost. Refresh the search.');
    return recovered;
  }

  async cachedSearch(query, cursor, account = this.credentials?.username.toLowerCase() || 'guest') {
    try {
      const cached = JSON.parse(await this.cacheStorage.read(this.cachePath(query, cursor, account)));
      if (!Array.isArray(cached.posts)) return null;
      let snapshotKey = cached.snapshotKey;
      if (snapshotKey) {
        try { await fs.access(dataPath(path.join('page-snapshots', `${snapshotKey}.json`))); }
        catch { snapshotKey = null; }
      }
      return { ...cached, snapshotKey: snapshotKey || await this.saveSnapshot(cached.posts) };
    } catch { return null; }
  }

  async search(query, cursor = '', refresh = false, signal, background = false) {
    if (!cursor && !background) this.cancelAutocomplete();
    const credentials = this.credentials;
    const account = credentials?.username.toLowerCase() || 'guest';
    const cached = await this.cachedSearch(query, cursor, account);
    const params = new URLSearchParams({ tags: query, limit: String(PAGE_SIZE), v2: 'true', mode: 'thumbnail' });
    if (cursor) params.set('page', cursor);
    let response;
    let posts;
    try {
      response = await this.request(`/posts.json?${params}`, {
        auth: credentials,
        headers: !refresh && !credentials && cached?.etag ? { 'If-None-Match': cached.etag } : {},
        signal,
      });
      if (response.status === 304 && cached) return { posts: cached.posts, fromCache: true, snapshotKey: cached.snapshotKey };
      posts = await readJSON(response);
      if (!Array.isArray(posts) || posts.length > PAGE_SIZE) throw new Error('Invalid e621 response');
    } catch (error) {
      if (signal?.aborted) throw error;
      if (cached && recoverableSearchError(error)) return { posts: cached.posts, fromCache: true, snapshotKey: cached.snapshotKey };
      throw error;
    }
    const stored = { posts, snapshotKey: await this.saveSnapshot(posts), etag: response.headers.get('etag'), savedAt: Date.now() };
    const destination = this.cachePath(query, cursor, account);
    await this.cacheStorage.write(destination, JSON.stringify(stored));
    void this.pruneCache();
    return { posts, fromCache: false, snapshotKey: stored.snapshotKey };
  }

  async pruneCache() {
    if (this.cachePruneRunning || Date.now() - this.lastCachePrune < 60 * 60_000) return;
    this.cachePruneRunning = true;
    this.lastCachePrune = Date.now();
    try {
      const directory = dataPath('search-cache');
      const entries = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json')).map(async name => {
        const file = path.join(directory, name);
        const stat = await fs.stat(file);
        return { file, size: stat.size, mtime: stat.mtimeMs };
      }));
      let size = entries.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of entries.sort((a, b) => a.mtime - b.mtime)) {
        if (size <= 512 * 1024 * 1024 && Date.now() - entry.mtime < 30 * 86400_000) break;
        await fs.rm(entry.file, { force: true });
        size -= entry.size;
      }
      const snapshotDirectory = dataPath('page-snapshots');
      const snapshots = await Promise.all((await fs.readdir(snapshotDirectory)).filter(name => name.endsWith('.json')).map(async name => {
        const file = path.join(snapshotDirectory, name);
        const stat = await fs.stat(file);
        return { file, size: stat.size, mtime: stat.mtimeMs };
      }));
      let snapshotSize = snapshots.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of snapshots.sort((a, b) => a.mtime - b.mtime)) {
        const key = path.basename(entry.file, '.json');
        if (this.activeSnapshots.has(key) || this.persistedSnapshots.has(key)) continue;
        if (Date.now() - entry.mtime < 7 * 86400_000) continue;
        if (snapshotSize <= 1024 * 1024 * 1024 && Date.now() - entry.mtime < 30 * 86400_000) break;
        await fs.rm(entry.file, { force: true });
        snapshotSize -= entry.size;
      }
    } catch { /* Cache maintenance must not interrupt searching. */ }
    finally { this.cachePruneRunning = false; this.cacheStorage.entries = null; }
  }

  async autocomplete(prefix) {
    const term = String(prefix).trim().toLowerCase();
    this.cancelAutocomplete();
    if (term.length < 2) return [];
    const cached = this.autocompleteCache.get(term);
    if (cached) {
      this.autocompleteCache.delete(term);
      if (cached.expiresAt > Date.now()) {
        this.autocompleteCache.set(term, cached);
        return cached.tags;
      }
    }
    const controller = new AbortController();
    this.autocompleteController = controller;
    const params = new URLSearchParams({
      'search[name_matches]': `${term}*`,
      'search[order]': 'count',
      limit: '10',
    });
    try {
      const response = await this.request(`/tags.json?${params}`, { signal: controller.signal });
      const tags = await readJSON(response);
      const values = Array.isArray(tags) ? tags : tags.tags || [];
      this.autocompleteCache.set(term, { tags: values, expiresAt: Date.now() + AUTOCOMPLETE_CACHE_MS });
      if (this.autocompleteCache.size > AUTOCOMPLETE_CACHE_LIMIT) this.autocompleteCache.delete(this.autocompleteCache.keys().next().value);
      return values;
    } finally {
      if (this.autocompleteController === controller) this.autocompleteController = null;
    }
  }

  cancelAutocomplete() {
    this.autocompleteController?.abort();
    this.autocompleteController = null;
  }

  async detail(id, signal, auth = this.credentials) {
    const response = await this.request(`/posts/${Number(id)}.json`, { signal, auth });
    return (await readJSON(response)).post;
  }

  async validate(credentials) {
    const response = await this.request('/users/me.json', { auth: credentials, allowStaleAuth: true });
    const profile = await readJSON(response);
    if (profile.name.toLowerCase() !== credentials.username.toLowerCase()) throw new Error('API key belongs to another account');
    return profile;
  }

  async profile(auth = this.credentials) {
    return this.request('/users/me.json', { auth }).then(response => readJSON(response));
  }

  async updateBlacklist(id, rules) {
    await discard(await this.request(`/users/${Number(id)}.json`, { method: 'PATCH', form: { 'user[blacklisted_tags]': rules } }));
  }

  async upvote(id) {
    const auth = this.credentials;
    const response = await this.request(`/posts/${Number(id)}/votes.json?score=1&no_unvote=true`, { method: 'POST', auth });
    const vote = await readJSON(response);
    if (vote.our_score === 1) return;
    // e621 currently returns our_score: 0 for an existing vote even with
    // no_unvote=true. Confirm the post still carries our vote before succeeding.
    if (vote.our_score === 0 && (await this.detail(id, undefined, auth)).vote === 1) return;
    throw new Error('e621 did not confirm the upvote');
  }

  async favorite(id) {
    const auth = this.credentials;
    try { await discard(await this.request('/favorites.json', { method: 'POST', form: { post_id: String(Number(id)) }, auth })); }
    catch (error) {
      if (!String(error).includes('e621: 422') || !(await this.detail(id, undefined, auth)).is_favorited) throw error;
    }
  }

  async unfavorite(id) {
    try { await discard(await this.request(`/favorites/${Number(id)}.json`, { method: 'DELETE' })); }
    catch (error) { if (!String(error).includes('404')) throw error; }
  }
}

module.exports = { E621Client, allowedMediaURL, USER_AGENT, MAX_PENDING_REQUESTS };
