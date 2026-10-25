import { CinemaError, getCatalog, getPoster, getVideoURL, downloadVideo, forgetPosters, checkKey } from './api.js';
import { PRODUCTS, groupFilms, filterFilms, readProgress, saveProgress, continueFilms, resumeFrom, deviceLang, readList, saveList, inList, toggleList, listGroups, splitTitle, kindLabel } from './catalog.js';
import { MAX_WHOLE_BYTES, claimPreview, reduced, onReducedChange } from './motion.js';
import { startPreview } from './previews.js';
import { mountBillboard } from './billboard.js';
import { mountRows } from './rows.js';
import { mountFeed } from './feed.js';
import { createBob } from './bob.js';
import { openSheet, closeSheet, enableDrag } from './modal.js';
import { mountAmbient, paleness } from './ambient.js';
import { mountReel } from './reel.js';
import { mountPlayer } from './player.js';
import { watchViewport, diagnostics, ios, homeScreenApp } from './viewport.js';
import { KINDS, readSettings, writeSettings, toggleKind, reelKinds, reelDeck, nextRound } from './settings.js';
import { OWNER, REPO, NAME_MAX, TOKENS_PAGE, takeInvite, inviteFromText, readGuest, writeGuest, readInvites, addInvite, removeInvite, tokenPageURL, inviteLink, cleanName, isFineGrained } from './invite.js';

// An invite link carries a guest's key in the fragment (#invite=…). It is read and removed from the address first,
// before anything else runs; browsers never send a fragment to a server.
const arrival = takeInvite();
watchViewport(); // the player follows window changes (rotation, toolbars)
const main = document.querySelector('main');
const topbar = document.querySelector('#topbar');
const tabbar = document.querySelector('#tabbar');
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
let token = '';
try { if (!demo) token = localStorage.getItem('mkc.token') || ''; } catch { /* The connect form explains storage failures. */ }
let catalog, film, version, screen, revision = 0, operation = new AbortController();
let savedFile, mediaURL, posterURLs = new Map();
let activeFilter = 'All', query = '', searching = false, gridMode = false, detailOpener, detailOrigin;
let tab = 'home', exploreRow = null, rowFilms = new Map(), live = {}, listDirty = false, chromeKey = '', groupCache;
let storage;
try { storage = localStorage; } catch { /* Watching also works with storage blocked. */ }
const progressKey = demo ? 'mkc.demo.progress' : 'mkc.progress';
const listKey = demo ? 'mkc.demo.list' : 'mkc.list';
// A device that opened an invite: { name, left }. The guest's key is kept under mkc.token like the owner's.
let guest = demo ? null : readGuest(storage), pendingInvite = null;
const isGuest = () => Boolean(guest && !guest.left);
let listIds = readList(storage, listKey), prefs = readSettings(storage), listFrom = null, restore = null, reelResume = null;
const desktopQuery = matchMedia('(min-width: 900px)');
const filters = ['All', 'MK Voice', 'Business OS', 'Talent Atlas', 'Job Orbit', 'Suite & apps', 'More', 'Ads', 'Demos', 'Arabic'];
const TABS = [['home', 'Home'], ['new', 'New & Hot'], ['films', 'Films'], ['ads', 'Ads'], ['demos', 'Demos'], ['reels', 'Reels'], ['list', 'My List']];
const PHONE_TABS = [['home', 'Home', 'home'], ['new', 'New & Hot', 'flame'], ['reels', 'Reels', 'reels'], ['search', 'Search', 'search'], ['settings', 'Settings', 'settings']];
// Screens that live under the tab bars. Reels and Settings are tabs; a detail sheet opens over a library tab.
const TABBED = ['library', 'reel', 'settings', 'invite'];
const KIND_NAMES = { films: 'Films', ads: 'Ads', demos: 'Demos' };
const kindTabs = { films: ['Films', 'FILMS'], ads: ['Ads', 'ADS & LOOPS'], demos: ['Demos', 'DEMOS'] };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const kindName = kind => kind === 'phone' ? 'Phone' : 'Desktop';
const isNew = f => { const time = Date.parse(f.added); return time >= Date.now() - 7 * 86400000 && time <= Date.now(); };
const formatDate = value => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(Date.parse(value));
const motionOn = () => prefs.autoplay && !reduced();
const iconPaths = {
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  back: '<path d="m15 4-8 8 8 8"/>', play: '<path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>', phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10"/>',
  download: '<path d="M12 2v14m-6-6 6 6 6-6M3 17v5h18v-5"/>', check: '<path d="m4 12 5 5L20 6"/>',
  retry: '<path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  offline: '<path d="m3 3 18 18M2 9a16 16 0 0 1 18-2M6 13a10 10 0 0 1 9-2M10 17l2-1"/><circle cx="12" cy="21" r="1"/>',
  cloud: '<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-2M18 10a4 4 0 0 1 0 8h-7M3 22 22 2"/>',
  sound: '<path d="M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8M19 4a11 11 0 0 1 0 16"/>',
  expand: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>', collapse: '<path d="M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6"/>',
  fill: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/>', fit: '<path d="M4 14h6v6M20 10h-6V4M14 10l6-6M4 20l6-6"/>',
  back10: '<path d="M12 4.6a7.6 7.6 0 1 1-7.6 7.6"/><path d="M12.6 2 9.8 4.6l2.8 2.6"/><text x="12.3" y="15.4" font-size="7.4" font-weight="600" font-family="DM, sans-serif" text-anchor="middle" fill="currentColor" stroke="none">10</text>',
  fwd10: '<path d="M12 4.6a7.6 7.6 0 1 0 7.6 7.6"/><path d="M11.4 2l2.8 2.6-2.8 2.6"/><text x="11.7" y="15.4" font-size="7.4" font-weight="600" font-family="DM, sans-serif" text-anchor="middle" fill="currentColor" stroke="none">10</text>',
  airplay: '<path d="M6 17H4.5A2.5 2.5 0 0 1 2 14.5v-9A2.5 2.5 0 0 1 4.5 3h15A2.5 2.5 0 0 1 22 5.5v9a2.5 2.5 0 0 1-2.5 2.5H18"/><path d="m12 14 5 7H7Z" fill="currentColor" stroke="none"/>', arrow: '<path d="m9 5 7 7-7 7"/>', alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>',
  home: '<path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5h4v5"/>', flame: '<path d="M12 3c.4 3 3.2 4.6 4.4 7A6.5 6.5 0 1 1 5.6 14c0-1.9.8-3.4 2-4.5.3 1.3.9 2 1.9 2.4C9.4 8.7 10.2 5.4 12 3Z"/>',
  list: '<path d="M4 6h11M4 12h7M4 18h7M18 11v8m-4-4h8"/>', plus: '<path d="M12 5v14M5 12h14"/>', mute: '<path d="M3 9h4l5-5v16l-5-5H3ZM16 9l5 6m0-6-5 6"/>', chevron: '<path d="m6 9 6 6 6-6"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
  reels: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M3.5 8.5h17M8.5 3.5l2.6 5M14 3.5l2.6 5"/><path d="M10.4 12.2v4.6l4-2.3Z" fill="currentColor" stroke="none"/>',
  paste: '<path d="M9 4.5H7A2.5 2.5 0 0 0 4.5 7v12A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V7A2.5 2.5 0 0 0 17 4.5h-2"/><rect x="9" y="2.5" width="6" height="4" rx="1.5"/><path d="M8.5 12h7M8.5 16h4.5"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1"/>', copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  people: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><circle cx="17.2" cy="9.2" r="2.6"/><path d="M16.4 14.1A5 5 0 0 1 21.4 19"/>',
  ticket: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4Z"/><path d="M15 6v2m0 3v2m0 3v2"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 9-9M17 6l3 3M14.5 8.5l2 2"/>',
  shuffle: '<path d="M3 7h3.2c1.9 0 3.1.9 4.2 2.5l3.2 5c1.1 1.6 2.3 2.5 4.2 2.5H21M3 17h3.2c1.4 0 2.4-.5 3.3-1.4M14.3 8.4c.9-.9 1.9-1.4 3.3-1.4H21M18 4l3 3-3 3M18 14l3 3-3 3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || ''}</svg>`;
const title = (f, tag = 'h2', cls = '') => `<${tag} dir="auto" class="film-title ${cls}">${escape(splitTitle(f.title).name)}</${tag}>`;
// The brand line above a title: the part before "—", else the product, else the kind ("More films" says nothing).
const kicker = f => splitTitle(f.title).kicker || (f.product && f.product !== 'More films' ? f.product : kindLabel(f.kind));
const cuts = f => [...new Set(f.versions.map(v => v.kind))].map(kindName).join(' + ');
// Meta line under a title: NEW, length, kind, then whatever the title and product add ("More films" adds nothing).
function metaLine(f, { product = false } = {}) {
  const { kicker: brand, notes } = splitTitle(f.title);
  const items = [duration(f.seconds), kindLabel(f.kind), ...(product && f.product && f.product !== brand && f.product !== 'More films' ? [f.product] : []), ...(f.lang === 'ar' ? ['Arabic'] : []), ...notes];
  return `${isNew(f) ? '<span class="new-badge">NEW</span>' : ''}${items.map(item => `<span>${escape(item)}</span>`).join('')}`;
}
const badges = f => `<div class="badges">${f.versions.map(v => `<span class="badge">${icon(v.kind)}${kindName(v.kind)}</span>`).join('')}</div>`;
const poster = (f, cls = '', lazy = false) => `<img class="poster ${cls}" data-poster="${escape(f.id)}" alt="" width="640" height="800"${lazy ? ' loading="lazy"' : ''}>`;
const brand = '<span class="wordmark">MK <span>Cinema</span></span>';
// Guest screens with no key have no Settings: its Connection rows talk about tokens and lead to the connect form.
const plainHeader = `<header class="header"><div class="brand">${brand}</div></header>`;
function header(back = false) {
  return `<header class="header ${back ? 'compact' : ''}">${back ? `<button class="icon-button" data-action="back" aria-label="Back to film">${icon('back')}</button>` : ''}<div class="brand">${brand}</div>${!back ? `<div class="header-actions"><button class="icon-button settings-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div>` : ''}</header>`;
}
function groupsOf() {
  if (groupCache?.source !== catalog) {
    const groups = groupFilms(catalog.films, { lang: deviceLang() }); // a language pair shows the device's language
    groupCache = { source: catalog, groups, byId: new Map(groups.flatMap(group => group.variants.map(item => [item.id, item]))) };
  }
  return groupCache.groups;
}
const findFilm = id => { groupsOf(); return groupCache.byId.get(id); };
const titleIds = id => groupsOf().find(group => group.variants.some(item => item.id === id))?.variants.map(item => item.id) || [id];
// A title's cuts in the language it is shown in (a language pair counts as one title, not as two cuts).
const sameLang = f => f.variants.filter(v => v.lang === f.lang);
const announce = text => { document.querySelector('#announce').textContent = text; };

// Previews reuse the film stream the player gets from api.js. Short-lived links are cached for four minutes.
// Demo clips go through a blob, like the player does, because the page policy only allows GitHub and blob media.
const previewURLs = new Map(), wholeBlobs = new Map();
function revokeWhole(key) { URL.revokeObjectURL(wholeBlobs.get(key)); wholeBlobs.delete(key); }
function clearPreviews() { previewURLs.clear(); [...wholeBlobs.keys()].forEach(revokeWhole); }
function source(f, prefer = desktopQuery.matches ? 'desktop' : 'phone') {
  const cut = f.versions.find(item => item.kind === prefer) || f.versions[0];
  const getURL = async ({ signal, fresh, whole } = {}) => {
    if (whole) {
      if (wholeBlobs.has(cut.file)) return wholeBlobs.get(cut.file);
      const url = await getVideoURL(cut.file, { demo, token, signal });
      const made = URL.createObjectURL(new Blob([await downloadVideo(url, { signal })], { type: 'video/mp4' }));
      wholeBlobs.set(cut.file, made);
      while (wholeBlobs.size > 2) revokeWhole(wholeBlobs.keys().next().value);
      return made;
    }
    const hit = previewURLs.get(cut.file);
    if (!fresh && hit && Date.now() - hit.at < 240000) return hit.promise;
    // No abort signal here: the request is shared, so one caller leaving must not fail the others.
    const promise = (async () => {
      const url = await getVideoURL(cut.file, { demo, token });
      if (!demo) return url;
      const response = await fetch(url);
      if (!response.ok) throw new CinemaError('invalid');
      return URL.createObjectURL(await response.blob());
    })();
    previewURLs.set(cut.file, { at: Date.now(), promise });
    promise.catch(() => previewURLs.delete(cut.file));
    return promise;
  };
  return { getURL, canDownload: !demo && cut.bytes <= MAX_WHOLE_BYTES };
}

function toggleMyList(id) {
  const ids = titleIds(id);
  listIds = toggleList(listIds, ids);
  saveList(storage, listIds, listKey);
  const on = inList(listIds, ids);
  announce(on ? 'Added to My List' : 'Removed from My List');
  for (const button of document.querySelectorAll('[data-action="toggle-list"], [data-bob="list"]')) {
    if (!ids.includes(button.dataset.id || button.closest('.bob')?.dataset.film)) continue;
    const name = findFilm(button.dataset.id || button.closest('.bob').dataset.film)?.title || '';
    button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} My List: ${name}`);
    button.innerHTML = icon(on ? 'check' : 'plus');
    button.classList.remove('pop'); void button.offsetWidth; button.classList.add('pop');
  }
  if (tab === 'list' || (tab === 'home' && exploreRow === 'My List')) { if (screen === 'library') library(); else listDirty = true; }
  else if (tab === 'home' && screen === 'film') listDirty = true;
  else if (tab === 'home' && screen === 'library') whenBobClosed(refreshListRow);
  return on;
}
// The My List row on Home follows the list in place, so the page keeps its scroll, its billboard and its focus.
// From a hover card it waits until the card has closed: rows never move under the pointer.
let rowTimer = 0;
function whenBobClosed(task) {
  clearInterval(rowTimer);
  const stamp = revision, run = () => {
    if (stamp !== revision) clearInterval(rowTimer);
    else if (!document.querySelector('.bob')) { clearInterval(rowTimer); task(); }
  };
  rowTimer = setInterval(run, 200); run();
}
function refreshListRow() {
  const shelves = main.querySelector('.shelves');
  if (!shelves) return;
  const items = listGroups(groupsOf(), listIds), old = shelves.querySelector('.shelf[data-row="My List"]');
  const before = shelves.querySelector('.shelf[data-row="Continue watching"]'), html = shelf('My List', items, readProgress(storage, progressKey));
  // The row being watched stays where it is when My List appears, grows or goes above it: the first row in the
  // upper part of the screen is the anchor. At the very top the billboard stays and the rows below move instead.
  const anchor = scrollY > 0 && [...shelves.children].find(row => row !== old && row.getBoundingClientRect().bottom > topbar.getBoundingClientRect().bottom && row.getBoundingClientRect().top < innerHeight * 0.75);
  const top = anchor && anchor.getBoundingClientRect().top;
  if (old && html) old.outerHTML = html;
  else if (old) old.remove();
  else if (html && before) before.insertAdjacentHTML('afterend', html);
  else if (html) shelves.insertAdjacentHTML('afterbegin', html);
  rowFilms.set('My List', items);
  if (anchor) scrollBy(0, anchor.getBoundingClientRect().top - top);
  live.rows?.destroy(); live.rows = mountRows(main);
  void fillPosters(revision);
}
const listButton = (f, cls = '') => {
  const on = inList(listIds, titleIds(f.id));
  return `<button class="icon-button round list-toggle ${cls}" data-action="toggle-list" data-id="${escape(f.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} My List: ${escape(f.title)}">${icon(on ? 'check' : 'plus')}</button>`;
};

// The top bar (desktop) and the bottom tab bar (phone) live outside <main>, so they keep their state and
// focus while the content under them is swapped.
function chrome() {
  const show = Boolean(catalog) && (TABBED.includes(screen) || screen === 'film'), desktop = desktopQuery.matches;
  // On a phone the reel is the whole screen over the tab bar, TikTok style: no top bar over the film.
  topbar.hidden = !show || (screen === 'reel' && !desktop);
  document.body.classList.toggle('has-chrome', show);
  document.body.classList.toggle('on-reel', show && screen === 'reel');
  document.body.classList.toggle('on-player', screen === 'player');
  if (!show) { tabbar.hidden = true; return; }
  tabbar.hidden = desktop;
  if (chromeKey !== String(desktop)) {
    chromeKey = String(desktop);
    topbar.innerHTML = `<div class="topbar-row"><button class="brand brand-button" data-tab="home" aria-label="MK Cinema home">${brand}</button>${desktop ? `<nav class="tabs" aria-label="Sections">${TABS.map(([id, label]) => `<button class="tab" data-tab="${id}" data-nav="${id}">${label}</button>`).join('')}<i class="tab-ink" aria-hidden="true"></i></nav><div class="header-actions"><button class="icon-button" data-action="search" data-nav="search" aria-label="Search">${icon('search')}</button><button class="icon-button settings-button" data-tab="settings" data-nav="settings" aria-label="Settings">${icon('settings')}</button></div>` : ''}</div>`;
    tabbar.innerHTML = desktop ? '' : PHONE_TABS.map(([id, label, symbol]) => `<button data-nav="${id}" ${id === 'search' ? 'data-action="search"' : `data-tab="${id}"`}>${icon(symbol)}<span>${label}</span></button>`).join('');
  }
  // My List has no phone tab: opened from Settings, the Settings tab stays lit.
  // Invite someone is a page of Settings: the Settings tab (and gear) stays lit.
  const current = searching ? 'search' : (tab === 'list' && !desktop) || tab === 'invite' ? 'settings' : tab;
  for (const button of document.querySelectorAll('[data-nav]')) {
    if (button.dataset.nav === current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  placeInk();
  paintBar();
}
// The white pill under the open tab slides on a tab change. Its first placement, and the correction once the web
// font has landed and the tabs change width, are instant: the pill never grows out of the bar's left edge.
function placeInk(instant = false) {
  const on = topbar.querySelector('.tab[aria-current]'), ink = topbar.querySelector('.tab-ink');
  if (!ink) return;
  ink.classList.toggle('off', !on);
  if (!on || !on.offsetWidth) return;
  if (instant || !ink.style.getPropertyValue('--w')) ink.style.transition = 'none';
  ink.style.setProperty('--x', `${on.offsetLeft}px`); ink.style.setProperty('--w', `${on.offsetWidth}px`);
  if (ink.style.transition) { void ink.offsetWidth; ink.style.transition = ''; }
}
document.fonts?.addEventListener?.('loadingdone', () => placeInk(true));
// Transparent over the hero, solid #141414 after 80 px of scroll.
// Over the reel (desktop) the bar is always frosted ink: there is no hero under it.
function paintBar() { topbar.style.setProperty('--bar', screen === 'reel' ? '1' : Math.min(1, scrollY / 80).toFixed(3)); }
addEventListener('scroll', paintBar, { passive: true });
desktopQuery.addEventListener('change', () => { chromeKey = ''; chrome(); });

// Tab changes crossfade for 250 ms (the browser's default view transition) where supported.
function swap(render) {
  if (reduced()) { render(); return; }
  if (!document.startViewTransition) { // older Safari: fade the new page in instead
    render(); main.classList.add('tab-in'); setTimeout(() => main.classList.remove('tab-in'), 260); return;
  }
  document.startViewTransition(async () => {
    render();
    // Wait briefly for the posters, so the new page fades in with its pictures rather than its skeletons.
    const images = [...main.querySelectorAll('img.poster[src]')].slice(0, 16);
    await Promise.race([Promise.all(images.map(img => img.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 250))]);
  });
}
function go(next) {
  if (!catalog || !TABBED.includes(screen)) return;
  if (next === tab && !searching && !gridMode && !exploreRow && activeFilter === 'All' && !query && !listFrom) { scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
  tab = next; activeFilter = 'All'; query = ''; searching = false; gridMode = false; exploreRow = null; listFrom = null;
  // Reels draw at once, without the crossfade: the reel's video must start inside this tap, or an iPhone mutes it.
  if (next === 'reels') library(); else swap(library);
}

function stopLive() {
  // Leaving Reels keeps its place for this visit: the same films in the same order, and the time in the one on screen.
  if (live.reel) reelResume = { ...live.reel.meta, items: [...main.querySelectorAll('.reel-item')].map(item => ({ id: item.dataset.film, n: Number(item.dataset.n) })), ...live.reel.snapshot() };
  for (const item of Object.values(live)) (item.destroy || item.stop)?.call(item);
  live = {}; bob?.close();
}
function mount(next, html, { focus = true } = {}) {
  persistPlayback();
  stopLive();
  operation.abort(); operation = new AbortController(); revision++;
  main.querySelectorAll('video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
  if (mediaURL?.startsWith('blob:')) URL.revokeObjectURL(mediaURL);
  mediaURL = undefined;
  screen = next; main.className = `screen ${next}`; main.dataset.tab = TABBED.includes(next) ? tab : ''; main.innerHTML = html;
  chrome();
  if (focus) main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  void fillPosters(revision);
}
// A poster fades in over the skeleton shimmer once it has loaded. Under the copy of the billboard, New & Hot and the
// details, a pale poster also deepens the shade so the white type stays readable.
function markReady(img) {
  img.classList.add('is-ready'); img.parentElement.classList.add('is-ready');
  if (img.matches('.billboard-poster, .hot-poster, .detail-poster, .reel-poster')) img.parentElement.style.setProperty('--pale', (paleness(img) ?? 0).toFixed(2));
}
main.addEventListener('load', event => { if (event.target.matches?.('img.poster')) markReady(event.target); }, true);
async function fillPosters(stamp) {
  if (!catalog) return;
  const groups = new Map();
  for (const img of main.querySelectorAll('[data-poster]')) {
    const f = catalog.films.find(f => f.id === img.dataset.poster);
    if (f) { if (!groups.has(f.poster)) groups.set(f.poster, []); groups.get(f.poster).push(img); }
  }
  await Promise.all([...groups].map(async ([path, images]) => {
    const f = catalog.films.find(f => f.poster === path);
    if (!f) return;
    try {
      let url = posterURLs.get(f.poster);
      if (!url) {
        url = await getPoster(f.poster, { demo, token, updated: catalog.updated, signal: operation.signal });
        if (stamp !== revision) { URL.revokeObjectURL(url); return; }
        posterURLs.set(f.poster, url);
      }
      if (stamp === revision) images.forEach(img => { img.src = url; if (img.complete && img.naturalWidth) markReady(img); });
    } catch (error) {
      if (error.name !== 'AbortError' && stamp === revision) showError(error);
    }
  }));
}
function clearPosters() { for (const url of posterURLs.values()) URL.revokeObjectURL(url); posterURLs.clear(); }
function connect(error = '') {
  screen = 'connect'; restore = () => connect(error);
  mount('connect', `${header()}<section class="connect-content"><h1>Connect GitHub</h1><p>Open your private film library.<br>Paste a read-only token once.</p><form id="connect-form"><label for="token">GitHub token</label><input id="token" type="password" placeholder="Paste token" autocomplete="off" autocapitalize="none" spellcheck="false" required aria-describedby="token-help${error ? ' token-error' : ''}" ${error ? 'aria-invalid="true"' : ''}><p id="token-help" class="small">Stored only in this browser.</p>${error ? `<p class="error-copy" id="token-error" role="alert">${icon('alert')}<span>${escape(error)}<br><span class="muted">Paste a new token, then try again.</span></span></p>` : ''}<section class="token-help"><h2>How to make the token</h2><ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained token ${icon('arrow')}</a></li><li>Only select repositories:<br><strong>mk-cinema-library</strong></li><li>Contents: Read-only</li></ol></section><button class="primary" type="submit">${error ? 'Retry connection' : 'Connect'}</button></form>${homeScreenApp() && !token ? '<button class="text-button paste-back" data-action="paste-screen">I have an invite link</button>' : ''}</section>`);
}
function loading() {
  restore = () => void loadLibrary();
  // The loading skeleton is the home's own shape (billboard, then rows), so the library lands without a jump.
  mount('loading', `${header()}<div class="loading-home" aria-hidden="true"><div class="skeleton loading-hero"><div class="loading-copy"><i></i><i></i><i></i><b></b></div></div>${Array.from({ length: 2 }, () => `<div class="loading-row"><i></i><div>${'<span class="skeleton"></span>'.repeat(4)}</div></div>`).join('')}</div><p class="sr-only" role="status">Loading library…</p>`);
}
async function loadLibrary() {
  loading(); const stamp = revision;
  try {
    const result = await getCatalog({ demo, token, signal: operation.signal });
    if (stamp !== revision) return;
    if (catalog?.updated !== result.updated) clearPosters();
    catalog = result; library();
  } catch (error) { if (error.name !== 'AbortError' && stamp === revision) showError(error); }
}
function library() {
  savedFile = undefined; listDirty = false; // drawing the library shows My List as it is now
  if (!catalog?.films.length) { stateScreen('empty'); return; }
  if (tab === 'reels') { reelScreen(); return; }
  if (tab === 'settings') { settingsScreen(); return; }
  if (tab === 'invite') { inviteScreen(); return; }
  const all = groupsOf(), progress = readProgress(storage, progressKey);
  const filterScroll = main.querySelector('.filters')?.scrollLeft || 0;
  screen = 'library';
  mount('library', tab === 'new' ? feedView(all) : tab === 'list' ? listView(all, progress) : browseView(all, progress), { focus: false });
  const chips = main.querySelector('.filters'); if (chips) chips.scrollLeft = filterScroll;
  enhance();
}
// Starts the motion that belongs to the screen that was just drawn.
function enhance() {
  live.rows = mountRows(main);
  live.ambient = mountAmbient(main);
  const billboard = main.querySelector('.billboard');
  main.classList.toggle('has-billboard', Boolean(billboard));
  const featured = billboard && findFilm(billboard.dataset.film);
  if (featured) live.billboard = mountBillboard(billboard, { ...source(featured), enabled: motionOn, icon });
  if (main.querySelector('.hot-feed')) live.feed = mountFeed(main, { source: id => source(findFilm(id), 'desktop'), enabled: motionOn });
}
function browseView(all, progress) {
  const home = tab === 'home';
  const base = home ? all : filterFilms(all, kindTabs[tab][0]);
  const recent = base.filter(isNew);
  const rows = [
    ['Continue watching', continueFilms(base, progress)], ...(home ? [['My List', listGroups(all, listIds)]] : []), ['New this week', recent],
    ...PRODUCTS.map(product => [product, base.filter(f => f.variants.some(v => v.product === product))]),
    ...(home ? [['Ads & loops', filterFilms(base, 'Ads')], ['Demos', filterFilms(base, 'Demos')]] : []), ['Arabic', filterFilms(base, 'Arabic')],
  ];
  rowFilms = new Map(rows);
  const filtered = gridMode || activeFilter !== 'All' || query.trim() || exploreRow;
  const matches = exploreRow ? rowFilms.get(exploreRow) || [] : filterFilms(base, activeFilter, query);
  const heading = exploreRow || (query.trim() ? 'Search results' : activeFilter !== 'All' ? activeFilter : home ? 'All titles' : kindTabs[tab][0]);
  const chips = home ? `<nav class="filters" aria-label="Filter films">${filters.map(f => `<button class="filter-chip" data-filter="${f}" aria-pressed="${activeFilter === f}">${f}</button>`).join('')}</nav>` : '';
  const search = searching ? `<div class="search-bar"><label class="sr-only" for="film-search">Search films</label>${icon('search')}<input id="film-search" type="search" placeholder="Titles, products, and cuts" value="${escape(query)}" autocomplete="off"><button class="icon-button" data-action="close-search" aria-label="Close search">${icon('close')}</button></div>` : '';
  const featured = base[0];
  const body = filtered ? `<section class="results"><div class="results-head"><div><h1>${escape(heading)}</h1><p class="results-count" role="status">${matches.length} ${matches.length === 1 ? 'title' : 'titles'}</p></div><button class="text-button" data-action="clear-filter">Clear filters</button></div><div class="results-grid">${matches.map(f => card(f, progress)).join('')}</div>${!matches.length ? '<p class="no-results">No films match. Try another title or clear the filters.</p>' : ''}</section>`
    : !featured ? `<section class="results"><div class="empty-list"><div class="state-icon">${icon('list')}</div><h2>Nothing here yet</h2><p>Films of this kind will appear when they are added.</p><button class="secondary" data-tab="home">Browse everything</button></div></section>`
    : `<section class="billboard" aria-label="${home ? 'Newest film' : 'Featured film'}" data-film="${escape(featured.id)}" data-preview="poster">${poster(featured, 'billboard-poster')}<video class="billboard-video" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video><div class="billboard-shade"></div><div class="billboard-copy"><p class="eyebrow" dir="auto">${escape(kicker(featured))}</p>${title(featured, 'h1')}<p class="hero-meta">${metaLine(featured)}<span class="meta-cuts">${cuts(featured)}</span></p><div class="blurb-wrap"><p class="blurb">${escape(featured.blurb)}</p></div><div class="billboard-actions"><button class="primary" data-action="hero-play" data-id="${escape(featured.id)}">${icon('play')}Play</button><button class="secondary" data-action="hero-info" data-id="${escape(featured.id)}">${icon('info')}More info</button></div></div><button class="icon-button billboard-tool" data-action="billboard-tool" aria-label="Unmute" hidden>${icon('mute')}</button></section><div class="shelves">${rows.map(([name, films]) => shelf(name, films, progress)).join('')}</div>`;
  return `${chips}${search}${body}<footer>${all.length} titles${demo ? ' · Demo collection' : ' · Your private collection'}</footer>`;
}
// Reels: the cinema as a reel, one film a screen (reel.js), with the titles, order, sound and end the owner chose
// in Settings. The reel's one video is started inside the tap that opened the tab, so an iPhone lets it play with
// sound from then on. Coming back within the visit finds the same films, on the same one, at the same time.
// The screen's cut: a phone plays 9:16 and a desktop 16:9; titles with that cut come first in the reel.
const reelShape = () => desktopQuery.matches ? 'desktop' : 'phone';
const reelKey = () => JSON.stringify([prefs.reelKinds, prefs.reelOrder, prefs.reelSound, reelShape()]);
function reelScreen() {
  const all = groupsOf(), byId = new Map(all.map(group => [group.id, group]));
  const saved = reelResume?.catalog === catalog && reelResume.key === reelKey() ? reelResume : null;
  reelResume = null;
  const entries = saved ? saved.items.map(item => ({ f: byId.get(item.id), n: item.n })).filter(item => item.f) : reelDeck(all, prefs, { prefer: reelShape() }).map((f, index) => ({ f, n: index + 1 }));
  const total = saved ? saved.total : entries.length;
  if (!entries.length) { mount('reel', reelEmpty(), { focus: false }); return; }
  const at = saved && entries[saved.index] ? saved.index : 0;
  mount('reel', reelView(entries, total, at), { focus: false });
  main.querySelector('.reel-video').play().catch(() => {}); // inside the tab tap: an iPhone keeps the sound after this
  const rail = () => main.querySelector('.reel-rail .list-toggle');
  live.reel = mountReel(main, {
    source: (id, shape) => source(findFilm(id), shape), icon, say: announce, onError: showError,
    sound: saved ? saved.sound : prefs.reelSound, advance: () => prefs.reelEnd === 'next',
    resume: saved && at === saved.index ? { index: at, time: saved.time } : null,
    onActive: item => {
      const f = findFilm(item.dataset.film), on = inList(listIds, titleIds(f.id)), button = rail();
      button.dataset.id = f.id; button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} My List: ${f.title}`); button.innerHTML = icon(on ? 'check' : 'plus');
      announce(`${splitTitle(f.title).name}, ${item.dataset.n} of ${total}`);
    },
    more: () => {
      const track = main.querySelector('.reel-track'), last = byId.get(track.lastElementChild.dataset.film);
      track.insertAdjacentHTML('beforeend', reelItems(nextRound(all, prefs, last, { prefer: reelShape() }).map((f, index) => ({ f, n: index + 1 })), -1));
      void fillPosters(revision);
      return true;
    },
  });
  live.reel.meta = { catalog, key: reelKey(), total };
}
// Posters load for the film on screen and its neighbours first; the rest wait until they come near.
function reelItems(entries, at = 0) {
  const prefer = reelShape();
  return entries.map(({ f, n }, index) => {
    const cut = f.versions.find(v => v.kind === prefer) || f.versions[0], lazy = at < 0 || Math.abs(index - at) > 1;
    return `<article class="reel-item" aria-hidden="true" data-film="${escape(f.id)}" data-shape="${cut.kind}" data-n="${n}" aria-label="${escape(f.title)}"><div class="reel-stage">${poster(f, 'reel-fill', lazy)}${poster(f, 'reel-poster', lazy)}<div class="reel-shade"></div><i class="reel-progress" aria-hidden="true"></i></div><div class="reel-copy"><p class="kicker" dir="auto">${escape(kicker(f))}</p>${title(f, 'h2', 'reel-title')}<p class="reel-meta">${metaLine(f)}</p><p class="blurb" dir="auto">${escape(f.blurb)}</p></div></article>`;
  }).join('');
}
function reelView(entries, total, at) {
  const order = prefs.reelOrder === 'shuffle' ? ['shuffle', 'Shuffled'] : ['reels', 'Newest first'];
  return `<section class="reel" aria-label="Reels" data-total="${total}"><video class="reel-video" playsinline preload="auto" aria-hidden="true" tabindex="-1"></video><div class="reel-top"><p class="reel-count" title="${order[1]}" aria-hidden="true">${icon(order[0])}<b>${entries[at].n} / ${total}</b></p></div><div class="reel-track" tabindex="0" aria-label="Films. Arrow keys move, Space pauses, M mutes.">${reelItems(entries, at)}</div><div class="reel-rail"><button class="icon-button round reel-step" data-reel="prev" aria-label="Previous film">${icon('chevron')}</button><button class="icon-button round reel-step" data-reel="next" aria-label="Next film">${icon('chevron')}</button>${listButton(entries[at].f, 'reel-list')}<span class="reel-sound"><span class="reel-hint" aria-hidden="true">Tap for sound</span><button class="icon-button round" data-reel="sound" aria-label="Mute">${icon('sound')}</button></span><button class="icon-button round" data-reel="fullscreen" aria-label="Full screen">${icon('expand')}</button></div><span class="reel-pause" aria-hidden="true">${icon('play')}</span><p class="reel-note" role="status"></p></section>`;
}
// Settings can leave Reels with nothing to play (say, only Demos, and there are none yet): a calm way back.
function reelEmpty() {
  const kinds = prefs.reelKinds.map(kind => KIND_NAMES[kind]).join(', ').replace(/, ([^,]*)$/, ' or $1');
  return `<section class="reel reel-empty" aria-label="Reels"><div class="empty-list"><div class="state-icon">${icon('reels')}</div><h1>Nothing to play here yet</h1><p>There are no ${escape(kinds.toLowerCase())} in your cinema.<br>Choose other titles for Reels in Settings.</p><div class="empty-actions"><button class="primary" data-tab="settings">${icon('settings')}Open Settings</button><button class="secondary" data-tab="home">Browse everything</button></div></div></section>`;
}

// Settings: short rows in frosted groups. Every control changes what the app does, at once or the next time
// Reels opens; the choices live in one key (settings.js).
const plural = (n, word = 'title') => `${n} ${n === 1 ? word : `${word}s`}`;
const switchRow = (id, name, on, note = '') => `<label class="set-row" for="${id}"><span class="set-text"><span class="set-name" id="${id}-name">${name}</span>${note ? `<small class="set-note" id="${id}-note">${note}</small>` : ''}</span><span class="switch"><input type="checkbox" id="${id}" role="switch" aria-labelledby="${id}-name"${on ? ' checked' : ''}${note ? ` aria-describedby="${id}-note"` : ''}></span></label>`;
const choiceRow = (name, label, options, value, note = '') => `<div class="set-row set-stack" role="radiogroup" aria-labelledby="${name}-label" aria-describedby="${name}-note"><span class="set-name" id="${name}-label">${label}</span><div class="segmented">${options.map(([key, text]) => `<label><input type="radio" name="${name}" value="${key}"${key === value ? ' checked' : ''}><span>${text}</span></label>`).join('')}</div><small class="set-note" id="${name}-note"${note ? '' : ' hidden'}>${note}</small></div>`;
const kindChip = (kind, count) => { const on = prefs.reelKinds.includes(kind); return `<button class="set-chip" data-reel-kind="${kind}" aria-pressed="${on}" aria-label="${KIND_NAMES[kind]}${count === undefined ? '' : `, ${plural(count)}`}">${icon(on ? 'check' : 'plus')}<span>${KIND_NAMES[kind]}</span>${count === undefined ? '' : `<small aria-hidden="true">${count}</small>`}</button>`; };
function settingsView({ solo = false } = {}) {
  const all = catalog ? groupsOf() : [], counts = catalog ? reelKinds(all) : {}, saved = catalog ? listGroups(all, listIds).length : 0;
  const group = (id, label, rows) => `<section class="set-group" aria-labelledby="set-${id}"><h2 class="set-label" id="set-${id}">${label}</h2><div class="set-card">${rows}</div></section>`;
  const tokenState = demo ? 'Demo, no token used' : token ? 'Saved in this browser' : 'Not connected';
  return `<section class="settings-page" aria-labelledby="settings-title"><div class="settings-head">${solo ? `<button class="icon-button" data-action="settings-back" aria-label="Back">${icon('back')}</button>` : ''}<h1 id="settings-title">Settings</h1></div>
${group('playback', 'Playback', `${switchRow('autoplay-toggle', 'Autoplay previews', prefs.autoplay && !reduced(), 'Muted previews on the home, on cards and in More info.')}${choiceRow('player-fit', 'Picture in the player', [['fit', 'Fit'], ['fill', 'Fill']], prefs.playerFit, 'Fit shows the whole film. Fill covers the screen and can trim its edges. A pinch in the player switches too.')}<div class="set-row"><span class="set-name">Language</span><span class="set-value">${deviceLang() === 'ar' ? 'Arabic' : 'English'} (from your ${desktopQuery.matches ? 'browser' : 'phone'})</span></div>`)}
${group('reels', 'Reels', `${switchRow('reel-sound', 'Start with sound', prefs.reelSound)}<div class="set-row set-stack"><span class="set-name" id="kinds-label">Which titles</span><div class="set-chips" role="group" aria-labelledby="kinds-label">${KINDS.map(kind => kindChip(kind, counts[kind])).join('')}</div></div>${choiceRow('reel-order', 'Order', [['shuffle', 'Shuffle'], ['newest', 'Newest first']], prefs.reelOrder, 'Titles with your screen’s version come first.')}${choiceRow('reel-end', 'When a film ends', [['next', 'Play the next'], ['wait', 'Wait']], prefs.reelEnd)}`)}
${catalog ? group('list', 'My List', `<button class="set-row set-link" data-action="open-list"><span class="set-name">Open My List</span><span class="set-value">${plural(saved)}</span>${icon('arrow')}</button>`) : ''}
${isGuest() ? group('sharing', 'Sharing', `<div class="set-row"><span class="set-name">Shared by</span><span class="set-value">${OWNER}</span></div><div class="set-row"><span class="set-name">Invite for</span><span class="set-value" dir="auto">${escape(guest.name)}</span></div><button class="set-row set-link set-danger" data-action="leave" aria-describedby="leave-note"><span class="set-name">Leave</span></button><p class="set-foot" id="leave-note">Forgets this invite on this device. ${OWNER}'s cinema stays as it is.</p><p class="set-foot set-status" id="settings-status" role="status"></p>`) : `${!demo && token ? group('invites', 'Invites', invitesRows()) : ''}
${group('connection', 'Connection', `<div class="set-row"><span class="set-name">Token</span><span class="set-value">${tokenState}</span></div><button class="set-row set-link set-danger" id="forget-token" data-action="forget-token" aria-describedby="forget-note"><span class="set-name">Forget token</span></button><p class="set-foot" id="forget-note">Removes the token and cached posters, then goes back to Connect.</p><p class="set-foot set-status" id="settings-status" role="status"></p>`)}`}
${group('about', 'About', `${catalog ? `<div class="set-row"><span class="set-name">Titles</span><span class="set-value">${all.length}</span></div>` : ''}${catalog?.skipped && !isGuest() ? `<div class="set-row set-stack"><span class="set-name">Left out</span><small class="set-note">${plural(catalog.skipped)} in cinema.json could not be read.</small></div>` : ''}<div class="set-row"><span class="set-name">Collection</span><span class="set-value">${demo ? 'Demo' : isGuest() ? `Shared by ${OWNER}` : 'Private'}</span></div><div class="set-row"><span class="set-name">App shell</span><span class="set-value" id="shell-version">Checking…</span></div><p class="set-foot" id="screen-info"></p>`)}
</section>`;
}
function settingsScreen({ solo = false } = {}) {
  mount(solo ? 'settings-solo' : 'settings', settingsView({ solo }), { focus: solo });
  syncAutoplay();
  main.querySelector('#screen-info').textContent = diagnostics();
  void showShell(revision);
}
// The app shell version is the service worker cache this browser holds (sw.js), read from Cache Storage.
async function showShell(stamp) {
  let text = 'Not saved for offline';
  try { const name = (await caches.keys()).find(key => key.startsWith('mkc-shell-')); if (name) text = `${name.slice(10)} · saved for offline`; } catch { /* no Cache Storage here */ }
  if (stamp === revision) main.querySelector('#shell-version')?.replaceChildren(text);
}
function saveSettings() { writeSettings(storage, prefs); }

// Invites (owner): one read-only key per person, made on GitHub's pre-filled page, checked here, then shared as a link
// with the key in its fragment. The list on this device keeps only each key's last four characters, never a key.
function invitesRows() {
  const now = Date.now();
  const rows = readInvites(storage).map(item => {
    const ended = Date.parse(item.expires) <= now, id = escape(item.id), name = escape(item.name);
    const when = `Made ${formatDate(item.made)} · ${ended ? 'ended' : 'ends'} ${item.expiresKnown ? '' : 'about '}${formatDate(item.expires)}`;
    return `<div class="set-row set-stack invite-item" data-invite="${id}"><div class="invite-line"><span class="set-name" dir="auto">${name}</span><span class="set-value invite-key" aria-label="Key ending ${escape(item.last4.split('').join(' '))}">${icon('key')}…${escape(item.last4)}</span></div><small class="set-note">${when}</small><div class="invite-actions"><a class="set-pill" href="${TOKENS_PAGE}" target="_blank" rel="noopener noreferrer" data-stop="${id}" aria-describedby="stop-${id}">Stop access</a><button class="set-pill" data-action="remove-invite" data-id="${id}" aria-label="Remove ${name} from the list">Remove from list</button></div><p class="invite-stop-note" id="stop-${id}" hidden>On GitHub, open “MK Cinema – ${name}” and press Delete. ${name}'s link stops working at once.</p></div>`;
  }).join('');
  return `<button class="set-row set-link" data-action="open-invite"><span class="set-text"><span class="set-name">Invite someone</span><small class="set-note">A link for family or friends, with a key of their own.</small></span>${icon('arrow')}</button>${rows}`;
}
let invite = null; // the link just made: { name, link }. Memory only, gone when the page closes.
const KEY_ERRORS = {
  token: 'GitHub refused this key. Copy it again, or make a new one in step 2.',
  access: `This key can't see ${REPO}. On GitHub, set Repository access to Only select repositories, then ${REPO}.`,
  write: 'This key can change files. Delete it on GitHub and make one with Contents: Read-only.',
  'rate-limit': 'GitHub needs a pause. Try again in a few minutes.',
  offline: 'You are offline. Connect, then try again.',
  'github-unreachable': 'GitHub could not be reached. Try again in a moment.',
  invalid: `The key works, but ${REPO} has no readable cinema.json.`,
};
function inviteView() {
  return `<section class="settings-page invite-page" aria-labelledby="invite-title"><div class="settings-head"><button class="icon-button" data-action="back-settings" aria-label="Back to Settings">${icon('back')}</button><h1 id="invite-title" tabindex="-1">Invite someone</h1></div>
<div class="invite-flow"><p class="invite-lead">Each person gets a key of their own, so you can stop one without touching the others. Their link works even when your PC is off.</p>
<section class="set-group" aria-labelledby="step-1"><h2 class="set-label invite-step" id="step-1"><b>1</b><span>Who is it for?</span></h2><div class="set-card"><div class="set-row set-stack"><label class="set-name" for="invite-name">Their name</label><input class="field" id="invite-name" type="text" maxlength="${NAME_MAX}" placeholder="Mom" autocomplete="off" enterkeyhint="done" dir="auto"></div></div></section>
<section class="set-group" aria-labelledby="step-2"><h2 class="set-label invite-step" id="step-2"><b>2</b><span>Make <span data-who>their</span> key on GitHub</span></h2><div class="set-card"><div class="set-row set-stack"><a class="primary invite-github" id="invite-github" target="_blank" rel="noopener noreferrer" aria-disabled="true" aria-describedby="invite-how">${icon('key')}<span data-github-label>Type a name first</span></a><ol class="invite-how" id="invite-how"><li><span>The name, 90 days and <strong>Contents: Read-only</strong> are filled in for you.</span></li><li><span>Under Repository access, choose <strong>Only select repositories</strong>, then <strong>${REPO}</strong>.</span></li><li><span>Press <strong>Generate token</strong> and copy it.</span></li></ol></div></div></section>
<section class="set-group" aria-labelledby="step-3"><h2 class="set-label invite-step" id="step-3"><b>3</b><span>Paste the new key</span></h2><div class="set-card"><form class="set-row set-stack" id="invite-form" novalidate><label class="sr-only" for="invite-token">New key from GitHub</label><input class="field" id="invite-token" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="invite-status"><button class="primary" type="submit">${icon('check')}Check key and make the link</button><p class="invite-status" id="invite-status" role="status"></p></form></div></section></div>
<section class="invite-ready" id="invite-ready" aria-labelledby="ready-title" hidden></section></section>`;
}
function inviteScreen() {
  invite = null;
  mount('invite', inviteView(), { focus: false });
  live.invite = { destroy() { invite = null; } };
  syncInviteName();
}
function syncInviteName() {
  const name = cleanName(main.querySelector('#invite-name')?.value), link = main.querySelector('#invite-github');
  if (!link) return;
  if (name) { link.href = tokenPageURL(name); link.removeAttribute('aria-disabled'); }
  else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
  link.querySelector('[data-github-label]').textContent = name ? `Make ${name}'s key on GitHub` : 'Type a name first';
  main.querySelector('[data-who]').textContent = name ? `${name}'s` : 'their';
}
async function makeInvite() {
  const nameInput = main.querySelector('#invite-name'), keyInput = main.querySelector('#invite-token');
  const status = main.querySelector('#invite-status'), button = main.querySelector('#invite-form [type=submit]');
  const name = cleanName(nameInput.value), key = keyInput.value.trim();
  [nameInput, keyInput].forEach(el => el.removeAttribute('aria-invalid')); delete status.dataset.tone;
  const fail = (text, field = keyInput) => { status.textContent = text; status.dataset.tone = 'error'; field.setAttribute('aria-invalid', 'true'); field.focus(); };
  if (!name) return fail('Type their name first (step 1).', nameInput);
  if (!key) return fail(`Paste the key GitHub made for ${name}.`);
  // The owner's own key never goes into a link: each person gets a separate one.
  if (key === token) return fail(`This is your own key. Make a new one for ${name} in step 2.`);
  if (!isFineGrained(key)) return fail(/^gh[a-z]_/u.test(key) ? 'This is a classic key, which can open all your repositories. Make a fine-grained key in step 2.' : "This doesn't look like a GitHub key. Copy it again from GitHub.");
  const stamp = revision;
  button.disabled = true; status.textContent = 'Checking the key with GitHub…';
  try {
    const result = await checkKey(key, { signal: operation.signal });
    if (stamp !== revision) return;
    invite = { name, link: inviteLink(location.href, { name, token: key }) };
    addInvite(storage, { name, token: key, expires: result.expires });
    keyInput.value = '';
    showReady(name, result.expires);
  } catch (error) {
    if (error.name === 'AbortError' || stamp !== revision) return;
    button.disabled = false;
    fail(KEY_ERRORS[error.code] || KEY_ERRORS.invalid);
  }
}
function showReady(name, expires) {
  const share = typeof navigator.share === 'function', app = new URL('./', location.href), who = escape(name);
  const until = `${expires ? '' : 'about '}${formatDate(expires || new Date(Date.now() + 90 * 86400000).toISOString())}`;
  main.querySelector('.invite-flow').hidden = true;
  const ready = main.querySelector('#invite-ready');
  ready.innerHTML = `<div class="invite-ticket"><div class="success-icon">${icon('check')}</div><h2 id="ready-title" dir="auto" tabindex="-1">${who}'s link is ready</h2><p>Anyone with this link can watch, so send it to ${who} only. It works until ${until}.</p><p class="invite-url" aria-hidden="true">${escape(app.host + app.pathname)}<span>#invite=••••••••</span></p></div><div class="invite-share">${share ? `<button class="primary" data-action="share-invite">${icon('share')}Share link</button>` : ''}<button class="${share ? 'secondary' : 'primary'}" data-action="copy-invite">${icon('copy')}Copy link</button></div><p class="invite-status" id="share-status" role="status"></p><p class="invite-warn">${icon('alert')}<span>Apps can't read a key's permissions. If you changed anything on GitHub, check that this key says Contents: Read-only.</span></p><div class="invite-after"><button class="text-button" data-action="invite-another">Invite someone else</button><button class="text-button" data-action="back-settings">Done</button></div>`;
  ready.hidden = false;
  window.scrollTo(0, 0);
  ready.querySelector('h2').focus({ preventScroll: true });
}
// Share opens the phone's share sheet; where there is none, or it fails, the link is copied instead.
async function shareInvite() {
  if (!invite) return;
  const status = main.querySelector('#share-status');
  try {
    await navigator.share({ title: 'MK Cinema', text: `${OWNER} shared his cinema with you.`, url: invite.link });
    status.textContent = `Sent. ${invite.name} can open it on any phone or computer.`;
  } catch (error) {
    if (error?.name === 'AbortError') { status.textContent = 'Not sent yet. Share or copy it when you are ready.'; return; }
    await copyInvite();
  }
}
async function copyInvite() {
  if (!invite) return;
  const status = main.querySelector('#share-status');
  let done = false;
  try { await navigator.clipboard.writeText(invite.link); done = true; } catch {
    const area = document.createElement('textarea');
    area.value = invite.link; area.readOnly = true; area.className = 'sr-only'; document.body.append(area); area.select();
    try { done = document.execCommand('copy'); } catch { /* no clipboard at all */ }
    area.remove();
  }
  status.textContent = done ? `Copied. Paste it in a message to ${invite.name}.` : 'This browser could not copy. Try Share, or another browser.';
}

// Guests: a device that opened an invite. No connect form and no GitHub words; an ended key gets a calm screen.
const GUEST_SCREENS = {
  'invite-ended': ['ticket', 'This invite has ended', `Ask ${OWNER} for a new link.`],
  'invite-bad': ['alert', 'This invite link is incomplete', `Ask ${OWNER} to send it again,<br>then open the whole link.`],
  'invite-left': ['home', `You left ${OWNER}'s cinema`, 'To come back, open his invite link again.'],
};
function guestScreen(kind) {
  const [symbol, heading, copy] = GUEST_SCREENS[kind];
  // On an iPhone a tapped link opens Safari, not the home-screen app, so there the way back is a paste.
  const pasteBack = kind === 'invite-left' && homeScreenApp();
  const actions = kind === 'invite-ended' ? `<button class="primary" data-action="retry">${icon('retry')}Try again</button><button class="text-button" data-action="leave">Forget this invite</button>`
    : kind === 'invite-bad' && token ? `<button class="primary" data-action="retry">${icon('play')}Open the cinema</button>`
    : pasteBack ? `<button class="primary" data-action="paste-screen">${icon('paste')}Paste his invite link</button>` : '';
  screen = kind; restore = () => guestScreen(kind);
  mount(kind, `${token ? header() : plainHeader}<section class="recovery guest-state"><div class="recovery-copy"><div class="state-icon">${icon(symbol)}</div><h1>${heading}</h1><p>${pasteBack ? 'To come back, paste his invite link.' : copy}</p></div>${actions ? `<div class="guest-actions">${actions}</div>` : ''}</section>`);
}
// An iPhone's home-screen app keeps a storage of its own (WebKit bug 181849) and opens the app's start address, so the
// key a guest saved in Safari is not there. With no key, a home-screen app asks for the invite link, once, and opens it
// on the same path as a tapped link. No GitHub words: the owner's own phone has one quiet way to his connect screen,
// which leads back here.
function pasteScreen() {
  screen = 'invite-paste'; restore = pasteScreen;
  mount('invite-paste', `${plainHeader}<section class="recovery guest-state"><div class="recovery-copy"><div class="state-icon">${icon('ticket')}</div><h1>Paste your invite link</h1><p>Copy the link ${OWNER} sent you,<br>then paste it here once.</p></div><div class="guest-actions"><button class="primary" data-action="paste-invite">${icon('paste')}Paste invite link</button><form class="paste-form" id="paste-form" novalidate><label for="invite-paste">Or paste it in this box</label><input class="field" id="invite-paste" type="text" inputmode="url" placeholder="https://…" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="go" aria-describedby="paste-status"><p class="invite-status" id="paste-status" role="status"></p><button class="secondary" type="submit">Open invite</button></form><button class="text-button" data-action="connect">I'm ${OWNER}</button></div></section>`);
}
// The paste button reads the clipboard inside the tap (iPhone shows its Paste bubble); a refusal hands over to the box.
async function pasteInvite() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* no clipboard, or the person said no */ }
  await openPasted(text);
}
async function openPasted(text) {
  const found = inviteFromText(text, location.href);
  if (found?.token) { await openInvite(found); return; }
  const field = main.querySelector('#invite-paste'), status = main.querySelector('#paste-status');
  if (!field) return;
  const empty = !String(text ?? '').trim();
  status.textContent = empty ? 'Tap the box, then choose Paste.' : found?.other ? `That link is for another app. Paste the MK Cinema link ${OWNER} sent you.`
    : found?.bad ? 'This invite link is incomplete. Copy the whole link, then paste it again.' : `That isn't an invite link. Copy the whole link ${OWNER} sent you, then paste it again.`;
  if (empty) { delete status.dataset.tone; field.removeAttribute('aria-invalid'); } else { status.dataset.tone = 'error'; field.setAttribute('aria-invalid', 'true'); }
  field.focus();
}
// A whole link pasted into the box opens at once; anything else waits for Open invite.
function pasteTyped(field) {
  const status = main.querySelector('#paste-status');
  field.removeAttribute('aria-invalid'); status.textContent = ''; delete status.dataset.tone;
  const found = inviteFromText(field.value, location.href);
  if (found?.token) void openInvite(found);
}
function inviteOwnerChoice(arrived) {
  pendingInvite = arrived; screen = 'invite-owner'; restore = () => inviteOwnerChoice(arrived);
  const name = escape(arrived.name);
  mount('invite-owner', `${header()}<section class="recovery guest-state"><div class="recovery-copy"><div class="state-icon">${icon('people')}</div><h1>This device already opens your cinema</h1><p>This link is ${name}'s invite. Keep your own key, or switch this device to ${name}'s.<br><span class="muted">Switching forgets your key here.</span></p></div><div class="guest-actions"><button class="primary" data-action="keep-key">Keep my key</button><button class="secondary" data-action="switch-invite"><span dir="auto">Switch to ${name}'s invite</span></button></div></section>`);
}
async function openInvite(arrived) {
  if (arrived.bad) { guestScreen('invite-bad'); return; }
  if (isGuest() && token === arrived.token) { await loadLibrary(); return; } // the same link, opened again
  if (token && !isGuest()) { inviteOwnerChoice(arrived); return; }
  await acceptInvite(arrived);
}
async function acceptInvite(arrived) {
  pendingInvite = null;
  if (token && token !== arrived.token) { operation.abort(); await forgetPosters(); clearPosters(); clearPreviews(); catalog = undefined; reelResume = null; }
  token = arrived.token;
  try { localStorage.setItem('mkc.token', token); } catch { /* blocked storage: the invite holds for this visit */ }
  guest = { name: arrived.name, left: false }; writeGuest(storage, guest);
  tab = 'home'; listFrom = null;
  welcome();
}
// The welcome loads the cinema behind it, so Start watching opens at once and an ended key shows its screen.
// An iPhone's home-screen app would not have the key (see pasteScreen), so there the tip is to keep the link.
let welcomeLoad;
function welcome() {
  restore = welcome;
  mount('welcome', `<section class="welcome" aria-labelledby="welcome-title"><div class="welcome-glow" aria-hidden="true"></div><p class="welcome-brand">${brand}</p><div class="welcome-fan" aria-hidden="true">${[0, 1, 2].map(() => '<figure class="welcome-card"></figure>').join('')}</div><div class="welcome-copy"><p class="kicker">An invite from ${OWNER}</p><h1 id="welcome-title" dir="auto">Hi ${escape(guest.name)}</h1><p class="welcome-line">${OWNER} shared his cinema with you.</p><p class="welcome-sub">His films, on this screen, whenever you like.</p></div><div class="welcome-actions"><button class="primary" data-action="enter">${icon('play')}Start watching</button><p class="welcome-tip">${ios() || homeScreenApp() ? 'Keep this link: tap it any time to watch.' : 'Add it to your home screen to come back in one tap.'}</p></div></section>`);
  const stamp = revision;
  welcomeLoad = getCatalog({ demo, token, signal: operation.signal });
  welcomeLoad.then(result => {
    if (stamp !== revision) return;
    if (catalog?.updated !== result.updated) clearPosters();
    catalog = result;
    const picks = groupsOf().slice(0, 3);
    main.querySelectorAll('.welcome-card').forEach((card, index) => { if (picks[index]) card.innerHTML = poster(picks[index]); else card.remove(); });
    void fillPosters(stamp);
  }, error => { if (error.name !== 'AbortError' && stamp === revision) showError(error); });
}
async function enter() {
  const stamp = revision;
  main.querySelector('[data-action="enter"]').disabled = true;
  try { await welcomeLoad; } catch { return; }
  if (stamp === revision) library();
}
async function leave() {
  try {
    operation.abort();
    try { localStorage.removeItem('mkc.token'); } catch { /* nothing stored */ }
    token = ''; guest = { name: guest?.name || 'Guest', left: true }; writeGuest(storage, guest);
    await forgetPosters(); clearPosters(); clearPreviews(); catalog = undefined; film = undefined; savedFile = undefined;
    reelResume = null; tab = 'home'; listFrom = null;
    guestScreen('invite-left');
  } catch { const status = main.querySelector('#settings-status'); if (status) status.textContent = 'Could not clear browser storage. Try again.'; }
}
function feedView(all) {
  const shown = all.slice(0, 24); // newest first; a long library does not become an endless feed
  const item = f => `<article class="hot-item" data-film="${escape(f.id)}" aria-label="${escape(f.title)}"><div class="hot-stage">${poster(f, 'hot-poster')}<video class="hot-video" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video><div class="hot-shade"></div><i class="hot-bar" aria-hidden="true"></i></div><div class="hot-copy"><p class="hot-date">${isNew(f) ? '<span class="new-badge">NEW</span>' : ''}${Date.parse(f.added) ? `<time datetime="${escape(f.added)}">${formatDate(f.added)}</time>` : 'Date unavailable'}</p><p class="kicker" dir="auto">${escape(kicker(f))}</p>${title(f, 'h2', 'hot-name')}<p class="blurb">${escape(f.blurb)}</p><div class="hot-actions"><button class="primary hot-play" data-play-film="${escape(f.id)}" aria-label="Play ${escape(f.title)}">${icon('play')}Play</button>${listButton(f)}<button class="icon-button round" data-film="${escape(f.id)}" aria-label="More info: ${escape(f.title)}">${icon('info')}</button></div></div></article>`;
  return `<section class="hot" aria-label="New and Hot"><h1 class="hot-title">New &amp; Hot</h1><div class="hot-feed">${shown.map(item).join('')}</div><div class="hot-rail" aria-hidden="true">${shown.length <= 10 ? shown.map(() => '<i></i>').join('') : ''}<b class="hot-rail-count"></b></div></section><footer>${all.length} titles${demo ? ' · Demo collection' : ' · Your private collection'}</footer>`;
}
function listView(all, progress) {
  const items = listGroups(all, listIds);
  return `<section class="results list-view" aria-label="My List"><div class="results-head">${listFrom ? `<button class="icon-button list-back" data-action="back-settings" aria-label="Back to Settings">${icon('back')}</button>` : ''}<div class="list-heading"><h1>My List</h1><p class="results-count" role="status">${items.length} ${items.length === 1 ? 'title' : 'titles'}</p></div></div>${items.length ? `<div class="results-grid">${items.map(f => card(f, progress)).join('')}</div>` : `<div class="empty-list"><div class="state-icon">${icon('list')}</div><h2>Your list is empty</h2><p>Add films with + to keep them here.</p><button class="secondary" data-tab="home">Browse films</button></div>`}</section><footer>${all.length} titles${demo ? ' · Demo collection' : ' · Your private collection'}</footer>`;
}
function card(f, progress = {}) {
  const id = f.resumeFilmId || f.id, saved = progress[id], { kicker: brand, name } = splitTitle(f.title);
  return `<article class="card"><button class="film-card" data-film="${escape(id)}" aria-label="More info: ${escape(f.title)}">${poster(f)}<span class="card-title film-title" dir="auto">${brand ? `<small class="card-kicker">${escape(brand)}</small>` : ''}${escape(name)}</span>${sameLang(f).length > 1 ? `<span class="cut-count">${sameLang(f).length} cuts</span>` : ''}</button>${f.resumeFilmId && saved ? `<progress class="watch-progress" value="${saved.time}" max="${saved.duration}" aria-label="Watch progress for ${escape(f.title)}"></progress>` : ''}</article>`;
}
function shelf(name, films, progress = {}) {
  return films.length ? `<section class="shelf" aria-label="${escape(name)}" data-row="${escape(name)}"><div class="shelf-heading"><h2>${escape(name)}</h2><span class="shelf-count">${films.length} ${films.length === 1 ? 'title' : 'titles'}</span><button class="explore" data-action="explore" data-row="${escape(name)}" aria-label="Explore all: ${escape(name)}"><span>Explore all</span>${icon('arrow')}</button><span class="row-dashes" aria-hidden="true"></span></div><div class="row-viewport"><div class="card-track">${films.map(f => card(f, progress)).join('')}</div><button class="paddle paddle-prev" aria-label="Previous titles: ${escape(name)}" disabled>${icon('back')}</button><button class="paddle paddle-next" aria-label="Next titles: ${escape(name)}">${icon('arrow')}</button></div></section>` : '';
}
function chooseFilm(id, directPlay = false, origin) {
  if (screen !== 'film') { detailOpener = origin instanceof Element ? origin : document.activeElement; detailOrigin = { el: origin instanceof Element ? origin : null, id }; }
  film = catalog.films.find(f => f.id === id);
  if (!film) return;
  version = film.versions.find(v => v.kind === (matchMedia('(min-width: 900px)').matches ? 'desktop' : 'phone')) || film.versions[0];
  if (directPlay) void play(); else filmPage(origin);
}
function versionList() {
  return `<section class="episodes" aria-label="Versions"><h2>Versions</h2><div class="episode-list" role="group" aria-label="Film version"><ol>${film.versions.map((v, index) => `<li><button class="episode ${v === version ? 'selected' : ''}" data-version="${v.kind}" aria-pressed="${v === version}"><span class="ep-n">${index + 1}</span>${poster(film, 'ep-poster')}<span class="ep-copy"><strong>${icon(v.kind)}${kindName(v.kind)} ${v.kind === 'phone' ? '9:16' : '16:9'}</strong><small>${duration(film.seconds)} · ${v.w}×${v.h}</small></span>${v === version ? `<span class="ep-check">${icon('check')}</span>` : ''}</button></li>`).join('')}</ol></div></section>`;
}
function filmPage(origin) {
  savedFile = undefined;
  if (!main.classList.contains('library')) library();
  const all = groupsOf();
  const group = all.find(g => g.variants.some(v => v.id === film.id));
  const selected = group.variants.find(v => v.id === film.id);
  const related = all.filter(g => g.id !== group.id && g.product === selected.product);
  let release = '';
  // the app streams 720p copies; the 1080p masters live on the film's release (it asks for the owner's GitHub sign-in,
  // so a guest, who can't open it, gets no release links)
  let fullQuality = '';
  if (!isGuest()) try { const url = new URL(film.release); if (url.protocol === 'https:') { release = `<a class="release-link" href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">View release ${icon('arrow')}</a>`; fullQuality = `<a class="secondary full-quality" href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">Full quality ${icon('arrow')}</a>`; } } catch { /* Old catalogs can omit a release link. */ }
  // Cuts in this language; the other language is one small link, never a card of its own.
  const mine = sameLang({ ...selected, variants: group.variants }), other = group.variants.find(v => v.lang !== selected.lang);
  const langSwitch = other ? `<button class="lang-switch" data-variant="${escape(other.id)}"${other.lang === 'ar' ? ' lang="ar" dir="rtl">النسخة العربية' : ' lang="en" dir="ltr">English version'}${icon('arrow')}</button>` : '';
  const cuts = mine.length > 1 ? `<section class="episodes" aria-label="Cuts"><h2>Cuts</h2><div class="episode-list" role="group" aria-label="Film cut"><ol>${mine.map((v, index) => `<li><button class="episode variant ${v.id === film.id ? 'selected' : ''}" data-variant="${escape(v.id)}" aria-pressed="${v.id === film.id}"><span class="ep-n">${index + 1}</span>${poster(v, 'ep-poster')}<span class="ep-copy"><strong dir="auto">${escape(v.variant || v.title)}</strong><small>${duration(v.seconds)} · ${escape(v.added || 'Date unavailable')}</small></span>${v.id === film.id ? `<span class="ep-check">${icon('check')}</span>` : ''}</button></li>`).join('')}</ol></div></section>` : '';
  const html = `<button class="icon-button detail-close" data-action="close-detail" aria-label="Close details">${icon('close')}</button><span class="sheet-handle" aria-hidden="true"></span><div class="detail-art">${poster(film, 'detail-poster')}<video class="detail-video" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video><div class="detail-shade"></div><div class="detail-hero"><p class="kicker" id="detail-kicker" dir="auto">${escape(kicker(selected))}</p><h1 id="detail-title" class="film-title" dir="auto">${escape(splitTitle(film.title).name)}</h1><div class="detail-buttons"><button class="primary detail-play" data-action="play">${icon('play')}Play</button>${listButton(film, 'detail-list')}<button class="icon-button round detail-mute" data-action="detail-mute" aria-label="Unmute" hidden>${icon('mute')}</button></div></div></div><div class="detail-body"><p class="detail-meta">${metaLine(selected, { product: true })}</p><p class="detail-blurb">${escape(selected.blurb)}</p><div class="film-actions"><button class="secondary" data-action="save">${icon('download')}${desktopQuery.matches ? 'Download' : 'Save to phone'}</button>${fullQuality}</div>${langSwitch}${cuts}${versionList()}<p class="date-added">Added <time>${escape(film.added || 'Date unavailable')}</time></p>${release}${related.length ? `<section class="shelf more-like" aria-label="More like this"><div class="shelf-heading"><h2>More like this</h2></div><div class="more-grid">${related.map(f => card(f)).join('')}</div></section>` : ''}</div>`;
  let detail = main.querySelector('#film-detail'), settled = Promise.resolve();
  if (detail) { live.modal?.stop(); detail.innerHTML = html; detail.scrollTop = 0; }
  else {
    main.insertAdjacentHTML('beforeend', `<dialog id="film-detail" aria-labelledby="detail-kicker detail-title">${html}</dialog>`);
    detail = main.querySelector('#film-detail');
    detail.addEventListener('cancel', event => { event.preventDefault(); void closeDetail(); });
    detail.addEventListener('click', event => {
      if (event.target !== detail) return;
      const box = detail.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) void closeDetail();
    });
    enableDrag(detail, from => void closeDetail(from));
    detail.showModal();
    live.billboard?.hold(true); live.feed?.hold(true);
    // Measured after showModal: the page lost its scrollbar, which can shift the card a few pixels.
    settled = openSheet(detail, { origin: origin instanceof Element ? origin.getBoundingClientRect() : origin, phone: !desktopQuery.matches });
  }
  screen = 'film';
  void fillPosters(revision);
  modalPreview(detail, settled);
}
function modalPreview(detail, settled) {
  const video = detail.querySelector('.detail-video'), art = detail.querySelector('.detail-art'), mute = detail.querySelector('.detail-mute');
  const { getURL, canDownload } = source(film, 'desktop');
  let preview, release, dead = !motionOn();
  const pauseHidden = () => { if (document.hidden) video.pause(); else if (!dead && art.classList.contains('is-playing')) video.play().catch(() => {}); };
  const stop = () => { dead = true; preview?.stop(); release?.(); art.classList.remove('is-playing'); mute.hidden = true; document.removeEventListener('visibilitychange', pauseHidden); };
  document.addEventListener('visibilitychange', pauseHidden);
  live.modal = { stop, sync() { if (!motionOn()) stop(); } };
  settled.then(() => {
    if (dead || !detail.isConnected) return;
    release = claimPreview({ stop });
    preview = startPreview(video, { getURL, canDownload, onPlaying() { art.classList.add('is-playing'); mute.hidden = false; }, onEnded() { art.classList.remove('is-playing'); }, onFail: stop });
  });
}
function originRect() {
  const el = detailOrigin?.el?.isConnected ? detailOrigin.el : detailOrigin && main.querySelector(`.film-card[data-film="${CSS.escape(detailOrigin.id)}"]`);
  const box = el?.getBoundingClientRect();
  return box && box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth ? box : null;
}
async function closeDetail(from = 0) {
  const detail = main.querySelector('#film-detail');
  if (!detail || detail.dataset.closing) return;
  detail.dataset.closing = 'true'; detail.inert = true;
  live.modal?.stop();
  await closeSheet(detail, { target: originRect(), phone: !desktopQuery.matches, from });
  if (!detail.isConnected) return;
  detail.close(); detail.remove();
  screen = 'library';
  live.billboard?.hold(false); live.feed?.hold(false);
  if (listDirty && tab === 'home' && main.querySelector('.shelves')) { listDirty = false; refreshListRow(); }
  const card = detailOrigin && main.querySelector(`.film-card[data-film="${CSS.escape(detailOrigin.id)}"]`);
  const back = detailOpener?.isConnected && detailOpener !== document.body ? detailOpener : card;
  if (back) back.focus({ preventScroll: true });
  else main.querySelector('[data-action="hero-info"], .film-card, [data-action="clear-filter"]')?.focus({ preventScroll: true });
  if (listDirty) { listDirty = false; library(); }
}
function persistPlayback() {
  const video = main.querySelector('video');
  if (screen === 'player' && video && film && video.readyState >= 1) saveProgress(storage, film.id, video.currentTime, video.duration, progressKey);
}
const messages = {
  offline: ['You’re offline', 'Connect to the internet.<br>Then try your library again.', 'offline'],
  'github-unreachable': ['GitHub is unavailable', 'Your library could not load.<br>Try again in a moment.', 'cloud'],
  empty: ['No films yet', 'Add films to your media repository,<br>then refresh.', 'film'],
  access: ["This token can't see the media repo", 'Select mk-cinema-library in the token settings.<br>Give Contents: Read-only access.', 'alert'],
  'rate-limit': ['GitHub needs a pause', 'The request limit was reached.<br>Wait a few minutes, then retry.', 'cloud'],
  invalid: ['This file could not open', 'Check the catalog and media files,<br>then try again.', 'alert']
};
function stateScreen(state) {
  const [heading,copy,symbol] = messages[state] || messages.invalid;
  screen = state; restore = () => stateScreen(state);
  mount(state, `${header()}<section class="recovery"><div class="stage-light" aria-hidden="true"></div><div class="recovery-copy">${symbol ? `<div class="state-icon">${icon(symbol)}</div>` : ''}<h1>${heading}</h1><p>${copy}</p></div><button class="primary" data-action="${state==='access' ? 'connect' : 'retry'}">${icon('retry')}${state==='empty'?'Refresh':state==='access'?'Update token':'Retry'}</button></section>`);
}
function showError(error) {
  // A guest's key that GitHub no longer accepts (revoked, expired, or its repository access removed) ends the invite.
  if (isGuest() && ['token', 'access'].includes(error.code)) guestScreen('invite-ended');
  else if (error.code === 'token') connect('Token is wrong or expired');
  else stateScreen(error.code || (navigator.onLine ? 'github-unreachable' : 'offline'));
}
async function playbackURL(signal, whole = false, onProgress) {
  const url = await getVideoURL(version.file, { demo, token, signal });
  // GitHub's raw host sends films as application/octet-stream with nosniff, which iPhone Safari can refuse
  // to stream. The fallback downloads the whole film and plays it from memory as video/mp4.
  if (!demo && whole) return URL.createObjectURL(new Blob([await downloadVideo(url, { signal, onProgress })], { type: 'video/mp4' }));
  if (!demo) return url;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new CinemaError('invalid');
  return URL.createObjectURL(await response.blob());
}
// The player: only the film, edge to edge, with the controls floating over it (player.js).
function playerView() {
  const shape = v => v.kind === 'phone' ? '9:16' : '16:9';
  const cutSwitch = film.versions.length > 1 ? `<div class="np-cuts" role="group" aria-label="Picture version">${film.versions.map(v => `<button class="np-cut" data-np="cut" data-cut="${v.kind}" aria-pressed="${v === version}" aria-label="${kindName(v.kind)} ${shape(v)}">${icon(v.kind)}<span>${kindName(v.kind)}</span></button>`).join('')}</div>` : '';
  const full = document.fullscreenEnabled ? `<button class="np-btn" data-np="fullscreen" aria-label="Full screen">${icon('expand')}</button>` : '';
  const ripple = (side, name) => `<div class="np-ripple" data-side="${side}" aria-hidden="true"><span>${icon(name)}<b></b></span></div>`;
  return `<div class="np" data-ui="on" data-fit="${prefs.playerFit}">
<video class="np-video" playsinline x-webkit-airplay="allow" preload="metadata" aria-label="${escape(film.title)}"></video>
<div class="np-touch" aria-hidden="true"></div>${ripple('back', 'back10')}${ripple('forward', 'fwd10')}
<div class="np-scrim" aria-hidden="true"></div>
<div class="np-ui">
<div class="np-top"><button class="np-btn" data-action="back" aria-label="Back to film">${icon('back')}</button><div class="np-title"><p class="np-kicker" dir="auto">${escape(kicker(film))}</p><h1 class="np-name film-title" dir="auto">${escape(splitTitle(film.title).name)}</h1></div><button class="np-btn" data-np="airplay" aria-label="AirPlay" hidden>${icon('airplay')}</button><button class="np-btn" data-np="mute" aria-label="Mute">${icon('sound')}</button></div>
<div class="np-mid"><button class="np-btn np-skip" data-np="back10" aria-label="Back 10 seconds">${icon('back10')}</button><button class="np-play" data-np="play" aria-label="Pause">${icon('pause')}</button><button class="np-btn np-skip" data-np="fwd10" aria-label="Forward 10 seconds">${icon('fwd10')}</button></div>
<div class="np-bottom"><div class="np-seek"><span class="np-time" data-np-elapsed>0:00</span><div class="np-scrub" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="${Math.round(film.seconds)}" aria-valuenow="0" aria-valuetext="0:00 of ${duration(film.seconds)}"><div class="np-track"><i class="np-buffer"></i><i class="np-fill"></i><i class="np-knob"></i><span class="np-bubble" aria-hidden="true"></span></div></div><span class="np-time np-left" data-np-left>-${duration(film.seconds)}</span></div>
<div class="np-row"><button class="np-pill" data-np="fit" aria-pressed="${prefs.playerFit === 'fill'}" aria-label="Fill the screen">${icon(prefs.playerFit === 'fill' ? 'fit' : 'fill')}<span>Fill</span></button>${cutSwitch}<span class="np-gap"></span>${full}</div></div>
</div>
<p class="player-status" role="status">Opening film…</p>
</div>`;
}
// `resumeAt` (seconds) comes from a cut switch inside the player; otherwise the saved progress decides.
async function play(resumeAt) {
  mount('player', playerView());
  const stamp = revision, signal = operation.signal, video = main.querySelector('video');
  const status = main.querySelector('.player-status');
  // Called inside the tap so iPhone lets the later play() start with sound after the URL arrives.
  video.play().catch(() => {});
  live.player = mountPlayer(main, {
    video, landscape: version.kind !== 'phone', seconds: film.seconds, fit: prefs.playerFit, reduced, icon,
    onFit(fit) { prefs.playerFit = fit; saveSettings(); },
    onBack: () => filmPage(),
    // Inside the tap again, so the new cut keeps its sound; it carries on where the other one was.
    onCut(kind) { const at = video.readyState >= 1 ? video.currentTime : undefined; version = film.versions.find(v => v.kind === kind) || version; void play(at); },
  });
  let refreshing = false, recoveryUsed = false, lastTime = 0, recoveryTime = 0, streamed = false, whole = false;
  async function source(resume = 0) {
    const url = await playbackURL(signal, whole, ({ loaded, total }) => {
      if (stamp === revision && total) status.textContent = `Loading film… ${Math.floor(loaded / total * 100)}%`;
    });
    if (stamp !== revision) { if(url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
    mediaURL = url;
    video.src = url;
    video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(resume, video.duration || resume); }, { once:true });
    try { await video.play(); status.textContent = ''; }
    catch (error) { if (error.name==='NotAllowedError') { status.textContent='Tap Play to watch.'; } else if (error.name!=='AbortError' && !video.error) throw error; }
  }
  video.addEventListener('timeupdate',()=>{ if(stamp!==revision) return; lastTime=video.currentTime; persistPlayback(); if(recoveryUsed && lastTime>recoveryTime+1) recoveryUsed=false; });
  video.addEventListener('pause', () => { if (stamp === revision) persistPlayback(); });
  video.addEventListener('ended', () => { if (stamp === revision) persistPlayback(); });
  video.addEventListener('loadedmetadata',()=>{ streamed=true; });
  video.addEventListener('error',async()=>{
    if (stamp!==revision || refreshing) return;
    if (recoveryUsed) { showError(new CinemaError('invalid')); return; }
    refreshing=true; recoveryUsed=true; recoveryTime=lastTime; status.textContent='Refreshing film…';
    // A stream that never loaded was refused, not expired: switch to the whole-file download for good.
    if (!streamed) whole=true;
    try { await source(lastTime); } catch(error) { if(stamp===revision && error.name!=='AbortError') showError(error); }
    finally { refreshing=false; }
  });
  // Only a film of 30 min or more picks up where it was left (resumeFrom); a cut switch carries its time over.
  const from = resumeAt ?? resumeFrom(readProgress(storage, progressKey)[film.id], film.seconds);
  try { await source(from); } catch(error) { if(stamp===revision && error.name!=='AbortError') showError(error); }
}
function saveScreen(state, preview = false) {
  screen=state;
  let panel;
  if(state==='save-progress') panel=`<h2>${desktopQuery.matches?'Downloading':'Saving to phone'}</h2><p id="percent" class="percent">${preview?'64%':'0%'}</p><progress max="100" value="${preview?64:0}" aria-label="Download progress"></progress><p id="download-note">Downloading the ${kindName(version.kind)} version.</p><button class="secondary" data-action="cancel-save">Cancel</button>`;
  else if(state==='save-ready') panel=`<div class="success-icon">${icon('download')}</div><h2>Ready to save</h2><p>The download is complete.<br>Choose where to keep your video.</p><button class="primary" data-action="deliver-file">${icon('download')}${canShareFile()?'Save video':'Download video'}</button><button class="text-button" data-action="back">Back to film</button><p id="save-note" role="status"></p>`;
  else panel=`<div class="success-icon">${icon('check')}</div><h2>Saved</h2><p>${preview?'The download is complete.':'The video was handed to your device.<br>Check your chosen save location.'}</p><button class="primary" data-action="back">${icon('play')}Back to film</button>`;
  mount(state, `${header(true)}<div class="save-film">${poster(film,film.posterShape==='9:16'?'save-poster tall':'save-poster')}<p class="kicker" dir="auto">${escape(kicker(film))}</p>${title(film,'h1')}<p class="runtime">${duration(film.seconds)}</p><div class="save-version badge">${icon(version.kind)}${kindName(version.kind)} ${version.kind==='phone'?'9:16':'16:9'}</div></div><section class="save-panel" aria-live="polite">${panel}</section>`);
}
async function save() {
  savedFile=undefined; saveScreen('save-progress');
  const stamp=revision, signal=operation.signal;
  try {
    const url=await getVideoURL(version.file,{demo,token,signal});
    const blob=await downloadVideo(url,{signal,onProgress:({loaded,total})=>{
      if(stamp!==revision) return;
      const progress=main.querySelector('progress');
      if(total) { const percent=Math.min(100,Math.floor(loaded/total*100)); progress.value=percent; main.querySelector('#percent').textContent=`${percent}%`; }
      else { progress.removeAttribute('value'); main.querySelector('#percent').textContent=`${(loaded/1048576).toFixed(1)} MB`; }
    }});
    if(stamp!==revision) return;
    const filename=film.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,160) || 'film';
    savedFile=new File([blob],`${filename}.mp4`,{type:'video/mp4'});
    saveScreen('save-ready');
  } catch(error) { if(error.name!=='AbortError' && stamp===revision) showError(error); }
}
function canShareFile() { try { return Boolean(savedFile && navigator.canShare?.({files:[savedFile]})); } catch { return false; } }
async function deliverFile() {
  if(!savedFile) return;
  const stamp=revision;
  const button=main.querySelector('[data-action="deliver-file"]'); button.disabled=true;
  try {
    if(canShareFile()) await navigator.share({files:[savedFile]});
    else {
      const url=URL.createObjectURL(savedFile), link=document.createElement('a');
      link.href=url; link.download=savedFile.name; document.body.append(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    if(stamp===revision) { saveScreen('saved'); savedFile=undefined; }
  } catch(error) {
    if(stamp!==revision) return;
    button.disabled=false;
    main.querySelector('#save-note').textContent=error.name==='AbortError'?'Save cancelled. Your video is ready to try again.':'Your device could not save the video. Try again.';
  }
}
main.addEventListener('submit',async event=>{
  if(event.target.id==='invite-form') { event.preventDefault(); await makeInvite(); return; }
  if(event.target.id==='paste-form') { event.preventDefault(); await openPasted(main.querySelector('#invite-paste').value); return; }
  if(event.target.id!=='connect-form') return; event.preventDefault();
  const input=main.querySelector('#token'); const value=input.value.trim();
  if(!value) return;
  if(demo) { await loadLibrary(); return; }
  const pasted=inviteFromText(value, location.href); // an invite link pasted here opens the invite; it is no token
  if(pasted?.token) { await openInvite(pasted); return; }
  try { localStorage.setItem('mkc.token',value); token=value; guest=null; writeGuest(storage,null); } catch { connect('Browser storage is blocked. Enable storage for this site.'); return; }
  await loadLibrary();
});
async function onClick(event) {
  // Stop access opens GitHub's token list in a new tab and says what to press there.
  const stop = event.target.closest('a[data-stop]');
  if (stop) { const note = main.querySelector(`#stop-${CSS.escape(stop.dataset.stop)}`); if (note) note.hidden = false; return; }
  if (event.target.closest('#invite-github[aria-disabled]')) { event.preventDefault(); main.querySelector('#invite-name')?.focus(); return; }
  // A tap on the picture of a New & Hot film opens its details, like the info button.
  const stage = event.target.closest('.hot-stage');
  if (stage && !event.target.closest('button') && main.contains(stage)) { chooseFilm(stage.closest('.hot-item').dataset.film, false, stage); return; }
  const button=event.target.closest('button'); if(!button) return;
  if(button.dataset.tab) { go(button.dataset.tab); return; }
  if(button.dataset.reelKind) { chooseKind(button); return; }
  if(button.dataset.playFilm) { chooseFilm(button.dataset.playFilm, true); return; }
  if(button.dataset.filter) { activeFilter=button.dataset.filter; gridMode=true; library(); main.querySelector(`[data-filter="${activeFilter}"]`)?.focus({preventScroll:true}); return; }
  if(button.dataset.variant) { chooseFilm(button.dataset.variant); [...main.querySelectorAll('[data-variant]')].find(el => el.dataset.variant === film.id)?.focus(); return; }
  if(button.dataset.film) { chooseFilm(button.dataset.film, false, button); return; }
  if(button.dataset.version) { version=film.versions.find(v=>v.kind===button.dataset.version); filmPage(); main.querySelector(`[data-version="${version.kind}"]`)?.focus(); return; }
  switch(button.dataset.action) {
    case 'hero-play': chooseFilm(button.dataset.id, true); break;
    case 'hero-info': chooseFilm(button.dataset.id, false, button); break;
    case 'close-detail': void closeDetail(); break;
    case 'toggle-list': toggleMyList(button.dataset.id); break;
    case 'detail-mute': { const video=main.querySelector('.detail-video'); video.muted=!video.muted; button.setAttribute('aria-label',video.muted?'Unmute':'Mute'); button.setAttribute('aria-pressed',String(!video.muted)); button.innerHTML=icon(video.muted?'mute':'sound'); break; }
    case 'explore': exploreRow=button.dataset.row; gridMode=true; library(); main.querySelector('[data-action="clear-filter"]')?.focus({preventScroll:true}); break;
    case 'search': if(!catalog || !TABBED.includes(screen)) break; if(tab!=='home') { tab='home'; activeFilter='All'; exploreRow=null; listFrom=null; } searching=true; gridMode=true; library(); main.querySelector('#film-search').focus(); break;
    case 'close-search': searching=false; query=''; gridMode=activeFilter!=='All'; library(); main.querySelector('[data-action="search"]')?.focus() || document.querySelector('[data-action="search"]')?.focus(); break;
    case 'clear-filter': activeFilter='All'; query=''; searching=false; gridMode=false; exploreRow=null; library(); main.querySelector('.filters') && (main.querySelector('.filters').scrollLeft=0); main.querySelector('[data-filter="All"]')?.focus({preventScroll:true}); break;
    case 'back': screen==='film' ? library() : filmPage(); break;
    case 'retry': await loadLibrary(); break;
    case 'connect': connect(); break;
    case 'settings': if (catalog && TABBED.includes(screen)) go('settings'); else settingsScreen({ solo: true }); break;
    case 'settings-back': (restore || connect)(); break;
    case 'open-list': tab = 'list'; listFrom = 'settings'; activeFilter = 'All'; query = ''; searching = false; gridMode = false; exploreRow = null; swap(library); break;
    case 'back-settings': go('settings'); break;
    case 'forget-token': await forgetToken(); break;
    case 'open-invite': if (catalog && !isGuest() && !demo) { tab = 'invite'; listFrom = null; activeFilter = 'All'; query = ''; searching = false; gridMode = false; exploreRow = null; swap(library); } break;
    case 'invite-another': inviteScreen(); main.querySelector('#invite-name').focus(); break;
    case 'share-invite': await shareInvite(); break;
    case 'copy-invite': await copyInvite(); break;
    case 'remove-invite': { removeInvite(storage, button.dataset.id); const row = button.closest('.invite-item'); main.querySelector('[data-action="open-invite"]')?.focus(); row?.remove(); announce('Removed from the list. The link still works until you stop it on GitHub.'); break; }
    case 'enter': await enter(); break;
    case 'leave': await leave(); break;
    case 'paste-invite': await pasteInvite(); break;
    case 'paste-screen': pasteScreen(); break;
    case 'keep-key': pendingInvite = null; await loadLibrary(); break;
    case 'switch-invite': if (pendingInvite) await acceptInvite(pendingInvite); break;
    case 'play': await play(); break;
    case 'save': await save(); break;
    case 'cancel-save': filmPage(); break;
    case 'deliver-file': await deliverFile(); break;
  }
}
[main, topbar, tabbar].forEach(el => el.addEventListener('click', onClick));
main.addEventListener('input', event => {
  if (event.target.id === 'invite-name') { syncInviteName(); return; }
  if (event.target.id === 'invite-paste') { pasteTyped(event.target); return; }
  if(event.target.id !== 'film-search') return;
  const caret = event.target.selectionStart;
  query = event.target.value; library();
  const input = main.querySelector('#film-search'); input.focus(); input.setSelectionRange(caret, caret);
});
const bob = createBob({
  host: main, find: findFilm, posterURL: f => posterURLs.get(f.poster) || '', source: f => source(f, 'desktop'),
  enabled: () => screen === 'library' && !reduced(), autoplay: motionOn, listed: f => inList(listIds, titleIds(f.id)),
  actions: { play: id => chooseFilm(id, true), info: (id, origin) => chooseFilm(id, false, origin), toggle: toggleMyList },
  icon, esc: escape, duration, isNew, topOffset: () => topbar.getBoundingClientRect().bottom,
});
// Settings controls. Reduced motion turns every preview off whatever the Autoplay switch says, and no film moves on
// by itself, so those two controls show that instead of pretending.
function syncAutoplay() {
  const toggle = main.querySelector('#autoplay-toggle');
  if (toggle) {
    toggle.checked = prefs.autoplay && !reduced(); toggle.disabled = reduced();
    main.querySelector('#autoplay-toggle-note').textContent = reduced() ? 'Off because this device asks for reduced motion.' : 'Muted previews on the home, on cards and in More info.';
    const note = main.querySelector('#reel-end-note');
    main.querySelectorAll('[name=reel-end]').forEach(input => { input.disabled = reduced(); });
    note.textContent = reduced() ? 'Films wait, because this device asks for reduced motion.' : ''; note.hidden = !reduced();
  }
  live.billboard?.sync(); live.feed?.sync(); live.modal?.sync(); bob.sync();
}
main.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'autoplay-toggle') { prefs.autoplay = input.checked; saveSettings(); syncAutoplay(); }
  else if (input.id === 'reel-sound') { prefs.reelSound = input.checked; saveSettings(); }
  else if (input.name === 'reel-order' && input.checked) { prefs.reelOrder = input.value; saveSettings(); }
  else if (input.name === 'reel-end' && input.checked) { prefs.reelEnd = input.value; saveSettings(); }
  else if (input.name === 'player-fit' && input.checked) { prefs.playerFit = input.value; saveSettings(); }
});
// Which titles Reels plays. The last kind on stays on, and says so.
function chooseKind(button) {
  const kind = button.dataset.reelKind, next = toggleKind(prefs.reelKinds, kind);
  if (next === prefs.reelKinds) { announce('Reels keep at least one kind on.'); button.classList.remove('pop'); void button.offsetWidth; button.classList.add('pop'); return; }
  prefs.reelKinds = next; saveSettings();
  for (const chip of main.querySelectorAll('[data-reel-kind]')) {
    const on = next.includes(chip.dataset.reelKind);
    chip.setAttribute('aria-pressed', String(on)); chip.querySelector('svg').outerHTML = icon(on ? 'check' : 'plus');
  }
}
async function forgetToken() {
  try {
    operation.abort();
    if(!demo) localStorage.removeItem('mkc.token'); token='';
    await forgetPosters(); clearPosters(); clearPreviews(); catalog=undefined; film=undefined; savedFile=undefined;
    reelResume=null; tab='home'; listFrom=null; connect();
  } catch { const status=main.querySelector('#settings-status'); if (status) status.textContent='Could not clear browser storage. Try again.'; }
}
onReducedChange(syncAutoplay);
window.addEventListener('pagehide', persistPlayback);
document.addEventListener('visibilitychange', () => { if(document.hidden) persistPlayback(); });
// With no key nothing loads, so going offline changes nothing: Retry would try the missing key and show the token screen.
window.addEventListener('offline',()=>{ if(screen!=='connect' && (token || demo)) stateScreen('offline'); });
async function start() {
  const preview=demo && params.get('state');
  if(preview==='connect' || preview==='connect-error') { connect(preview==='connect-error'?'Token is wrong or expired':''); return; }
  if(preview==='loading') { loading(); return; }
  if(preview && messages[preview]) { stateScreen(preview); return; }
  if(!demo && arrival) { await openInvite(arrival); return; }
  if(!demo && !token) { if (guest?.left) guestScreen('invite-left'); else if (homeScreenApp()) pasteScreen(); else connect(); return; }
  await loadLibrary();
  if(demo && catalog && ['save-progress','saved'].includes(preview)) { film=catalog.films[0]; version=film.versions[0]; saveScreen(preview,true); }
}
void start();
// An invite opened in a tab where the app is already open only changes the fragment: the page does not reload.
addEventListener('hashchange', () => { const next = takeInvite(); if (next && !demo) void openInvite(next); });
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{/* The app also works without offline shell caching. */});
