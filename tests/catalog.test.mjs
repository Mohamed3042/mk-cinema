import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFilms, filterFilms, readProgress, saveProgress, continueFilms, resumeFrom, deviceLang, RESUME_MIN_SECONDS, splitTitle, kindLabel } from '../catalog.js';

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

test('an episode is labelled Episode and listed with Films; an unknown kind shows as Film', () => {
  assert.equal(kindLabel('episode'), 'Episode');
  const groups = groupFilms([film('ep', { kind: 'episode' }), film('ad', { kind: 'ad' }), film('odd', { kind: 'hologram' })]);
  assert.equal(groups.find(g => g.id === 'ep').kind, 'episode');
  assert.equal(groups.find(g => g.id === 'odd').kind, 'film');
  assert.deepEqual(filterFilms(groups, 'Films').map(g => g.id).sort(), ['ep', 'odd']);
  assert.equal(splitTitle('Pop & Ship — Ep 1 (episode)').notes.length, 0, 'the kind is not repeated as a note');
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
  const long = { seconds: 3600 };
  const groups = groupFilms([film('main', { group: 'g', ...long }), film('cut', { group: 'g', ...long }), film('other', long), film('done', long), film('zero', long)]);
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
  assert.deepEqual(split('Lumen App — Demo (app 0.7.3)'), { kicker: 'Lumen App', name: 'Demo', notes: ['app 0.7.3'] });
  assert.deepEqual(split('Lumen App — Sales & Support, Arabic-led cut (demo · عربي)'), { kicker: 'Lumen App', name: 'Sales & Support, Arabic-led cut', notes: [] });
  assert.deepEqual(split('Lumen App — Second Look (series)').notes, ['series']);
  assert.deepEqual(split('Rose Atelier — launch reel (9:16 · عربي)'), { kicker: 'Rose Atelier', name: 'Launch reel', notes: ['9:16'] });
  assert.deepEqual(split('Trilogy — Three rooms. One door.'), { kicker: 'Trilogy', name: 'Three rooms. One door.', notes: [] });
  assert.deepEqual(split('Golden Hour — V1'), { kicker: 'Golden Hour', name: 'V1', notes: [] });
  assert.deepEqual(split('A – B — C'), { kicker: 'A', name: 'B — C', notes: [] });
});

test('titles without a brand line stay whole; odd input never empties a title', () => {
  assert.deepEqual(splitTitle('Salt & Pepper'), { kicker: '', name: 'Salt & Pepper', notes: [] });
  assert.deepEqual(splitTitle('رحلة الضوء'), { kicker: '', name: 'رحلة الضوء', notes: [] });
  assert.deepEqual(splitTitle('Day-to-day - plan'), { kicker: '', name: 'Day-to-day - plan', notes: [] });
  assert.deepEqual(splitTitle('Prof. Sample — Thank-you film (عربي)'), { kicker: 'Prof. Sample', name: 'Thank-you film', notes: [] });
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

test('resume: only films of 30 min or more start where they were left', () => {
  assert.equal(RESUME_MIN_SECONDS, 1800);
  const at = (time, duration = 2400) => ({ time, duration, updated: 1 });
  assert.equal(resumeFrom(at(600), 29 * 60 + 59), 0, '29:59 starts at 0');
  assert.equal(resumeFrom(at(600), 30 * 60), 600, '30:00 resumes');
  assert.equal(resumeFrom(at(6, 12), 12), 0, 'a 12 s demo film starts at 0');
  assert.equal(resumeFrom(at(600, 100 * 60), undefined), 600, 'no catalog length: the saved duration decides (long)');
  assert.equal(resumeFrom(at(6, 12), 0), 0, 'no catalog length and a short saved duration: 0');
  assert.equal(resumeFrom({ time: 6, updated: 1 }, undefined), 0, 'unknown duration: 0');
  assert.equal(resumeFrom(undefined, 3600), 0, 'nothing saved: 0');
  assert.equal(resumeFrom(at(2350), 2400), 0, 'almost done: from the start');
});

test('continue watching lists only films of 30 min or more', () => {
  const groups = groupFilms([film('short', { seconds: 12 }), film('edge', { seconds: 1799 }), film('long', { seconds: 1800 }), film('unknown', { seconds: 0 })]);
  const progress = { short: { time: 6, duration: 12, updated: 1 }, edge: { time: 60, duration: 1799, updated: 2 }, long: { time: 60, duration: 1800, updated: 3 }, unknown: { time: 60, duration: 3600, updated: 4 } };
  assert.deepEqual(continueFilms(groups, progress).map(item => item.resumeFilmId), ['unknown', 'long']);
});

test('language: the device language picks which film of a language pair stands for the title', () => {
  assert.equal(deviceLang({ languages: ['ar-KW', 'en'] }), 'ar');
  assert.equal(deviceLang({ language: 'AR' }), 'ar');
  assert.equal(deviceLang({ languages: ['en-US', 'ar'] }), 'en', 'the first language decides');
  assert.equal(deviceLang({ languages: [], language: 'ar-EG' }), 'ar');
  assert.equal(deviceLang({}), 'en');
  assert.equal(deviceLang(undefined), 'en');
  const pair = [film('en-cut', { group: 'p', lang: 'en', added: '2026-10-22' }), film('ar-cut', { group: 'p', lang: 'ar', added: '2026-10-20' })];
  assert.equal(groupFilms(pair, { lang: 'ar' })[0].id, 'ar-cut', 'Arabic device + pair: the Arabic film, though older');
  assert.equal(groupFilms(pair, { lang: 'en' })[0].id, 'en-cut', 'English device + pair: the English film');
  assert.equal(groupFilms(pair, { lang: 'ar' })[0].variants.length, 2, 'the other language stays in the group');
  const englishOnly = [film('one', { group: 'e', lang: 'en' }), film('two', { group: 'e', lang: 'en', added: '2026-10-20' })];
  assert.equal(groupFilms(englishOnly, { lang: 'ar' })[0].id, 'one', 'Arabic device, no Arabic: the newest English film');
  const unmarked = [film('plain', { group: 'u', added: '2026-10-19' }), film('arabic', { group: 'u', lang: 'ar' })];
  assert.equal(groupFilms(unmarked, { lang: 'en' })[0].id, 'plain', 'a film without lang counts as English');
  assert.equal(groupFilms(unmarked, { lang: 'ar' })[0].id, 'arabic');
  const groups = groupFilms([...pair, film('solo')], { lang: 'ar' });
  assert.equal(groups.length, 2, 'a pair is one title');
  assert.equal(filterFilms(groups, 'All', 'cut')[0].id, 'ar-cut', 'search shows the device language when both match');
  assert.deepEqual(filterFilms(groupFilms(pair, { lang: 'en' }), 'Arabic'), [], 'English device: the pair’s Arabic film is no card of its own, not even under Arabic');
  assert.equal(filterFilms(groupFilms(pair, { lang: 'ar' }), 'Arabic')[0].id, 'ar-cut', 'Arabic device: the Arabic chip finds it');
  assert.equal(filterFilms(groupFilms([film('only-ar', { lang: 'ar' })], { lang: 'en' }), 'Arabic')[0].id, 'only-ar', 'an Arabic film with no English twin still shows on an English device');
});
