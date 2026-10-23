import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';

const origin = 'http://127.0.0.1:4173';
const root = new URL('../', import.meta.url);
const shots = new URL('shots/', root);
const catalog = JSON.parse(await readFile(new URL('demo/cinema.json', root), 'utf8'));
const server = serve(4173);
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
await mkdir(shots, { recursive: true });
const browserTemp = fileURLToPath(new URL('.browser-profile/', root));
await mkdir(browserTemp, { recursive: true });
process.env.TEMP = browserTemp;
process.env.TMP = browserTemp;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const results = [];
const errors = [];
const states = ['connect', 'connect-error', 'loading', 'offline', 'github-unreachable', 'empty', 'save-progress', 'saved'];

async function record(name, task) {
  try { await task(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

function captureErrors(page, label) {
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
}

async function loaded(page, suffix = '?demo') {
  await page.goto(origin + '/' + suffix);
  await page.locator('main').waitFor();
  const state = new URL(origin + '/' + suffix).searchParams.get('state');
  if (state) await page.locator(`main.${state === 'connect-error' ? 'connect' : state}`).waitFor();
  else if (suffix.includes('demo')) await page.locator('main.library').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function openFeature(page) {
  await page.locator('[data-action=hero-info]').click();
  await page.locator('#film-detail[open]').waitFor();
}

async function shot(page, name) {
  await page.waitForFunction(() => [...document.querySelectorAll('img[data-poster]')].every(el => el.complete && el.naturalWidth > 0));
  await page.screenshot({ path: new URL(`${name}.png`, shots).pathname.replace(/^\/(\w:)/, '$1'), fullPage: false, animations: 'disabled' });
}

async function checkLayout(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
  const tinyControls = await page.locator('button, input, a').evaluateAll(nodes => nodes.filter(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width && r.height && s.visibility !== 'hidden' && (r.width < 43 || r.height < 43);
  }).map(el => el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 8));
  assert.deepEqual(tinyControls, [], 'All controls have 44 px tap targets');
}

try {
  await record('static server byte ranges', async () => {
    const path = catalog.films[0].versions[0].file;
    const response = await fetch(`${origin}/${path}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(response.status, 206);
    assert.equal((await response.arrayBuffer()).byteLength, 100);
    const invalid = await fetch(`${origin}/${path}`, { headers: { Range: 'bytes=99999999-' } });
    assert.equal(invalid.status, 416);
  });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const desktop = viewport.width > 400;
    const suffix = desktop ? '-desktop' : '';
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true, serviceWorkers: 'block' });
    await context.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }));
    const page = await context.newPage();
    captureErrors(page, `${viewport.width}`);

    for (const state of states) await record(`${viewport.width} ${state}`, async () => {
      await loaded(page, `?demo&state=${state}`);
      await shot(page, `${state}${suffix}`);
      await checkLayout(page);
      if (state === 'connect') assert.ok(await page.locator('input[type=password]').count(), 'Token is masked');
      if (state === 'connect-error') assert.ok(await page.getByText('Token is wrong or expired', { exact: false }).count());
      if (state === 'offline' || state === 'github-unreachable') assert.ok(await page.getByRole('button', { name: /retry/i }).count());
    });

    await record(`${viewport.width} home and Arabic title`, async () => {
      await loaded(page);
      await page.locator('.billboard [data-action=hero-info]').waitFor();
      await shot(page, `home${suffix}`);
      await checkLayout(page);
      const arabic = catalog.films.find(f => /[\u0600-\u06ff]/.test(f.title));
      assert.ok(arabic, 'Demo includes Arabic title');
      const title = page.getByText(arabic.title, { exact: true }).first();
      assert.equal(await title.getAttribute('dir'), 'auto', 'Arabic title uses dir=auto');
      assert.equal(await title.evaluate(el => getComputedStyle(el).direction), 'rtl');
      assert.ok(await title.evaluate(el => document.fonts.check(`${getComputedStyle(el).fontWeight} ${getComputedStyle(el).fontSize} ${getComputedStyle(el).fontFamily}`, el.textContent)), 'Title font is loaded');
      assert.ok(await page.locator('.shelf').count() > 1, 'Home has grouped film rows');
      assert.equal(await page.locator('.billboard').count(), 1, 'Newest film has a billboard');
      const card = page.locator('.film-card').first();
      await card.focus();
      assert.notEqual(await card.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'Cards have visible keyboard focus');
    });

    await record(`${viewport.width} chips and Arabic search`, async () => {
      const arabic = catalog.films.find(f => f.lang === 'ar');
      assert.ok(arabic, 'Demo has an Arabic film');
      const allCount = new Set(catalog.films.map(f => f.group || f.id)).size;
      await page.locator('[data-filter=All]').click();
      await page.locator('.results-grid').waitFor();
      assert.equal(await page.locator('.results-grid .film-card').count(), allCount, 'All chip lists each grouped title once');
      for (const [chip, product] of [['MK Voice', 'MK Voice'], ['Business OS', 'MK Business OS'], ['Talent Atlas', 'Talent Atlas'], ['Job Orbit', 'MK Job Orbit'], ['Suite & apps', 'MK Suite & apps'], ['More', 'More films'], ['Ads'], ['Demos']]) {
        await page.locator('[data-filter]').filter({ hasText: new RegExp(`^${chip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click();
        await page.locator('.results-grid').waitFor();
        const matches = catalog.films.filter(f => product ? f.product === product : chip === 'Ads' ? ['ad', 'loop'].includes(f.kind) : f.kind === 'demo');
        const count = new Set(matches.map(f => f.group || f.id)).size;
        assert.equal(await page.locator('.results-grid .film-card').count(), count, `${chip} chip filters grouped films`);
      }
      await page.locator('[data-filter=Arabic]').click();
      if (!desktop) assert.ok(await page.locator('[data-filter=Arabic]').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      }), 'Selected Arabic chip stays in the phone viewport');
      const grid = page.locator('.results-grid');
      await grid.waitFor();
      assert.ok(await grid.locator(`.film-card[data-film="${arabic.id}"]`).count(), 'Arabic chip finds Arabic title');
      assert.ok(await page.locator('.results-count').innerText(), 'Filtered view gives a count');
      await shot(page, `filtered-grid${suffix}`);
      await checkLayout(page);
      await page.locator('[data-action=clear-filter]').click();
      await page.locator('.billboard').waitFor();
      await page.locator('[data-action=search]').click();
      await grid.waitFor();
      assert.equal(await grid.locator('.film-card').count(), allCount, 'Opening search shows the title grid');
      await page.locator('#film-search').fill(arabic.title);
      await page.waitForFunction(id => document.querySelector(`.results-grid .film-card[data-film="${id}"]`), arabic.id);
      assert.equal(await grid.locator('.film-card').count(), 1, 'Full Arabic title search finds one film');
      assert.equal(await grid.locator('.film-title').first().getAttribute('dir'), 'auto');
      await shot(page, `search${suffix}`);
      await checkLayout(page);
      await page.locator('#film-search').fill('no-such-made-up-film-987');
      await page.waitForFunction(() => document.querySelector('.results-grid')?.querySelectorAll('.film-card').length === 0);
      assert.match(await page.locator('.results-count').innerText(), /0/, 'No matches shows a zero count');
      await page.locator('[data-action=clear-filter]').click();
      await page.locator('.billboard').waitFor();
    });

    await record(`${viewport.width} groups collapse and variants stay selectable`, async () => {
      const primary = catalog.films.find(f => f.id === 'golden-hour');
      const alternate = catalog.films.find(f => f.group === primary.group && f.id !== primary.id);
      assert.ok(primary?.group && primary.group === alternate?.group, 'Demo has an explicit duplicate group');
      await page.locator('[data-action=search]').click();
      await page.locator('#film-search').fill('Golden Hour');
      await page.locator('.results-grid').waitFor();
      assert.equal(await page.locator('.results-grid .film-card').count(), 1, 'Two variants make one card');
      assert.equal(await page.locator(`.results-grid .film-card[data-film="${alternate.id}"]`).count(), 0, 'Alternate is not a second card');
      await page.locator(`.results-grid .film-card[data-film="${primary.id}"]`).focus();
      await page.keyboard.press('Enter');
      const detail = page.locator('#film-detail');
      await detail.locator(`[data-variant="${alternate.id}"]`).click();
      assert.equal(await detail.locator('.film-title').first().innerText(), alternate.title, 'Variant selects its film');
      await detail.locator(`[data-variant="${primary.id}"]`).click();
      assert.equal(await detail.locator('.film-title').first().innerText(), primary.title, 'Main cut can be restored');
      await page.keyboard.press('Escape');
      await page.locator('#film-detail').waitFor({ state: 'hidden' });
      await page.locator('[data-action=clear-filter]').click();
    });

    await record(`${viewport.width} related films and detail focus return`, async () => {
      const opener = page.locator('.film-card[data-film="last-light"]').first();
      await opener.focus();
      await page.keyboard.press('Enter');
      const detail = page.locator('#film-detail[open]');
      await detail.waitFor();
      const related = detail.locator('.shelf[aria-label="More like this"]');
      assert.equal(await related.locator('.film-card[data-film="paper-moon"]').count(), 1, 'Detail offers another film from the same product');
      await page.keyboard.press('Escape');
      await detail.waitFor({ state: 'hidden' });
      assert.ok(await opener.evaluate(el => document.activeElement === el), 'Closing details returns focus to its card');
    });

    await record(`${viewport.width} film and both players`, async () => {
      await openFeature(page);
      await page.locator('#film-detail [data-action=play]').waitFor();
      assert.ok(await page.locator('#film-detail').evaluate(el => el.matches(':modal')), 'Details are a modal dialog');
      assert.ok(await page.locator('#film-detail img[data-poster]').count(), 'Detail has a large poster');
      const release = catalog.films.find(f => f.id === 'golden-hour').release;
      if (release?.startsWith('https://')) {
        const link = page.locator('#film-detail .release-link');
        assert.equal(await link.getAttribute('href'), release, 'Detail uses the catalog release link');
        assert.equal(new URL(await link.getAttribute('href')).protocol, 'https:');
        assert.equal(await link.getAttribute('target'), '_blank');
        assert.match(await link.getAttribute('rel'), /\bnoopener\b/);
        assert.match(await link.getAttribute('rel'), /\bnoreferrer\b/);
      }
      await shot(page, `detail${suffix}`);
      await checkLayout(page);
      for (const [kind, label] of [['portrait', 'Phone 9:16'], ['landscape', 'Desktop 16:9']]) {
        await page.getByRole('button', { name: label, exact: false }).click();
        await page.locator('#film-detail [data-action=play]').click();
        const video = page.locator('video');
        await video.waitFor();
        await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
        await video.evaluate(el => el.pause());
        const media = await video.evaluate(el => ({ w: el.videoWidth, h: el.videoHeight, error: el.error?.message, fit: getComputedStyle(el).objectFit }));
        assert.ok(media.w > 0 && media.h > 0 && !media.error, 'Video decoded without error');
        assert.equal(media.fit, 'contain', 'Video is never cropped');
        assert.ok(kind === 'portrait' ? media.h > media.w : media.w > media.h, 'Correct video version');
        await page.getByLabel('Seek', { exact: true }).focus();
        await page.keyboard.press('End');
        assert.ok(await video.evaluate(el => el.currentTime > 2.5), 'Video seeks to the end');
        await page.keyboard.press('Home');
        assert.ok(await video.evaluate(el => el.currentTime < 0.2), 'Video seeks back to the start');
        assert.notEqual(await page.getByLabel('Seek', { exact: true }).evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'Keyboard focus is visible');
        await page.locator('main').focus();
        await shot(page, `player-${kind}${suffix}`);
        if (kind === 'landscape') await shot(page, `player${suffix}`);
        const previousVideo = await video.elementHandle();
        await page.getByRole('button', { name: 'Back to film', exact: true }).click();
        await previousVideo.evaluate(el => { el.dispatchEvent(new Event('timeupdate')); el.dispatchEvent(new Event('durationchange')); });
      }
    });

    await record(`${viewport.width} phone-only film`, async () => {
      await loaded(page);
      const phoneOnly = catalog.films.find(f => f.versions.length === 1 && f.versions[0].kind === 'phone');
      assert.ok(phoneOnly, 'Demo has phone-only film');
      await page.locator(`.film-card[data-film="${phoneOnly.id}"]`).first().click();
      await page.locator('#film-detail [data-action=play]').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Desktop 16:9', exact: false }).count(), 0, 'Unavailable desktop version is not offered');
      await shot(page, `film-phone-only${suffix}`);
    });

    await record(`${viewport.width} save cancel and download`, async () => {
      await loaded(page);
      await openFeature(page);
      await page.route('**/demo/*.mp4', async route => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.continue().catch(() => {});
      });
      await page.getByRole('button', { name: 'Save to phone', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.locator('#film-detail[open]').waitFor();
      await page.unroute('**/demo/*.mp4');
      await page.getByRole('button', { name: 'Save to phone', exact: true }).click();
      await page.getByRole('button', { name: 'Download video', exact: true }).waitFor();
      await shot(page, `save-ready${suffix}`);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download video', exact: true }).click();
      const download = await downloading;
      assert.equal(download.suggestedFilename(), `${catalog.films[0].title}.mp4`);
      assert.equal(await download.failure(), null, 'Fallback download succeeds');
      await page.locator('main.saved').waitFor();
      await shot(page, `saved-flow${suffix}`);
      await page.getByRole('button', { name: 'Back to film', exact: true }).last().click();
      await page.locator('#film-detail[open]').waitFor();
    });

    await context.close();
  }

  await record('continue watching persists, resumes, and clears completed films', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    captureErrors(page, 'continue watching');
    await loaded(page);
    await openFeature(page);
    await page.locator('#film-detail [data-action=play]').click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.locator('video').evaluate(el => {
      el.pause(); el.currentTime = 1.1; el.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mkc.demo.progress') || '{}')['golden-hour']?.time >= 1);
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.demo.progress')));
    assert.ok(progress['golden-hour'].duration > 0, 'Saved progress has a duration');
    assert.ok(progress['golden-hour'].updated > 0, 'Saved progress has an update time');
    assert.deepEqual(Object.keys(progress['golden-hour']).sort(), ['duration', 'time', 'updated'], 'Progress stores only position data');
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.progress')), null, 'Demo progress is separate from private films');
    await page.reload();
    const shelf = page.locator('.shelf[aria-label="Continue watching"]');
    await shelf.waitFor();
    assert.equal(await shelf.locator('.film-card[data-film="golden-hour"]').count(), 1, 'Saved film returns after reload');
    await shelf.locator('.film-card[data-film="golden-hour"]').click();
    await page.locator('#film-detail [data-action=play]').click();
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      if (!video || video.readyState < 2) return false;
      video.pause(); return video.currentTime >= 1;
    });
    assert.ok(await page.locator('video').evaluate(el => el.currentTime < 2.5), 'Film resumes near the saved position');
    await page.locator('video').evaluate(el => { el.currentTime = el.duration; el.dispatchEvent(new Event('ended')); });
    await page.waitForFunction(() => {
      const entry = JSON.parse(localStorage.getItem('mkc.demo.progress') || '{}')['golden-hour'];
      return !entry || entry.time / entry.duration >= 0.95;
    });
    await page.reload();
    await page.locator('main.library').waitFor();
    assert.equal(await page.locator('.shelf[aria-label="Continue watching"]').count(), 0, 'Completed film leaves Continue watching');
    await context.close();
  });

  await record('share success and user cancel', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(() => {
      let calls = 0;
      Object.defineProperty(navigator, 'canShare', { value: ({ files }) => files.length === 1 && files[0].type === 'video/mp4', configurable: true });
      Object.defineProperty(navigator, 'share', { value: async ({ files }) => {
        if (++calls === 1) throw new DOMException('Cancelled by test', 'AbortError');
        window.__shared = { name: files[0].name, size: files[0].size, type: files[0].type };
      }, configurable: true });
    });
    const page = await context.newPage();
    captureErrors(page, 'share');
    await loaded(page);
    await openFeature(page);
    await page.getByRole('button', { name: 'Save to phone', exact: true }).click();
    await page.getByRole('button', { name: 'Save video', exact: true }).click();
    await page.getByText('Save cancelled.', { exact: false }).waitFor();
    assert.equal(await page.locator('main.save-ready').count(), 1, 'Share cancel keeps the file ready');
    await page.getByRole('button', { name: 'Save video', exact: true }).click();
    await page.locator('main.saved').waitFor();
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.name, `${catalog.films[0].title}.mp4`);
    assert.ok(shared.size > 0 && shared.type === 'video/mp4');
    await context.close();
  });

  for (const test of [
    { status: 401, text: 'Token is wrong or expired' },
    { status: 403, text: 'Token is wrong or expired' },
    { status: 404, text: "This token can't see the media repo" },
    { status: 403, remaining: '0', text: 'GitHub needs a pause' },
    { abort: true, text: 'GitHub is unavailable' },
  ]) await record(`mock GitHub ${test.abort ? 'network failure' : test.status + (test.remaining ? ' rate limit' : '')}`, async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`mock GitHub: ${error.message}`));
    await page.route('https://api.github.com/**', route => test.abort ? route.abort('failed') : route.fulfill({ status: test.status, body: '{}', headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining', ...(test.remaining ? { 'x-ratelimit-remaining': test.remaining } : {}) } }));
    await loaded(page, '');
    await page.getByLabel('GitHub token', { exact: true }).fill('synthetic-test-token');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByText(test.text, { exact: false }).waitFor();
    await context.close();
  });

  await record('a completed share does not reopen a film after leaving', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { value: () => new Promise(resolve => { window.__completeShare = resolve; }), configurable: true });
    });
    const page = await context.newPage();
    captureErrors(page, 'deferred share');
    await loaded(page);
    await openFeature(page);
    await page.getByRole('button', { name: 'Save to phone', exact: true }).click();
    await page.getByRole('button', { name: 'Save video', exact: true }).click();
    await page.getByRole('button', { name: 'Back to film', exact: true }).first().click();
    await page.locator('#film-detail[open]').waitFor();
    await page.evaluate(() => window.__completeShare());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#film-detail[open]').count(), 1);
    await context.close();
  });

  await record('two video URL refreshes keep the play position', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`video refresh: ${error.message}`));
    const videoData = await readFile(new URL(catalog.films[0].versions[0].file, root));
    let metadata = 0;
    await page.route('https://api.github.com/**', async route => {
      const request = route.request();
      const path = decodeURIComponent(new URL(request.url()).pathname.split('/contents/')[1]);
      const headers = { 'access-control-allow-origin': '*' };
      if (path === 'cinema.json') return route.fulfill({ json: catalog, headers });
      if (request.headers().accept === 'application/vnd.github.object') {
        metadata++;
        return route.fulfill({ json: { download_url: `https://raw.githubusercontent.com/demo/mk-cinema/test.mp4?token=synthetic-${metadata}` }, headers });
      }
      return route.fulfill({ body: await readFile(new URL(path, root)), contentType: 'image/jpeg', headers });
    });
    await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ body: videoData, contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' } }));
    await loaded(page, '');
    await page.getByLabel('GitHub token', { exact: true }).fill('synthetic-test-token');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await openFeature(page);
    await page.locator('#film-detail [data-action=play]').click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    for (let cycle = 0; cycle < 2; cycle++) {
      const video = page.locator('video');
      const position = cycle ? 2 : 0.5;
      await video.evaluate((el, time) => { el.pause(); el.currentTime = time; el.dispatchEvent(new Event('timeupdate')); }, position);
      await page.waitForFunction(time => document.querySelector('video')?.currentTime >= time, position);
      const prior = metadata;
      await video.evaluate(el => el.dispatchEvent(new Event('error')));
      await page.waitForFunction(({ next, time }) => document.querySelector('video')?.src.includes(`synthetic-${next}`) && document.querySelector('video')?.readyState >= 2 && document.querySelector('video')?.currentTime >= time - 0.1, { next: prior + 1, time: position });
      assert.equal(metadata, prior + 1, 'A fresh URL is requested on every expiry');
      await video.evaluate(el => el.pause());
    }
    await context.close();
  });

  await record('a refused stream plays from a whole-film download', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`stream fallback: ${error.message}`));
    const videoData = await readFile(new URL(catalog.films[0].versions[0].file, root));
    let metadata = 0;
    await page.route('https://api.github.com/**', async route => {
      const request = route.request();
      const path = decodeURIComponent(new URL(request.url()).pathname.split('/contents/')[1]);
      const headers = { 'access-control-allow-origin': '*' };
      if (path === 'cinema.json') return route.fulfill({ json: catalog, headers });
      if (request.headers().accept === 'application/vnd.github.object') {
        metadata++;
        return route.fulfill({ json: { download_url: `https://raw.githubusercontent.com/demo/mk-cinema/test.mp4?token=synthetic-${metadata}` }, headers });
      }
      return route.fulfill({ body: await readFile(new URL(path, root)), contentType: 'image/jpeg', headers });
    });
    // Like iPhone Safari with GitHub's octet-stream type: the video element cannot stream it, fetch() can download it.
    await page.route('https://raw.githubusercontent.com/**', route => route.request().resourceType() === 'media'
      ? route.fulfill({ body: 'not a video', contentType: 'application/octet-stream' })
      : route.fulfill({ body: videoData, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } }));
    await loaded(page, '');
    await page.getByLabel('GitHub token', { exact: true }).fill('synthetic-test-token');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await openFeature(page);
    await page.locator('#film-detail [data-action=play]').click();
    await page.waitForFunction(() => document.querySelector('video')?.src.startsWith('blob:') && document.querySelector('video')?.readyState >= 2);
    assert.equal(metadata, 2, 'The fallback asks for one fresh URL');
    assert.equal(await page.locator('main.player').count(), 1, 'The player stays open');
    await context.close();
  });

  await record('offline recovery and settings', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    captureErrors(page, 'offline recovery');
    await loaded(page);
    await page.waitForFunction(() => [...document.querySelectorAll('img[data-poster]')].every(el => el.complete && el.naturalWidth > 0));
    await context.setOffline(true);
    await page.locator('main.offline').waitFor();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('main.library').waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Forget token', exact: true }).click();
    await page.locator('main.connect').waitFor();
    await context.close();
  });
  await record('844 landscape phone playback', async () => {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    captureErrors(page, '844 landscape');
    await loaded(page);
    await openFeature(page);
    await page.getByRole('button', { name: 'Desktop 16:9', exact: false }).click();
    await page.locator('#film-detail [data-action=play]').click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.locator('video').evaluate(el => el.pause());
    await checkLayout(page);
    await shot(page, 'player-rotated');
    await context.close();
  });
  await record('320 px phone and reduced motion', async () => {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    captureErrors(page, '320');
    for (const query of ['?demo&state=connect', '?demo']) {
      await loaded(page, query);
      await checkLayout(page);
      assert.equal(await page.locator('main').evaluate(el => getComputedStyle(el).animationName), 'none');
    }
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    assert.ok(await focused.count());
    assert.notEqual(await focused.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await shot(page, 'library-small');
    await context.close();
  });
  await record('service worker caches the app shell only', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'allow' });
    const page = await context.newPage();
    captureErrors(page, 'service worker');
    await loaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const entries = await page.evaluate(async () => {
      const names = await caches.keys();
      return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
    });
    assert.ok(entries.some(url => url.endsWith('/app.js')), 'App script is cached');
    assert.ok(entries.every(url => url.startsWith(origin) && !url.includes('/demo/') && !url.includes('api.github.com') && !url.includes('token=')), 'No private data, API, or films in shell cache');
    await context.setOffline(true);
    await page.reload();
    await page.locator('main.offline').waitFor();
    await context.close();
  });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

await writeFile(new URL('results.json', shots), JSON.stringify({ checks: results, consoleErrors: errors }, null, 2) + '\n');
assert.deepEqual(errors, [], 'No browser console or page errors');
assert.ok(results.every(r => r.pass), 'All browser checks pass');
console.log(`${results.length} browser checks passed.`);
