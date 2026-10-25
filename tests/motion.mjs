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
  await record('desktop tabs: seven tabs, 250 ms crossfade, moving ink, content per tab', async () => {
    const { context, page } = await session();
    await loaded(page);
    assert.deepEqual(await page.locator('.tabs .tab').allInnerTexts(), ['Home', 'New & Hot', 'Films', 'Ads', 'Demos', 'Reels', 'My List']);
    assert.equal(await page.locator('[data-action=shuffle]').count(), 0, 'the Reels tab replaces the Shuffle capsule');
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
    assert.deepEqual(await bar.locator('button').allInnerTexts(), ['Home', 'New & Hot', 'Reels', 'Search', 'Settings']);
    assert.equal(await bar.locator('button svg').count(), 5, 'Every tab has an icon');
    assert.equal(await page.locator('#topbar button').count(), 1, 'the phone top bar is only the brand: Settings is a tab now');
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
    await bar.getByRole('button', { name: 'Settings' }).click();
    await page.locator('main.settings .settings-page').waitFor();
    assert.equal(await bar.locator('[aria-current=page]').innerText(), 'Settings');
    await page.getByRole('button', { name: /^Open My List/ }).click();
    await page.locator('main[data-tab=list] .empty-list').waitFor();
    assert.equal(await bar.locator('[aria-current=page]').innerText(), 'Settings', 'My List has no phone tab; Settings stays lit');
    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await page.locator('main.settings .settings-page').waitFor();
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
    const listRow = page.locator('.shelf[data-row="My List"]');
    await listRow.waitFor();
    assert.equal(await listRow.locator('.film-card').count(), 1, 'the My List row on Home shows the film at once');
    await page.locator('#tabbar').getByRole('button', { name: 'Settings' }).tap();
    assert.match(await page.getByRole('button', { name: /^Open My List/ }).innerText(), /1 title$/, 'Settings counts the saved titles');
    await page.getByRole('button', { name: /^Open My List/ }).tap();
    await page.locator('main[data-tab=list] .results-grid .film-card').waitFor();
    assert.equal(await page.locator('main[data-tab=list] .results-grid .film-card').count(), 1);
    await shot(page, 'my-list');
    await page.getByRole('button', { name: 'Back to Settings' }).tap();
    await page.locator('main.settings').waitFor();
    await page.locator('#tabbar').getByRole('button', { name: 'Home' }).tap();
    await page.locator('.shelf[data-row="My List"] .film-card').first().waitFor();
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
    // The film just added puts a My List row on Home as the sheet closes; hover once the rows have settled.
    await page.locator('.shelf[data-row="My List"]').waitFor();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
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
    await page.locator('main.settings').waitFor();
    assert.equal(await page.locator('#topbar [data-nav=settings]').getAttribute('aria-current'), 'page', 'the gear is lit while Settings is open');
    const toggle = page.getByRole('switch', { name: 'Autoplay previews', exact: true });
    assert.equal(await toggle.isChecked(), true, 'On by default');
    await toggle.click();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('mkc.settings'))).autoplay, false);
    await page.locator('.tab[data-tab=home]').click();
    await page.locator('main[data-tab=home] .billboard').waitFor();
    await page.waitForTimeout(2800);
    assert.equal(await billboardState(page), 'off');
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
    await page.locator('.tab[data-tab=home]').click();
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
    assert.match(await page.locator('#autoplay-toggle-note').innerText(), /reduced motion/);
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
    // Continue watching holds films of 30 min or more: the 12 s demo clip gets a 40 min catalog length here.
    await page.route('**/demo/cinema.json', route => route.fulfill({ json: { ...catalog, films: catalog.films.map(f => f.id === 'golden-hour' ? { ...f, seconds: 2400 } : f) } }));
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
    assert.deepEqual(rows, [true, true, true, true, true], 'Tab bar buttons are full-size tap targets');
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

  const reelCount = page => page.locator('.reel-count b').textContent();
  const reelLive = page => page.locator('.reel-item.is-active.is-live').waitFor({ timeout: 12000 });
  const titleCount = new Set(catalog.films.map(f => f.group || f.id)).size;
  const openReels = async (page, phone = false) => {
    if (phone) await page.locator('#tabbar [data-tab=reels]').tap(); else await page.locator('.tab[data-tab=reels]').click();
    await page.locator('main.reel').waitFor();
  };
  const setPrefs = (page, prefs) => page.evaluate(value => localStorage.setItem('mkc.settings', JSON.stringify(value)), prefs);
  await record('Reels: the tab plays the cinema as a reel under the top bar, with sound; keys, pause, mute and the end move it on', async () => {
    const { context, page } = await session();
    await loaded(page);
    await openReels(page);
    assert.equal(await page.locator('.tab[data-tab=reels]').getAttribute('aria-current'), 'page');
    const bar = await box(page, '#topbar'), reel = await box(page, 'section.reel');
    assert.ok(Math.abs(reel.top - bar.bottom) < 1 && Math.abs(reel.bottom - 900) < 1, `the reel fills the area under the top bar (${reel.top}-${reel.bottom}, bar ${bar.bottom})`);
    assert.equal(await page.locator('#topbar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(5, 6, 10, 0.72)', 'the bar is frosted ink over the reel');
    const films = await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.film));
    assert.equal(films.length, titleCount, 'every title once');
    assert.equal(new Set(films).size, titleCount, 'no title twice');
    await reelLive(page);
    assert.equal(await reelCount(page), `1 / ${titleCount}`);
    assert.ok(await page.locator('.reel-video').evaluate(video => video.src.startsWith('blob:') && !video.paused && !video.muted && video.closest('.reel-item').classList.contains('is-active')), 'the first film plays with sound inside its own screen');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.reel-count b').textContent.startsWith('2 '));
    await reelLive(page);
    assert.notEqual(await page.locator('.reel-item.is-active').getAttribute('data-film'), films[0], 'the next film is on screen');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('.reel-count b').textContent.startsWith('1 '));
    await reelLive(page);
    for (let n = 0; n < 4; n++) await page.keyboard.press('Tab'); // My List, search, settings, then the reel
    assert.equal(await page.evaluate(() => document.activeElement.className), 'reel-track', 'the reel is the next stop for the keyboard after the bar');
    await page.keyboard.press(' ');
    assert.ok(await page.locator('.reel-video').evaluate(video => video.paused), 'Space pauses');
    assert.equal(await page.locator('.reel.is-paused').count(), 1, 'the glass play sign shows');
    await page.keyboard.press(' ');
    assert.equal(await page.locator('.reel.is-paused').count(), 0, 'Space plays again');
    await page.keyboard.press('m');
    assert.equal(await page.locator('[data-reel=sound]').getAttribute('aria-label'), 'Turn sound on', 'm mutes, and the button now offers sound');
    assert.ok(await page.locator('.reel-video').evaluate(video => video.muted));
    await page.locator('.reel-video').evaluate(video => { video.currentTime = Math.max(0, video.duration - 0.3); });
    await page.waitForFunction(() => document.querySelector('.reel-count b').textContent.startsWith('2 '), null, { timeout: 8000 });
    assert.ok(await page.locator('.reel-video').evaluate(video => video.muted), 'the sound choice carries to the next film');
    const tiny = await page.locator('.reel button').evaluateAll(nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.width < 43 || r.height < 43); }).length);
    assert.equal(tiny, 0, 'reel controls keep 44 px targets');
    await page.locator('.tab[data-tab=home]').click();
    await page.locator('main.library[data-tab=home]').waitFor();
    assert.equal(await page.locator('.reel-video').count(), 0, 'leaving leaves no reel video behind');
    await context.close();
  });

  await record('Reels: leaving pauses and releases the film; coming back in the same visit resumes it where it was', async () => {
    const { context, page } = await session();
    await loaded(page);
    await openReels(page);
    await reelLive(page);
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.reel-count b').textContent.startsWith('2 '));
    await reelLive(page);
    const film = await page.locator('.reel-item.is-active').getAttribute('data-film');
    const order = await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.film));
    await page.locator('.reel-video').evaluate(video => { video.pause(); video.currentTime = 6; });
    await page.waitForFunction(() => Math.abs(document.querySelector('.reel-video').currentTime - 6) < 0.1);
    await page.locator('.tab[data-tab=new]').click();
    await page.locator('main[data-tab=new]').waitFor();
    assert.equal(await page.locator('.reel-video').count(), 0, 'the reel film is released');
    await openReels(page);
    assert.deepEqual(await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.film)), order, 'the same films in the same order');
    await reelLive(page);
    assert.equal(await page.locator('.reel-item.is-active').getAttribute('data-film'), film, 'on the same film');
    assert.equal(await reelCount(page), `2 / ${titleCount}`);
    const time = await page.locator('.reel-video').evaluate(video => video.currentTime);
    assert.ok(time >= 5.9 && time < 9, `at the same time (${time.toFixed(2)} s)`);
    // A change in Settings starts a fresh reel in the new order.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Newest first' }).check();
    await openReels(page);
    await reelLive(page);
    assert.equal(await reelCount(page), `1 / ${titleCount}`, 'a new order starts from the first film');
    await context.close();
  });

  await record('Reels on a phone: the tab bar stays and covers nothing; a swipe moves on, a 9:16 cut is shown whole, the reel never runs out', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await loaded(page);
    await openReels(page, true);
    await reelLive(page);
    assert.equal(await page.locator('#tabbar').isVisible(), true, 'the tab bar stays');
    assert.equal(await page.locator('#topbar').isHidden(), true, 'no top bar over the film');
    assert.equal(await page.locator('#tabbar [aria-current=page]').innerText(), 'Reels');
    const barTop = (await box(page, '#tabbar')).top;
    const covered = await page.locator('.reel-item.is-active .reel-copy > *, .reel-rail button:not(.reel-step), .reel-item.is-active .reel-progress').evaluateAll((nodes, top) => nodes.filter(el => el.getBoundingClientRect().bottom > top - 4).map(el => el.className || el.tagName), barTop);
    assert.deepEqual(covered, [], 'titles, controls and the progress line all sit above the tab bar');
    const active = await page.locator('.reel-item.is-active').evaluate(item => ({ shape: item.dataset.shape, fit: getComputedStyle(item.querySelector('.reel-video')).objectFit }));
    assert.equal(active.fit, 'contain', 'every cut is shown whole, never cropped');
    await page.touchscreen.tap(195, 420);
    assert.equal(await page.locator('.reel.is-paused').count(), 1, 'a tap on the film pauses it');
    await page.touchscreen.tap(195, 420);
    for (let n = 2; n <= titleCount - 1; n++) {
      await page.locator('.reel-track').evaluate(track => track.scrollBy({ top: track.clientHeight }));
      await page.waitForFunction(wanted => document.querySelector('.reel-count b').textContent.startsWith(`${wanted} `), n);
    }
    const all = await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.film));
    assert.equal(all.length, titleCount * 2, 'a second round was drawn before the first ran out');
    assert.notEqual(all[titleCount], all[titleCount - 1], 'the new round does not repeat the film that just played');
    await shot(page, 'reels');
    await page.locator('#tabbar [data-tab=home]').tap();
    await page.locator('main.library[data-tab=home]').waitFor();
    await context.close();
  });

  // Where a film really shows: the content box of an <img>/<video> under its object-fit (centred, as the reel keeps it).
  const shownBox = el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
    if (!w || !h || style.objectPosition !== '50% 50%') return null;
    const scale = style.objectFit === 'cover' ? Math.max(r.width / w, r.height / h) : style.objectFit === 'contain' ? Math.min(r.width / w, r.height / h) : null;
    if (!scale) return null;
    const width = w * scale, height = h * scale, left = r.left + (r.width - width) / 2, top = r.top + (r.height - height) / 2;
    return { fit: style.objectFit, left, top, right: left + width, bottom: top + height };
  };
  const TALL = { width: 440, height: 956 };
  await record('Reels show every film whole: a 9:16 and a 16:9 cut stay inside the screen; on a phone a 16:9 film sits above the copy', async () => {
    // Demo data with Amber Room cut only for desktop (a 16:9 film on a phone); Velvet Steps is cut only for phones.
    const mock = { ...catalog, films: catalog.films.map(f => f.id === 'amber-room' ? { ...f, versions: f.versions.filter(v => v.kind === 'desktop') } : f) };
    const problems = [];
    for (const [viewport, phone] of [[PHONE, true], [TALL, true], [DESKTOP, false]]) {
      const { context, page } = await session({ viewport, phone });
      await page.route('**/demo/cinema.json', route => route.fulfill({ json: mock }));
      await loaded(page);
      await openReels(page, phone);
      await reelLive(page);
      for (const shape of ['phone', 'desktop']) {
        const at = `${viewport.width}×${viewport.height} ${shape === 'phone' ? '9:16' : '16:9'}`;
        await page.locator('.reel-track').evaluate((track, wanted) => { track.scrollTop = track.querySelector(`.reel-item[data-shape=${wanted}]`).offsetTop; }, shape);
        await page.waitForFunction(wanted => document.querySelector('.reel-item.is-active.is-live')?.dataset.shape === wanted, shape, { timeout: 12000 });
        await page.waitForTimeout(400);
        const seen = await page.locator('.reel-item.is-active').evaluate((item, fn) => {
          const shown = new Function(`return ${fn}`)();
          const reel = item.closest('.reel').getBoundingClientRect();
          const rail = [...document.querySelectorAll('.reel-rail button')].map(b => b.getBoundingClientRect()).filter(r => r.width > 2);
          return { video: shown(item.querySelector('.reel-video')), poster: shown(item.querySelector('.reel-poster')), reel: { top: reel.top, bottom: reel.bottom },
            copy: item.querySelector('.reel-copy').firstElementChild.getBoundingClientRect().top, rail: Math.min(...rail.map(r => r.top)), count: document.querySelector('.reel-count').getBoundingClientRect().bottom, w: innerWidth, h: innerHeight };
        }, shownBox.toString());
        await page.waitForFunction(() => [...document.querySelectorAll('.reel-item.is-active img')].every(el => el.complete && el.naturalWidth > 0));
        await page.screenshot({ path: fileURLToPath(new URL(`reels-framing/${process.env.REEL_SHOTS || 'after'}-${viewport.width}x${viewport.height}-${shape === 'phone' ? '9x16' : '16x9'}.png`, shots)), animations: 'disabled' });
        try {
          for (const name of ['video', 'poster']) {
            const b = seen[name];
            assert.ok(b, `${at}: the ${name} has a measurable picture`);
            assert.equal(b.fit, 'contain', `${at}: the ${name} is shown whole (contain), not ${b.fit}`);
            assert.ok(b.left >= -0.5 && b.right <= seen.w + 0.5 && b.top >= seen.reel.top - 0.5 && b.bottom <= seen.h + 0.5, `${at}: the ${name} lies inside the screen (${JSON.stringify(b)})`);
          }
          if (phone && shape === 'desktop') {
            const above = Math.min(seen.copy, seen.rail);
            assert.ok(seen.video.bottom <= above + 0.5, `${at}: the 16:9 film ends (${seen.video.bottom.toFixed(1)}) above the copy and rail (${above.toFixed(1)})`);
            assert.ok(Math.abs(seen.video.left) < 0.5 && Math.abs(seen.video.right - seen.w) < 0.5, `${at}: the 16:9 film spans the width`);
            const middle = (seen.video.top + seen.video.bottom) / 2, space = [seen.count, above];
            assert.ok(seen.video.top >= seen.count - 0.5 && Math.abs(middle - (space[0] + space[1]) / 2) < 4, `${at}: the 16:9 film is centred between the counter and the copy (middle ${middle.toFixed(1)}, space ${space.map(n => n.toFixed(1)).join('-')})`);
          }
        } catch (error) { problems.push(error.message); } // every screen and shape is checked (and shot) before failing
      }
      await context.close();
    }
    assert.deepEqual(problems, []);
  });

  await record('Reels shade: lighter and shorter, yet white copy stays readable over a bright frame', async () => {
    const sharp = (await import('sharp')).default;
    for (const viewport of [PHONE, TALL]) {
      const { context, page } = await session({ viewport, phone: true });
      await loaded(page);
      await openReels(page, true);
      await reelLive(page);
      // A white frame under the shade, everything else out of the way; --pale as a bright film sets it.
      const marks = await page.locator('.reel-item.is-active').evaluate(item => {
        const video = item.querySelector('.reel-video'); video.pause();
        const stage = item.querySelector('.reel-stage');
        for (const el of stage.querySelectorAll('img, video')) el.style.visibility = 'hidden';
        stage.style.background = '#fff';
        const copy = item.querySelector('.reel-copy'), kicker = copy.firstElementChild.getBoundingClientRect(), blurb = copy.lastElementChild.getBoundingClientRect();
        document.querySelectorAll('.reel-copy, .reel-rail, .reel-top, #tabbar, .reel-progress').forEach(el => { el.style.visibility = 'hidden'; });
        return { kicker: Math.round(kicker.top + 2), blurb: Math.round(blurb.bottom - 2) };
      });
      const sample = async pale => {
        await page.locator('.reel-item.is-active .reel-stage').evaluate((stage, value) => stage.style.setProperty('--pale', value), String(pale));
        await page.waitForTimeout(1000);
        const { data, info } = await sharp(await page.screenshot({ animations: 'disabled' })).raw().toBuffer({ resolveWithObject: true });
        const at = y => { const i = (y * info.width + 20) * info.channels; return data[i]; }; // grey, so red = value
        return { kicker: at(marks.kicker), blurb: at(marks.blurb), middle: at(Math.round(viewport.height * 0.5)) };
      };
      const lum = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const contrast = v => 1.05 / (lum(v) + 0.05);
      const dark = await sample(0), bright = await sample(1);
      // The old shade left about 45 of 255 at the blurb and dimmed the middle of the screen; the new one is ~35 % lighter.
      assert.ok(dark.blurb >= 85, `${viewport.height}: the shade at the copy's foot is lighter than before (${dark.blurb} of 255)`);
      assert.ok(dark.middle >= 250, `${viewport.height}: the shade is shorter: the middle of the screen is untouched (${dark.middle})`);
      for (const [where, value] of Object.entries({ kicker: bright.kicker, blurb: bright.blurb })) assert.ok(contrast(value) >= 4.5, `${viewport.height}: over a bright frame white copy at the ${where} keeps 4.5:1 (${contrast(value).toFixed(2)}:1, ${value})`);
      await context.close();
    }
  });

  await record('Reels play the screen’s version first: phone cuts first on a phone, desktop cuts first on a desktop', async () => {
    // Demo data with two titles cut only for desktop, so both screens have titles without their cut.
    const wideOnly = ['amber-room', 'last-light'];
    const mock = { ...catalog, films: catalog.films.map(f => wideOnly.includes(f.id) ? { ...f, versions: f.versions.filter(v => v.kind === 'desktop') } : f) };
    for (const [viewport, prefer, phone] of [[PHONE, 'phone', true], [DESKTOP, 'desktop', false]]) {
      const { context, page } = await session({ viewport, phone });
      await page.route('**/demo/cinema.json', route => route.fulfill({ json: mock }));
      await loaded(page);
      await openReels(page, phone);
      await reelLive(page);
      const shapes = await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.shape));
      const matching = shapes.filter(shape => shape === prefer).length;
      assert.ok(matching > 0 && matching < shapes.length, `${prefer}: the catalog mixes titles with and without a ${prefer} cut (${shapes.join(', ')})`);
      assert.ok(shapes.slice(0, matching).every(shape => shape === prefer), `${prefer}: every ${prefer} cut plays before any other (${shapes.join(', ')})`);
      assert.equal(await page.locator('.reel-item.is-active').getAttribute('data-shape'), prefer, `${prefer}: the reel opens on a ${prefer} cut`);
      await context.close();
    }
  });

  await record('Reels on an iPhone: a film with a 16:9 poster plays its phone cut from the start, through a broken link, a whole-film download and the next round', async () => {
    // Shaped like the library's MK Sheep: a 16:9 poster, the phone cut listed first. It is the newest, so it opens the reel.
    const sheep = { id: 'sheep-test', title: 'Sheep test', kind: 'film', lang: 'en', dir: 'ltr', posterShape: '16:9', seconds: 12, added: '2026-10-23', poster: 'demo/posters/amber-room.jpg', product: 'MK Suite & apps', group: null,
      versions: catalog.films.find(f => f.id === 'amber-room').versions.map(v => ({ ...v })) };
    const mock = { ...catalog, films: [sheep, ...catalog.films] };
    for (const iphone of [true, false]) {
      const { context, page } = await session({ viewport: PHONE, phone: true });
      const fetched = [];
      await page.route('https://api.github.com/**', async route => {
        const request = route.request(), path = decodeURIComponent(new URL(request.url()).pathname.split('/contents/')[1]);
        const headers = { 'access-control-allow-origin': '*' };
        if (path === 'cinema.json') return route.fulfill({ json: mock, headers });
        if (request.headers().accept === 'application/vnd.github.object') return route.fulfill({ json: { download_url: `https://raw.githubusercontent.com/demo/mk-cinema/${path}?token=synthetic` }, headers });
        return route.fulfill({ body: await readFile(new URL(path, root)), contentType: 'image/jpeg', headers });
      });
      // Like iPhone Safari: the stream is refused, the whole film is downloaded. Otherwise the film streams.
      await page.route('https://raw.githubusercontent.com/**', async route => {
        if (iphone && route.request().resourceType() === 'media') return route.fulfill({ body: 'not a video', contentType: 'application/octet-stream' });
        const path = new URL(route.request().url()).pathname.replace('/demo/mk-cinema/', '');
        fetched.push(path);
        return route.fulfill({ body: await readFile(new URL(path, root)), contentType: iphone ? 'application/octet-stream' : 'video/mp4', headers: { 'access-control-allow-origin': '*' } });
      });
      await page.goto(`${origin}/`);
      await setPrefs(page, { reelOrder: 'newest', reelSound: false });
      await page.reload();
      await page.locator('main.connect').waitFor();
      await page.getByLabel('GitHub token', { exact: true }).fill('synthetic-test-token');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await page.locator('main.library').waitFor();
      await openReels(page, true);
      await reelLive(page);
      const shown = () => page.locator('.reel-item.is-active').evaluate(item => { const video = item.querySelector('.reel-video'); return { film: item.dataset.film, shape: item.dataset.shape, w: video?.videoWidth, h: video?.videoHeight, fit: video && getComputedStyle(video).objectFit }; });
      const how = iphone ? 'downloaded whole' : 'streamed';
      assert.deepEqual(await shown(), { film: 'sheep-test', shape: 'phone', w: 360, h: 640, fit: 'contain' }, `${how}: the phone cut plays, shown whole`);
      assert.ok(fetched.length && fetched.every(path => path.endsWith('-phone.mp4')), `${how}: only phone cuts were fetched (${fetched.join(', ')})`);
      if (!iphone) {
        // The short-lived link breaks mid-film: one fresh link, and the same cut carries on where it was.
        await page.locator('.reel-video').evaluate(video => { video.pause(); video.currentTime = 2; video.dispatchEvent(new Event('error')); });
        await page.waitForFunction(() => { const v = document.querySelector('.reel-item.is-active .reel-video'); return v && !v.paused && v.currentTime >= 2 && v.videoWidth; });
        assert.deepEqual(await shown(), { film: 'sheep-test', shape: 'phone', w: 360, h: 640, fit: 'contain' }, 'after a broken link the phone cut carries on');
      }
      // The next round: every item of the new round keeps the phone cut.
      await page.locator('.reel-track').evaluate(track => { const items = track.querySelectorAll('.reel-item'); track.scrollTop = items[items.length - 3].offsetTop; });
      await page.waitForFunction(count => document.querySelectorAll('.reel-item').length > count, titleCount + 1);
      const shapes = await page.locator('.reel-item[data-film=sheep-test]').evaluateAll(items => items.map(item => item.dataset.shape));
      assert.deepEqual(shapes, ['phone', 'phone'], 'the next round plays the phone cut too');
      assert.ok(fetched.every(path => path.endsWith('-phone.mp4')), `${how}: still only phone cuts (${fetched.join(', ')})`);
      await context.close();
    }
  });

  await record('Language: an Arabic phone sees the Arabic film of a pair everywhere, an English one the English film; the other is one link in More info', async () => {
    // Demo data: the Arabic Light Journey (رحلة الضوء) gets an English twin in the same group (an older film, so
    // newest-first alone would never show it).
    const lj = catalog.films.find(f => f.id === 'light-journey');
    const twin = { ...lj, id: 'light-journey-en', title: 'Light Journey', lang: 'en', dir: 'ltr', variant: 'English', group: 'lj-pair', added: '2026-10-14' };
    const mock = { ...catalog, films: [...catalog.films.map(f => f.id === 'light-journey' ? { ...f, group: 'lj-pair', variant: 'Arabic' } : f), twin] };
    assert.equal(lj.lang, 'ar');
    for (const [locale, shown, hidden, link, name] of [['ar-KW', 'light-journey', 'light-journey-en', 'English version', 'Arabic'], ['en-US', 'light-journey-en', 'light-journey', 'النسخة العربية', 'English']]) {
      const { context, page } = await session({ viewport: PHONE, phone: true, extra: { locale } });
      await page.route('**/demo/cinema.json', route => route.fulfill({ json: mock }));
      await loaded(page);
      assert.equal(await page.evaluate(() => navigator.languages[0]), locale);
      assert.ok(await page.locator(`.film-card[data-film="${shown}"]`).count() > 0, `${locale}: the ${name} film has cards`);
      assert.equal(await page.locator(`.film-card[data-film="${hidden}"]`).count(), 0, `${locale}: the other language never has a card of its own`);
      assert.equal(await page.locator(`.film-card[data-film="${shown}"] .cut-count`).count(), 0, `${locale}: a language pair is not "2 cuts"`);
      await page.locator('#tabbar [data-tab=new]').tap();
      await page.locator('main[data-tab=new]').waitFor();
      assert.deepEqual([await page.locator(`.hot-item[data-film="${shown}"]`).count(), await page.locator(`.hot-item[data-film="${hidden}"]`).count()], [1, 0], `${locale}: New & Hot shows the ${name} film`);
      await openReels(page, true);
      const reel = await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.film));
      assert.ok(reel.includes(shown) && !reel.includes(hidden), `${locale}: Reels play the ${name} film (${reel.join(', ')})`);
      await page.locator('#tabbar [data-tab=settings]').tap();
      await page.locator('main.settings').waitFor();
      assert.ok((await page.locator('.set-value').allInnerTexts()).includes(`${name} (from your phone)`), `${locale}: Settings says which language it follows`);
      await page.locator('#tabbar [data-tab=home]').tap();
      await page.locator('main.library[data-tab=home]').waitFor();
      await page.locator(`.film-card[data-film="${shown}"]`).first().click();
      await page.locator('#film-detail[open]').waitFor();
      assert.equal(await page.locator('#film-detail .lang-switch').innerText(), link, `${locale}: More info offers the other language as one link`);
      assert.equal(await page.locator('#film-detail .episodes[aria-label=Cuts]').count(), 0, `${locale}: no cut list for a pair`);
      await page.locator('#film-detail .lang-switch').click();
      await page.waitForFunction(id => document.querySelector('#film-detail .lang-switch')?.dataset.variant === id, shown);
      assert.equal(await page.locator('#film-detail #detail-title').innerText(), mock.films.find(f => f.id === hidden).title, `${locale}: the link opens the other language`);
      await context.close();
    }
  });

  await record('Reels with reduced motion: a film that ends waits instead of moving on', async () => {
    const { context, page } = await session({ reduced: true });
    await loaded(page);
    await openReels(page);
    await reelLive(page);
    await page.locator('.reel-video').evaluate(video => { video.currentTime = Math.max(0, video.duration - 0.3); });
    await page.locator('.reel-item.is-active.is-ended').waitFor({ timeout: 8000 });
    assert.equal(await reelCount(page), `1 / ${titleCount}`, 'still on the first film');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.reel-count b').textContent.startsWith('2 '));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.getByRole('radio', { name: 'Play the next' }).isDisabled(), true, 'Settings shows that films wait under reduced motion');
    assert.match(await page.locator('#reel-end-note').innerText(), /reduced motion/);
    await context.close();
  });

  await record('Settings: When a film ends: Wait keeps the film on screen; a tap plays it again', async () => {
    const { context, page } = await session();
    await loaded(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Wait' }).check();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('mkc.settings'))).reelEnd, 'wait');
    await openReels(page);
    await reelLive(page);
    await page.locator('.reel-video').evaluate(video => { video.currentTime = Math.max(0, video.duration - 0.3); });
    await page.locator('.reel-item.is-active.is-ended').waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    assert.equal(await reelCount(page), `1 / ${titleCount}`, 'still on the first film');
    await page.mouse.click(700, 450);
    await page.waitForFunction(() => { const video = document.querySelector('.reel-video'); return !video.paused && video.currentTime < 3; });
    assert.equal(await page.locator('.reel-item.is-active.is-ended').count(), 0, 'it plays again from the start');
    await context.close();
  });

  await record('Settings: Which titles, Order and Start with sound change what Reels plays, and are remembered', async () => {
    const { context, page } = await session();
    await loaded(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('main.settings').waitFor();
    const films = page.locator('[data-reel-kind=films]'), ads = page.locator('[data-reel-kind=ads]'), demos = page.locator('[data-reel-kind=demos]');
    assert.deepEqual(await page.locator('[data-reel-kind]').evaluateAll(chips => chips.map(chip => chip.getAttribute('aria-pressed'))), ['true', 'true', 'true'], 'all kinds on by default');
    assert.match(await films.getAttribute('aria-label'), /^Films, \d+ titles?$/);
    await films.click(); await ads.click();
    assert.equal(await demos.getAttribute('aria-pressed'), 'true');
    await demos.click();
    assert.equal(await demos.getAttribute('aria-pressed'), 'true', 'the last kind stays on');
    assert.equal(await page.locator('#announce').innerText(), 'Reels keep at least one kind on.');
    await page.getByRole('switch', { name: 'Start with sound', exact: true }).click();
    await page.reload();
    await page.locator('main.library').waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.locator('[data-reel-kind=films]').getAttribute('aria-pressed'), 'false', 'remembered after a reload');
    assert.equal(await page.getByRole('switch', { name: 'Start with sound', exact: true }).isChecked(), false);
    await openReels(page);
    await reelLive(page);
    const kinds = await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.film));
    const demoIds = catalog.films.filter(f => f.kind === 'demo').map(f => f.id);
    assert.ok(kinds.length && kinds.every(id => demoIds.includes(id)), 'only demos play');
    assert.ok(await page.locator('.reel-video').evaluate(video => video.muted), 'Start with sound off: the reel starts muted');
    assert.equal(await page.locator('[data-reel=sound]').getAttribute('aria-label'), 'Turn sound on');
    assert.equal(await page.locator('.reel.is-quiet').count(), 0, 'no "Tap for sound" nag when the owner chose quiet');
    // Order: Newest first follows the catalog dates, every kind back on.
    await setPrefs(page, { reelOrder: 'newest' });
    await page.reload();
    await page.locator('main.library').waitFor();
    await openReels(page);
    const seen = new Set(), dated = catalog.films.toSorted((a, b) => b.added.localeCompare(a.added)).filter(f => !seen.has(f.group || f.id) && seen.add(f.group || f.id));
    const wide = f => f.versions.some(v => v.kind === 'desktop'), newest = [...dated.filter(wide), ...dated.filter(f => !wide(f))].map(f => f.id);
    assert.deepEqual(await page.locator('.reel-item').evaluateAll(items => items.map(item => item.dataset.film)), newest, 'newest first, titles with a desktop cut before the phone-only ones');
    assert.equal(await page.locator('.reel-count').getAttribute('title'), 'Newest first');
    await context.close();
  });

  await record('Reels: a browser that refused sound once does not keep the reel muted on the next visit', async () => {
    const { context, page } = await session();
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      window.refuseSound = true;
      HTMLMediaElement.prototype.play = function () {
        return window.refuseSound && !this.muted ? Promise.reject(new DOMException('No sound yet', 'NotAllowedError')) : play.call(this);
      };
    });
    await loaded(page);
    await openReels(page);
    await page.locator('.reel.is-quiet').waitFor();
    await page.evaluate(() => { window.refuseSound = false; });
    await page.locator('.tab[data-tab=home]').click();
    await page.locator('main.library').waitFor();
    await openReels(page);
    await reelLive(page);
    assert.equal(await page.locator('.reel-video').evaluate(video => video.muted), false, 'the owner never muted, so the next tap brings the sound back');
    await context.close();
  });

  await record('Reels with nothing to play: a calm empty state with a way to Settings and a way home', async () => {
    const { context, page } = await session();
    await page.route('**/demo/cinema.json', route => route.fulfill({ json: { ...catalog, films: catalog.films.filter(f => f.kind !== 'demo') } }));
    await page.goto(`${origin}/?demo`);
    await setPrefs(page, { reelKinds: ['demos'] });
    await page.reload();
    await page.locator('main.library').waitFor();
    await openReels(page);
    await page.locator('.reel-empty').waitFor();
    assert.match(await page.locator('.reel-empty h1').innerText(), /Nothing to play/);
    assert.equal(await page.locator('.reel-video').count(), 0);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    await page.locator('main.settings').waitFor();
    await openReels(page);
    await page.getByRole('button', { name: 'Browse everything' }).click();
    await page.locator('main.library[data-tab=home]').waitFor();
    await context.close();
  });

  await record('Reels: films that cannot play move on, three in a row stop the reel, and focus stays on the tab', async () => {
    const { context, page } = await session();
    await loaded(page);
    await page.route('**/demo/*.mp4', route => route.fulfill({ status: 200, body: 'not a film', contentType: 'video/mp4' })); // a file the browser cannot decode
    await openReels(page);
    await page.locator('.reel-item.is-active.is-failed').waitFor({ timeout: 8000 });
    assert.match(await page.locator('.reel-note').textContent(), /cannot play here/);
    await page.waitForFunction(() => /not playing right now/.test(document.querySelector('.reel-note').textContent), null, { timeout: 15000 });
    const stopped = await reelCount(page);
    assert.equal(stopped, `3 / ${titleCount}`, 'the third failure in a row stops the reel');
    await page.waitForTimeout(3200);
    assert.equal(await reelCount(page), stopped, 'and it stays stopped');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.tab), 'reels', 'focus stays on the Reels tab');
    await context.close();
  });

  await record('Settings: a page of real controls with labels, focus and the token flow; reachable from Connect too', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await loaded(page);
    await page.locator('#tabbar [data-tab=settings]').tap();
    await page.locator('main.settings').waitFor();
    assert.deepEqual(await page.locator('.set-label').allInnerTexts(), ['PLAYBACK', 'REELS', 'MY LIST', 'CONNECTION', 'ABOUT']);
    assert.equal(await page.getByRole('radiogroup', { name: 'Order' }).count(), 1);
    assert.equal(await page.getByRole('radiogroup', { name: 'When a film ends' }).count(), 1);
    assert.equal(await page.getByRole('group', { name: 'Which titles' }).count(), 1);
    assert.match(await page.locator('.set-value').allInnerTexts().then(values => values.join(' | ')), /Demo, no token used.*7.*Demo/);
    const tiny = await page.locator('.settings-page button, .settings-page .segmented label, .settings-page .switch input').evaluateAll(nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.height < 44; }).length);
    assert.equal(tiny, 0, 'every control is a 44 pt target');
    await page.getByRole('radio', { name: 'Shuffle' }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('radio', { name: 'Newest first' }).isChecked(), true, 'arrow keys move the choice');
    assert.notEqual(await page.locator('.segmented label:has(input:focus-visible)').evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'the focused choice shows a ring');
    const barTop = (await box(page, '#tabbar')).top;
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    assert.ok((await box(page, '.set-group:last-child .set-card')).bottom < barTop, 'the last group scrolls clear of the tab bar');
    await shot(page, 'settings');
    await page.goto(`${origin}/?demo&state=connect`);
    await page.locator('main.connect').waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('main.settings-solo').waitFor();
    assert.equal(await page.locator('#tabbar').isHidden(), true, 'no tabs without a library');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.locator('main.connect').waitFor();
    await context.close();
  });

  await record('the service worker caches the new motion files and the cache name moved on', async () => {
    const { context, page } = await session({ extra: { serviceWorkers: 'allow', reducedMotion: 'reduce' } });
    await loaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async name => [name, (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)]))));
    assert.deepEqual(Object.keys(cached), ['mkc-shell-v18'], 'Old shell caches are gone');
    for (const file of ['motion.css', 'motion.js', 'previews.js', 'billboard.js', 'rows.js', 'bob.js', 'modal.js', 'feed.js', 'ambient.js', 'reel.js', 'settings.js', 'invite.js', 'player.js', 'viewport.js']) assert.ok(cached['mkc-shell-v18'].includes(`/${file}`), `${file} is cached`);
    assert.ok(cached['mkc-shell-v18'].every(path => !path.includes('/demo/')), 'No films in the shell cache');
    await page.locator('.tab[data-tab=settings], #topbar [data-tab=settings]').first().click();
    assert.equal(await page.locator('#shell-version').innerText(), 'v18 · saved for offline', 'Settings → About names the shell this browser holds');
    await context.close();
  });

  // Real films stream from GitHub, another origin, so the reel cannot read their frames. Trying must not leave the
  // posters unreadable for the rest of the visit (no light under the page, no shade under pale posters).
  await record('a frame from another origin never stops the posters lighting the page', async () => {
    const { context, page } = await session();
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 })); // a bare script page asks for one
    await page.goto(`${origin}/ambient.js`);
    const result = await page.evaluate(async foreign => {
      const { paleness, wash } = await import('/ambient.js');
      const video = Object.assign(document.createElement('video'), { muted: true, preload: 'auto', src: foreign });
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('the foreign film did not load')); });
      const poster = Object.assign(new Image(), { src: '/demo/posters/amber-room.jpg' });
      await poster.decode();
      return { frame: paleness(video), lit: Boolean(wash(poster)), pale: paleness(poster) };
    }, 'http://localhost:4173/demo/amber-room-phone.mp4');
    assert.equal(result.frame, null, 'A frame from another origin cannot be read');
    assert.ok(result.lit, 'The poster still lights the page');
    assert.notEqual(result.pale, null, 'The poster is still read for its shade');
    await context.close();
  });

  // The Netflix-style player (player.js). Final screenshots for review go to shots/netflix-player/.
  await mkdir(new URL('netflix-player/', shots), { recursive: true });
  const LANDSCAPE = { width: 844, height: 390 };
  const ui = page => page.locator('.np').getAttribute('data-ui');
  const media = page => page.locator('main.player video').evaluate(el => ({ t: el.currentTime, paused: el.paused, muted: el.muted, fit: getComputedStyle(el).objectFit, w: el.videoWidth, h: el.videoHeight }));
  // Opens the billboard film (Golden Hour: a Phone and a Desktop cut) in the given cut, the way a finger or a mouse would.
  async function openPlayer(page, cut, { touch = true } = {}) {
    await loaded(page);
    const press = locator => touch ? locator.tap() : locator.click();
    await press(page.locator('.billboard [data-action=hero-info]'));
    await page.locator('#film-detail[open]').waitFor();
    await press(page.locator('#film-detail').getByRole('button', { name: cut }));
    await press(page.locator('#film-detail [data-action=play]'));
    await page.waitForFunction(() => { const v = document.querySelector('main.player video'); return v?.readyState >= 2 && !v.paused; });
    return page.locator('main.player video');
  }
  // Pauses on a given frame (paused, the controls stay up).
  const still = (page, time) => page.locator('main.player video').evaluate((el, at) => new Promise(resolve => { el.pause(); el.addEventListener('seeked', resolve, { once: true }); el.currentTime = at; }), time);
  const rectOf = (page, selector) => page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(n => Math.round(n)); });
  const npShot = (page, name) => shot(page, `netflix-player/${name}`);

  await record('Player: a 9:16 cut fills the upright phone with sound from the Play tap; controls hide 3 s after the last touch and one tap brings them back', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await openPlayer(page, 'Phone 9:16');
    const start = await media(page);
    assert.equal(start.muted, false, 'the film plays with sound');
    assert.ok(start.h > start.w, 'the phone cut plays');
    assert.equal(await page.locator('#topbar').isVisible(), false, 'no page header');
    assert.equal(await page.locator('#tabbar').isVisible(), false, 'no tab bar');
    assert.deepEqual(await rectOf(page, 'main.player video'), [0, 0, 390, 844], 'the film box covers the whole screen, no margins');
    assert.equal(await page.locator('.np').getAttribute('data-rotated'), null, 'a 9:16 film is not turned');
    assert.equal(start.fit, 'contain', 'shown whole by default: titles near the edges are never cut');
    for (const button of await page.locator('.np button:visible').all()) assert.ok(await button.getAttribute('aria-label'), 'every control has a label');
    assert.equal(await page.locator('.np-scrub').getAttribute('role'), 'slider');
    // Playing: the controls leave by themselves.
    await page.waitForFunction(() => document.querySelector('.np').dataset.ui === 'off', null, { timeout: 4500 });
    await npShot(page, 'phone-9x16-clean');
    // One tap on the picture brings them back; they leave 3 s after that tap.
    await page.touchscreen.tap(195, 250);
    const tapped = Date.now();
    assert.equal(await ui(page), 'on', 'one tap brings the controls back');
    await page.waitForTimeout(2300);
    assert.equal(await ui(page), 'on', 'still there 2.3 s after the tap');
    await page.waitForFunction(() => document.querySelector('.np').dataset.ui === 'off', null, { timeout: 3000 });
    const gone = Date.now() - tapped;
    assert.ok(gone >= 2900 && gone < 4000, `the controls leave about 3 s after the last touch (${gone} ms)`);
    assert.equal(await page.locator('.np-ui').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    assert.equal(await page.locator('[data-np=play]').evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'hidden controls take no taps');
    await page.touchscreen.tap(195, 250);
    assert.equal(await ui(page), 'on');
    await page.touchscreen.tap(195, 250);
    assert.equal(await ui(page), 'off', 'a tap on the picture while they show sends them away');
    // Paused, they stay.
    await page.touchscreen.tap(195, 250);
    await page.locator('[data-np=play]').tap();
    assert.equal((await media(page)).paused, true);
    assert.equal(await page.locator('[data-np=play]').getAttribute('aria-label'), 'Play');
    await page.waitForTimeout(3400);
    assert.equal(await ui(page), 'on', 'the controls stay while the film is paused');
    await still(page, 4.2);
    await npShot(page, 'phone-9x16-controls');
    await context.close();
  });

  await record('Player: a double-tap on the left or right third jumps 10 s back or forward with a ripple', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await openPlayer(page, 'Phone 9:16');
    await still(page, 11);
    const twice = async (x, y) => { await page.touchscreen.tap(x, y); await page.waitForTimeout(90); await page.touchscreen.tap(x, y); };
    await twice(60, 300);
    let t = (await media(page)).t;
    assert.ok(Math.abs(t - 1) < 0.3, `double-tap left: 11 s to 1 s (${t.toFixed(2)})`);
    const back = page.locator('.np-ripple[data-side=back]');
    assert.ok(await back.evaluate(el => el.classList.contains('go')), 'the left ripple shows');
    assert.equal(await back.locator('b').innerText(), '−10');
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false, 'a double-tap never goes full screen');
    await twice(330, 300);
    t = (await media(page)).t;
    assert.ok(Math.abs(t - 11) < 0.3, `double-tap right: 1 s to 11 s (${t.toFixed(2)})`);
    assert.equal(await page.locator('.np-ripple[data-side=forward] b').innerText(), '+10');
    await page.waitForTimeout(800);
    // A single tap on a side only shows or hides the controls, after a moment, and does not jump.
    assert.equal(await ui(page), 'on');
    await page.touchscreen.tap(60, 300);
    await page.waitForFunction(() => document.querySelector('.np').dataset.ui === 'off', null, { timeout: 1000 });
    assert.ok(Math.abs((await media(page)).t - 11) < 0.05, 'a single tap does not seek');
    // The ±10 buttons and the keyboard do the same.
    await page.touchscreen.tap(195, 250);
    await page.getByRole('button', { name: 'Back 10 seconds' }).tap();
    assert.ok(Math.abs((await media(page)).t - 1) < 0.3, 'the Back 10 seconds button');
    await page.getByRole('button', { name: 'Forward 10 seconds' }).tap();
    assert.ok(Math.abs((await media(page)).t - 11) < 0.3, 'the Forward 10 seconds button');
    await context.close();
  });

  await record('Player: a 16:9 cut on an upright phone turns sideways and fills it; taps, double-taps and the scrubber work in the turned frame', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    const video = await openPlayer(page, 'Desktop 16:9');
    const m = await media(page);
    assert.ok(m.w > m.h, 'the desktop cut plays');
    assert.equal(await page.locator('.np').getAttribute('data-rotated'), '', 'the player is turned');
    assert.deepEqual(await rectOf(page, '.np'), [0, 0, 390, 844], 'the turned player covers the screen');
    assert.deepEqual(await rectOf(page, 'main.player video'), [0, 0, 390, 844], 'the film box covers the screen');
    const [a, b] = await page.locator('.np').evaluate(el => new DOMMatrix(getComputedStyle(el).transform)).then(x => [x.a, x.b]);
    assert.ok(Math.abs(a) < 1e-6 && Math.abs(b - 1) < 1e-6, 'turned 90° clockwise');
    // The film's own frame is landscape: the video is 844 wide and 390 high in it.
    assert.deepEqual(await video.evaluate(el => [el.offsetWidth, el.offsetHeight]), [844, 390]);
    await still(page, 4.2);
    await npShot(page, 'phone-16x9-turned');
    // The scrubber runs down the screen. A touch a quarter of the way down is a quarter of the film.
    const track = await page.locator('.np-track').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top, h: r.height, w: r.width }; });
    assert.ok(track.h > 500 && track.w < 12, 'the bar runs down the upright screen');
    const length = await video.evaluate(el => el.duration);
    await page.touchscreen.tap(track.x, track.top + track.h * 0.25);
    let t = (await media(page)).t;
    assert.ok(Math.abs(t - length * 0.25) < 0.35, `a tap a quarter down the bar seeks to a quarter (${t.toFixed(2)} of ${length.toFixed(2)})`);
    // A drag along it follows the finger, with the time bubble on show.
    await page.mouse.move(track.x, track.top + track.h * 0.25);
    await page.mouse.down();
    await page.mouse.move(track.x + 6, track.top + track.h * 0.5, { steps: 4 });
    assert.equal(await page.locator('.np').getAttribute('data-scrubbing'), '', 'scrubbing');
    assert.equal(await page.locator('.np-bubble').innerText(), (await page.locator('[data-np-elapsed]').innerText()));
    const knob = await page.locator('.np-knob').evaluate(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
    assert.ok(Math.abs(knob - (track.top + track.h * 0.5)) < 6, 'the knob sits under the finger');
    await page.mouse.move(track.x, track.top + track.h * 0.75, { steps: 4 });
    await page.mouse.up();
    t = (await media(page)).t;
    assert.ok(Math.abs(t - length * 0.75) < 0.35, `a drag to three quarters seeks there (${t.toFixed(2)})`);
    assert.equal(await page.locator('.np').getAttribute('data-scrubbing'), null);
    // The film's left third is the top of the screen.
    await still(page, 11);
    await page.touchscreen.tap(195, 120); await page.waitForTimeout(90); await page.touchscreen.tap(195, 120);
    t = (await media(page)).t;
    assert.ok(Math.abs(t - 1) < 0.3, `a double-tap at the top of the screen jumps back (${t.toFixed(2)})`);
    await page.waitForTimeout(800);
    await page.touchscreen.tap(195, 740); await page.waitForTimeout(90); await page.touchscreen.tap(195, 740);
    t = (await media(page)).t;
    assert.ok(Math.abs(t - 11) < 0.3, `a double-tap at the bottom jumps forward (${t.toFixed(2)})`);
    // Buttons answer where they are drawn: Back sits at the top right of the screen.
    const backButton = await page.getByRole('button', { name: 'Back to film' }).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    assert.ok(backButton.x > 300 && backButton.y < 100, 'Back is at the film\'s top left, the screen\'s top right');
    await page.touchscreen.tap(backButton.x, backButton.y);
    await page.locator('#film-detail[open]').waitFor();
    await context.close();
  });

  await record('Player: a phone held in landscape plays a 16:9 cut edge to edge, never turned', async () => {
    const { context, page } = await session({ viewport: LANDSCAPE, phone: true });
    await openPlayer(page, 'Desktop 16:9');
    assert.equal(await page.locator('.np').getAttribute('data-rotated'), null, 'nothing is turned');
    assert.ok(identity(await page.locator('.np').evaluate(el => getComputedStyle(el).transform)));
    assert.deepEqual(await rectOf(page, 'main.player video'), [0, 0, 844, 390]);
    await still(page, 4.2);
    await npShot(page, 'phone-landscape-16x9');
    // Turning the phone upright turns the player; turning it back undoes it.
    await page.setViewportSize(PHONE);
    await page.waitForFunction(() => document.querySelector('.np').hasAttribute('data-rotated'));
    await page.setViewportSize(LANDSCAPE);
    await page.waitForFunction(() => !document.querySelector('.np').hasAttribute('data-rotated'));
    await context.close();
  });

  await record('Player: Fit or Fill switches object-fit by button and by pinch, is remembered, and shows in Settings', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await openPlayer(page, 'Phone 9:16');
    await still(page, 4.2);
    const fill = page.getByRole('button', { name: 'Fill the screen' });
    assert.equal(await fill.getAttribute('aria-pressed'), 'false');
    await fill.tap();
    assert.equal((await media(page)).fit, 'cover', 'Fill covers the screen');
    assert.equal(await fill.getAttribute('aria-pressed'), 'true');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('mkc.settings'))).playerFit, 'fill', 'remembered in mkc.settings');
    await page.waitForTimeout(450); // the zoom settles
    await npShot(page, 'phone-9x16-fill');
    // A two-finger pinch in shows the whole film again; out fills.
    const cdp = await context.newCDPSession(page);
    const pinch = async (from, to) => {
      const points = gap => [{ x: 195, y: 230 - gap / 2, id: 0 }, { x: 195, y: 230 + gap / 2, id: 1 }]; // clear of the buttons
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + (to - from) * i / 6) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await pinch(260, 90);
    assert.equal((await media(page)).fit, 'contain', 'a pinch in fits');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('mkc.settings'))).playerFit, 'fit');
    await pinch(90, 260);
    assert.equal((await media(page)).fit, 'cover', 'a pinch out fills');
    assert.ok(Math.abs((await media(page)).t - 4.2) < 0.05, 'a pinch never seeks');
    // Settings → Playback shows the choice and changes it.
    await page.getByRole('button', { name: 'Back to film' }).tap();
    await page.locator('#film-detail [data-action=close-detail]').tap();
    await page.locator('#film-detail').waitFor({ state: 'detached' });
    await page.locator('#tabbar').getByRole('button', { name: 'Settings' }).tap();
    const fillRadio = page.getByRole('radio', { name: 'Fill', exact: true }), fitRadio = page.getByRole('radio', { name: 'Fit', exact: true });
    assert.equal(await fillRadio.isChecked(), true, 'Settings shows Fill');
    await page.locator('label').filter({ has: fitRadio }).tap();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('mkc.settings'))).playerFit, 'fit');
    await page.reload();
    await openPlayer(page, 'Phone 9:16');
    assert.equal((await media(page)).fit, 'contain', 'the player opens as Settings says');
    await context.close();
  });

  await record('Player: switching cut in the player carries on at the same time, with sound', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await openPlayer(page, 'Phone 9:16');
    await still(page, 5);
    const desktopCut = page.getByRole('button', { name: 'Desktop 16:9' });
    assert.equal(await page.getByRole('button', { name: 'Phone 9:16' }).getAttribute('aria-pressed'), 'true');
    await desktopCut.tap();
    await page.waitForFunction(() => { const v = document.querySelector('main.player video'); return v?.readyState >= 2 && v.videoWidth > v.videoHeight && !v.paused; });
    const m = await media(page);
    assert.ok(m.t >= 4.9 && m.t < 6.5, `the desktop cut carries on at 5 s (${m.t.toFixed(2)})`);
    assert.equal(m.muted, false);
    assert.equal(await page.locator('.np').getAttribute('data-rotated'), '', 'and turns sideways');
    assert.equal(await page.getByRole('button', { name: 'Desktop 16:9' }).getAttribute('aria-pressed'), 'true');
    await context.close();
  });

  await record('Player: desktop fills the window; F, Space, arrows, M and Esc work', async () => {
    const { context, page } = await session();
    const video = await openPlayer(page, 'Desktop 16:9', { touch: false });
    assert.deepEqual(await rectOf(page, 'main.player video'), [0, 0, 1440, 900], 'the film fills the window, no letterbox chrome');
    assert.equal(await page.locator('#topbar').isVisible(), false);
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('main'));
    assert.equal(await page.getByRole('button', { name: 'Exit full screen' }).count(), 1, 'the button says how to leave');
    await page.keyboard.press(' ');
    assert.equal((await media(page)).paused, true, 'Space pauses');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => !document.querySelector('main.player video').paused);
    await still(page, 1);
    await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs((await media(page)).t - 11) < 0.2, 'ArrowRight jumps 10 s forward');
    await page.keyboard.press('ArrowLeft');
    assert.ok(Math.abs((await media(page)).t - 1) < 0.2, 'ArrowLeft jumps 10 s back');
    await page.keyboard.press('m');
    assert.equal((await media(page)).muted, true, 'M mutes');
    assert.equal(await page.locator('[data-np=mute]').getAttribute('aria-label'), 'Unmute');
    await page.keyboard.press('m');
    assert.equal((await media(page)).muted, false, 'M unmutes');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator('main.player').count(), 1, 'the first Esc only leaves full screen');
    // The slider is a real one for the keyboard.
    const scrub = page.getByRole('slider', { name: 'Seek' });
    await scrub.focus();
    await page.keyboard.press('End');
    assert.ok((await media(page)).t > 11.5, 'End goes to the end');
    await page.keyboard.press('Home');
    assert.ok((await media(page)).t < 0.1, 'Home goes to the start');
    await page.keyboard.press('ArrowUp');
    assert.ok(Math.abs((await media(page)).t - 10) < 0.2, 'ArrowUp on the slider jumps 10 s');
    assert.equal(await scrub.getAttribute('aria-valuetext'), `0:10 of ${await video.evaluate(el => `0:${String(Math.floor(el.duration)).padStart(2, '0')}`)}`);
    assert.notEqual(await scrub.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'keyboard focus shows on the slider');
    // The mouse: a move shows the controls, stillness hides them and the pointer.
    await still(page, 1); // the film has 11 s to run, more than the 3 s the controls wait
    await page.locator('main.player video').evaluate(el => el.play());
    await page.mouse.move(700, 300);
    await page.mouse.move(720, 320);
    assert.equal(await ui(page), 'on');
    await page.waitForFunction(() => document.querySelector('.np').dataset.ui === 'off', null, { timeout: 4500 });
    assert.equal(await page.locator('.np').evaluate(el => getComputedStyle(el).cursor), 'none', 'the pointer hides with the controls');
    // A mouse double-click on the picture toggles full screen.
    await page.mouse.dblclick(700, 300);
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('main'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.fullscreenElement);
    await still(page, 4.2);
    await page.mouse.move(5, 450);
    await npShot(page, 'desktop-controls');
    await page.keyboard.press('Escape');
    await page.locator('#film-detail[open]').waitFor();
    assert.equal(await page.locator('main.player').count(), 0, 'the second Esc leaves the player');
    await context.close();
  });

  await record('Player: reduced motion shows and hides at once, with no ripple', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true, reduced: true });
    await openPlayer(page, 'Phone 9:16');
    assert.equal(await page.locator('.np-ui').evaluate(el => getComputedStyle(el).transitionDuration), '0s', 'no fade');
    await still(page, 11);
    await page.touchscreen.tap(60, 300); await page.waitForTimeout(90); await page.touchscreen.tap(60, 300);
    assert.ok(Math.abs((await media(page)).t - 1) < 0.3, 'the double-tap still jumps');
    assert.equal(await page.locator('.np-ripple.go').count(), 0, 'without a ripple');
    await context.close();
  });

  // iPhone home-screen app with black-translucent: the window of a non-scrolling screen can be ~55 pt shorter than
  // the screen. Stubbed here as a 390 x 797 window on a 390 x 852 screen (Chrome has no safe areas, so they are 0).
  const SHORT = { width: 390, height: 797 };
  const homeScreenApp = context => context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
    Object.defineProperty(Screen.prototype, 'height', { get: () => 852, configurable: true });
    Object.defineProperty(Screen.prototype, 'width', { get: () => 390, configurable: true });
  });
  const edges = (page, selector) => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; });

  // An iPhone home-screen app (black-translucent) gets the whole screen only while the page is taller than its window;
  // a page that fits (Reels, the player) loses the status bar's height at the bottom: a black band, and an earlier
  // stretch that toggled the page's height made the tab bar jump (owner's iPhone 2026-10-24: window 956 on Settings,
  // tab bar 62 pt higher on Reels = safe-area top 62). So on iPhone the page is always 1 px taller than the window,
  // a constant that never toggles, and these screens never lock the page either.
  await record('iPhone: Reels and the player never lock the page, cover the window and hold the tab bar still', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await homeScreenApp(context);
    await loaded(page);
    const locked = () => page.evaluate(() => [document.documentElement, document.body].some(el => ['overflow', 'overflowY'].some(p => getComputedStyle(el)[p] === 'hidden')));
    const taller = () => page.evaluate(() => document.documentElement.scrollHeight > innerHeight);
    const home = await edges(page, '#tabbar');
    await page.locator('#tabbar').getByRole('button', { name: 'Reels' }).tap();
    await page.locator('section.reel .reel-item').first().waitFor();
    assert.equal(await locked(), false, 'Reels leaves the page unlocked');
    assert.equal(await taller(), true, 'on Reels the page is still taller than the window');
    assert.deepEqual(await edges(page, 'section.reel'), { top: 0, bottom: PHONE.height, left: 0, right: PHONE.width }, 'the reel covers the window');
    const reels = await edges(page, '#tabbar');
    assert.deepEqual(reels, home, 'the tab bar sits exactly where it does on Home');
    await page.waitForTimeout(2500);
    assert.deepEqual(await edges(page, '#tabbar'), reels, 'and holds still while the reel plays');
    await page.locator('#tabbar').getByRole('button', { name: 'Settings' }).tap();
    assert.match(await page.locator('#screen-info').innerText(), /window 844 · safe 0 \/ 0 · home-screen app$/, 'Settings → About says what the app sees');
    await page.locator('#tabbar').getByRole('button', { name: 'Home' }).tap();
    await page.locator('main.library').waitFor();
    await openPlayer(page, 'Phone 9:16');
    assert.equal(await locked(), false, 'the player leaves the page unlocked');
    assert.equal(await taller(), true, 'in the player the page is still taller than the window');
    assert.deepEqual(await edges(page, 'main.player'), { top: 0, bottom: PHONE.height, left: 0, right: PHONE.width }, 'the player covers the window');
    await context.close();
  });

  await record('iPhone trick stays on iPhone: a browser tab gets no extra pixel of scroll on Reels or in the player', async () => {
    const { context, page } = await session({ viewport: PHONE, phone: true });
    await loaded(page);
    await page.locator('#tabbar').getByRole('button', { name: 'Reels' }).tap();
    await page.locator('section.reel .reel-item').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false, 'Reels in a browser tab does not scroll');
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
