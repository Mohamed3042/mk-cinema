const API = 'https://api.github.com/repos/Mohamed3042/mk-cinema-library/contents/';
const POSTER_CACHE = 'mkc-private-posters-v1-';
const objectURLs = new Set();
const posterWrites = new Set();
let posterEpoch;
let posterCache;
let posterGeneration = 0;

export class CinemaError extends Error {
  constructor(code) {
    const messages = {
      token: 'Token is wrong or expired',
      access: "This token can't see the media repo",
      'rate-limit': 'GitHub request limit reached. Please try again later.',
      offline: 'You are offline',
      'github-unreachable': 'GitHub is unavailable',
      invalid: 'The library data is not valid',
      write: 'This key can change files',
    };
    super(messages[code] || messages.invalid);
    this.name = 'CinemaError';
    this.code = code;
  }
}

function invalid() { throw new CinemaError('invalid'); }

function validPath(path) {
  if (typeof path !== 'string' || !path || path.length > 2048 || /[\\\u0000-\u001f?#:%]/u.test(path)) invalid();
  if (path.split('/').some(part => !part || part === '.' || part === '..')) invalid();
  return path;
}

function demoURL(path) {
  validPath(path);
  return new URL(path.startsWith('demo/') ? `./${path}` : `./demo/${path}`, import.meta.url).href;
}

function apiURL(path) {
  return API + validPath(path).split('/').map(encodeURIComponent).join('/');
}

function networkError(error) {
  if (error?.name === 'AbortError' || error instanceof CinemaError) throw error;
  throw new CinemaError(globalThis.navigator?.onLine === false ? 'offline' : 'github-unreachable');
}

async function request(url, { token, accept, signal } = {}) {
  if (globalThis.navigator?.onLine === false) throw new CinemaError('offline');
  const headers = token ? {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: accept,
  } : {};
  let response;
  try {
    response = await fetch(url, { headers, signal, cache: 'no-store', redirect: 'error', credentials: 'omit' });
  } catch (error) { networkError(error); }
  if (!response.ok) {
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new CinemaError('rate-limit');
    if (response.status === 401 || response.status === 403) throw new CinemaError('token');
    if (response.status === 404) throw new CinemaError('access');
    throw new CinemaError('github-unreachable');
  }
  return response;
}

function auth(token) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) throw new CinemaError('token');
  return token.trim();
}

function text(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid();
  return value;
}

// A film the app cannot read is left out (and counted), so one bad entry never closes the whole cinema; a catalog
// that lists films must still have one readable film.
function catalog(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.films)) invalid();
  const updated = text(data.updated, 200), ids = new Set();
  const films = data.films.flatMap(entry => {
    let film;
    try { film = readFilm(entry); } catch (error) { if (error instanceof CinemaError) return []; throw error; }
    if (ids.has(film.id)) return [];
    ids.add(film.id);
    return [film];
  });
  if (data.films.length && !films.length) invalid();
  return { version: 1, updated, films, skipped: data.films.length - films.length };
}
// The fields that reach paths and sizes must be right. An optional label the app cannot read (a kind it does not know
// yet, an empty blurb) is dropped, and the screens use their default.
const LABELS = {
  product: ['MK Voice', 'MK Business OS', 'Talent Atlas', 'MK Job Orbit', 'MK Suite & apps', 'More films'],
  kind: ['film', 'episode', 'ad', 'loop', 'teaser', 'demo', 'reel'], lang: ['ar', 'en'],
};
const label = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;
function readFilm(film) {
  if (!film || typeof film !== 'object') invalid();
  const id = text(film.id, 200);
  if (!['ltr', 'rtl', 'auto'].includes(film.dir) || !['16:9', '9:16'].includes(film.posterShape)) invalid();
  if (!Number.isFinite(film.seconds) || film.seconds < 0 || !Array.isArray(film.versions) || !film.versions.length) invalid();
  const kinds = new Set();
  const versions = film.versions.map(version => {
    if (!version || !['phone', 'desktop'].includes(version.kind) || kinds.has(version.kind)) invalid();
    kinds.add(version.kind);
    if (![version.w, version.h, version.bytes].every(value => Number.isSafeInteger(value) && value > 0)) invalid();
    return { kind: version.kind, file: validPath(version.file), w: version.w, h: version.h, bytes: version.bytes };
  });
  const metadata = {};
  for (const [key, allowed] of Object.entries(LABELS)) if (allowed.includes(film[key])) metadata[key] = film[key];
  for (const key of ['group', 'variant', 'blurb']) {
    const value = label(film[key], key === 'blurb' ? 1000 : 200);
    if (value) metadata[key] = value;
  }
  return {
    id, title: text(film.title), dir: film.dir, seconds: film.seconds,
    added: label(film.added, 200) || '',
    poster: validPath(film.poster), posterShape: film.posterShape,
    versions, release: typeof film.release === 'string' ? film.release : null, ...metadata,
  };
}

export async function getCatalog({ demo = false, token, signal } = {}) {
  const response = await request(demo ? demoURL('cinema.json') : apiURL('cinema.json'), {
    token: demo ? undefined : auth(token), accept: 'application/vnd.github.raw', signal,
  });
  let data;
  try { data = await response.json(); } catch (error) {
    if (error?.name === 'AbortError') throw error;
    invalid();
  }
  return catalog(data);
}

// Checks a key made for an invite: it must read cinema.json (a valid catalog) and must not carry a write scope.
// Only classic keys report scopes (X-OAuth-Scopes); GitHub has no way to read a fine-grained key's own permissions,
// so for those the caller warns instead. No write request is ever sent to find out.
const WRITE_SCOPE = /(?:^|,)\s*(?:repo|public_repo|delete_repo|workflow|(?:write|admin):[a-z_:]+)\s*(?=,|$)/u;
// GitHub-Authentication-Token-Expiration looks like "2027-01-22 10:00:00 UTC" (or "… +0000").
function expiry(value) {
  if (!value) return null;
  const time = [value, value.replace(' ', 'T').replace(/\s*UTC$/u, 'Z').replace(/\s+([+-]\d{2}):?(\d{2})$/u, '$1:$2')].map(Date.parse).find(Number.isFinite);
  return time === undefined ? null : new Date(time).toISOString();
}
export async function checkKey(token, { signal } = {}) {
  const response = await request(apiURL('cinema.json'), { token: auth(token), accept: 'application/vnd.github.raw', signal });
  const scopes = response.headers.get('x-oauth-scopes');
  let data;
  try { data = await response.json(); } catch (error) {
    if (error?.name === 'AbortError') throw error;
    invalid();
  }
  const library = catalog(data);
  if (scopes != null && WRITE_SCOPE.test(scopes)) throw new CinemaError('write');
  return { titles: library.films.length, expires: expiry(response.headers.get('github-authentication-token-expiration')) };
}

async function openPosterCache(updated) {
  if (!globalThis.caches) return null;
  const epoch = text(updated, 200);
  if (posterEpoch !== epoch) {
    posterEpoch = epoch;
    const name = POSTER_CACHE + encodeURIComponent(epoch);
    posterCache = (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(item => item.startsWith(POSTER_CACHE) && item !== name).map(item => caches.delete(item)));
      return caches.open(name);
    })().catch(() => null);
  }
  return posterCache;
}

export async function getPoster(path, { demo = false, token, updated, signal } = {}) {
  validPath(path);
  const generation = posterGeneration;
  const checkActive = () => {
    if (signal?.aborted || generation !== posterGeneration) throw new DOMException('Aborted', 'AbortError');
  };
  checkActive();
  const cache = demo ? null : await openPosterCache(updated);
  checkActive();
  const key = new URL(`./_mkc-posters/${path.split('/').map(encodeURIComponent).join('/')}`, import.meta.url).href;
  let cached;
  try { cached = await cache?.match(key); } catch { /* Storage can be disabled. */ }
  let blob;
  if (cached) blob = await cached.blob();
  else {
    const response = await request(demo ? demoURL(path) : apiURL(path), {
      token: demo ? undefined : auth(token), accept: 'application/vnd.github.raw', signal,
    });
    try { blob = await response.blob(); } catch (error) { networkError(error); }
  }
  // GitHub raw responses do not guarantee an image Content-Type.
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  checkActive();
  const starts = (...signature) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = String.fromCharCode(...bytes);
  const type = starts(0xff, 0xd8, 0xff) ? 'image/jpeg'
    : starts(137, 80, 78, 71, 13, 10, 26, 10) ? 'image/png'
    : /^GIF8[79]a/u.test(ascii) ? 'image/gif'
    : ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP' ? 'image/webp' : '';
  if (!type) invalid();
  blob = new Blob([blob], { type });
  checkActive();
  if (!cached && cache) {
    let write;
    try {
      write = cache.put(key, new Response(blob, { headers: { 'Content-Type': type } }));
      posterWrites.add(write);
      await write;
    } catch { /* The poster still works if storage is full. */ }
    finally { posterWrites.delete(write); }
  }
  checkActive();
  const url = URL.createObjectURL(blob);
  objectURLs.add(url);
  return url;
}

function rawURL(value) {
  let url;
  try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port || url.username || url.password) invalid();
  return url.href;
}

export async function getVideoURL(path, { demo = false, token, signal } = {}) {
  if (demo) return demoURL(path);
  const response = await request(apiURL(path), { token: auth(token), accept: 'application/vnd.github.object', signal });
  let data;
  try { data = await response.json(); } catch (error) {
    if (error?.name === 'AbortError') throw error;
    invalid();
  }
  return rawURL(data?.download_url);
}

export async function downloadVideo(url, { signal, onProgress = () => {} } = {}) {
  const response = await request(url, { signal });
  const header = Number(response.headers.get('content-length'));
  const total = Number.isFinite(header) && header > 0 ? header : 0;
  let loaded = 0;
  onProgress({ loaded, total });
  try {
    if (!response.body) {
      const blob = await response.blob();
      onProgress({ loaded: blob.size, total: total || blob.size });
      return blob;
    }
    const reader = response.body.getReader();
    const chunks = [];
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress({ loaded, total });
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    return new Blob(chunks, { type: 'video/mp4' });
  } catch (error) { networkError(error); }
}

export async function forgetPosters() {
  posterGeneration++;
  objectURLs.forEach(url => URL.revokeObjectURL(url));
  objectURLs.clear();
  const opening = posterCache;
  posterEpoch = undefined;
  posterCache = undefined;
  await Promise.allSettled([opening, ...posterWrites]);
  if (globalThis.caches) {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(POSTER_CACHE)).map(name => caches.delete(name)));
  }
}
