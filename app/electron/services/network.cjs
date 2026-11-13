const USER_AGENT = 'libfurry/0.2 (personal macOS client; contact via e621)';
const API_BODY_BYTES = 64 * 1024 * 1024;
const ERROR_BODY_BYTES = 1024 * 1024;
const MEDIA_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function allowedMediaURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(?:static\d*\.)?(e621|e926)\.net$/i.test(url.hostname) && url.pathname.startsWith('/data/');
  } catch { return false; }
}

function allowedAPIURL(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://e621.net' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

async function discard(response) {
  if (typeof response?.body?.cancel === 'function') await response.body.cancel().catch(() => {});
}

async function fetchAllowed(value, options = {}, media = false) {
  let url = new URL(value);
  const allowed = media ? allowedMediaURL : allowedAPIURL;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(url)) throw new Error('Blocked an untrusted network address');
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await discard(response);
    if (!location || hop === MAX_REDIRECTS) throw new Error('Too many or invalid redirects');
    if (!media && options.method && !['GET', 'HEAD'].includes(options.method)) {
      throw new Error('Redirects are not allowed for account actions');
    }
    url = new URL(location, url);
  }
}

function declaredBytes(response) {
  const raw = response.headers.get('content-length');
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Invalid response length');
  return Number(raw);
}

async function readText(response, limit = API_BODY_BYTES) {
  try {
    if (declaredBytes(response) > limit) throw new Error('Response exceeds the size limit');
    const chunks = [];
    let received = 0;
    for await (const chunk of response.body || []) {
      received += chunk.byteLength;
      if (received > limit) throw new Error('Response exceeds the size limit');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, received).toString('utf8');
  } catch (error) {
    await discard(response);
    throw error;
  }
}

async function readJSON(response) {
  return JSON.parse(await readText(response));
}

module.exports = { USER_AGENT, allowedMediaURL, fetchAllowed, readText, readJSON, declaredBytes, discard,
  API_BODY_BYTES, ERROR_BODY_BYTES, MEDIA_BYTES };
