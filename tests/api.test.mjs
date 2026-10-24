import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the browser ES module without adding a package/build requirement.
const source = (await readFile(new URL('../api.js', import.meta.url), 'utf8')).replaceAll('import.meta.url', "'https://cinema.test/app/api.js'");
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const good = () => ({ version: 1, updated: '2026-10-22', films: [{
  id: 'demo-one', title: 'A made-up film', dir: 'auto', seconds: 4, added: '2026-10-22',
  poster: 'posters/one.png', posterShape: '16:9', release: null,
  versions: [{ kind: 'phone', file: 'films/one.mp4', w: 360, h: 640, bytes: 200 }],
}] });
const originalFetch = globalThis.fetch;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
test.after(() => { globalThis.fetch = originalFetch; });

test('catalog validates data and sends private API headers without storing requests', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Mohamed3042/mk-cinema-library/contents/cinema.json');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(options.headers.Accept, 'application/vnd.github.raw');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    return Response.json(good());
  };
  assert.equal((await api.getCatalog({ token: 'test-secret' })).films[0].id, 'demo-one');
});

test('catalog rejects path traversal, URL paths, bad dimensions and duplicate IDs', async () => {
  for (const change of [
    data => { data.films[0].poster = '../private.png'; },
    data => { data.films[0].poster = 'https://evil.example/x'; },
    data => { data.films[0].versions[0].file = '%2e%2e/private.mp4'; },
    data => { data.films[0].versions[0].w = -1; },
    data => { data.films.push(data.films[0]); },
  ]) {
    const data = good(); change(data);
    globalThis.fetch = async () => Response.json(data);
    await assert.rejects(api.getCatalog({ token: 'secret' }), { code: 'invalid' });
  }
});

test('catalog preserves optional film metadata and keeps old catalogs valid', async () => {
  const metadata = { product: 'MK Voice', kind: 'demo', lang: 'ar', group: 'sample-cuts', variant: 'Arabic-led cut', blurb: 'A sample demo.' };
  const data = good();
  Object.assign(data.films[0], metadata);
  globalThis.fetch = async () => Response.json(data);
  const result = (await api.getCatalog({ token: 'secret' })).films[0];
  for (const [key, value] of Object.entries(metadata)) assert.equal(result[key], value, key);
  globalThis.fetch = async () => Response.json(good());
  const old = (await api.getCatalog({ token: 'secret' })).films[0];
  for (const key of Object.keys(metadata)) assert.equal(Object.hasOwn(old, key), false, key);

  for (const [key, value] of [
    ['product', 'Other product'], ['product', 5], ['kind', 'movie'], ['kind', []], ['lang', 'fr'], ['lang', {}],
    ['group', 5], ['group', ' '], ['group', 'a'.repeat(201)], ['variant', false], ['variant', ''],
    ['blurb', {}], ['blurb', 'a'.repeat(1001)], ['poster', '../private.png'],
  ]) {
    const invalid = good();
    Object.assign(invalid.films[0], metadata, { [key]: value });
    globalThis.fetch = async () => Response.json(invalid);
    await assert.rejects(api.getCatalog({ token: 'secret' }), { code: 'invalid' }, key);
  }
  const invalid = good();
  Object.assign(invalid.films[0], metadata);
  invalid.films[0].versions[0].file = 'https://example.test/private.mp4';
  globalThis.fetch = async () => Response.json(invalid);
  await assert.rejects(api.getCatalog({ token: 'secret' }), { code: 'invalid' });
});

test('errors have safe stable codes and never include token or URL', async () => {
  for (const [status, headers, code] of [[401, {}, 'token'], [403, {}, 'token'], [403, { 'x-ratelimit-remaining': '0' }, 'rate-limit'], [404, {}, 'access'], [503, {}, 'github-unreachable']]) {
    globalThis.fetch = async () => new Response('', { status, headers });
    await assert.rejects(api.getCatalog({ token: 'hidden-secret' }), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('hidden-secret'));
      return true;
    });
  }
  globalThis.fetch = async () => { throw new Error('private URL'); };
  await assert.rejects(api.getCatalog({ token: 'secret' }), { code: 'github-unreachable' });
});

test('video URL accepts only the HTTPS raw host', async () => {
  for (const value of ['https://evil.example/x', 'http://raw.githubusercontent.com/x', 'https://user@raw.githubusercontent.com/x', null]) {
    globalThis.fetch = async () => Response.json({ download_url: value });
    await assert.rejects(api.getVideoURL('films/one.mp4', { token: 'secret' }), { code: 'invalid' });
  }
  const value = 'https://raw.githubusercontent.com/owner/repo/main/film.mp4?token=private';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Accept, 'application/vnd.github.object');
    return Response.json({ download_url: value });
  };
  assert.equal(await api.getVideoURL('films/one.mp4', { token: 'secret' }), value);
});

test('downloads count streamed bytes and do not send API credentials', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(options.headers, {});
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3]));
      controller.close();
    } }), { headers: { 'content-length': '3' } });
  };
  const progress = [];
  const blob = await api.downloadVideo('https://raw.githubusercontent.com/demo', { onProgress: item => progress.push(item) });
  assert.equal(blob.size, 3);
  assert.equal(blob.type, 'video/mp4');
  assert.deepEqual(progress, [{ loaded: 0, total: 3 }, { loaded: 2, total: 3 }, { loaded: 3, total: 3 }]);
});

test('abort remains an abort so a cancel does not become an error screen', async () => {
  const controller = new AbortController(); controller.abort();
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(api.downloadVideo('https://raw.githubusercontent.com/demo', { signal: controller.signal }), { name: 'AbortError' });
});

test('demo paths stay local and never receive the saved token', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://cinema.test/app/demo/cinema.json');
    assert.deepEqual(options.headers, {});
    return Response.json(good());
  };
  await api.getCatalog({ demo: true, token: 'never-send-this' });
  assert.equal(await api.getVideoURL('demo/video-phone.mp4', { demo: true, token: 'secret' }), 'https://cinema.test/app/demo/video-phone.mp4');
  assert.equal(await api.getVideoURL('videos/one.mp4', { demo: true }), 'https://cinema.test/app/demo/videos/one.mp4');
});

test('private poster cache uses local keys, refreshes with catalog epoch and clears on forget', async () => {
  const stores = new Map();
  globalThis.caches = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async key => entries.get(key)?.clone(),
        put: async (key, value) => {
          assert.ok(key.startsWith('https://cinema.test/app/_mkc-posters/'));
          assert.ok(!key.includes('secret'));
          assert.equal(value.headers.has('Authorization'), false);
          entries.set(key, value);
        },
      };
    },
  };
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(png, { headers: { 'content-type': 'image/png' } }); };
  for (let index = 0; index < 2; index++) {
    const url = await api.getPoster('posters/one.png', { token: 'secret', updated: 'epoch-one' });
    assert.ok(url.startsWith('blob:'));
  }
  assert.equal(requests, 1);
  await api.getPoster('posters/one.png', { token: 'secret', updated: 'epoch-two' });
  assert.equal(requests, 2);
  assert.deepEqual([...stores.keys()], ['mkc-private-posters-v1-epoch-two']);
  await api.forgetPosters();
  assert.equal(stores.size, 0);
  delete globalThis.caches;
});

test('offline is distinct from an online network failure', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try { await assert.rejects(api.getCatalog({ token: 'secret' }), { code: 'offline' }); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('posters use raster signatures even with a generic MIME type and reject garbage', async () => {
  for (const mime of ['application/octet-stream', 'text/plain', 'image/png']) {
    globalThis.fetch = async () => new Response(png, { headers: { 'content-type': mime } });
    const url = await api.getPoster('posters/one.png', { demo: true });
    assert.equal((await originalFetch(url)).headers.get('content-type'), 'image/png');
  }
  for (const mime of ['application/octet-stream', 'image/jpeg']) {
    globalThis.fetch = async () => new Response('not an image', { headers: { 'content-type': mime } });
    await assert.rejects(api.getPoster('posters/one.png', { demo: true }), { code: 'invalid' });
  }
  await api.forgetPosters();
});

test('an aborted or forgotten poster cannot start a private cache write', async () => {
  let writes = 0;
  const names = new Set();
  globalThis.caches = {
    keys: async () => [...names], delete: async name => names.delete(name),
    open: async name => { names.add(name); return { match: async () => undefined, put: async () => { writes++; } }; },
  };
  try {
    for (const action of ['abort', 'forget']) {
      const controller = new AbortController();
      let finishBody, bodyStarted;
      const started = new Promise(resolve => { bodyStarted = resolve; });
      globalThis.fetch = async () => ({ ok: true, blob: () => { bodyStarted(); return new Promise(resolve => { finishBody = resolve; }); } });
      const pending = api.getPoster('posters/one.png', { token: 'secret', updated: action, signal: controller.signal });
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      await started;
      if (action === 'abort') controller.abort();
      else await api.forgetPosters();
      finishBody(new Blob([png], { type: 'application/octet-stream' }));
      await rejected;
      assert.equal(writes, 0);
    }
    await api.forgetPosters();
    assert.equal(names.size, 0);
  } finally { delete globalThis.caches; }
});

test('forget waits for a private cache write already in flight before deleting it', async () => {
  const names = new Set();
  let finishWrite, writeStarted;
  const started = new Promise(resolve => { writeStarted = resolve; });
  globalThis.caches = {
    keys: async () => [...names], delete: async name => names.delete(name),
    open: async name => { names.add(name); return {
      match: async () => undefined,
      put: () => { writeStarted(); return new Promise(resolve => { finishWrite = resolve; }); },
    }; },
  };
  globalThis.fetch = async () => new Response(png);
  try {
    const pending = api.getPoster('posters/one.png', { token: 'secret', updated: 'in-flight' });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await started;
    let forgotten = false;
    const cleanup = api.forgetPosters().then(() => { forgotten = true; });
    await Promise.resolve();
    assert.equal(forgotten, false);
    finishWrite();
    await Promise.all([cleanup, rejected]);
    assert.equal(names.size, 0);
  } finally { delete globalThis.caches; }
});

test('invite key check: reads cinema.json with the key in the header only, and returns the expiry GitHub reports', async () => {
  const fake = 'github_pat_11FAKEFAKE0000000000_testonlynotarealkeyAbCdEfGh1234';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Mohamed3042/mk-cinema-library/contents/cinema.json');
    assert.ok(!String(url).includes(fake), 'never in the URL');
    assert.equal(options.headers.Authorization, `Bearer ${fake}`);
    return Response.json(good(), { headers: { 'github-authentication-token-expiration': '2027-01-22 10:00:00 UTC' } });
  };
  assert.deepEqual(await api.checkKey(fake), { titles: 1, expires: '2027-01-22T10:00:00.000Z' });
  globalThis.fetch = async () => Response.json(good(), { headers: { 'github-authentication-token-expiration': '2027-01-22 10:00:00 +0300' } });
  assert.equal((await api.checkKey(fake)).expires, '2027-01-22T07:00:00.000Z');
  globalThis.fetch = async () => Response.json(good());
  assert.equal((await api.checkKey(fake)).expires, null, 'no header: unknown');
});

test('invite key check: write scopes are refused, read-only scopes pass, and GitHub refusals keep their codes', async () => {
  for (const scopes of ['repo', 'public_repo, read:user', 'read:org, write:packages', 'workflow', 'admin:org']) {
    globalThis.fetch = async () => Response.json(good(), { headers: { 'x-oauth-scopes': scopes } });
    await assert.rejects(api.checkKey('key'), { code: 'write' }, scopes);
  }
  for (const scopes of ['', 'read:user', 'read:packages, read:org']) {
    globalThis.fetch = async () => Response.json(good(), { headers: { 'x-oauth-scopes': scopes } });
    assert.equal((await api.checkKey('key')).titles, 1, `read-only: "${scopes}"`);
  }
  for (const [status, code] of [[401, 'token'], [403, 'token'], [404, 'access']]) {
    globalThis.fetch = async () => new Response('{}', { status });
    await assert.rejects(api.checkKey('key'), { code });
  }
  globalThis.fetch = async () => Response.json({ version: 9 });
  await assert.rejects(api.checkKey('key'), { code: 'invalid' }, 'the key must read a real catalog');
  await assert.rejects(api.checkKey(''), { code: 'token' });
});
