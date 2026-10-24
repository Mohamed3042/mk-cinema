import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';
import { feedWindow, feedProgress, feedTime } from '../motion.js';

// Motion checks. They run in real time in headless Chrome with motion on, so previews, hover cards and
// transitions really play. Dates are fixed so "NEW" and "New this week" never drift.
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
const DESKTOP = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 };
const ROW = '.shelf[data-row="New this week"]';

async function record(name, task) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY="New & Hot" runs the checks whose name contains it
  try { await task(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function session({ viewport = DESKTOP, reduced = false, phone = false, extra = {} } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block', hasTouch: phone, isMobile: phone, ...extra });
  await context.clock.setFixedTime('2026-10-23T12:00:00Z');
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const label = `${viewport.width}${reduced ? ' reduced' : ''}`;
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
  return { context, page };
}
async function loaded(page, suffix = '?demo') {
  await page.goto(`${origin}/${suffix}`);
  await page.locator('main.library').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function shot(page, name) {
  await page.waitForFunction(() => [...document.querySelectorAll('img[data-poster]')].every(el => el.complete && el.naturalWidth > 0));
  await page.screenshot({ path: new URL(`${name}.png`, shots).pathname.replace(/^\/(\w:)/, '$1'), animations: 'disabled' });
}
const box = (page, selector) => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
const billboardState = page => page.locator('.billboard').getAttribute('data-preview');
const waitState = (page, state, timeout = 9000) => page.waitForFunction(wanted => document.querySelector('.billboard')?.dataset.preview === wanted, state, { timeout });
const identity = transform => transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
async function hoverCard(page, index, row = ROW) {
  const card = page.locator(row).locator('.card').nth(index);
  const rect = await card.evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.min(r.left + r.width / 2, innerWidth - 24), y: r.top + r.height / 2 }; });
  await page.mouse.move(rect.x, rect.y);
  return card;
}
async function showRow(page, row = ROW) {
  await page.locator(row).scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 160));
  await page.waitForTimeout(350);
}

try {
  await record('desktop tabs: six tabs, 250 ms crossfade, moving ink, content per tab', async () => {
    const { context, page } = await session();
    await loaded(page);
    assert.deepEqual(await page.locator('.tabs .tab').allInnerTexts(), ['Home', 'New & Hot', 'Films', 'Ads', 'Demos', 'My List']);
    assert.equal(await page.locator('.tab[aria-current=page]').innerText(), 'Home');
    assert.equal(await page.locator('#tabbar').isVisible(), false, 'The bottom bar is for phones');
    assert.ok(await page.locator('[data-action=search]').count() === 1 && await page.getByRole('button', { name: 'Settings', exact: true }).count() === 1, 'Search and settings sit in the top bar');
    const fade = await page.evaluate(async () => {
      document.querySelector('.tab[data-tab=new]').click();
      const seen = new Set();
      const end = performance.now() + 900;
      while (performance.now() < end) {
        for (const animation of document.getAnimations()) if (animation.effect?.pseudoElement?.startsWith('::view-transition')) seen.add(animation.effect.getComputedTiming().duration);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return [...seen];
    });
    assert.ok(fade.includes(250), `The tab switch crossfades for 250 ms (saw ${JSON.stringify(fade)})`);
    await page.locator('main[data-tab=new] .hot-item').first().waitFor();
    assert.equal(await page.locator('main[data-tab=new] .hot-item').count(), new Set(catalog.films.map(f => f.group || f.id)).size, 'New & Hot lists every title once');
    const ink = await page.evaluate(() => ({ x: document.querySelector('.tab-ink').style.getPropertyValue('--x'), left: `${document.querySelector('.tab[aria-current]').offsetLeft}px` }));
    assert.equal(ink.x, ink.left, 'The ink sits under the active tab');
    for (const [tab, id] of [['films', 'golden-hour'], ['ads', 'velvet-steps'], ['demos', 'light-journey']]) {
      await page.locator(`.tab[data-tab=${tab}]`).click();
      await page.locator(`main[data-tab=${tab}] .billboard[data-film="${id}"]`).waitFor();
      assert.equal(await page.locator('.tab[aria-current=page]').getAttribute('data-tab'), tab);
    }
    await page.locator('.tab[data-tab=home]').click();
    await page.locator('main[data-tab=home] .billboard').waitFor();
    await page.evaluate(() => scrollTo(0, 900));
    await page.locator('.tab[data-tab=home]').click();
    await page.waitForFunction(() => scrollY < 5);
    await context.close();
  });

  await record('top bar is clear over the hero and frosted ink within 80 px of scroll', async () => {
    const { context, page } = await session();
    await loaded(page);
    const look = () => page.locator('#topbar').evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, frost: s.backdropFilter || s.webkitBackdropFilter }; });
    assert.equal((await look()).background, 'rgba(5, 6, 10, 0)');
    await page.evaluate(() => scrollTo(0, 40));
    await page.waitForFunction(() => document.querySelector('#topbar').style.getPropertyValue('--bar') === '0.500');
    const half = Number((await look()).background.match(/[\d.]+/g)[3]);
    assert.ok(half > 0.3 && half < 0.42, `Half way down it is half frosted (alpha ${half})`);
    await page.evaluate(() => scrollTo(0, 120));
    await page.waitForFunction(() => document.querySelector('#topbar').style.getPropertyValue('--bar') === '1.000');
    const settled = await look();
    assert.equal(settled.background, 'rgba(5, 6, 10, 0.72)');
    assert.match(settled.frost, /blur\(26px\)/, 'Settled, it frosts what scrolls under it');
    await context.close();
  });

  await record('phone: bottom tab bar with icons and safe-area inset, tab switching, search', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await loaded(page);
    const bar = page.locator('#tabbar');
    assert.deepEqual(await bar.locator('button').allInnerTexts(), ['Home', 'New & Hot', 'Search', 'My List']);
    assert.equal(await bar.locator('button svg').count(), 4, 'Every tab has an icon');
    assert.equal(await page.locator('.tabs').count(), 0, 'The desktop tabs are not on a phone');
    const rect = await box(page, '#tabbar');
    assert.ok(Math.abs(rect.bottom - (844 - 10)) < 1 && Math.abs(rect.width - (390 - 28)) < 1, 'A capsule floating 10 px over the bottom edge, 14 px in from the sides');
    const inset = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter(rule => rule.selectorText === '.tabbar').map(rule => rule.cssText).join(' '));
    assert.match(inset, /safe-area-inset-bottom/, 'The bar keeps clear of the iPhone home indicator');
    await waitState(page, 'playing');
    await shot(page, 'home');
    await bar.getByRole('button', { name: 'New & Hot' }).click();
    await page.locator('main[data-tab=new] .hot-item').first().waitFor();
    assert.equal(await bar.locator('[aria-current=page]').innerText(), 'New & Hot');
    await bar.getByRole('button', { name: 'My List' }).click();
    await page.locator('main[data-tab=list] .empty-list').waitFor();
    await bar.getByRole('button', { name: 'Search' }).click();
    await page.locator('#film-search').waitFor();
    assert.ok(await page.locator('#film-search').evaluate(el => document.activeElement === el), 'Search opens with the keyboard ready');
    assert.equal(await bar.locator('[aria-current=page]').innerText(), 'Search');
    await bar.getByRole('button', { name: 'Home' }).click();
    await page.locator('main[data-tab=home] .billboard').waitFor();
    assert.equal(await page.locator('#film-search').count(), 0, 'Home closes search');
    await context.close();
  });

  await record('My List: add from More info, shows on the tab, survives a reload, removes cleanly', async () => {
    const { context, page } = await session({ extra: { reducedMotion: 'reduce' } });
    await loaded(page);
    await page.locator('.tab[data-tab=list]').click();
    await page.locator('.empty-list').waitFor();
    await page.locator('.tab[data-tab=home]').click();
    await page.locator('.film-card[data-film="amber-room"]').first().click();
    const toggle = page.locator('#film-detail .list-toggle');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.match(await toggle.getAttribute('aria-label'), /^Add to My List: The Amber Room/);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.match(await toggle.getAttribute('aria-label'), /^Remove from My List/);
    assert.equal(await page.locator('#announce').innerText(), 'Added to My List');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.demo.list')));
    assert.deepEqual(stored, ['amber-room'], 'Only the film id is stored');
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.list')), null, 'Demo data stays apart from the private list');
    await page.keyboard.press('Escape');
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await page.locator('.tab[data-tab=list]').click();
    await page.locator('main[data-tab=list] .film-card[data-film="amber-room"]').waitFor();
    assert.match(await page.locator('.results-count').innerText(), /^1 title$/);
    await shot(page, 'my-list-desktop');
    await page.reload();
    await page.locator('.tab[data-tab=list]').click();
    await page.locator('main[data-tab=list] .film-card[data-film="amber-room"]').waitFor();
    await page.locator('.film-card[data-film="amber-room"]').click();
    await page.locator('#film-detail .list-toggle').click();
    await page.keyboard.press('Escape');
    await page.locator('.empty-list').waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.demo.list'))), []);
    await context.close();
  });

  await record('My List on a phone: add from the sheet, then see it on the tab', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await loaded(page);
    await page.locator(ROW).scrollIntoViewIfNeeded();
    await page.locator(ROW).locator('.film-card').nth(2).tap();
    await page.locator('#film-detail[open]').waitFor();
    await page.locator('#film-detail .list-toggle').tap();
    assert.equal(await page.locator('#film-detail .list-toggle').getAttribute('aria-pressed'), 'true');
    await page.touchscreen.tap(195, 40);
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await page.locator('#tabbar').getByRole('button', { name: 'My List' }).tap();
    await page.locator('main[data-tab=list] .results-grid .film-card').waitFor();
    assert.equal(await page.locator('main[data-tab=list] .results-grid .film-card').count(), 1);
    await shot(page, 'my-list');
    await context.close();
  });

  await record('hover card: 400 ms delay, 1.5x growth from the right edge, preview after 600 ms, collapse', async () => {
    const { context, page } = await session();
    await loaded(page);
    await showRow(page);
    await page.evaluate(() => {
      window.__t = {};
      document.addEventListener('pointerover', event => { if (event.target.closest?.('.card') && !window.__t.over) window.__t.over = performance.now(); }, true);
      new MutationObserver(() => { if (document.querySelector('.bob') && !window.__t.bob) window.__t.bob = performance.now(); }).observe(document.body, { childList: true });
    });
    const card = await hoverCard(page, 0);
    const first = await card.evaluate(el => { const r = el.querySelector('.film-card').getBoundingClientRect(); return { left: r.left, width: r.width }; });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.bob').count(), 0, 'Nothing grows before the 400 ms delay');
    await page.locator('.bob').waitFor();
    const delay = await page.evaluate(() => window.__t.bob - window.__t.over);
    assert.ok(delay >= 380 && delay <= 600, `The card opens after a 400 ms hover (took ${Math.round(delay)} ms)`);
    await page.waitForFunction(() => document.querySelector('.bob')?.dataset.state === 'open');
    const bob = await box(page, '.bob');
    assert.equal(await page.locator('.bob').getAttribute('data-edge'), 'left');
    assert.ok(Math.abs(bob.left - first.left) < 1, 'The left-edge card grows rightward');
    assert.ok(Math.abs(bob.width / first.width - 1.5) < 0.02, `It grows about 1.5x (${(bob.width / first.width).toFixed(2)})`);
    assert.ok(bob.top < (await box(page, `${ROW} .card`)).top, 'It rises above its neighbours');
    const buttons = await page.locator('.bob [data-bob]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    assert.match(buttons[0], /^Play /); assert.match(buttons[1], /^Add to My List: /); assert.match(buttons[2], /^More info: /);
    assert.match(await page.locator('.bob-meta').innerText(), /NEW\s*0:12\s*Film/);
    const opened = await page.evaluate(() => window.__t.bob);
    await page.waitForFunction(() => document.querySelector('.bob')?.classList.contains('is-playing'), null, { timeout: 8000 });
    const playing = await page.evaluate(() => ({ at: performance.now(), t: document.querySelector('.bob video').currentTime, paused: document.querySelector('.bob video').paused, muted: document.querySelector('.bob video').muted }));
    assert.ok(playing.at - opened >= 580, `The muted preview waits 600 ms (started ${Math.round(playing.at - opened)} ms after opening)`);
    assert.ok(!playing.paused && playing.muted && playing.t > 0.9, 'The preview plays muted from about 10% in');
    await shot(page, 'bob-card-desktop');
    // right edge and middle
    await page.mouse.move(5, 5);
    await page.locator('.bob').waitFor({ state: 'detached' });
    await hoverCard(page, 3);
    await page.locator('.bob').waitFor();
    const rightCard = await box(page, `${ROW} .card:nth-child(4) .film-card`);
    await page.waitForFunction(() => document.querySelector('.bob')?.dataset.state === 'open');
    assert.equal(await page.locator('.bob').getAttribute('data-edge'), 'right');
    const right = await box(page, '.bob');
    assert.ok(Math.abs(right.right - rightCard.right) < 1, 'The right-edge card grows leftward');
    await hoverCard(page, 1);
    await page.waitForFunction(() => document.querySelector('.bob')?.dataset.edge === 'center', null, { timeout: 4000 });
    const middleCard = await box(page, `${ROW} .card:nth-child(2) .film-card`);
    await page.waitForFunction(() => document.querySelector('.bob')?.dataset.state === 'open');
    const middle = await box(page, '.bob');
    assert.ok(Math.abs((middle.left + middle.width / 2) - (middleCard.left + middleCard.width / 2)) < 1.5, 'A middle card grows from its centre');
    // one preview at a time
    const playingNow = await page.evaluate(() => [...document.querySelectorAll('video')].filter(video => !video.paused && !video.closest('.billboard')).length);
    assert.ok(playingNow <= 1, 'At most one hover preview plays');
    // collapse plays the grow backwards, then everything is released
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => document.querySelector('.bob')?.dataset.state === 'closing', null, { timeout: 1500 });
    await page.waitForFunction(() => { const transform = document.querySelector('.bob') && getComputedStyle(document.querySelector('.bob')).transform; return transform && transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)'; }, null, { timeout: 1500 });
    await page.locator('.bob').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('video[src]')].filter(video => !video.closest('.billboard')).length), 0, 'The preview is released');
    await context.close();
  });

  await record('hover card actions: + My List toggles, More info grows the sheet from the card, Play opens the player', async () => {
    const { context, page } = await session();
    await loaded(page);
    await showRow(page);
    await hoverCard(page, 1);
    await page.waitForFunction(() => document.querySelector('.bob')?.dataset.state === 'open');
    const add = page.locator('.bob [data-bob=list]');
    await add.click();
    assert.equal(await add.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mkc.demo.list')).length), 1);
    await page.locator('.bob [data-bob=info]').click();
    await page.locator('#film-detail[open]').waitFor();
    assert.equal(await page.locator('.bob').count(), 0, 'The hover card gives way to the sheet');
    assert.equal(await page.locator('#film-detail .list-toggle').getAttribute('aria-pressed'), 'true', 'The sheet agrees with the list');
    await page.keyboard.press('Escape');
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await hoverCard(page, 2);
    await page.waitForFunction(() => document.querySelector('.bob')?.dataset.state === 'open');
    await page.locator('.bob [data-bob=play]').click();
    await page.locator('main.player video').waitFor();
    await context.close();
  });

  await record('More info on desktop: grows out of the card, 850 px panel, autoplay preview, closes by Esc, x and backdrop', async () => {
    const { context, page } = await session();
    await loaded(page);
    await showRow(page);
    const opener = page.locator('.film-card[data-film="last-light"]').first();
    await opener.scrollIntoViewIfNeeded();
    const cardRect = await opener.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, width: r.width }; });
    const early = await page.evaluate(async () => {
      document.querySelector('.film-card[data-film="last-light"]').click();
      await new Promise(resolve => setTimeout(resolve, 70));
      const dialog = document.querySelector('#film-detail');
      return { open: dialog?.open, animations: dialog?.getAnimations().length, transform: getComputedStyle(dialog).transform, clip: getComputedStyle(dialog).clipPath, width: dialog.getBoundingClientRect().width };
    });
    assert.ok(early.open && early.animations >= 1 && !identity(early.transform), 'It starts as the card and grows');
    assert.ok(early.width < 850 * 0.8, `At 70 ms it is still small (${Math.round(early.width)} px)`);
    await page.waitForFunction(() => document.querySelector('#film-detail')?.getAnimations().every(animation => animation.playState === 'finished'));
    const panel = await box(page, '#film-detail');
    assert.ok(Math.abs(panel.width - 850) <= 2, `The panel is about 850 px wide (${panel.width})`);
    assert.ok(Math.abs(panel.left + panel.width / 2 - 720) <= 2, 'It sits in the centre');
    assert.ok(identity(await page.locator('#film-detail').evaluate(el => getComputedStyle(el).transform)));
    const backdrop = await page.locator('#film-detail').evaluate(el => getComputedStyle(el, '::backdrop').backdropFilter || getComputedStyle(el, '::backdrop').webkitBackdropFilter);
    assert.match(backdrop, /blur\(/, 'The page behind is dimmed and blurred');
    const art = await box(page, '#film-detail .detail-art');
    assert.ok(Math.abs(art.width / art.height - 16 / 9) < 0.02, 'The top is a 16:9 picture');
    for (const selector of ['[data-action=play]', '.list-toggle', '.detail-hero h1', '.episodes [data-version]', '.shelf[aria-label="More like this"] .more-grid .film-card']) assert.ok(await page.locator(`#film-detail ${selector}`).count(), `Sheet has ${selector}`);
    assert.equal(await page.locator('#film-detail .episodes').count(), 1, 'Versions are listed like episodes');
    await page.waitForFunction(() => document.querySelector('#film-detail .detail-art')?.classList.contains('is-playing'), null, { timeout: 8000 });
    const preview = await page.locator('#film-detail .detail-video').evaluate(el => ({ paused: el.paused, muted: el.muted, t: el.currentTime }));
    assert.ok(!preview.paused && preview.muted && preview.t > 0.9, 'The 16:9 preview autoplays muted');
    const mute = page.locator('#film-detail [data-action=detail-mute]');
    await mute.click();
    assert.equal(await page.locator('#film-detail .detail-video').evaluate(el => el.muted), false, 'The round button unmutes');
    assert.equal(await mute.getAttribute('aria-label'), 'Mute');
    await shot(page, 'modal-desktop');
    // Escape: runs backwards
    await page.keyboard.press('Escape');
    const closing = await page.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 70));
      const dialog = document.querySelector('#film-detail');
      return dialog ? { closing: dialog.dataset.closing, transform: getComputedStyle(dialog).transform, width: dialog.getBoundingClientRect().width } : null;
    });
    assert.ok(closing && closing.closing === 'true' && !identity(closing.transform) && closing.width < 850, 'Closing plays the opening in reverse');
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    assert.ok(await opener.evaluate(el => document.activeElement === el), 'Focus returns to the card');
    // x button and backdrop
    await opener.click();
    await page.locator('#film-detail[open]').waitFor();
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await opener.click();
    await page.locator('#film-detail[open]').waitFor();
    await page.mouse.click(8, 450);
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'The page is scrollable again');
    assert.ok(cardRect.width > 0);
    await context.close();
  });

  await record('More info on a phone: bottom sheet springs up, drags down to close, taps outside to close', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await loaded(page);
    await page.locator(ROW).scrollIntoViewIfNeeded();
    const opener = page.locator(ROW).locator('.film-card').nth(1);
    await opener.tap();
    await page.locator('#film-detail[open]').waitFor();
    await page.waitForFunction(() => document.querySelector('#film-detail')?.getAnimations().length === 0, null, { timeout: 4000 });
    const sheet = await box(page, '#film-detail');
    assert.ok(Math.abs(sheet.bottom - 844) <= 1 && sheet.width === 390, 'A sheet on the bottom edge');
    assert.ok(await page.locator('#film-detail .sheet-handle').isVisible(), 'It shows a grab handle');
    await page.waitForFunction(() => document.querySelector('#film-detail .detail-art')?.classList.contains('is-playing'), null, { timeout: 8000 });
    await shot(page, 'modal');
    const cdp = await context.newCDPSession(page);
    const drag = async (from, to, steps, pause = 0) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
      for (let step = 1; step <= steps; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + (to.y - from.y) * step / steps }] });
        if (pause) await page.waitForTimeout(pause);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    // a short, slow pull springs back
    await drag({ x: 200, y: sheet.top + 120 }, { x: 200, y: sheet.top + 150 }, 6, 40);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#film-detail').count(), 1, 'A short pull does not close it');
    const back = await box(page, '#film-detail');
    assert.ok(Math.abs(back.bottom - 844) <= 1 && await page.locator('#film-detail').evaluate(el => el.style.transform === ''), 'It springs back into place');
    // a long pull closes it
    await drag({ x: 200, y: back.top + 120 }, { x: 200, y: back.top + 520 }, 10);
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.tabbar').isVisible(), true);
    // the dimmed area closes it too
    await opener.tap();
    await page.locator('#film-detail[open]').waitFor();
    await page.touchscreen.tap(195, 40);
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await context.close();
  });

  await record('autoplay: billboard film starts after 2 s at 10%, text quiets at 6 s, replay at the end, pauses offscreen', async () => {
    const { context, page } = await session();
    const started = Date.now();
    await loaded(page);
    assert.equal(await billboardState(page), 'poster');
    assert.equal(await page.locator('.billboard-video').evaluate(el => el.hasAttribute('src')), false, 'No film is fetched before the 2 s mark');
    await waitState(page, 'playing');
    const delay = Date.now() - started;
    assert.ok(delay >= 1900 && delay < 6500, `The film shows about 2 s after the page opens (${delay} ms)`);
    const video = page.locator('.billboard-video');
    const info = await video.evaluate(el => ({ t: el.currentTime, d: el.duration, muted: el.muted, inline: el.hasAttribute('playsinline') }));
    assert.ok(info.t >= info.d * 0.1 - 0.05 && info.t < info.d * 0.1 + 1.2, `It starts about 10% in (${info.t.toFixed(2)} of ${info.d.toFixed(2)} s)`);
    assert.ok(info.muted && info.inline, 'muted playsinline');
    const opacity = () => video.evaluate(el => Number(getComputedStyle(el).opacity));
    await page.waitForFunction(() => document.querySelector('.billboard')?.classList.contains('is-playing'));
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.billboard-video')).opacity) > 0.95, null, { timeout: 3000 });
    assert.ok(await opacity() > 0.95, 'The film has crossfaded over the poster');
    assert.equal(await page.locator('.billboard.is-quiet').count(), 0, 'The text is still there at first');
    await page.waitForFunction(() => document.querySelector('.billboard')?.classList.contains('is-quiet'), null, { timeout: 6000 });
    const quietAt = Date.now() - started;
    assert.ok(quietAt >= 5600 && quietAt < 9500, `The text quiets about 6 s in (${quietAt} ms)`);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.billboard .blurb-wrap')).opacity) < 0.05, null, { timeout: 3000 });
    const title = await page.locator('.billboard h1').evaluate(el => getComputedStyle(el).transform);
    assert.ok(!identity(title), 'The title shrinks');
    assert.equal(await page.locator('.billboard h1').evaluate(el => getComputedStyle(el).transitionDuration), '1.2s', 'in about 1.2 s');
    assert.ok(await page.locator('.billboard-tool').isVisible(), 'A round mute button sits bottom-right');
    const tool = await box(page, '.billboard-tool');
    assert.ok(tool.right > 1300 && tool.width === 44 && tool.height === 44, 'round and 44 px');
    assert.equal(await page.locator('.billboard-tool').getAttribute('aria-label'), 'Unmute');
    await shot(page, 'home-desktop');
    await page.locator('.billboard-tool').click();
    assert.equal(await video.evaluate(el => el.muted), false);
    assert.equal(await page.locator('.billboard-tool').getAttribute('aria-label'), 'Mute');
    // offscreen: paused; back: playing
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await waitState(page, 'paused', 3000);
    assert.equal(await video.evaluate(el => el.paused), true, 'The film pauses once the billboard is offscreen');
    await page.evaluate(() => scrollTo(0, 0));
    await waitState(page, 'playing', 3000);
    assert.equal(await video.evaluate(el => el.paused), false, 'and resumes when it returns');
    // the end: back to the poster with a replay button
    await video.evaluate(el => { el.currentTime = el.duration - 0.2; });
    await waitState(page, 'ended', 5000);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.billboard-video')).opacity) < 0.05, null, { timeout: 3000 });
    assert.equal(await page.locator('.billboard-tool').getAttribute('aria-label'), 'Replay');
    assert.equal(await page.locator('.billboard.is-quiet').count(), 0, 'The text comes back');
    await page.locator('.billboard-tool').click();
    await waitState(page, 'playing', 6000);
    await context.close();
  });

  await record('autoplay: only one preview plays at a time and the sheet holds the billboard', async () => {
    const { context, page } = await session();
    await loaded(page);
    await waitState(page, 'playing');
    await showRow(page);
    await hoverCard(page, 1);
    await page.waitForFunction(() => document.querySelector('.bob')?.classList.contains('is-playing'), null, { timeout: 8000 });
    const count = await page.evaluate(() => [...document.querySelectorAll('video')].filter(video => !video.paused).length);
    assert.ok(count <= 2, `The billboard and one hover preview (saw ${count})`);
    await page.mouse.move(5, 5);
    await page.locator('.bob').waitFor({ state: 'detached' });
    await page.evaluate(() => scrollTo(0, 0));
    await waitState(page, 'playing', 4000);
    await page.locator('[data-action=hero-info]').click();
    await page.locator('#film-detail[open]').waitFor();
    await waitState(page, 'paused', 3000);
    await page.waitForFunction(() => document.querySelector('#film-detail .detail-art')?.classList.contains('is-playing'), null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('video')].filter(video => !video.paused).length), 1, 'Only the sheet plays');
    await page.keyboard.press('Escape');
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await waitState(page, 'playing', 3000);
    await context.close();
  });

  await record('Settings: Autoplay previews is on by default, switches every preview off and back on, and is remembered', async () => {
    const { context, page } = await session();
    await loaded(page);
    await waitState(page, 'playing');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const toggle = page.locator('#autoplay-toggle');
    assert.equal(await toggle.isChecked(), true, 'On by default');
    assert.equal(await toggle.getAttribute('role'), 'switch');
    await toggle.click();
    assert.equal(await page.evaluate(() => localStorage.getItem('mkc.autoplay')), '0');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await waitState(page, 'off', 2000);
    assert.equal(await page.locator('.billboard-video').evaluate(el => el.hasAttribute('src')), false, 'The film is gone, the poster stays');
    await showRow(page);
    await hoverCard(page, 1);
    await page.locator('.bob').waitFor();
    await page.waitForTimeout(1600);
    assert.equal(await page.locator('.bob').evaluate(el => el.classList.contains('is-playing')), false, 'Hover cards still open, without a preview');
    await page.mouse.move(5, 5);
    await page.reload();
    await page.locator('main.library').waitFor();
    await page.waitForTimeout(2800);
    assert.equal(await billboardState(page), 'off', 'It is remembered');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.locator('#autoplay-toggle').isChecked(), false);
    await page.locator('#autoplay-toggle').click();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await waitState(page, 'playing', 8000);
    await context.close();
  });

  await record('reduced motion: posters only, no hover card, no crossfade, no scrubbing, no growing sheet', async () => {
    const { context, page } = await session({ reduced: true });
    await loaded(page);
    await page.waitForTimeout(3200);
    assert.equal(await billboardState(page), 'off');
    assert.equal(await page.locator('video[src]').count(), 0, 'No film is loaded anywhere');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'Nothing is animating');
    await showRow(page);
    await hoverCard(page, 1);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.bob').count(), 0, 'No hover card');
    await page.locator('.tab[data-tab=new]').click();
    await page.locator('main[data-tab=new] .hot-item').first().waitFor();
    assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.pseudoElement).length), 0, 'The tab switch is instant');
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('video[src]').count(), 0, 'New & Hot stays on posters');
    assert.equal(await page.locator('.hot-item.is-live').count(), 0);
    assert.ok(await page.locator('.hot-item').first().evaluate(el => getComputedStyle(el.querySelector('.hot-video')).display === 'none'));
    await page.locator('.tab[data-tab=home]').click();
    await page.locator('.film-card[data-film="amber-room"]').first().click();
    await page.locator('#film-detail[open]').waitFor();
    assert.equal(await page.locator('#film-detail').evaluate(el => el.getAnimations().length), 0, 'The sheet opens without growing');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#film-detail .detail-video').evaluate(el => el.hasAttribute('src')), false, 'and without a preview');
    await page.keyboard.press('Escape');
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.locator('#autoplay-toggle').isDisabled(), true, 'The switch explains that reduced motion wins');
    assert.match(await page.locator('#autoplay-note').innerText(), /reduced motion/);
    await context.close();
    const phone = await session({ viewport: PHONE, reduced: true, phone: true });
    await loaded(phone.page);
    await phone.page.waitForTimeout(3000);
    assert.equal(await billboardState(phone.page), 'off');
    await phone.context.close();
  });

  await record('rows page by one view in 750 ms with paddles and dashes; Explore all slides out and opens the row', async () => {
    const { context, page } = await session();
    await loaded(page);
    await showRow(page);
    const shelf = page.locator(ROW);
    const track = shelf.locator('.card-track');
    const heading = shelf.locator('.shelf-heading');
    assert.equal(await shelf.locator('.explore').evaluate(el => el.offsetWidth), 0, 'Explore all is tucked away');
    assert.equal(await shelf.locator('.paddle-next').evaluate(el => Number(getComputedStyle(el).opacity)), 0, 'Paddles hide until hover');
    await heading.hover();
    await page.waitForFunction(selector => document.querySelector(`${selector} .explore`).offsetWidth > 60, ROW);
    await shelf.locator('.card').first().hover();
    await page.waitForFunction(selector => Number(getComputedStyle(document.querySelector(`${selector} .paddle-next`)).opacity) > 0.95, ROW);
    assert.equal(await shelf.locator('.paddle-prev').isDisabled(), true, 'No previous page at the start');
    const dashes = await shelf.locator('.row-dashes i').count();
    assert.equal(dashes, 2, 'Page dashes: one per page');
    assert.equal(await shelf.locator('.row-dashes i.on').count(), 1);
    const timing = await track.evaluate(el => ({ time: getComputedStyle(el).transitionDuration, ease: getComputedStyle(el).transitionTimingFunction }));
    assert.deepEqual(timing, { time: '0.75s', ease: 'cubic-bezier(0.5, 0, 0.1, 1)' });
    const view = await box(page, `${ROW} .row-viewport`);
    await shelf.locator('.paddle-next').click();
    await page.waitForTimeout(220);
    const mid = await track.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
    assert.ok(mid < -20, `It is sliding (${Math.round(mid)} px at 220 ms)`);
    await page.waitForTimeout(800);
    const end = await track.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
    assert.ok(mid > end || mid === end, 'and keeps going');
    assert.equal(await shelf.getAttribute('data-page'), '1');
    const geometry = () => shelf.evaluate(el => {
      const cards = [...el.querySelector('.card-track').children], style = getComputedStyle(el.querySelector('.card-track')), view = el.querySelector('.row-viewport').clientWidth;
      const gap = parseFloat(style.columnGap), pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), width = cards[0].offsetWidth;
      return { view, step: width + gap, per: Math.floor((view - pad + gap) / (width + gap) + 0.01), max: pad + cards.length * width + (cards.length - 1) * gap - view };
    });
    const small = await geometry();
    assert.ok(Math.abs(-end - Math.min(small.per * small.step, small.max)) < 1, 'A short last page stops flush with the edge instead of overshooting');
    assert.equal(await shelf.locator('.row-dashes i').nth(1).getAttribute('class'), 'on');
    assert.equal(await shelf.locator('.paddle-next').isDisabled(), true, 'The last page has no next');
    await shelf.locator('.paddle-prev').click();
    await page.waitForTimeout(950);
    assert.equal(await track.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41), 0, 'Back to the first page');
    // a long row (twelve cards) pages by a full view: four cards, about the width of the row
    await shelf.evaluate(el => { const row = el.querySelector('.card-track'); row.append(...[...row.children].map(card => card.cloneNode(true))); el.querySelector('.row-viewport').style.width = '1439px'; });
    await page.waitForFunction(selector => document.querySelector(selector).dataset.pages === '3', ROW);
    assert.equal(await shelf.locator('.row-dashes i').count(), 3);
    await shelf.locator('.card').first().hover();
    await shelf.locator('.paddle-next').click();
    await page.waitForTimeout(950);
    const full = await geometry();
    const paged = -(await track.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41));
    assert.ok(Math.abs(paged - full.per * full.step) < 1 && paged > view.width * 0.8 && paged <= view.width, `A full page is one view of cards (${Math.round(paged)} of ${Math.round(view.width)} px)`);
    await shelf.evaluate(el => { el.querySelector('.row-viewport').style.width = ''; });
    await page.reload();
    await page.locator('main.library').waitFor();
    await showRow(page);
    await heading.hover();
    await shelf.locator('.explore').click();
    await page.locator('.results h1').waitFor();
    assert.equal(await page.locator('.results h1').innerText(), 'New this week');
    assert.equal(await page.locator('.results-grid .film-card').count(), 6);
    await page.locator('[data-action=clear-filter]').click();
    await page.locator('.billboard').waitFor();
    await context.close();
    const phone = await session({ viewport: PHONE, phone: true });
    await loaded(phone.page);
    const rule = await phone.page.locator(`${ROW} .card-track`).evaluate(el => ({ x: getComputedStyle(el).overflowX, snap: getComputedStyle(el).scrollSnapType, over: el.scrollWidth > el.clientWidth }));
    assert.deepEqual(rule, { x: 'auto', snap: 'x mandatory', over: true }, 'On a phone rows are native momentum scrollers with snap');
    assert.equal(await phone.page.locator(`${ROW} .paddle-next`).evaluate(el => getComputedStyle(el).display), 'none');
    assert.ok(await phone.page.locator(`${ROW} .explore`).evaluate(el => el.offsetWidth > 60), 'Explore all is always visible on touch');
    await phone.context.close();
  });

  await record('skeleton shimmer while posters load, and a wipe-in progress bar on Continue watching', async () => {
    const { context, page } = await session({ extra: { reducedMotion: 'no-preference' } });
    await context.addInitScript(() => localStorage.setItem('mkc.demo.progress', JSON.stringify({ 'golden-hour': { time: 4, duration: 12, updated: Date.now() } })));
    await page.route('**/demo/posters/*', async route => { await new Promise(resolve => setTimeout(resolve, 900)); await route.continue(); });
    await page.goto(`${origin}/?demo`);
    await page.locator('main.library .film-card').first().waitFor();
    const during = await page.locator('.film-card').first().evaluate(el => ({ ready: el.classList.contains('is-ready'), animation: getComputedStyle(el).animationName }));
    assert.deepEqual(during, { ready: false, animation: 'shimmer' }, 'A shimmering skeleton stands in for the poster');
    await page.waitForFunction(() => [...document.querySelectorAll('.film-card')].every(el => el.classList.contains('is-ready')), null, { timeout: 8000 });
    assert.equal(await page.locator('.film-card').first().evaluate(el => getComputedStyle(el).animationName), 'none', 'The shimmer stops when the poster arrives');
    const bar = page.locator('.shelf[aria-label="Continue watching"] progress.watch-progress');
    assert.equal(await bar.count(), 1, 'Continue watching has a progress bar');
    assert.equal(await bar.getAttribute('value'), '4');
    assert.equal(await bar.getAttribute('max'), '12');
    assert.match(await bar.getAttribute('aria-label'), /Watch progress for Golden Hour/);
    assert.equal(await bar.evaluate(el => getComputedStyle(el).animationName), 'bar-in');
    assert.equal(await page.locator('.shelf:not([aria-label="Continue watching"]) progress').count(), 0, 'Other rows have none');
    await context.close();
  });

  await record('New & Hot: the film nearest the middle moves only while you scroll, stops about 50 ms after, rewinds back', async () => {
    const { context, page } = await session();
    await loaded(page);
    await page.locator('.tab[data-tab=new]').click();
    await page.locator('.hot-item[data-live=true]').waitFor({ timeout: 10000 });
    for (const selector of ['time', '.hot-name', '[data-play-film]']) assert.ok(await page.locator(`.hot-item ${selector}`).count() >= 7, `Every film shows ${selector}`);
    await shot(page, 'new-and-hot-desktop');
    const read = () => page.evaluate(() => {
      const item = document.querySelector('.hot-item[data-active]'), video = item?.querySelector('video'), stage = item?.querySelector('.hot-stage');
      const nearest = [...document.querySelectorAll('.hot-item')].map(el => { const r = el.querySelector('.hot-stage').getBoundingClientRect(); return { id: el.dataset.film, d: Math.abs(r.top + r.height / 2 - innerHeight / 2), visible: Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) > r.height * 0.25 }; }).filter(x => x.visible).sort((a, b) => a.d - b.d)[0]?.id;
      const r = stage?.getBoundingClientRect(), stages = [...document.querySelectorAll('.hot-stage')];
      return { id: item?.dataset.film, nearest, t: video?.currentTime, paused: video?.paused, duration: video?.duration, top: r?.top, height: r?.height, pitch: stages[1].getBoundingClientRect().top - stages[0].getBoundingClientRect().top, withSource: document.querySelectorAll('.hot-item video[src]').length };
    });
    let state = await read();
    assert.equal(state.id, state.nearest, 'The film nearest the middle is the one that moves');
    assert.ok(state.withSource <= 1, 'Only that film holds a video source');
    // settle, then scroll in small wheel steps
    await page.waitForFunction(() => document.querySelector('.hot-item[data-active] video')?.paused === true);
    const before = (await read()).t;
    // a frame-by-frame trace of the scroll position and the film, taken while the wheel turns
    await page.evaluate(() => {
      window.__trace = new Promise(resolve => {
        const video = document.querySelector('.hot-item[data-active] video'), rows = [], start = performance.now();
        const sample = () => { rows.push({ at: performance.now() - start, y: scrollY, paused: video.paused, time: video.currentTime }); if (performance.now() - start < 2400) requestAnimationFrame(sample); else resolve(rows); };
        requestAnimationFrame(sample);
      });
    });
    for (let step = 0; step < 10; step++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(28); }
    const trace = await page.evaluate(() => window.__trace);
    const lastMove = trace.findLast((row, index) => index > 0 && row.y !== trace[index - 1].y);
    const stopped = trace.find(row => row.at > lastMove.at && row.paused);
    assert.ok(stopped, 'The film stops once the scrolling stops');
    const delay = stopped.at - lastMove.at;
    console.log(`  the film stopped ${Math.round(delay)} ms after the page stopped moving`);
    assert.ok(delay <= 260, `It stops soon after the last input (${Math.round(delay)} ms)`);
    const afterStop = trace.filter(row => row.at >= stopped.at);
    assert.ok(afterStop.every(row => row.paused && Math.abs(row.time - stopped.time) < 0.02), 'and then it does not move again');
    assert.ok(trace.filter(row => row.at < lastMove.at && row.y !== trace[0].y).some(row => !row.paused), 'It played while the page was moving');
    state = await read();
    await page.waitForTimeout(300);
    const settled = await read();
    const target = feedTime(feedProgress(settled.top + settled.height / 2, DESKTOP.height / 2, settled.pitch), feedWindow(settled.duration, settled.pitch));
    assert.ok(settled.t - before > 1.5, `Scrolling 400 px moved the film (${before.toFixed(2)} s to ${settled.t.toFixed(2)} s)`);
    assert.ok(Math.abs(settled.t - target) < 0.3, `The frame matches the scroll position (${settled.t.toFixed(2)} s, wanted ${target.toFixed(2)} s)`);
    await page.waitForTimeout(500);
    const frozen = await read();
    assert.ok(frozen.paused && Math.abs(frozen.t - settled.t) < 0.02, 'No input, no motion');
    // back up: the film rewinds
    for (let step = 0; step < 10; step++) { await page.mouse.wheel(0, -40); await page.waitForTimeout(28); }
    await page.waitForTimeout(700);
    const rewound = await read();
    assert.ok(rewound.t < settled.t - 1.5, `Scrolling back rewinds it (${settled.t.toFixed(2)} s to ${rewound.t.toFixed(2)} s)`);
    assert.ok(rewound.paused);
    // moving on to the next film hands the video over
    await page.evaluate(() => scrollBy(0, 760));
    await page.waitForFunction(first => document.querySelector('.hot-item[data-active]')?.dataset.film !== first, state.id, { timeout: 4000 });
    await page.waitForTimeout(500);
    assert.ok((await read()).withSource <= 1, 'The previous film let go of its source');
    await context.close();
  });

  await record('New & Hot on a phone: films scrub with the scroll, the nearest one is active, controls stay reachable', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await loaded(page);
    await page.locator('#tabbar').getByRole('button', { name: 'New & Hot' }).click();
    await page.locator('.hot-item[data-live=true]').waitFor({ timeout: 10000 });
    await shot(page, 'new-and-hot');
    // Centre the second film first, so the 100 px scroll below stays on it whatever height the copy has.
    await page.evaluate(() => { const r = document.querySelectorAll('.hot-stage')[1].getBoundingClientRect(); scrollBy(0, r.top + r.height / 2 - innerHeight / 2); });
    await page.waitForFunction(() => document.querySelector('.hot-item[data-active]') === document.querySelectorAll('.hot-item')[1]);
    const read = () => page.evaluate(() => { const item = document.querySelector('.hot-item[data-active]'); const v = item?.querySelector('video'); return { id: item?.dataset.film, t: v?.currentTime, paused: v?.paused, live: item?.classList.contains('is-live') }; });
    await page.waitForFunction(() => document.querySelector('.hot-item[data-active] video')?.paused === true);
    const first = await read();
    await page.evaluate(() => scrollBy(0, 100));
    await page.waitForTimeout(700);
    const moved = await read();
    assert.equal(moved.id, first.id);
    assert.ok(moved.t > first.t + 0.5, `About 100 px of scroll moved the film (${first.t.toFixed(2)} s to ${moved.t.toFixed(2)} s)`);
    assert.ok(moved.paused, 'and it stopped');
    await page.evaluate(() => scrollBy(0, 480));
    await page.waitForFunction(id => document.querySelector('.hot-item[data-active]')?.dataset.film !== id, first.id, { timeout: 4000 });
    await page.locator('.hot-item[data-active] [data-play-film]').scrollIntoViewIfNeeded();
    const tap = await box(page, '.hot-item[data-active] .hot-play');
    assert.ok(tap.height >= 44, 'Play is a full-size tap target');
    await page.locator('.hot-item[data-active] .hot-play').tap();
    await page.locator('main.player video').waitFor();
    await context.close();
  });

  await record('New & Hot: the list button and the picture open My List and More info', async () => {
    const { context, page } = await session({ extra: { reducedMotion: 'reduce' } });
    await loaded(page);
    await page.locator('.tab[data-tab=new]').click();
    const item = page.locator('.hot-item[data-film="velvet-steps"]');
    await item.locator('.list-toggle').click();
    assert.equal(await item.locator('.list-toggle').getAttribute('aria-pressed'), 'true');
    await item.locator('.hot-stage').click({ position: { x: 200, y: 100 } });
    await page.locator('#film-detail[open]').waitFor();
    assert.equal(await page.locator('#film-detail .detail-hero h1').innerText(), 'Velvet Steps');
    assert.equal(await page.locator('#film-detail .list-toggle').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await context.close();
  });

  await record('keyboard, labels and AA contrast for the new chrome', async () => {
    const { context, page } = await session({ extra: { reducedMotion: 'reduce' } });
    await loaded(page);
    await page.evaluate(() => scrollTo(0, 200));
    const ratio = (selector, background = '#141414') => page.locator(selector).first().evaluate((el, bg) => {
      const parse = value => value.match(/[\d.]+/g).map(Number);
      const flatten = (fg, under) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + under[i] * (1 - a)); };
      const luminance = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const under = parse(bg.startsWith('#') ? `rgb(${[1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16)).join(',')})` : bg);
      const fg = flatten(parse(getComputedStyle(el).color), under);
      const [high, low] = [luminance(fg), luminance(under)].sort((a, b) => b - a);
      return (high + 0.05) / (low + 0.05);
    }, background);
    // Backgrounds are the Liquid Glass surfaces each text sits on: the tab capsule over frosted ink, the white
    // pills, the ink page, the smoked chip glass, and the details panel (a selected version is 10 % lighter).
    for (const [selector, background] of [['.tab:not([aria-current])', '#1e1f24'], ['.tab[aria-current]', '#ffffff'], ['.shelf-count', '#05060a'], ['.filter-chip[aria-pressed=false]', '#08090d'], ['.filter-chip[aria-pressed=true]', '#ffffff']]) assert.ok(await ratio(selector, background) >= 4.5, `${selector} passes AA`);
    await page.locator('.film-card[data-film="last-light"]').first().click();
    for (const [selector, background] of [['.detail-meta span:nth-child(2)', '#14161d'], ['.ep-copy small', '#2c2d34'], ['.date-added', '#14161d'], ['.episode:not(.selected) .ep-n', '#14161d']]) assert.ok(await ratio(`#film-detail ${selector}`, background) >= 4.5, `${selector} passes AA`);
    await page.keyboard.press('Escape');
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.paddle-next').first().getAttribute('aria-label'), 'Next titles: New this week');
    assert.equal(await page.locator('.explore').first().getAttribute('aria-label'), 'Explore all: New this week');
    await page.locator('.tab[data-tab=home]').focus();
    assert.notEqual(await page.locator('.tab[data-tab=home]').evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'Tabs show keyboard focus');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'new', 'Tab walks the top bar in order');
    await page.keyboard.press('Enter');
    await page.locator('main[data-tab=new]').waitFor();
    assert.equal(await page.locator('.tab[data-tab=new]').getAttribute('aria-current'), 'page');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'new', 'Focus stays on the tab after switching');
    const phone = await session({ viewport: PHONE, phone: true, extra: { reducedMotion: 'reduce' } });
    await loaded(phone.page);
    const rows = await phone.page.locator('#tabbar button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return r.height >= 44 && r.width >= 44; }));
    assert.deepEqual(rows, [true, true, true, true], 'Tab bar buttons are full-size tap targets');
    assert.equal(await phone.page.locator('#tabbar button[aria-current=page]').count(), 1);
    await phone.context.close();
    await context.close();
  });

  for (const big of [false, true]) await record(`previews on a phone: a refused stream ${big ? 'stays on the poster when the film is over 40 MB' : 'falls back to a whole-film download'}`, async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    const videoData = await readFile(new URL(catalog.films[0].versions[0].file, root));
    const mock = { ...catalog, films: catalog.films.map(film => ({ ...film, versions: film.versions.map(version => ({ ...version, bytes: big ? 80 * 1024 * 1024 : version.bytes })) })) };
    let metadata = 0, downloads = 0;
    await page.route('https://api.github.com/**', async route => {
      const request = route.request();
      const path = decodeURIComponent(new URL(request.url()).pathname.split('/contents/')[1]);
      const headers = { 'access-control-allow-origin': '*' };
      if (path === 'cinema.json') return route.fulfill({ json: mock, headers });
      if (request.headers().accept === 'application/vnd.github.object') { metadata++; return route.fulfill({ json: { download_url: `https://raw.githubusercontent.com/demo/mk-cinema/test.mp4?token=synthetic-${metadata}` }, headers }); }
      return route.fulfill({ body: await readFile(new URL(path, root)), contentType: 'image/jpeg', headers });
    });
    // Like iPhone Safari with GitHub's octet-stream type: the video element cannot stream it, fetch() can download it.
    await page.route('https://raw.githubusercontent.com/**', route => { if (route.request().resourceType() === 'media') return route.fulfill({ body: 'not a video', contentType: 'application/octet-stream' }); downloads++; return route.fulfill({ body: videoData, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } }); });
    await page.goto(`${origin}/`);
    await page.locator('main.connect').waitFor();
    await page.getByLabel('GitHub token', { exact: true }).fill('synthetic-test-token');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.locator('main.library .billboard').waitFor();
    if (big) {
      await waitState(page, 'failed', 12000);
      assert.equal(downloads, 0, 'A film over 40 MB is never downloaded for a preview');
      assert.equal(await page.locator('.billboard-video').evaluate(el => el.hasAttribute('src')), false, 'the poster stays');
    } else {
      await waitState(page, 'playing', 12000);
      assert.equal(await page.locator('.billboard-video').evaluate(el => el.src.startsWith('blob:')), true, 'It plays from memory');
      assert.equal(downloads, 1, 'The film was downloaded once');
      assert.equal(metadata, 3, 'stream, fresh link, then the download');
      await page.locator('#tabbar').getByRole('button', { name: 'New & Hot' }).tap();
      await page.waitForFunction(() => document.querySelector('.hot-item[data-live=true] video')?.src.startsWith('blob:'), null, { timeout: 12000 });
    }
    await context.close();
  });

  await record('the service worker caches the new motion files and the cache name moved on', async () => {
    const { context, page } = await session({ extra: { serviceWorkers: 'allow', reducedMotion: 'reduce' } });
    await loaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async name => [name, (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)]))));
    assert.deepEqual(Object.keys(cached), ['mkc-shell-v5'], 'Old shell caches are gone');
    for (const file of ['motion.css', 'motion.js', 'previews.js', 'billboard.js', 'rows.js', 'bob.js', 'modal.js', 'feed.js', 'ambient.js']) assert.ok(cached['mkc-shell-v5'].includes(`/${file}`), `${file} is cached`);
    assert.ok(cached['mkc-shell-v5'].every(path => !path.includes('/demo/')), 'No films in the shell cache');
    await context.close();
  });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

await writeFile(new URL('results-motion.json', shots), JSON.stringify({ checks: results, consoleErrors: errors }, null, 2) + '\n');
assert.deepEqual(errors, [], 'No browser console or page errors');
assert.ok(results.every(result => result.pass), 'All motion checks pass');
console.log(`${results.length} motion checks passed.`);
