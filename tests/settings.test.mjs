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

// Cuts: p = phone only, d = desktop only, b = both. Products repeat so the shuffle rules have work to do.
const cut = { p: ['phone'], d: ['desktop'], b: ['phone', 'desktop'] };
const shaped = (id, shape, added, product) => ({ ...film(id, 'film', added, product), versions: cut[shape].map(kind => ({ kind, file: `demo/${id}-${kind}.mp4`, w: 1, h: 1, bytes: 1 })) });
const mixed = groupFilms([
  shaped('p1', 'p', '2026-10-30', 'MK Voice'), shaped('d1', 'd', '2026-10-29', 'Talent Atlas'), shaped('b1', 'b', '2026-10-28', 'MK Voice'),
  shaped('p2', 'p', '2026-10-27', 'Talent Atlas'), shaped('d2', 'd', '2026-10-26', 'MK Voice'), shaped('b2', 'b', '2026-10-25', 'Talent Atlas'),
  shaped('p3', 'p', '2026-10-24', 'MK Business OS'), shaped('d3', 'd', '2026-10-23', 'MK Business OS'),
]);
const hasCut = (item, kind) => item.versions.some(version => version.kind === kind);
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const NEWEST = { ...DEFAULTS, reelOrder: 'newest' };

test('reels: Newest first puts the titles with the screen\'s cut first, each part in date order', () => {
  assert.deepEqual(ids(reelDeck(mixed, NEWEST, { prefer: 'phone' })), ['p1', 'b1', 'p2', 'b2', 'p3', 'd1', 'd2', 'd3']);
  assert.deepEqual(ids(reelDeck(mixed, NEWEST, { prefer: 'desktop' })), ['d1', 'b1', 'd2', 'b2', 'd3', 'p1', 'p2', 'p3']);
  assert.deepEqual(ids(reelDeck(mixed, NEWEST)), ['p1', 'd1', 'b1', 'p2', 'd2', 'b2', 'p3', 'd3'], 'no screen given: the plain date order');
});

test('reels: Shuffle shuffles each part on its own, every title once, phone or desktop cuts first', () => {
  for (const prefer of ['phone', 'desktop']) {
    const matching = mixed.filter(item => hasCut(item, prefer)).length, orders = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const deck = reelDeck(mixed, DEFAULTS, { random: seeded(seed), prefer });
      assert.deepEqual(ids(deck).sort(), ids(mixed).sort(), `${prefer} ${seed}: every title once`);
      assert.ok(deck.slice(0, matching).every(item => hasCut(item, prefer)), `${prefer} ${seed}: the screen's cuts come first`);
      assert.ok(deck.slice(matching).every(item => !hasCut(item, prefer)), `${prefer} ${seed}: then the rest`);
      for (let i = 1; i < deck.length; i++) assert.notEqual(deck[i].product, deck[i - 1].product, `${prefer} ${seed}: one product never twice in a row (avoidable here)`);
      orders.add(ids(deck).join());
    }
    assert.ok(orders.size > 5, `${prefer}: the order really is shuffled`);
  }
});

test('reels: a cinema where no title, or every title, has the screen\'s cut keeps the plain order', () => {
  const phoneOnly = mixed.filter(item => !hasCut(item, 'desktop'));
  assert.deepEqual(ids(reelDeck(phoneOnly, NEWEST, { prefer: 'desktop' })), ids(reelDeck(phoneOnly, NEWEST)), 'no desktop cuts: date order');
  assert.deepEqual(ids(reelDeck(phoneOnly, NEWEST, { prefer: 'phone' })), ids(reelDeck(phoneOnly, NEWEST)), 'all phone cuts: date order');
  assert.deepEqual(ids(reelDeck(phoneOnly, DEFAULTS, { random: seeded(5), prefer: 'desktop' })), ids(reelDeck(phoneOnly, DEFAULTS, { random: seeded(5) })), 'no matching cut: the same shuffle as before');
  assert.deepEqual(ids(reelDeck(phoneOnly, DEFAULTS, { random: seeded(5), prefer: 'phone' })), ids(reelDeck(phoneOnly, DEFAULTS, { random: seeded(5) })), 'all match: the same shuffle as before');
});

test('reels: each new round is grouped the same way and never opens with the film or product that just played', () => {
  for (const prefer of ['phone', 'desktop']) {
    const matching = mixed.filter(item => hasCut(item, prefer)).length;
    for (let seed = 1; seed <= 40; seed++) {
      const last = reelDeck(mixed, DEFAULTS, { random: seeded(seed), prefer }).at(-1), round = nextRound(mixed, DEFAULTS, last, { random: seeded(seed + 100), prefer });
      assert.ok(round.slice(0, matching).every(item => hasCut(item, prefer)), `${prefer} ${seed}: the round opens with the screen's cuts`);
      assert.notEqual(round[0].id, last.id, `${prefer} ${seed}: not the film that just played`);
      assert.notEqual(round[0].product, last.product, `${prefer} ${seed}: not its product either`);
    }
    // Every title has the screen's cut, so the last film is in the first part: the boundary rule still holds there.
    const all = mixed.filter(item => hasCut(item, prefer));
    for (let seed = 1; seed <= 20; seed++) {
      const last = reelDeck(all, DEFAULTS, { random: seeded(seed), prefer }).at(-1);
      assert.notEqual(nextRound(all, DEFAULTS, last, { random: seeded(seed + 7), prefer })[0].id, last.id, `${prefer} ${seed}: one part only, still not the same film`);
    }
    assert.deepEqual(ids(nextRound(mixed, NEWEST, mixed[0], { prefer })), ids(reelDeck(mixed, NEWEST, { prefer })), `${prefer}: newest first starts the grouped order again`);
  }
});
