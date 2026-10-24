import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, readSettings, writeSettings, reelKinds, toggleKind, reelDeck, nextRound } from '../settings.js';
import { groupFilms } from '../catalog.js';

const storage = (entries = {}) => ({ data: new Map(Object.entries(entries)), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, String(value)); }, removeItem(key) { this.data.delete(key); } });
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
const film = (id, kind, added, product = id) => ({ id, title: id, kind, added, product, seconds: 12, poster: `demo/${id}.jpg`, versions: [{ kind: 'phone', file: `demo/${id}.mp4`, w: 360, h: 640, bytes: 1 }] });
const groups = groupFilms([
  film('a-film', 'film', '2026-10-20'), film('b-ad', 'ad', '2026-10-22'), film('c-demo', 'demo', '2026-10-18'),
  film('d-loop', 'loop', '2026-10-21'), film('e-teaser', 'teaser', '2026-10-19'), film('f-reel', 'reel', '2026-10-17'),
]);
const ids = list => list.map(item => item.id);

test('settings: defaults when nothing is stored, when the JSON is broken, and when storage is blocked', () => {
  assert.deepEqual(DEFAULTS, { autoplay: true, reelSound: true, reelKinds: ['films', 'ads', 'demos'], reelOrder: 'shuffle', reelEnd: 'next', playerFit: 'fit' });
  assert.deepEqual(readSettings(storage()), DEFAULTS);
  assert.deepEqual(readSettings(storage({ 'mkc.settings': '{not json' })), DEFAULTS);
  assert.deepEqual(readSettings(storage({ 'mkc.settings': '[1,2]' })), DEFAULTS);
  assert.deepEqual(readSettings(storage({ 'mkc.settings': 'null' })), DEFAULTS);
  assert.deepEqual(readSettings(blocked), DEFAULTS);
  assert.deepEqual(readSettings(undefined), DEFAULTS);
  assert.doesNotThrow(() => writeSettings(blocked, DEFAULTS));
  assert.doesNotThrow(() => writeSettings(undefined, DEFAULTS));
});

test('settings: each field falls back on its own; bad values never leak through', () => {
  const stored = { autoplay: 'yes', reelSound: false, reelKinds: ['ads', 'ads', 'cats', 7], reelOrder: 'random', reelEnd: 'wait', extra: 'dropped' };
  assert.deepEqual(readSettings(storage({ 'mkc.settings': JSON.stringify(stored) })), { ...DEFAULTS, reelSound: false, reelKinds: ['ads'], reelEnd: 'wait' });
  assert.deepEqual(readSettings(storage({ 'mkc.settings': JSON.stringify({ reelKinds: [] }) })).reelKinds, DEFAULTS.reelKinds, 'at least one kind stays on');
  assert.deepEqual(readSettings(storage({ 'mkc.settings': JSON.stringify({ reelKinds: ['demos', 'films'] }) })).reelKinds, ['films', 'demos'], 'kinds keep one fixed order');
});

test('settings: written as one JSON key and read back the same; the old autoplay key moves in', () => {
  const store = storage({ 'mkc.autoplay': '0' });
  assert.equal(readSettings(store).autoplay, false, 'an existing Autoplay off is kept');
  const next = { ...readSettings(store), reelOrder: 'newest', reelEnd: 'wait', reelKinds: ['films'] };
  writeSettings(store, next);
  assert.deepEqual(JSON.parse(store.getItem('mkc.settings')), next);
  assert.equal(store.getItem('mkc.autoplay'), null, 'the old key is gone once the new one is written');
  assert.deepEqual(readSettings(store), next);
  assert.equal(readSettings(storage({ 'mkc.autoplay': '1' })).autoplay, true);
  assert.equal(readSettings(storage({ 'mkc.autoplay': '0', 'mkc.settings': JSON.stringify({ autoplay: true }) })).autoplay, true, 'the new key wins');
});

test('settings: the player shows the whole film unless Fill was chosen', () => {
  assert.equal(DEFAULTS.playerFit, 'fit', 'Fit by default: titles near the frame edges are never cut');
  assert.equal(readSettings(storage({ 'mkc.settings': JSON.stringify({ playerFit: 'fill' }) })).playerFit, 'fill');
  for (const bad of ['cover', 'FILL', 1, null]) assert.equal(readSettings(storage({ 'mkc.settings': JSON.stringify({ playerFit: bad }) })).playerFit, 'fit');
  const store = storage();
  writeSettings(store, { ...DEFAULTS, playerFit: 'fill' });
  assert.equal(JSON.parse(store.getItem('mkc.settings')).playerFit, 'fill', 'kept in the one settings key');
});

test('settings: a kind can be switched off, but the last one stays on', () => {
  assert.deepEqual(toggleKind(['films', 'ads', 'demos'], 'ads'), ['films', 'demos']);
  assert.deepEqual(toggleKind(['films'], 'demos'), ['films', 'demos']);
  assert.deepEqual(toggleKind(['films'], 'films'), ['films'], 'the last kind cannot be switched off');
  assert.deepEqual(toggleKind(['films'], 'cats'), ['films']);
});

test('reels: Films, Ads and Demos pick which titles play', () => {
  assert.deepEqual(reelKinds(groups), { films: 3, ads: 2, demos: 1 }, 'films hold teasers and reels, ads hold loops');
  assert.deepEqual(ids(reelDeck(groups, { ...DEFAULTS, reelOrder: 'newest', reelKinds: ['films'] })), ['a-film', 'e-teaser', 'f-reel']);
  assert.deepEqual(ids(reelDeck(groups, { ...DEFAULTS, reelOrder: 'newest', reelKinds: ['ads'] })), ['b-ad', 'd-loop']);
  assert.deepEqual(ids(reelDeck(groups, { ...DEFAULTS, reelOrder: 'newest', reelKinds: ['demos'] })), ['c-demo']);
  assert.equal(reelDeck(groups, DEFAULTS).length, 6, 'all three kinds: every title');
  assert.deepEqual(reelDeck([], DEFAULTS), [], 'an empty cinema gives an empty reel');
});

test('reels: Newest first keeps the catalog date order; Shuffle draws a new order and keeps every title once', () => {
  const newest = ids(reelDeck(groups, { ...DEFAULTS, reelOrder: 'newest' }));
  assert.deepEqual(newest, ['b-ad', 'd-loop', 'a-film', 'e-teaser', 'c-demo', 'f-reel']);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shuffled = ids(reelDeck(groups, DEFAULTS, { random }));
  assert.notDeepEqual(shuffled, newest, 'shuffle is not the date order');
  assert.deepEqual([...shuffled].sort(), [...newest].sort(), 'every title once');
});

test('reels: the next round keeps the order the owner chose', () => {
  const settings = { ...DEFAULTS, reelOrder: 'newest' };
  const deck = reelDeck(groups, settings);
  assert.deepEqual(ids(nextRound(groups, settings, deck.at(-1))), ids(deck), 'newest first starts again from the newest');
  const last = reelDeck(groups, DEFAULTS).at(-1);
  for (let n = 0; n < 20; n++) assert.notEqual(nextRound(groups, DEFAULTS, last)[0].id, last.id, 'a shuffled round never opens with the film that just played');
});
