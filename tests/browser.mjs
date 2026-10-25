import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';
import { splitTitle } from '../catalog.js';

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
      // The sheet shows "Golden Hour — V1" as a brand line over a clean name.
      assert.equal(await detail.locator('#detail-title').textContent(), splitTitle(alternate.title).name, 'Variant selects its film');
      assert.equal(await detail.locator('.detail-hero .kicker').textContent(), splitTitle(alternate.title).kicker, 'The brand line names the film');
      await detail.locator(`[data-variant="${primary.id}"]`).click();
      assert.equal(await detail.locator('#detail-title').textContent(), splitTitle(primary.title).name, 'Main cut can be restored');
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
        const frame = await page.locator('.np').evaluate(el => { const r = el.getBoundingClientRect(); return { box: [r.left, r.top, r.width, r.height].map(Math.round), rotated: el.hasAttribute('data-rotated') }; });
        assert.deepEqual(frame.box, [0, 0, viewport.width, viewport.height], 'The player covers the whole screen');
        assert.deepEqual(await video.evaluate(el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); }), [0, 0, viewport.width, viewport.height], 'The film box covers the whole screen');
        assert.equal(frame.rotated, !desktop && kind === 'landscape', 'Only a 16:9 film on an upright phone is turned sideways');
        assert.equal(await page.locator('.player-header, .player-controls').count(), 0, 'No header or control strip outside the film');
        await checkLayout(page);
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
      await page.getByRole('button', { name: desktop ? 'Download' : 'Save to phone', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.locator('#film-detail[open]').waitFor();
      await page.unroute('**/demo/*.mp4');
      await page.getByRole('button', { name: desktop ? 'Download' : 'Save to phone', exact: true }).click();
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
    // Only films of 30 min or more resume: the demo clip is 12 s, so its catalog length says 40 min here.
    await page.route('**/demo/cinema.json', route => route.fulfill({ json: { ...catalog, films: catalog.films.map(f => f.id === 'golden-hour' ? { ...f, seconds: 2400 } : f) } }));
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
    // A short film (12 s, the real demo length) keeps its saved place but never resumes or joins Continue watching.
    await page.evaluate(() => localStorage.setItem('mkc.demo.progress', JSON.stringify({ 'light-journey': { time: 6, duration: 12, updated: Date.now() } })));
    await page.reload();
    await page.locator('main.library').waitFor();
    assert.equal(await page.locator('.shelf[aria-label="Continue watching"]').count(), 0, 'A short film is not in Continue watching');
    assert.equal(await page.locator('progress.watch-progress').count(), 0, 'and shows no progress bar');
    await page.locator('.film-card[data-film="light-journey"]').first().click();
    await page.locator('#film-detail [data-action=play]').click();
    await page.waitForFunction(() => { const video = document.querySelector('video'); if (!video || video.readyState < 2) return false; video.pause(); return true; });
    assert.ok(await page.locator('video').evaluate(el => el.currentTime < 1), 'A short film starts from the beginning');
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
    assert.equal(await page.locator('.np').getAttribute('data-rotated'), null, 'A phone in landscape is never turned');
    assert.deepEqual(await page.locator('video').evaluate(el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); }), [0, 0, 844, 390], 'The film fills the landscape phone');
    await shot(page, 'player-landscape-phone');
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

  // Invites. Every key here is made up in the fine-grained shape; GitHub is mocked, nothing leaves this computer.
  const FAKE = {
    guest: 'github_pat_11FAKEGUEST000000000_testonlynotarealkeyGuest0001',
    owner: 'github_pat_11FAKEOWNER000000000_testonlynotarealkeyOwner0002',
    mom: 'github_pat_11FAKEINVITE00000000_testonlynotarealkeyMomKey4321',
    dad: 'github_pat_11FAKEINVITE00000000_testonlynotarealkeyDadKey8765',
    write: 'github_pat_11FAKEWRITE000000000_testonlynotarealkeyWrite0003',
    norepo: 'github_pat_11FAKENOREPO00000000_testonlynotarealkeyNoRepo004',
  };
  const keys = Object.values(FAKE);
  const inviteHash = (n, t) => `#invite=${Buffer.from(JSON.stringify({ v: 1, n, t })).toString('base64url')}`;
  const inviteShots = new URL('invites/', shots);
  await mkdir(inviteShots, { recursive: true });
  const inviteShot = async (page, name) => {
    await page.waitForFunction(() => [...document.querySelectorAll('img[data-poster]')].every(el => el.complete && el.naturalWidth > 0));
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, inviteShots)), animations: 'disabled' });
  };
  // What the server saw (the real request lines), what the page asked for, and everything it printed.
  const wire = [];
  server.on('request', request => wire.push(request.url));
  const leaks = { requests: [], console: [] };
  function watch(page, label) {
    // GitHub refusals the test asks for print a resource error; anything else still fails the suite.
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of (401|404)/.test(message.text())) errors.push(`${label}: ${message.text()}`); });
    page.on('request', request => leaks.requests.push(request.url()));
    page.on('console', message => leaks.console.push(message.text()));
  }
  // GitHub, mocked: each key gets the answer its name says. The expiry and scope headers are exposed like GitHub does.
  async function mockGitHub(context, { ended = 0 } = {}) {
    const seen = [];
    await context.route('https://github.com/**', route => route.fulfill({ body: '<!doctype html><title>GitHub (mock)</title>', contentType: 'text/html' }));
    await context.route('https://api.github.com/**', async route => {
      const request = route.request(), auth = request.headers().authorization || '';
      seen.push(auth);
      const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-oauth-scopes, github-authentication-token-expiration' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': 'authorization, accept, x-github-api-version' } });
      if (ended && auth === `Bearer ${FAKE.guest}`) return route.fulfill({ status: ended, body: '{}', headers });
      if (auth === `Bearer ${FAKE.norepo}`) return route.fulfill({ status: 404, body: '{}', headers });
      const path = decodeURIComponent(new URL(request.url()).pathname.split('/contents/')[1]);
      if (path === 'cinema.json') {
        const extra = auth === `Bearer ${FAKE.mom}` ? { 'github-authentication-token-expiration': '2027-01-22 10:00:00 UTC' } : auth === `Bearer ${FAKE.write}` ? { 'x-oauth-scopes': 'repo' } : {};
        return route.fulfill({ json: catalog, headers: { ...headers, ...extra } });
      }
      return route.fulfill({ body: await readFile(new URL(path, root)), contentType: 'image/jpeg', headers });
    });
    return seen;
  }
  const mainText = page => page.locator('main').innerText();

  await record('invite: a guest opens the link, the key leaves the address, a welcome, then the cinema', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const seen = await mockGitHub(context);
    const page = await context.newPage();
    watch(page, 'invite guest');
    await page.goto(`${origin}/${inviteHash('Mom', FAKE.guest)}`);
    await page.locator('main.welcome').waitFor();
    assert.equal(await page.evaluate(() => location.hash), '', 'the fragment is gone from the address');
    assert.ok(!page.url().includes('invite') && !page.url().includes(FAKE.guest), 'the address no longer holds the invite');
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), FAKE.guest, 'stored where the app keeps its key');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.guest'))), { name: 'Mom', left: false });
    const welcome = await mainText(page);
    assert.match(welcome, /Hi Mom/);
    assert.match(welcome, /Mohamed shared his cinema with you/);
    assert.doesNotMatch(welcome, /github|token/i, 'no GitHub words for a guest');
    assert.equal(await page.locator('.welcome-tip').innerText(), 'Add it to your home screen to come back in one tap.', 'Android and computers share storage with their home-screen app');
    await page.locator('.welcome-card.is-ready').first().waitFor();
    await inviteShot(page, 'guest-welcome');
    await checkLayout(page);
    await page.getByRole('button', { name: 'Start watching', exact: true }).click();
    await page.locator('main.library').waitFor();
    assert.ok(seen.length && seen.every(auth => auth === `Bearer ${FAKE.guest}`), 'the key travels only in the Authorization header');
    // The address was replaced, not pushed: Back and Forward never bring the invite back.
    await page.goBack(); await page.goForward();
    await page.locator('main.library').waitFor();
    assert.ok(!page.url().includes('invite'), 'history holds no invite');
    // The releases are private to the owner, so a guest's details sheet offers no release links.
    await openFeature(page);
    const golden = catalog.films.find(f => f.id === 'golden-hour');
    assert.ok(golden.release?.startsWith('https://') && golden.title.includes(await page.locator('#detail-title').innerText()), 'the featured film has a release');
    assert.equal(await page.locator('#film-detail .full-quality, #film-detail .release-link').count(), 0, 'no release links for a guest');
    assert.doesNotMatch(await page.locator('#film-detail').innerText(), /github|full quality|view release/i, 'no GitHub words in a guest\'s details');
    await page.keyboard.press('Escape');
    await page.locator('#film-detail').waitFor({ state: 'hidden' });
    await page.locator('#tabbar [data-tab=settings]').click();
    await page.locator('main.settings').waitFor();
    const settings = await mainText(page);
    assert.match(settings, /Shared by\s+Mohamed/);
    assert.match(settings, /Invite for\s+Mom/);
    assert.doesNotMatch(settings, /github|token|Invite someone/i, 'no token details, no inviting from a guest');
    await page.locator('#set-sharing').evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY - 140));
    await inviteShot(page, 'guest-settings');
    await checkLayout(page);
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await page.locator('main.invite-left').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), null, 'Leave forgets the key');
    assert.match(await mainText(page), /You left Mohamed's cinema/);
    await page.reload();
    await page.locator('main.invite-left').waitFor();
    assert.equal(await page.locator('#connect-form').count(), 0, 'a guest who left never meets the connect form');
    await inviteShot(page, 'guest-left');
    await context.close();
  });

  for (const status of [401, 404]) await record(`invite: an ended key (${status}) shows the calm ended screen`, async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await mockGitHub(context, { ended: status });
    const page = await context.newPage();
    watch(page, `invite ended ${status}`);
    await page.goto(`${origin}/${inviteHash('Dad', FAKE.guest)}`);
    await page.locator('main.invite-ended').waitFor();
    const text = await mainText(page);
    assert.match(text, /This invite has ended/);
    assert.match(text, /Ask Mohamed for a new link\./);
    assert.doesNotMatch(text, /github|token/i, "not the owner's token-help screen");
    assert.equal(await page.locator('#connect-form').count(), 0);
    if (status === 401) { await inviteShot(page, 'guest-ended'); await checkLayout(page); }
    // Later visits with the stored key end up on the same screen, and Try again tries again.
    await page.reload();
    await page.locator('main.invite-ended').waitFor();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('main.invite-ended').waitFor();
    await page.getByRole('button', { name: 'Forget this invite', exact: true }).click();
    await page.locator('main.invite-left').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), null);
    await context.close();
  });

  await record('invite: a broken link stores nothing and says so calmly', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await mockGitHub(context);
    const page = await context.newPage();
    watch(page, 'invite bad');
    for (const hash of ['#invite=bm90LWpzb24', `#invite=${Buffer.from(JSON.stringify({ v: 1, n: 'Mom', t: 'ghp_classicclassicclassicclassic1234' })).toString('base64url')}`]) {
      await page.goto(`${origin}/${hash}`);
      await page.locator('main.invite-bad').waitFor();
      assert.equal(await page.evaluate(() => location.hash), '');
      assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), null);
      assert.match(await mainText(page), /This invite link is incomplete/);
    }
    await context.close();
  });

  await record('invite: the owner makes a link (pre-filled GitHub page, key checks, ticket, Share falls back to Copy, list)', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(owner => {
      if (!localStorage.getItem('mkc.token')) localStorage.setItem('mkc.token', owner);
      // Share fails the way a browser without a share target does; the clipboard is a stand-in the test can read.
      Object.defineProperty(navigator, 'share', { value: async () => { throw new DOMException('No share target', 'NotAllowedError'); }, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text; } }, configurable: true });
    }, FAKE.owner);
    await mockGitHub(context);
    const page = await context.newPage();
    watch(page, 'invite owner');
    await page.goto(`${origin}/`);
    await page.locator('main.library').waitFor();
    await page.locator('#tabbar [data-tab=settings]').click();
    await page.locator('main.settings').waitFor();
    await page.getByRole('button', { name: /Invite someone/ }).click();
    await page.locator('main.invite').waitFor();
    assert.equal(await page.locator('#tabbar [data-nav=settings]').getAttribute('aria-current'), 'page', 'the Settings tab stays lit');
    assert.equal(await page.locator('#invite-github').getAttribute('href'), null, 'no GitHub link before a name');
    await inviteShot(page, 'owner-1-start');
    await checkLayout(page);
    await page.locator('#invite-name').fill('Mom');
    const href = new URL(await page.locator('#invite-github').getAttribute('href'));
    assert.equal(`${href.origin}${href.pathname}`, 'https://github.com/settings/personal-access-tokens/new');
    assert.deepEqual(['name', 'target_name', 'expires_in', 'contents'].map(key => href.searchParams.get(key)), ['MK Cinema – Mom', 'Mohamed3042', '90', 'read']);
    assert.match(await page.locator('#invite-github').innerText(), /Make Mom's key on GitHub/);
    const [github] = await Promise.all([context.waitForEvent('page'), page.locator('#invite-github').click()]);
    await github.waitForLoadState();
    assert.ok(github.url().startsWith('https://github.com/settings/personal-access-tokens/new?'), 'opens the pre-filled page in a new tab');
    await github.close();
    await inviteShot(page, 'owner-2-named');
    const tryKey = async (key, expected) => {
      await page.locator('#invite-token').fill(key);
      await page.getByRole('button', { name: 'Check key and make the link', exact: true }).click();
      await page.waitForFunction(text => document.querySelector('#invite-status')?.textContent.includes(text), expected);
      assert.equal(await page.locator('#invite-token').getAttribute('aria-invalid'), 'true');
    };
    await tryKey(FAKE.owner, 'This is your own key');
    await tryKey('ghp_classicclassicclassicclassic1234', 'This is a classic key');
    await tryKey(FAKE.norepo, "This key can't see mk-cinema-library");
    await tryKey(FAKE.write, 'This key can change files');
    await inviteShot(page, 'owner-3-refused');
    assert.deepEqual(await page.evaluate(() => localStorage.getItem('mkc.invites')), null, 'a refused key is not listed');
    await page.locator('#invite-token').fill(FAKE.mom);
    await page.getByRole('button', { name: 'Check key and make the link', exact: true }).click();
    await page.getByRole('heading', { name: "Mom's link is ready" }).waitFor();
    assert.match(await mainText(page), /It works until Jan 22, 2027/, 'the expiry GitHub reported');
    await inviteShot(page, 'owner-4-link-ready');
    await checkLayout(page);
    assert.ok(!(await page.content()).includes(FAKE.mom), 'the new key is not on the page');
    await page.getByRole('button', { name: 'Share link', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#share-status')?.textContent.startsWith('Copied'));
    const link = new URL(await page.evaluate(() => window.__copied));
    assert.equal(`${link.origin}${link.pathname}`, `${origin}/`, 'the app address');
    assert.equal(link.search, '', 'never a query string');
    assert.ok(link.hash.startsWith('#invite='));
    assert.deepEqual(JSON.parse(Buffer.from(link.hash.slice(8), 'base64url').toString()), { v: 1, n: 'Mom', t: FAKE.mom });
    const stored = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
    assert.ok(!stored.includes(FAKE.mom), 'the new key is stored nowhere on this device');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.invites')).map(item => [item.name, item.last4, item.expires])), [['Mom', '4321', '2027-01-22T10:00:00.000Z']]);
    // Without a share sheet only Copy is offered.
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await page.getByRole('button', { name: 'Invite someone else', exact: true }).click();
    await page.locator('#invite-name').fill('Dad');
    await page.locator('#invite-token').fill(FAKE.dad);
    await page.getByRole('button', { name: 'Check key and make the link', exact: true }).click();
    await page.getByRole('heading', { name: "Dad's link is ready" }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Share link' }).count(), 0, 'no Share without a share sheet');
    assert.match(await mainText(page), /It works until about /, 'unknown expiry: the planned 90 days');
    await page.getByRole('button', { name: 'Copy link', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#share-status')?.textContent.startsWith('Copied'));
    assert.equal(JSON.parse(Buffer.from(new URL(await page.evaluate(() => window.__copied)).hash.slice(8), 'base64url').toString()).n, 'Dad');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('main.settings').waitFor();
    assert.deepEqual(await page.locator('.invite-item .set-name').allInnerTexts(), ['Dad', 'Mom']);
    assert.deepEqual(await page.locator('.invite-key').allInnerTexts(), ['…8765', '…4321']);
    await page.locator('.invite-item[data-invite]').last().scrollIntoViewIfNeeded();
    const [list] = await Promise.all([context.waitForEvent('page'), page.locator('.invite-item').last().getByRole('link', { name: 'Stop access' }).click()]);
    await list.waitForLoadState();
    assert.equal(list.url(), 'https://github.com/settings/personal-access-tokens', "GitHub's fine-grained token list");
    await list.close();
    assert.match(await page.locator('.invite-item').last().locator('.invite-stop-note').innerText(), /open “MK Cinema – Mom” and press Delete/);
    await page.locator('.invite-item').first().scrollIntoViewIfNeeded();
    await inviteShot(page, 'owner-5-list');
    await checkLayout(page);
    await page.getByRole('button', { name: 'Remove Dad from the list', exact: true }).click();
    assert.deepEqual(await page.locator('.invite-item .set-name').allInnerTexts(), ['Mom']);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.invites')).map(item => item.name)), ['Mom']);
    await context.close();
  });

  await record('invite: an owner who opens an invite keeps his own key unless he switches', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(owner => { if (!localStorage.getItem('mkc.token')) localStorage.setItem('mkc.token', owner); }, FAKE.owner);
    await mockGitHub(context);
    const page = await context.newPage();
    watch(page, 'invite owner device');
    await page.goto(`${origin}/${inviteHash('Mom', FAKE.guest)}`);
    await page.locator('main.invite-owner').waitFor();
    assert.equal(await page.evaluate(() => location.hash), '');
    await page.getByRole('button', { name: 'Keep my key', exact: true }).click();
    await page.locator('main.library').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), FAKE.owner);
    // Opening a link in a tab where the app already runs changes only the fragment.
    await page.evaluate(hash => { location.hash = hash; }, inviteHash('Mom', FAKE.guest));
    await page.locator('main.invite-owner').waitFor();
    assert.equal(await page.evaluate(() => location.hash), '');
    await page.getByRole('button', { name: "Switch to Mom's invite", exact: true }).click();
    await page.locator('main.welcome').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), FAKE.guest);
    await context.close();
  });

  // Home-screen apps. An iPhone's keeps its own storage (WebKit bug 181849) and opens the start address, so a key saved
  // in Safari is not there. Chrome cannot emulate either: navigator.standalone (iPhone only) and the display-mode
  // query (CDP ignores it) are stubbed. A new context is a new storage, like a newly added home-screen app.
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
  const iphone = (context, homeScreen) => context.addInitScript(on => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => on, configurable: true }), homeScreen);
  const displayStandalone = context => context.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = query => { const list = real(query); if (/display-mode:\s*standalone/u.test(query)) Object.defineProperty(list, 'matches', { value: true }); return list; };
  });
  // The clipboard answers what the test put in window.__clipboard; an Error there is a refusal. Like an iPhone, it
  // refuses a read that is not made inside the tap itself.
  const clipboard = context => context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { readText: async () => {
    if (window.event?.type !== 'click') throw new DOMException('Not inside a tap', 'NotAllowedError');
    const value = window.__clipboard; if (value instanceof Error) throw value; return value ?? '';
  } }, configurable: true }));
  const pasteStatus = (page, pattern) => page.waitForFunction(source => new RegExp(source).test(document.querySelector('#paste-status')?.textContent || ''), pattern.source);

  await record('invite: a home-screen app with no key asks for the invite link (clipboard or box), never for a token', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await displayStandalone(context);
    await clipboard(context);
    await mockGitHub(context);
    const page = await context.newPage();
    watch(page, 'invite paste');
    await page.goto(`${origin}/`);
    await page.locator('main.invite-paste').waitFor();
    const text = await mainText(page);
    assert.match(text, /Paste your invite link/);
    assert.match(text, /Copy the link Mohamed sent you/);
    assert.doesNotMatch(text, /github|token/i, "never the owner's token screen");
    assert.equal(await page.locator('#connect-form').count(), 0);
    await inviteShot(page, 'guest-paste');
    await checkLayout(page);
    // Going offline leaves it be: Retry on the offline screen would try a missing key and show the token screen.
    await page.evaluate(() => { window.__offline = new Promise(resolve => addEventListener('offline', () => setTimeout(resolve, 0), { once: true })); });
    await context.setOffline(true);
    await page.evaluate(() => window.__offline);
    assert.equal(await page.locator('main.invite-paste').count(), 1, 'offline keeps the paste screen');
    await context.setOffline(false);
    const paste = page.getByRole('button', { name: 'Paste invite link', exact: true });
    await page.evaluate(() => { window.__clipboard = 'see you at 8'; });
    await paste.click();
    await pasteStatus(page, /isn't an invite link/);
    // A refused or empty clipboard hands over to the box.
    await page.evaluate(() => { window.__clipboard = new DOMException('Refused by test', 'NotAllowedError'); });
    await paste.click();
    await pasteStatus(page, /Tap the box, then choose Paste/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'invite-paste', 'the box takes focus');
    // A broken link and another app's link are refused in the box, and nothing is stored.
    const open = page.getByRole('button', { name: 'Open invite', exact: true });
    await page.locator('#invite-paste').fill(`${origin}/#invite=bm90LWpzb24`);
    await open.click();
    await pasteStatus(page, /incomplete/);
    assert.equal(await page.locator('#invite-paste').getAttribute('aria-invalid'), 'true');
    await page.locator('#invite-paste').fill(`https://example.test/another-app/${inviteHash('Mom', FAKE.guest)}`);
    assert.equal(await page.locator('#invite-paste').getAttribute('aria-invalid'), null, 'typing clears the error');
    await open.click();
    await pasteStatus(page, /for another app/);
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), null, 'a refused link stores nothing');
    await inviteShot(page, 'guest-paste-refused');
    await checkLayout(page);
    // The shared message with the link in it opens the invite on the same path as opening the link.
    await page.evaluate(link => { window.__clipboard = `Mohamed shared his cinema with you. ${link}`; }, `${origin}/${inviteHash('Mom', FAKE.guest)}`);
    await paste.click();
    await page.locator('main.welcome').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), FAKE.guest);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.guest'))), { name: 'Mom', left: false });
    assert.equal(await page.locator('.welcome-tip').innerText(), 'Keep this link: tap it any time to watch.', 'no home-screen tip inside the home-screen app');
    await page.getByRole('button', { name: 'Start watching', exact: true }).click();
    await page.locator('main.library').waitFor();
    await page.reload();
    await page.locator('main.library').waitFor(); // the next launch opens the cinema
    await context.close();
  });

  await record('invite: on an iPhone the welcome says keep the link; its home-screen app pastes it once', async () => {
    const link = `${origin}/${inviteHash('Mom', FAKE.guest)}`;
    const safari = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await iphone(safari, false);
    await mockGitHub(safari);
    let page = await safari.newPage();
    watch(page, 'iPhone Safari');
    await page.goto(link);
    await page.locator('main.welcome').waitFor();
    assert.equal(await page.locator('.welcome-tip').innerText(), 'Keep this link: tap it any time to watch.', 'no home-screen promise on an iPhone');
    await page.locator('.welcome-card.is-ready').first().waitFor();
    await inviteShot(page, 'guest-welcome-iphone');
    await checkLayout(page);
    await safari.close();
    const app = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await iphone(app, true);
    await mockGitHub(app);
    page = await app.newPage();
    watch(page, 'iPhone home screen');
    await page.goto(`${origin}/`);
    await page.locator('main.invite-paste').waitFor();
    assert.doesNotMatch(await mainText(page), /github|token/i);
    await page.locator('#invite-paste').fill(link); // a whole link in the box opens at once
    await page.locator('main.welcome').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), FAKE.guest);
    await page.getByRole('button', { name: 'Start watching', exact: true }).click();
    await page.locator('main.library').waitFor();
    // There a tapped link opens Safari, not the home-screen app, so after Leave the way back is a paste.
    await page.locator('#tabbar [data-tab=settings]').click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await page.locator('main.invite-left').waitFor();
    assert.match(await mainText(page), /To come back, paste his invite link\./);
    assert.equal(await page.locator('.settings-button').count(), 0, 'no Settings without a key: its rows talk about tokens');
    await inviteShot(page, 'guest-left-home-screen');
    await checkLayout(page);
    await page.getByRole('button', { name: 'Paste his invite link', exact: true }).click();
    await page.locator('main.invite-paste').waitFor();
    // The owner's own phone: one quiet button leads to his connect screen, and back.
    await page.getByRole('button', { name: "I'm Mohamed", exact: true }).click();
    await page.locator('main.connect').waitFor();
    await page.getByRole('button', { name: 'I have an invite link', exact: true }).click();
    await page.locator('main.invite-paste').waitFor();
    await page.getByRole('button', { name: "I'm Mohamed", exact: true }).click();
    await page.locator('main.connect').waitFor();
    await inviteShot(page, 'home-screen-connect');
    await checkLayout(page);
    // An invite link pasted into the token box opens the invite; it is never saved as a token.
    await page.getByLabel('GitHub token', { exact: true }).fill(link);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.locator('main.welcome').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.token')), FAKE.guest);
    await app.close();
  });

  await record('invite: no key ever appears in a request URL, on the wire or in the console', async () => {
    const hits = list => list.filter(text => keys.some(key => text.includes(key)) || text.includes('invite='));
    assert.ok(wire.length > 0 && leaks.requests.length > 0, 'requests were recorded');
    assert.deepEqual(hits(wire), [], 'the server never saw a key or an invite');
    assert.deepEqual(hits(leaks.requests), [], 'no request URL carries a key');
    assert.deepEqual(hits(leaks.console), [], 'nothing printed a key');
  });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

await writeFile(new URL('results.json', shots), JSON.stringify({ checks: results, consoleErrors: errors }, null, 2) + '\n');
assert.deepEqual(errors, [], 'No browser console or page errors');
assert.ok(results.every(r => r.pass), 'All browser checks pass');
console.log(`${results.length} browser checks passed.`);
