export const PRODUCTS = ['MK Voice', 'MK Business OS', 'Talent Atlas', 'MK Job Orbit', 'MK Suite & apps', 'More films'];
const KINDS = ['film', 'episode', 'ad', 'loop', 'teaser', 'demo', 'reel'];
const KIND_LABELS = { film: 'Film', episode: 'Episode', reel: 'Reel', ad: 'Ad', loop: 'Loop', teaser: 'Teaser', demo: 'Demo' };
const RESTATED = new Set([...KINDS, 'عربي', 'arabic']);

export const kindLabel = kind => KIND_LABELS[kind] || 'Film';

// Catalog titles read like file names ("North Studio — Night Swim (film)"). Screens show a brand line, a clean
// name, and only the bracket notes that add something ("app 0.7.3"); kind and Arabic already have their own labels.
export function splitTitle(title) {
  let name = String(title ?? '').trim(), kicker = '', notes = [];
  const dash = /^(.+?)\s+[—–]\s+(.+)$/u.exec(name);
  if (dash) [, kicker, name] = dash;
  const bracket = /^(.+?)\s*\(([^()]+)\)$/u.exec(name);
  if (bracket) {
    name = bracket[1];
    notes = bracket[2].split('·').map(part => part.trim()).filter(part => part && !RESTATED.has(part.toLowerCase()));
  }
  return { kicker, name: name.charAt(0).toUpperCase() + name.slice(1), notes };
}

function normalize(film) {
  return {
    ...film,
    product: PRODUCTS.includes(film.product) ? film.product : 'More films',
    kind: KINDS.includes(film.kind) ? film.kind : 'film',
    lang: ['ar', 'en'].includes(film.lang) ? film.lang : film.title.includes('عربي') ? 'ar' : 'en',
    blurb: typeof film.blurb === 'string' && film.blurb.trim() ? film.blurb : film.title.replace(/[.!?]$/u, '') + '.',
  };
}

function newest(a, b) {
  return (Date.parse(b.added) || 0) - (Date.parse(a.added) || 0)
    || b.versions.length - a.versions.length
    || Number(b.versions.some(version => version.kind === 'desktop')) - Number(a.versions.some(version => version.kind === 'desktop'));
}

// The language this device reads: Arabic when its first language is Arabic, else English.
export const deviceLang = (nav = globalThis.navigator) => String(nav?.languages?.[0] || nav?.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';

// One title per group. With `lang`, the newest variant in that language stands for the group (the card, rows, search,
// Reels, the billboard), and filters and search look only at that language's films; a group without it shows its
// newest variant. A film without `lang` counts as English.
export function groupFilms(films, { lang = null } = {}) {
  const groups = new Map();
  for (const source of films) {
    const film = normalize(source);
    const key = typeof film.group === 'string' && film.group.trim() ? `group:${film.group.trim()}` : `id:${film.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(film);
  }
  return [...groups.values()].map(variants => {
    variants.sort(newest);
    const shown = variants.find(film => film.lang === lang) || variants[0];
    return lang ? { ...shown, variants, shownLang: shown.lang } : { ...shown, variants };
  }).sort(newest);
}

function matchesFilter(film, filter) {
  const products = { 'MK Voice': 'MK Voice', 'Business OS': 'MK Business OS', 'Talent Atlas': 'Talent Atlas', 'Job Orbit': 'MK Job Orbit', 'Suite & apps': 'MK Suite & apps', More: 'More films' };
  if (filter === 'All') return true;
  if (filter === 'Films') return ['film', 'episode', 'teaser', 'reel'].includes(film.kind);
  if (filter === 'Ads') return film.kind === 'ad' || film.kind === 'loop';
  if (filter === 'Demos') return film.kind === 'demo';
  if (filter === 'Arabic') return film.lang === 'ar';
  return film.product === products[filter];
}

export function filterFilms(groups, filter = 'All', query = '') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return groups.flatMap(group => {
    const matches = film => matchesFilter(film, filter) && words.every(word =>
      [film.title, film.product, film.kind, film.lang, film.variant, film.blurb].filter(Boolean).join(' ').toLocaleLowerCase().includes(word));
    // A title shown in one language is found through that language's films only: the other is not a card of its own.
    const film = matches(group) ? group : group.variants.find(item => (!group.shownLang || item.lang === group.shownLang) && matches(item));
    return film ? [{ ...film, variants: group.variants }] : [];
  });
}

function validId(id) {
  return typeof id === 'string' && /^[\p{L}\p{N}_.-]{1,200}$/u.test(id);
}

function validProgress(entry) {
  return entry && ['time', 'duration', 'updated'].every(key => typeof entry[key] === 'number' && Number.isFinite(entry[key]))
    && entry.time >= 0 && entry.duration > 0 && entry.time <= entry.duration && entry.updated >= 0;
}

export function readProgress(storage, key = 'mkc.progress') {
  try {
    const data = JSON.parse(storage.getItem(key));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([id, entry]) => validId(id) && validProgress(entry))
      .map(([id, { time, duration, updated }]) => [id, { time, duration, updated }]));
  } catch { return {}; }
}

export function saveProgress(storage, id, time, duration, key = 'mkc.progress') {
  const progress = readProgress(storage, key);
  const entry = { time, duration, updated: Date.now() };
  if (!validId(id) || !validProgress(entry)) return progress;
  Object.defineProperty(progress, id, { value: entry, enumerable: true, configurable: true, writable: true });
  try { storage.setItem(key, JSON.stringify(progress)); } catch { /* Watching still works when storage is blocked or full. */ }
  return progress;
}

// My List holds film ids only: no title, URL or token. A title with several cuts counts as listed when any cut is.
export function readList(storage, key = 'mkc.list') {
  try {
    const data = JSON.parse(storage.getItem(key));
    return Array.isArray(data) ? [...new Set(data.filter(validId))].slice(0, 200) : [];
  } catch { return []; }
}

export function saveList(storage, list, key = 'mkc.list') {
  try { storage.setItem(key, JSON.stringify(list)); } catch { /* My List still works for this visit when storage is blocked. */ }
}

export const inList = (list, ids) => ids.some(id => list.includes(id));

// `ids` are every cut of one title, newest first. Adding stores the first and puts it at the front.
export const toggleList = (list, ids) => inList(list, ids) ? list.filter(id => !ids.includes(id)) : [ids[0], ...list].slice(0, 200);

export function listGroups(groups, list) {
  const seen = new Set();
  return list.flatMap(id => {
    const group = groups.find(item => item.variants.some(film => film.id === id));
    if (!group || seen.has(group.id)) return [];
    seen.add(group.id);
    return [group];
  });
}

// Only long films resume: a short one always starts from the beginning, and never sits in Continue watching.
export const RESUME_MIN_SECONDS = 30 * 60;
const longEnough = (seconds, entry) => (Number.isFinite(seconds) && seconds > 0 ? seconds : entry?.duration) >= RESUME_MIN_SECONDS;
// Where the player starts a film: its saved place when the film is 30 min or longer and not almost done, else 0.
// `seconds` is the catalog length; when it is unknown the saved duration decides.
export function resumeFrom(entry, seconds) {
  if (!validProgress(entry) || !longEnough(seconds, entry)) return 0;
  return entry.time / entry.duration < 0.95 ? entry.time : 0;
}

export function continueFilms(groups, progress) {
  return groups.flatMap(group => {
    const watched = group.variants.filter(film => Object.hasOwn(progress, film.id) && validProgress(progress[film.id]) && longEnough(film.seconds, progress[film.id]))
      .sort((a, b) => progress[b.id].updated - progress[a.id].updated);
    const film = watched[0];
    if (!film || progress[film.id].time <= 0 || progress[film.id].time / progress[film.id].duration >= 0.95) return [];
    return [{ ...group, resumeFilmId: film.id }];
  }).sort((a, b) => progress[b.resumeFilmId].updated - progress[a.resumeFilmId].updated);
}
