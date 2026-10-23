import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

// Motion proof. Records a scripted tour of the demo in real time (desktop, then phone) with Playwright video and
// cuts 12-frame contact strips with ffmpeg: shots/motion-<name>.png. Needs ffmpeg on the PATH.
const root = new URL('../', import.meta.url);
const path = url => fileURLToPath(url);
const shots = new URL('shots/', root), videos = new URL('shots/motion/', root);
const server = serve(4174);
await new Promise(resolve => server.once('listening', resolve));
await rm(videos, { recursive: true, force: true });
await mkdir(videos, { recursive: true });
const profile = new URL('.browser-profile/', root);
await mkdir(profile, { recursive: true });
process.env.TEMP = process.env.TMP = path(profile);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const origin = 'http://127.0.0.1:4174';
const ROW = '.shelf[data-row="New this week"]';

async function record(name, viewport, options, tour) {
  const dir = new URL(`${name}/`, videos);
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', recordVideo: { dir: path(dir), size: viewport }, ...options });
  await context.clock.setFixedTime('2026-10-23T12:00:00Z');
  const page = await context.newPage();
  const start = Date.now(), marks = {};
  const mark = label => { marks[label] = (Date.now() - start) / 1000; };
  await tour(page, mark, context);
  await context.close();
  const [file] = await readdir(path(dir));
  await rename(path(new URL(file, dir)), path(new URL(`../${name}.webm`, dir)));
  await rm(path(dir), { recursive: true, force: true });
  return { video: path(new URL(`${name}.webm`, videos)), marks };
}
// Twelve evenly spaced frames from [from, to) seconds, tiled into one picture.
function strip(video, name, from, to, { width, columns }) {
  const span = to - from, out = path(new URL(`motion-${name}.png`, shots));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, from)), '-t', String(span), '-i', video, '-vf', `fps=12/${span},scale=${width}:-2,tile=${columns}x${12 / columns}`, '-frames:v', '1', out]);
  console.log(`motion-${name}.png  ${from.toFixed(1)}-${to.toFixed(1)} s`);
}
const nudge = async (page, deltaY, steps, gap = 30) => { for (let step = 0; step < steps; step++) { await page.mouse.wheel(0, deltaY); await page.waitForTimeout(gap); } };

try {
  const desktop = await record('desktop', { width: 1440, height: 900 }, {}, async (page, mark) => {
    await page.goto(`${origin}/?demo`);
    await page.locator('main.library').waitFor();
    await page.evaluate(() => document.fonts.ready);
    mark('load'); await page.waitForTimeout(8600);
    await page.locator(ROW).scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, 160)); await page.waitForTimeout(700);
    const card = page.locator(ROW).locator('.card').nth(1);
    const box = await card.boundingBox();
    mark('bob'); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(3600);
    await page.mouse.move(5, 5); await page.waitForTimeout(1000);
    mark('modal'); await card.locator('.film-card').click(); await page.waitForTimeout(2600);
    mark('close'); await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
    await page.mouse.move(5, 5); await page.waitForTimeout(900);
    await page.locator(ROW).locator('.shelf-heading').hover(); await page.waitForTimeout(800);
    mark('row'); await page.locator(ROW).locator('.paddle-next').click(); await page.waitForTimeout(1500);
    await page.locator(ROW).locator('.paddle-prev').click(); await page.waitForTimeout(1100);
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(500);
    mark('scroll'); await nudge(page, 40, 14); await page.waitForTimeout(700);
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(600);
    mark('tabs'); await page.locator('.tab[data-tab=new]').click(); await page.waitForTimeout(1500);
    mark('hot'); await nudge(page, 40, 14); await page.waitForTimeout(1000);
    await nudge(page, -40, 14); await page.waitForTimeout(900);
    mark('end');
  });
  const d = desktop.marks, v = desktop.video, big = { width: 400, columns: 4 };
  strip(v, 'desktop-billboard', d.load + 0.4, d.load + 8.8, big);
  strip(v, 'desktop-bob', d.bob + 0.1, d.bob + 4.2, big);
  strip(v, 'desktop-bob-grow', d.bob + 0.25, d.bob + 1.05, big);
  strip(v, 'desktop-modal-open', d.modal - 0.05, d.modal + 0.75, big);
  strip(v, 'desktop-modal-close', d.close - 0.05, d.close + 0.75, big);
  strip(v, 'desktop-row', d.row - 0.1, d.row + 1.1, big);
  strip(v, 'desktop-scroll', d.scroll - 0.1, d.scroll + 1.5, big);
  strip(v, 'desktop-tabs', d.tabs - 0.1, d.tabs + 0.7, big);
  strip(v, 'desktop-hot', d.hot, d.end, big);

  const phone = await record('phone', { width: 390, height: 844 }, { hasTouch: true, isMobile: true }, async (page, mark, context) => {
    const cdp = await context.newCDPSession(page);
    const swipe = (distance, speed) => cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 500, yDistance: -distance, speed, gestureSourceType: 'touch' });
    await page.goto(`${origin}/?demo`);
    await page.locator('main.library').waitFor();
    await page.evaluate(() => document.fonts.ready);
    mark('load'); await page.waitForTimeout(8600);
    await page.locator(ROW).scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    mark('sheet'); await page.locator(ROW).locator('.film-card').nth(1).tap(); await page.waitForTimeout(2400);
    const top = (await page.locator('#film-detail').boundingBox()).y;
    mark('drag');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: top + 150 }] });
    for (let step = 1; step <= 14; step++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: top + 150 + step * 30 }] }); await page.waitForTimeout(24); }
    await page.waitForTimeout(260);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('#film-detail').waitFor({ state: 'detached' }); await page.waitForTimeout(700);
    mark('tabs'); await page.locator('#tabbar').getByRole('button', { name: 'New & Hot' }).tap(); await page.waitForTimeout(1600);
    mark('hot'); await swipe(300, 500); await page.waitForTimeout(900);
    await swipe(420, 700); await page.waitForTimeout(1100);
    mark('end');
  });
  const p = phone.marks, pv = phone.video, narrow = { width: 200, columns: 6 };
  strip(pv, 'phone-billboard', p.load + 0.4, p.load + 8.8, narrow);
  strip(pv, 'phone-sheet-open', p.sheet - 0.05, p.sheet + 0.85, narrow);
  strip(pv, 'phone-sheet-drag', p.drag + 0.1, p.drag + 1.3, narrow);
  strip(pv, 'phone-tabs', p.tabs - 0.1, p.tabs + 0.7, narrow);
  strip(pv, 'phone-hot', p.hot, p.end, narrow);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
