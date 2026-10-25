import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFilms, filterFilms, readProgress, saveProgress, continueFilms, splitTitle, kindLabel } from '../catalog.js';

const film = (id, fields = {}) => ({ id, title: id, added: '2026-10-22', versions: [{ kind: 'phone' }], seconds: 100, ...fields });
const storage = () => ({ data: new Map(), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, value); } });

test('old catalogs get defaults and unrelated titles never collapse', () => {
  const source = [film('one', { title: 'Same title' }), film('two', { title: 'Same title' }), film('ar', { title: 'مشهد عربي' })];
  const groups = groupFilms(source);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].product, 'More films');
  assert.equal(groups[0].kind, 'film');
  assert.equal(groups[0].blurb, 'Same title.');
  assert.equal(groups[2].lang, 'ar');
  assert.equal(source[0].product, undefined);
});

test('explicit variants collapse; newest wins, then completeness, desktop, and input order', () => {
  const variants = [film('old', { group: 'a', added: '2026-10-20' }), film('main', { group: 'a' }), film('second', { group: 'a' })];
  const [group] = groupFilms(variants);
  assert.equal(group.id, 'main');
  assert.deepEqual(group.variants.map(item => item.id), ['main', 'second', 'old']);
  assert.equal(groupFilms([film('phone', { group: 'b' }), film('desktop', { group: 'b', versions: [{ kind: 'desktop' }] })])[0].id, 'desktop');
  assert.equal(groupFilms([film('phone', { group: 'b' }), film('both', { group: 'b', versions: [{ kind: 'phone' }, { kind: 'desktop' }] })])[0].id, 'both');
  assert.equal(groupFilms([film('a', { group: '' }), film('b', { group: ' ' })]).length, 2);
});

test('chips and search include alternate cuts, Arabic, metadata, and combined filters', () => {
  const groups = groupFilms([
    film('main', { title: 'Golden Hour', group: 'gold', product: 'MK Voice' }),
    film('cut', { title: 'رحلة الضوء عربي', group: 'gold', lang: 'ar', kind: 'demo', variant: 'Arabic-led cut', product: 'MK Voice', added: '2026-10-21' }),
    film('loop', { kind: 'loop', product: 'MK Suite & apps' }),
    film('ad', { kind: 'ad', product: 'MK Business OS' }),
    film('atlas', { product: 'Talent Atlas' }), film('orbit', { product: 'MK Job Orbit' }), film('other'),
  ]);
  assert.equal(groups.length, 6);
  assert.equal(filterFilms(groups, 'Arabic')[0].id, 'cut');
  assert.equal(filterFilms(groups, 'All', 'رحلة')[0].id, 'cut');
  assert.equal(filterFilms(groups, 'Demos', 'عربي')[0].id, 'cut');
  assert.equal(filterFilms(groups, 'MK Voice', 'arabic-led')[0].id, 'cut');
  assert.equal(filterFilms(groups, 'All', 'GOLDEN hour')[0].id, 'main');
  assert.equal(filterFilms(groups, 'Ads').length, 2);
  for (const chip of ['MK Voice', 'Business OS', 'Suite & apps', 'Talent Atlas', 'Job Orbit', 'More']) assert.equal(filterFilms(groups, chip).length, 1, chip);
  assert.deepEqual(filterFilms(groups, 'Arabic', 'missing'), []);
  assert.equal(filterFilms(groups, 'Arabic')[0].variants.length, 2);
});

test('progress stores numbers per id and strips all other fields on read', () => {
  const local = storage();
  saveProgress(local, 'sample', 32, 100);
  const stored = JSON.parse(local.getItem('mkc.progress'));
  assert.deepEqual(Object.keys(stored), ['sample']);
  assert.deepEqual(Object.keys(stored.sample), ['time', 'duration', 'updated']);
  assert.equal(stored.sample.time, 32);
  assert.equal(typeof stored.sample.updated, 'number');
  local.setItem('mkc.progress', JSON.stringify({ sample: { time: 3, duration: 5, updated: 1, token: 'discard', url: 'discard' }, 'https://example.test/film': { time: 1, duration: 5, updated: 1 }, bad: { time: '1', duration: 5, updated: 1 } }));
  assert.deepEqual(readProgress(local), { sample: { time: 3, duration: 5, updated: 1 } });
});

test('progress handles broken or blocked storage and invalid times', () => {
  const local = storage();
  local.setItem('mkc.progress', '{');
  assert.deepEqual(readProgress(local), {});
  for (const value of [null, [], 4, 'wrong']) {
    local.setItem('mkc.progress', JSON.stringify(value));
    assert.deepEqual(readProgress(local), {});
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } };
  assert.deepEqual(readProgress(blocked), {});
  assert.equal(saveProgress(blocked, 'film', 1, 4).film.time, 1);
  for (const [time, duration] of [[NaN, 5], [Infinity, 5], [-1, 5], [2, 0], [6, 5]]) assert.deepEqual(saveProgress(storage(), 'film', time, duration), {});
  assert.deepEqual(saveProgress(storage(), 'https://example.test', 1, 4), {});
});

test('continue watching uses latest watched variant and hides completed, empty, or invalid progress', () => {
  const groups = groupFilms([film('main', { group: 'g' }), film('cut', { group: 'g' }), film('other'), film('done'), film('zero')]);
  const progress = { main: { time: 20, duration: 100, updated: 1 }, cut: { time: 30, duration: 100, updated: 3 }, other: { time: 20, duration: 100, updated: 2 }, done: { time: 95, duration: 100, updated: 4 }, zero: { time: 0, duration: 100, updated: 5 } };
  assert.deepEqual(continueFilms(groups, progress).map(item => item.resumeFilmId), ['cut', 'other']);
  progress.cut.time = 100;
  assert.deepEqual(continueFilms(groups, progress).map(item => item.resumeFilmId), ['other']);
  assert.deepEqual(continueFilms(groups, {}), []);
});

test('titles split into a brand line, a clean name, and notes that add something', () => {
  const split = title => splitTitle(title);
  assert.deepEqual(split('North Studio — Night Swim (film)'), { kicker: 'North Studio', name: 'Night Swim', notes: [] });
  assert.deepEqual(split('North Studio — reel'), { kicker: 'North Studio', name: 'Reel', notes: [] });
  assert.deepEqual(split('Lumen App — Walkthrough (app 2.4.1)'), { kicker: 'Lumen App', name: 'Walkthrough', notes: ['app 2.4.1'] });
  assert.deepEqual(split('Lumen App — Front Desk, Arabic-first cut (demo · عربي)'), { kicker: 'Lumen App', name: 'Front Desk, Arabic-first cut', notes: [] });
  assert.deepEqual(split('Lumen App — Small Rooms (series)').notes, ['series']);
  assert.deepEqual(split('Rose Atelier — window reel (9:16 · عربي)'), { kicker: 'Rose Atelier', name: 'Window reel', notes: ['9:16'] });
  assert.deepEqual(split('Tide Lab — Two shores. One boat.'), { kicker: 'Tide Lab', name: 'Two shores. One boat.', notes: [] });
  assert.deepEqual(split('Golden Hour — V1'), { kicker: 'Golden Hour', name: 'V1', notes: [] });
  assert.deepEqual(split('A – B — C'), { kicker: 'A', name: 'B — C', notes: [] });
});

test('titles without a brand line stay whole; odd input never empties a title', () => {
  assert.deepEqual(splitTitle('Salt & Pepper'), { kicker: '', name: 'Salt & Pepper', notes: [] });
  assert.deepEqual(splitTitle('رحلة الضوء'), { kicker: '', name: 'رحلة الضوء', notes: [] });
  assert.deepEqual(splitTitle('Day-to-day - plan'), { kicker: '', name: 'Day-to-day - plan', notes: [] });
  assert.deepEqual(splitTitle('Dr. Example — Garden film (عربي)'), { kicker: 'Dr. Example', name: 'Garden film', notes: [] });
  assert.equal(splitTitle('(عربي)').name, '(عربي)');
  assert.equal(splitTitle('Brand — (x)').name, '(x)');
  assert.deepEqual(splitTitle(undefined), { kicker: '', name: '', notes: [] });
  assert.equal(splitTitle('  Spaced title  ').name, 'Spaced title');
});

test('kind labels read as words, unknown kinds fall back to Film', () => {
  assert.deepEqual(['film', 'reel', 'ad', 'loop', 'teaser', 'demo'].map(kindLabel), ['Film', 'Reel', 'Ad', 'Loop', 'Teaser', 'Demo']);
  assert.equal(kindLabel('trailer'), 'Film');
  assert.equal(kindLabel(undefined), 'Film');
});
