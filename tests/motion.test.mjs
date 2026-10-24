import test from 'node:test';
import assert from 'node:assert/strict';
import { chase, feedWindow, feedProgress, feedTime, bobRect, claimPreview, readAutoplay, writeAutoplay, spring, PREVIEW_START, PX_PER_SEC } from '../motion.js';
import { groupFilms, filterFilms, readList, saveList, inList, toggleList, listGroups } from '../catalog.js';

const storage = () => ({ data: new Map(), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, value); } });
const film = (id, fields = {}) => ({ id, title: id, added: '2026-10-22', versions: [{ kind: 'phone' }], seconds: 12, ...fields });

test('scroll film: seeks on a big gap or backward scroll, plays to catch up, pauses when caught up', () => {
  assert.deepEqual(chase({ target: 5, time: 1, quietFor: 0 }), { act: 'seek', to: 5 });
  assert.deepEqual(chase({ target: 1, time: 1.1, quietFor: 0 }), { act: 'seek', to: 1 });
  assert.deepEqual(chase({ target: 2, time: 1.99, quietFor: 0 }), { act: 'pause' });
  assert.deepEqual(chase({ target: 2, time: 2.03, quietFor: 0 }), { act: 'pause' });
  const moving = chase({ target: 2.5, time: 2, quietFor: 10 });
  assert.equal(moving.act, 'play');
  assert.equal(moving.rate, 2, 'while scrolling the gap closes in about a quarter second');
});

test('scroll film: after 50 ms of quiet it finishes at full speed, jumps a big gap, and never crawls', () => {
  const scrolling = chase({ target: 2.1, time: 2, quietFor: 49 });
  assert.ok(scrolling.rate < 0.5 && scrolling.rate >= 0.1, 'while input continues the rate follows the gap');
  assert.equal(chase({ target: 2.8, time: 2, quietFor: 10 }).rate, 3, 'rate is capped at 3x while scrolling');
  assert.equal(chase({ target: 2.1, time: 2, quietFor: 51 }).rate, 3, 'once quiet it finishes at 3x');
  assert.equal(chase({ target: 2.19, time: 2, quietFor: 100 }).act, 'play', 'a gap under 0.2 s is closed in under 0.07 s');
  assert.deepEqual(chase({ target: 2.5, time: 2, quietFor: 100 }), { act: 'seek', to: 2.5 }, 'a bigger gap is jumped once input has stopped');
  assert.equal(chase({ target: 2.5, time: 2, quietFor: 10 }).act, 'play', 'while scrolling the same gap still plays');
});

test('new and hot: a film plays a window from 10% and costs PX_PER_SEC of scroll per second', () => {
  const window = feedWindow(12, 600);
  assert.equal(window.start, 12 * PREVIEW_START);
  assert.equal(window.span, 600 / PX_PER_SEC);
  assert.equal(feedTime(0, window), window.start);
  assert.equal(feedTime(1, window), window.start + window.span);
  assert.equal(feedTime(-3, window), window.start, 'before its zone the film waits at its start');
  assert.equal(feedTime(9, window), window.start + window.span, 'after it the film rests at the end of its window');
  const short = feedWindow(3, 2000);
  assert.ok(short.start + short.span < 3, 'a short film never runs off its end');
  assert.ok(feedWindow(3, 10).span >= 0.5, 'a tiny item still moves');
});

test('new and hot: every pixel of scroll moves the active film, from one end of its window to the other', () => {
  assert.equal(feedProgress(500, 500, 400), 0.5, 'centred means half way');
  assert.equal(feedProgress(700, 500, 400), 0, 'half a pitch below the middle it has just become active');
  assert.equal(feedProgress(300, 500, 400), 1, 'half a pitch above it hands over to the next film');
  assert.equal(feedProgress(600, 500, 400), 0.25);
  assert.equal(feedProgress(2000, 500, 400), 0, 'clamped');
  assert.equal(feedProgress(-2000, 500, 400), 1, 'clamped');
  // the next film's centre is one pitch behind, so when one film ends the next one starts
  assert.equal(feedProgress(500 - 200, 500, 400), 1);
  assert.equal(feedProgress(500 - 200 + 400, 500, 400), 0);
});

test('hover card: left-edge grows rightward, right-edge leftward, the middle grows from its centre', () => {
  const view = { w: 1440, h: 900, top: 68 };
  const bounds = { left: 58, right: 1382 };
  const at = left => ({ left, right: left + 300, width: 300, top: 400, height: 169 });
  const first = bobRect({ card: at(58), bounds, view });
  assert.equal(first.edge, 'left');
  assert.equal(first.left, 58, 'the card edge stays put');
  assert.equal(first.width, 450);
  const last = bobRect({ card: at(1082), bounds, view });
  assert.equal(last.edge, 'right');
  assert.equal(last.left + last.width, 1382, 'the right edge stays put');
  const middle = bobRect({ card: at(600), bounds, view });
  assert.equal(middle.edge, 'center');
  assert.equal(middle.left + middle.width / 2, 750, 'grows from the centre');
  assert.equal(middle.media, 169 * 1.5);
  assert.equal(middle.top, 400 - (169 * 1.5 - 169) / 2, 'grows above and below the card');
});

test('hover card: stays inside the viewport and below the top bar', () => {
  const view = { w: 1440, h: 900, top: 68 };
  const bounds = { left: 58, right: 1382 };
  const high = bobRect({ card: { left: 600, right: 900, width: 300, top: 70, height: 169 }, bounds, view });
  assert.ok(high.top >= 68 + 8, 'never under the top bar');
  const low = bobRect({ card: { left: 600, right: 900, width: 300, top: 800, height: 169 }, bounds, view });
  assert.ok(low.top + low.total <= 900 - 8, 'never below the screen');
  const peek = bobRect({ card: { left: 1250, right: 1550, width: 300, top: 400, height: 169 }, bounds, view });
  assert.ok(peek.left + peek.width <= 1440 - 8, 'a card peeking past the edge still opens fully on screen');
});

test('only one preview plays at a time', () => {
  const stopped = [];
  const one = { stop: () => stopped.push('one') }, two = { stop: () => stopped.push('two') };
  const releaseOne = claimPreview(one);
  claimPreview(one);
  assert.deepEqual(stopped, [], 'claiming again as the same owner stops nothing');
  const releaseTwo = claimPreview(two);
  assert.deepEqual(stopped, ['one'], 'a new owner stops the previous one');
  releaseOne();
  claimPreview({ stop: () => stopped.push('three') });
  assert.deepEqual(stopped, ['one', 'two'], 'a stale release does not free the current owner');
  releaseTwo();
});

test('autoplay defaults on, remembers off, and survives blocked storage', () => {
  const store = storage();
  assert.equal(readAutoplay(store), true);
  writeAutoplay(store, false);
  assert.equal(readAutoplay(store), false);
  writeAutoplay(store, true);
  assert.equal(readAutoplay(store), true);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readAutoplay(blocked), true);
  assert.doesNotThrow(() => writeAutoplay(blocked, false));
});

test('spring easing starts at 0, overshoots a little, and settles at exactly 1', () => {
  const points = spring().slice(7, -1).split(', ').map(Number);
  assert.equal(points[0], 0);
  assert.equal(points.at(-1), 1);
  assert.ok(Math.max(...points) > 1 && Math.max(...points) < 1.15, 'a soft overshoot');
});

test('My List stores ids only, drops bad data, and treats every cut of a title as one entry', () => {
  const store = storage();
  assert.deepEqual(readList(store), []);
  let list = toggleList([], ['main', 'cut']);
  assert.deepEqual(list, ['main'], 'adding stores the newest cut');
  assert.equal(inList(list, ['main', 'cut']), true);
  assert.equal(inList(list, ['cut', 'main']), true, 'any cut counts');
  list = toggleList(['other', 'main', 'cut'], ['main', 'cut']);
  assert.deepEqual(list, ['other'], 'removing clears every cut');
  assert.deepEqual(toggleList(['a'], ['b']), ['b', 'a'], 'newest first');
  saveList(store, ['main', 'x']);
  assert.deepEqual(JSON.parse(store.getItem('mkc.list')), ['main', 'x']);
  store.setItem('mkc.list', JSON.stringify(['ok', 'ok', 'bad id!', 42, { a: 1 }, 'also-ok']));
  assert.deepEqual(readList(store), ['ok', 'also-ok'], 'duplicates and invalid ids are dropped');
  store.setItem('mkc.list', '{not json');
  assert.deepEqual(readList(store), []);
  assert.deepEqual(readList({ getItem() { throw new Error('blocked'); } }), []);
  assert.doesNotThrow(() => saveList({ setItem() { throw new Error('full'); } }, ['a']));
  assert.equal(toggleList(Array.from({ length: 200 }, (_, index) => `id-${index}`), ['new']).length, 200, 'the list is capped');
});

test('My List shows titles in the order they were added, once each', () => {
  const groups = groupFilms([film('main', { group: 'g' }), film('cut', { group: 'g', added: '2026-10-20' }), film('solo', { added: '2026-10-21' })]);
  assert.deepEqual(listGroups(groups, ['solo', 'cut', 'main', 'gone']).map(group => group.id), ['solo', 'main']);
});

test('the Films tab keeps films, teasers and reels, and leaves ads, loops and demos out', () => {
  const groups = groupFilms([film('f', { kind: 'film' }), film('t', { kind: 'teaser' }), film('r', { kind: 'reel' }), film('a', { kind: 'ad' }), film('l', { kind: 'loop' }), film('d', { kind: 'demo' })]);
  assert.deepEqual(filterFilms(groups, 'Films').map(item => item.id).sort(), ['f', 'r', 't']);
});

test('film light: pale posters are dimmed so they glow instead of fogging the page; colourful ones pass', async () => {
  const { dimFor } = await import('../ambient.js');
  const fill = (r, g, b) => Uint8ClampedArray.from({ length: 48 * 27 * 4 }, (_, i) => [r, g, b, 255][i % 4]);
  assert.equal(dimFor(fill(233, 64, 45)), 0, 'a red poster keeps all its light');
  assert.equal(dimFor(fill(12, 14, 20)), 0, 'a dark poster keeps all its light');
  assert.ok(Math.abs(dimFor(fill(255, 255, 255)) - 0.7) < 0.01, 'a white poster gives 30 % of its light');
  assert.ok(Math.abs(dimFor(fill(153, 153, 153)) - 0.5) < 0.01, 'a grey poster is capped at the same brightness');
});

test('film light: the shade under white type deepens only over pale posters', async () => {
  const { paleFor } = await import('../ambient.js');
  const fill = (r, g, b) => Uint8ClampedArray.from({ length: 48 * 27 * 4 }, (_, i) => [r, g, b, 255][i % 4]);
  assert.equal(paleFor(fill(233, 64, 45)), 0, 'a red poster keeps the light shade');
  assert.equal(paleFor(fill(20, 22, 29)), 0, 'a dark poster keeps the light shade');
  assert.equal(paleFor(fill(250, 250, 250)), 1, 'a white poster gets the full shade');
  assert.ok(Math.abs(paleFor(fill(166, 166, 166)) - 0.5) < 0.02, 'in between, in between');
});
