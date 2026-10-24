import { filterFilms } from './catalog.js';
import { shuffleDeck } from './reel.js';

// The owner's choices, kept in one JSON key. Anything missing or broken falls back to its default on its own, and
// blocked storage never stops playback: the app keeps the choices for the visit.
export const SETTINGS_KEY = 'mkc.settings';
const LEGACY_AUTOPLAY = 'mkc.autoplay'; // before Settings had a page, Autoplay previews lived here
export const KINDS = ['films', 'ads', 'demos'];
const KIND_FILTER = { films: 'Films', ads: 'Ads', demos: 'Demos' };
export const DEFAULTS = Object.freeze({ autoplay: true, reelSound: true, reelKinds: Object.freeze([...KINDS]), reelOrder: 'shuffle', reelEnd: 'next', playerFit: 'fit' });

function normalize(raw = {}) {
  const kinds = Array.isArray(raw.reelKinds) ? KINDS.filter(kind => raw.reelKinds.includes(kind)) : [];
  return {
    autoplay: typeof raw.autoplay === 'boolean' ? raw.autoplay : DEFAULTS.autoplay,
    reelSound: typeof raw.reelSound === 'boolean' ? raw.reelSound : DEFAULTS.reelSound,
    reelKinds: kinds.length ? kinds : [...DEFAULTS.reelKinds],
    reelOrder: ['shuffle', 'newest'].includes(raw.reelOrder) ? raw.reelOrder : DEFAULTS.reelOrder,
    reelEnd: ['next', 'wait'].includes(raw.reelEnd) ? raw.reelEnd : DEFAULTS.reelEnd,
    // The player shows the whole film (Fit) unless Fill was chosen: the owner's films carry titles near the edges.
    playerFit: ['fit', 'fill'].includes(raw.playerFit) ? raw.playerFit : DEFAULTS.playerFit,
  };
}
export function readSettings(storage, key = SETTINGS_KEY) {
  let stored = null, legacy = null;
  try { stored = JSON.parse(storage.getItem(key)); } catch { /* broken JSON or blocked storage: defaults */ }
  try { legacy = storage.getItem(LEGACY_AUTOPLAY); } catch { /* blocked */ }
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) return normalize(stored);
  return normalize(legacy === null ? {} : { autoplay: legacy !== '0' });
}
export function writeSettings(storage, settings, key = SETTINGS_KEY) {
  try {
    storage.setItem(key, JSON.stringify(normalize(settings)));
    storage.removeItem(LEGACY_AUTOPLAY);
  } catch { /* The choice still holds for this visit when storage is blocked. */ }
}
// Switches one kind on or off. The last kind on stays on: a reel with nothing to play is not a choice.
export function toggleKind(kinds, kind) {
  if (!KINDS.includes(kind)) return kinds;
  if (kinds.includes(kind)) return kinds.length > 1 ? kinds.filter(item => item !== kind) : kinds;
  return KINDS.filter(item => item === kind || kinds.includes(item));
}
// How many titles each kind holds, for the counts next to the switches.
export const reelKinds = groups => Object.fromEntries(KINDS.map(kind => [kind, filterFilms(groups, KIND_FILTER[kind]).length]));
const pick = (groups, kinds) => groups.filter(group => kinds.some(kind => filterFilms([group], KIND_FILTER[kind]).length));
// The titles the Reels tab plays, in the chosen order. `groups` come newest first (groupFilms).
export function reelDeck(groups, settings, { random = Math.random, after = null } = {}) {
  const titles = pick(groups, settings.reelKinds);
  return settings.reelOrder === 'newest' ? titles : shuffleDeck(titles, { random, after });
}
// The round drawn when a reel nears its end: newest first starts again from the top, shuffle draws a new order
// that never opens with the film that just played.
export const nextRound = (groups, settings, after, options = {}) => reelDeck(groups, settings, { ...options, after });
