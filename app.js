import { CinemaError, getCatalog, getPoster, getVideoURL, downloadVideo, forgetPosters } from './api.js';
import { PRODUCTS, groupFilms, filterFilms, readProgress, saveProgress, continueFilms, readList, saveList, inList, toggleList, listGroups } from './catalog.js';
import { MAX_WHOLE_BYTES, claimPreview, reduced, onReducedChange, readAutoplay, writeAutoplay } from './motion.js';
import { startPreview } from './previews.js';
import { mountBillboard } from './billboard.js';
import { mountRows } from './rows.js';
import { mountFeed } from './feed.js';
import { createBob } from './bob.js';
import { openSheet, closeSheet, enableDrag } from './modal.js';

const main = document.querySelector('main');
const topbar = document.querySelector('#topbar');
const tabbar = document.querySelector('#tabbar');
const settings = document.querySelector('#settings');
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
let listIds = readList(storage, listKey), autoplay = readAutoplay(storage);
const desktopQuery = matchMedia('(min-width: 900px)');
const filters = ['All', 'MK Voice', 'Business OS', 'Talent Atlas', 'Job Orbit', 'Suite & apps', 'More', 'Ads', 'Demos', 'Arabic'];
const TABS = [['home', 'Home'], ['new', 'New & Hot'], ['films', 'Films'], ['ads', 'Ads'], ['demos', 'Demos'], ['list', 'My List']];
const PHONE_TABS = [['home', 'Home', 'home'], ['new', 'New & Hot', 'flame'], ['search', 'Search', 'search'], ['list', 'My List', 'list']];
const kindTabs = { films: ['Films', 'FILMS'], ads: ['Ads', 'ADS & LOOPS'], demos: ['Demos', 'DEMOS'] };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const kindName = kind => kind === 'phone' ? 'Phone' : 'Desktop';
const isNew = f => { const time = Date.parse(f.added); return time >= Date.now() - 7 * 86400000 && time <= Date.now(); };
const formatDate = value => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(Date.parse(value));
const motionOn = () => autoplay && !reduced();
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
  expand: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>', arrow: '<path d="m9 5 7 7-7 7"/>', alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>',
  home: '<path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5h4v5"/>', flame: '<path d="M12 3c.4 3 3.2 4.6 4.4 7A6.5 6.5 0 1 1 5.6 14c0-1.9.8-3.4 2-4.5.3 1.3.9 2 1.9 2.4C9.4 8.7 10.2 5.4 12 3Z"/>',
  list: '<path d="M4 6h11M4 12h7M4 18h7M18 11v8m-4-4h8"/>', plus: '<path d="M12 5v14M5 12h14"/>', mute: '<path d="M3 9h4l5-5v16l-5-5H3ZM16 9l5 6m0-6-5 6"/>', chevron: '<path d="m6 9 6 6 6-6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || ''}</svg>`;
const title = (f, tag = 'h2', cls = '') => `<${tag} dir="auto" class="film-title ${cls}">${escape(f.title)}</${tag}>`;
const badges = f => `<div class="badges">${f.versions.map(v => `<span class="badge">${icon(v.kind)}${kindName(v.kind)}</span>`).join('')}</div>`;
const poster = (f, cls = '') => `<img class="poster ${cls}" data-poster="${escape(f.id)}" alt="" width="640" height="800">`;
const brand = '<span class="wordmark">MK <span>Cinema</span></span>';
function header(back = false) {
  return `<header class="header ${back ? 'compact' : ''}">${back ? `<button class="icon-button" data-action="back" aria-label="Back to film">${icon('back')}</button>` : ''}<div class="brand">${brand}</div>${!back ? `<div class="header-actions"><button class="icon-button settings-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div>` : ''}</header>`;
}
function groupsOf() {
  if (groupCache?.source !== catalog) {
    const groups = groupFilms(catalog.films);
    groupCache = { source: catalog, groups, byId: new Map(groups.flatMap(group => group.variants.map(item => [item.id, item]))) };
  }
  return groupCache.groups;
}
const findFilm = id => { groupsOf(); return groupCache.byId.get(id); };
const titleIds = id => groupsOf().find(group => group.variants.some(item => item.id === id))?.variants.map(item => item.id) || [id];
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
  if (tab === 'list') { if (screen === 'library') library(); else listDirty = true; }
  return on;
}
const listButton = (f, cls = '') => {
  const on = inList(listIds, titleIds(f.id));
  return `<button class="icon-button round list-toggle ${cls}" data-action="toggle-list" data-id="${escape(f.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} My List: ${escape(f.title)}">${icon(on ? 'check' : 'plus')}</button>`;
};

// The top bar (desktop) and the bottom tab bar (phone) live outside <main>, so they keep their state and
// focus while the content under them is swapped.
function chrome() {
  const show = screen === 'library' || screen === 'film';
  topbar.hidden = !show; document.body.classList.toggle('has-chrome', show);
  if (!show) { tabbar.hidden = true; return; }
  const desktop = desktopQuery.matches;
  tabbar.hidden = desktop;
  if (chromeKey !== String(desktop)) {
    chromeKey = String(desktop);
    topbar.innerHTML = `<div class="topbar-row"><button class="brand brand-button" data-tab="home" aria-label="MK Cinema home">${brand}</button>${desktop ? `<nav class="tabs" aria-label="Sections">${TABS.map(([id, label]) => `<button class="tab" data-tab="${id}" data-nav="${id}">${label}</button>`).join('')}<i class="tab-ink" aria-hidden="true"></i></nav>` : ''}<div class="header-actions">${desktop ? `<button class="icon-button" data-action="search" data-nav="search" aria-label="Search">${icon('search')}</button>` : ''}<button class="icon-button settings-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div></div>`;
    tabbar.innerHTML = desktop ? '' : PHONE_TABS.map(([id, label, symbol]) => `<button data-nav="${id}" ${id === 'search' ? 'data-action="search"' : `data-tab="${id}"`}>${icon(symbol)}<span>${label}</span></button>`).join('');
  }
  const current = searching ? 'search' : tab;
  for (const button of document.querySelectorAll('[data-nav]')) {
    if (button.dataset.nav === current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  const on = topbar.querySelector('.tab[aria-current]'), ink = topbar.querySelector('.tab-ink');
  if (ink) {
    ink.classList.toggle('off', !on);
    if (on) { ink.style.setProperty('--x', `${on.offsetLeft}px`); ink.style.setProperty('--w', `${on.offsetWidth}px`); }
  }
  paintBar();
}
// Transparent over the hero, solid #141414 after 80 px of scroll.
function paintBar() { topbar.style.setProperty('--bar', Math.min(1, scrollY / 80).toFixed(3)); }
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
  if (!catalog || (screen !== 'library')) return;
  if (next === tab && !searching && !gridMode && !exploreRow && activeFilter === 'All' && !query) { scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
  tab = next; activeFilter = 'All'; query = ''; searching = false; gridMode = false; exploreRow = null;
  swap(library);
}

function stopLive() {
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
  screen = next; main.className = `screen ${next}`; main.dataset.tab = next === 'library' ? tab : ''; main.innerHTML = html;
  chrome();
  if (focus) main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  void fillPosters(revision);
}
// A poster fades in over the skeleton shimmer once it has loaded.
function markReady(img) { img.classList.add('is-ready'); img.parentElement.classList.add('is-ready'); }
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
  screen = 'connect';
  mount('connect', `${header()}<section class="connect-content"><h1>Connect GitHub</h1><p>Open your private film library.<br>Paste a read-only token once.</p><form id="connect-form"><label for="token">GitHub token</label><input id="token" type="password" placeholder="Paste token" autocomplete="off" autocapitalize="none" spellcheck="false" required aria-describedby="token-help${error ? ' token-error' : ''}" ${error ? 'aria-invalid="true"' : ''}><p id="token-help" class="small">Stored only in this browser.</p>${error ? `<p class="error-copy" id="token-error" role="alert">${icon('alert')}<span>${escape(error)}<br><span class="muted">Paste a new token, then try again.</span></span></p>` : ''}<section class="token-help"><h2>How to make the token</h2><ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained token ${icon('arrow')}</a></li><li>Only select repositories:<br><strong>mk-cinema-library</strong></li><li>Contents: Read-only</li></ol></section><button class="primary" type="submit">${error ? 'Retry connection' : 'Connect'}</button></form></section>`);
}
function loading() {
  mount('loading', `${header()}<div class="skeleton-feature" aria-hidden="true"><div class="skeleton poster-block"></div><div class="skeleton-copy"><i></i><i></i><i></i><i></i><p>Loading library…</p></div></div><div class="skeleton-rows" aria-hidden="true">${Array.from({length:3},()=>'<div class="skeleton-row"><div class="skeleton"></div><div><i></i><i></i><i></i></div></div>').join('')}</div><p class="sr-only" role="status">Loading library…</p>`);
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
  savedFile = undefined;
  if (!catalog?.films.length) { stateScreen('empty'); return; }
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
    ['Continue watching', continueFilms(base, progress)], ['New this week', recent],
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
  const body = filtered ? `<section class="results"><div class="results-head"><div><p class="eyebrow">YOUR COLLECTION</p><h1>${escape(heading)}</h1><p class="results-count" role="status">${matches.length} ${matches.length === 1 ? 'title' : 'titles'}</p></div><button class="text-button" data-action="clear-filter">Clear filters</button></div><div class="results-grid">${matches.map(f => card(f, progress)).join('')}</div>${!matches.length ? '<p class="no-results">No films match. Try another title or clear the filters.</p>' : ''}</section>`
    : !featured ? `<section class="results"><div class="empty-list"><div class="state-icon">${icon('list')}</div><h2>Nothing here yet</h2><p>Films of this kind will appear when they are added.</p><button class="secondary" data-tab="home">Browse everything</button></div></section>`
    : `<section class="billboard" aria-label="${home ? 'Newest film' : 'Featured film'}" data-film="${escape(featured.id)}" data-preview="poster">${poster(featured, 'billboard-poster')}<video class="billboard-video" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video><div class="billboard-shade"></div><div class="billboard-copy"><p class="eyebrow">${home ? 'YOUR PRIVATE CINEMA' : kindTabs[tab][1]}</p>${title(featured, 'h1')}<p class="hero-meta"><span class="new-badge">NEW</span><span>${duration(featured.seconds)}</span><span>${escape(featured.product)}</span><span>${escape(featured.kind)}</span></p><div class="blurb-wrap"><p class="blurb">${escape(featured.blurb)}</p></div><div class="billboard-actions"><button class="primary" data-action="hero-play" data-id="${escape(featured.id)}">${icon('play')}Play</button><button class="secondary" data-action="hero-info" data-id="${escape(featured.id)}">${icon('info')}More info</button></div></div><button class="icon-button billboard-tool" data-action="billboard-tool" aria-label="Unmute" hidden>${icon('mute')}</button></section><div class="shelves">${rows.map(([name, films]) => shelf(name, films, progress)).join('')}</div>`;
  return `${chips}${search}${body}<footer>${all.length} titles${demo ? ' · Demo collection' : ' · Your private collection'}</footer>`;
}
function feedView(all) {
  const shown = all.slice(0, 24); // newest first; a long library does not become an endless feed
  const item = f => `<article class="hot-item" data-film="${escape(f.id)}" aria-label="${escape(f.title)}"><div class="hot-stage">${poster(f, 'hot-poster')}<video class="hot-video" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video><div class="hot-shade"></div><i class="hot-bar" aria-hidden="true"></i></div><div class="hot-copy"><p class="hot-date">${isNew(f) ? '<span class="new-badge">NEW</span>' : ''}${Date.parse(f.added) ? `<time datetime="${escape(f.added)}">${formatDate(f.added)}</time>` : 'Date unavailable'}</p>${title(f, 'h2', 'hot-name')}<p class="blurb">${escape(f.blurb)}</p><div class="hot-actions"><button class="primary hot-play" data-play-film="${escape(f.id)}" aria-label="Play ${escape(f.title)}">${icon('play')}Play</button>${listButton(f)}<button class="icon-button round" data-film="${escape(f.id)}" aria-label="More info: ${escape(f.title)}">${icon('info')}</button></div></div></article>`;
  return `<section class="hot" aria-label="New and Hot"><h1 class="hot-title">New &amp; Hot</h1><div class="hot-feed">${shown.map(item).join('')}</div><div class="hot-rail" aria-hidden="true">${shown.length <= 10 ? shown.map(() => '<i></i>').join('') : ''}<b class="hot-rail-count"></b></div></section><footer>${all.length} titles${demo ? ' · Demo collection' : ' · Your private collection'}</footer>`;
}
function listView(all, progress) {
  const items = listGroups(all, listIds);
  return `<section class="results list-view" aria-label="My List"><div class="results-head"><div><p class="eyebrow">YOUR COLLECTION</p><h1>My List</h1><p class="results-count" role="status">${items.length} ${items.length === 1 ? 'title' : 'titles'}</p></div></div>${items.length ? `<div class="results-grid">${items.map(f => card(f, progress)).join('')}</div>` : `<div class="empty-list"><div class="state-icon">${icon('list')}</div><h2>Your list is empty</h2><p>Tap + on any film to keep it here.</p><button class="secondary" data-tab="home">Browse films</button></div>`}</section><footer>${all.length} titles${demo ? ' · Demo collection' : ' · Your private collection'}</footer>`;
}
function card(f, progress = {}) {
  const id = f.resumeFilmId || f.id, saved = progress[id];
  return `<article class="card"><button class="film-card" data-film="${escape(id)}" aria-label="More info: ${escape(f.title)}">${poster(f)}<span class="card-title film-title" dir="auto">${escape(f.title)}</span>${f.variants.length > 1 ? `<span class="cut-count">${f.variants.length} cuts</span>` : ''}</button>${f.resumeFilmId && saved ? `<progress class="watch-progress" value="${saved.time}" max="${saved.duration}" aria-label="Watch progress for ${escape(f.title)}"></progress>` : ''}</article>`;
}
function shelf(name, films, progress = {}) {
  return films.length ? `<section class="shelf" aria-label="${escape(name)}" data-row="${escape(name)}"><div class="shelf-heading"><h2>${escape(name)}</h2><button class="explore" data-action="explore" data-row="${escape(name)}" aria-label="Explore all: ${escape(name)}"><span>Explore all</span>${icon('arrow')}</button><span class="shelf-count">${films.length} ${films.length === 1 ? 'title' : 'titles'}</span><span class="row-dashes" aria-hidden="true"></span></div><div class="row-viewport"><div class="card-track">${films.map(f => card(f, progress)).join('')}</div><button class="paddle paddle-prev" aria-label="Previous titles: ${escape(name)}" disabled>${icon('back')}</button><button class="paddle paddle-next" aria-label="Next titles: ${escape(name)}">${icon('arrow')}</button></div></section>` : '';
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
  try { const url = new URL(film.release); if (url.protocol === 'https:') release = `<a class="release-link" href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">View release ${icon('arrow')}</a>`; } catch { /* Old catalogs can omit a release link. */ }
  const cuts = group.variants.length > 1 ? `<section class="episodes" aria-label="Cuts"><h2>Cuts</h2><div class="episode-list" role="group" aria-label="Film cut"><ol>${group.variants.map((v, index) => `<li><button class="episode variant ${v.id === film.id ? 'selected' : ''}" data-variant="${escape(v.id)}" aria-pressed="${v.id === film.id}"><span class="ep-n">${index + 1}</span>${poster(v, 'ep-poster')}<span class="ep-copy"><strong dir="auto">${escape(v.variant || v.title)}</strong><small>${duration(v.seconds)} · ${escape(v.added || 'Date unavailable')}</small></span>${v.id === film.id ? `<span class="ep-check">${icon('check')}</span>` : ''}</button></li>`).join('')}</ol></div></section>` : '';
  const html = `<button class="icon-button detail-close" data-action="close-detail" aria-label="Close details">${icon('close')}</button><span class="sheet-handle" aria-hidden="true"></span><div class="detail-art">${poster(film, 'detail-poster')}<video class="detail-video" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video><div class="detail-shade"></div><div class="detail-hero"><h1 id="detail-title" class="film-title" dir="auto">${escape(film.title)}</h1><div class="detail-buttons"><button class="primary detail-play" data-action="play">${icon('play')}Play</button>${listButton(film, 'detail-list')}<button class="icon-button round detail-mute" data-action="detail-mute" aria-label="Unmute" hidden>${icon('mute')}</button></div></div></div><div class="detail-body"><p class="detail-meta">${isNew(selected) ? '<span class="new-badge">NEW</span>' : ''}<span>${duration(film.seconds)}</span><span>${escape(selected.product)}</span><span>${escape(selected.kind)}</span>${selected.lang === 'ar' ? '<span>Arabic</span>' : ''}</p><p class="detail-blurb">${escape(selected.blurb)}</p><div class="film-actions"><button class="secondary" data-action="save">${icon('download')}Save to phone</button></div>${cuts}${versionList()}<p class="date-added">Added <time>${escape(film.added || 'Date unavailable')}</time></p>${release}${related.length ? `<section class="shelf more-like" aria-label="More like this"><div class="shelf-heading"><h2>More like this</h2></div><div class="more-grid">${related.map(f => card(f)).join('')}</div></section>` : ''}</div>`;
  let detail = main.querySelector('#film-detail'), settled = Promise.resolve();
  if (detail) { live.modal?.stop(); detail.innerHTML = html; detail.scrollTop = 0; }
  else {
    main.insertAdjacentHTML('beforeend', `<dialog id="film-detail" aria-labelledby="detail-title">${html}</dialog>`);
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
  empty: ['No films yet', 'Add films to your media repository,<br>then refresh.', ''],
  access: ["This token can't see the media repo", 'Select mk-cinema-library in the token settings.<br>Give Contents: Read-only access.', 'alert'],
  'rate-limit': ['GitHub needs a pause', 'The request limit was reached.<br>Wait a few minutes, then retry.', 'cloud'],
  invalid: ['This file could not open', 'Check the catalog and media files,<br>then try again.', 'alert']
};
function stateScreen(state) {
  const [heading,copy,symbol] = messages[state] || messages.invalid;
  screen = state;
  mount(state, `${header()}<section class="recovery"><div class="stage-light" aria-hidden="true"></div><div class="recovery-copy">${symbol ? `<div class="state-icon">${icon(symbol)}</div>` : '<p class="eyebrow">YOUR COLLECTION</p>'}<h1>${heading}</h1><p>${copy}</p></div><button class="primary" data-action="${state==='access' ? 'connect' : 'retry'}">${icon('retry')}${state==='empty'?'Refresh':state==='access'?'Update token':'Retry'}</button></section>`);
}
function showError(error) {
  if (error.code === 'token') connect('Token is wrong or expired');
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
async function play() {
  screen = 'player';
  mount('player', `<header class="player-header"><button class="icon-button" data-action="back" aria-label="Back to film">${icon('back')}</button><div>${title(film,'h1')}<p class="eyebrow">${kindName(version.kind)} ${version.kind==='phone'?'9:16':'16:9'}</p></div></header><div class="video-stage"><video playsinline preload="metadata" aria-label="${escape(film.title)}"></video><button class="center-play" data-action="toggle-play" aria-label="Pause">${icon('pause')}</button><p class="player-status" role="status">Opening film…</p></div><div class="player-controls"><label class="sr-only" for="seek">Seek</label><input type="range" id="seek" min="0" max="100" step="0.1" value="0"><div class="player-bottom"><span id="elapsed">0:00</span><span id="total">${duration(film.seconds)}</span><button class="icon-button" data-action="mute" aria-label="Mute">${icon('sound')}</button><button class="icon-button" data-action="fullscreen" aria-label="Full screen">${icon('expand')}</button></div></div>`);
  const stamp = revision, signal = operation.signal, video = main.querySelector('video');
  const status = main.querySelector('.player-status');
  // Called inside the tap so iPhone lets the later play() start with sound after the URL arrives.
  video.play().catch(() => {});
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
    if (stamp === revision) updatePlayButton();
  }
  video.addEventListener('timeupdate',()=>{ if(stamp!==revision) return; lastTime=video.currentTime; persistPlayback(); if(recoveryUsed && lastTime>recoveryTime+1) recoveryUsed=false; main.querySelector('#elapsed').textContent=duration(lastTime); main.querySelector('#seek').value=video.duration ? lastTime/video.duration*100 : 0; });
  video.addEventListener('durationchange',()=>{ if(stamp===revision && Number.isFinite(video.duration)) main.querySelector('#total').textContent=duration(video.duration); });
  video.addEventListener('play',updatePlayButton); video.addEventListener('pause',updatePlayButton);
  video.addEventListener('pause', () => { if (stamp === revision) persistPlayback(); });
  video.addEventListener('ended', () => { if (stamp === revision) { persistPlayback(); updatePlayButton(); } });
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
  main.querySelector('#seek').addEventListener('input',event=>{ if(Number.isFinite(video.duration)) video.currentTime=Number(event.target.value)/100*video.duration; });
  const progress = readProgress(storage, progressKey)[film.id];
  try { await source(progress && progress.time / progress.duration < 0.95 ? progress.time : 0); } catch(error) { if(stamp===revision && error.name!=='AbortError') showError(error); }
}
function updatePlayButton() {
  const video=main.querySelector('video'), button=main.querySelector('.center-play');
  if(!video || !button) return;
  button.innerHTML=icon(video.paused?'play':'pause'); button.setAttribute('aria-label',video.paused?'Play':'Pause');
}
function saveScreen(state, preview = false) {
  screen=state;
  let panel;
  if(state==='save-progress') panel=`<h2>Saving to phone</h2><p id="percent" class="percent">${preview?'64%':'0%'}</p><progress max="100" value="${preview?64:0}" aria-label="Download progress"></progress><p id="download-note">Downloading the ${kindName(version.kind)} version.</p><button class="secondary" data-action="cancel-save">Cancel</button>`;
  else if(state==='save-ready') panel=`<div class="success-icon">${icon('download')}</div><h2>Ready to save</h2><p>The download is complete.<br>Choose where to keep your video.</p><button class="primary" data-action="deliver-file">${icon('download')}${canShareFile()?'Save video':'Download video'}</button><button class="text-button" data-action="back">Back to film</button><p id="save-note" role="status"></p>`;
  else panel=`<div class="success-icon">${icon('check')}</div><h2>Saved</h2><p>${preview?'The download is complete.':'The video was handed to your device.<br>Check your chosen save location.'}</p><button class="primary" data-action="back">${icon('play')}Back to film</button>`;
  mount(state, `${header(true)}<div class="save-film">${poster(film,'save-poster')}${title(film,'h1')}<p class="runtime">${duration(film.seconds)}</p><div class="save-version badge">${icon(version.kind)}${kindName(version.kind)} ${version.kind==='phone'?'9:16':'16:9'}</div></div><section class="save-panel" aria-live="polite">${panel}</section>`);
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
  if(event.target.id!=='connect-form') return; event.preventDefault();
  const input=main.querySelector('#token'); const value=input.value.trim();
  if(!value) return;
  if(demo) { await loadLibrary(); return; }
  try { localStorage.setItem('mkc.token',value); token=value; } catch { connect('Browser storage is blocked. Enable storage for this site.'); return; }
  await loadLibrary();
});
async function onClick(event) {
  // A tap on the picture of a New & Hot film opens its details, like the info button.
  const stage = event.target.closest('.hot-stage');
  if (stage && !event.target.closest('button') && main.contains(stage)) { chooseFilm(stage.closest('.hot-item').dataset.film, false, stage); return; }
  const button=event.target.closest('button'); if(!button) return;
  if(button.dataset.tab) { go(button.dataset.tab); return; }
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
    case 'search': if(screen!=='library') break; if(tab!=='home') { tab='home'; activeFilter='All'; exploreRow=null; } searching=true; gridMode=true; library(); main.querySelector('#film-search').focus(); break;
    case 'close-search': searching=false; query=''; gridMode=activeFilter!=='All'; library(); main.querySelector('[data-action="search"]')?.focus() || document.querySelector('[data-action="search"]')?.focus(); break;
    case 'clear-filter': activeFilter='All'; query=''; searching=false; gridMode=false; exploreRow=null; library(); main.querySelector('.filters') && (main.querySelector('.filters').scrollLeft=0); main.querySelector('[data-filter="All"]')?.focus({preventScroll:true}); break;
    case 'back': screen==='film' ? library() : filmPage(); break;
    case 'retry': await loadLibrary(); break;
    case 'connect': connect(); break;
    case 'settings': syncAutoplay(); settings.showModal(); break;
    case 'play': await play(); break;
    case 'save': await save(); break;
    case 'cancel-save': filmPage(); break;
    case 'deliver-file': await deliverFile(); break;
    case 'toggle-play': {
      const video=main.querySelector('video');
      if(video.paused) { try { await video.play(); main.querySelector('.player-status').textContent=''; } catch { main.querySelector('.player-status').textContent='Could not play. Return to the film and retry.'; } } else video.pause(); break;
    }
    case 'mute': { const video=main.querySelector('video'); video.muted=!video.muted; button.setAttribute('aria-label',video.muted?'Unmute':'Mute'); button.setAttribute('aria-pressed',String(video.muted)); break; }
    case 'fullscreen': {
      const video=main.querySelector('video');
      try { if(document.fullscreenElement) await document.exitFullscreen(); else if(main.requestFullscreen) await main.requestFullscreen(); else if(video.webkitEnterFullscreen) video.webkitEnterFullscreen(); } catch { main.querySelector('.player-status').textContent='Full screen is not available on this device.'; } break;
    }
  }
}
[main, topbar, tabbar].forEach(el => el.addEventListener('click', onClick));
main.addEventListener('input', event => {
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
// The Autoplay previews switch in Settings; reduced motion turns every preview off whatever the switch says.
const autoplayToggle = document.querySelector('#autoplay-toggle');
function syncAutoplay() {
  autoplayToggle.checked = autoplay && !reduced(); autoplayToggle.disabled = reduced();
  document.querySelector('#autoplay-note').textContent = reduced() ? 'Off because this device asks for reduced motion.' : 'Muted previews on the home, on cards and in More info.';
  live.billboard?.sync(); live.feed?.sync(); live.modal?.sync(); bob.sync();
}
autoplayToggle.addEventListener('change', () => { autoplay = autoplayToggle.checked; writeAutoplay(storage, autoplay); syncAutoplay(); });
onReducedChange(syncAutoplay);
syncAutoplay();
window.addEventListener('pagehide', persistPlayback);
document.addEventListener('visibilitychange', () => { if(document.hidden) persistPlayback(); });
document.querySelector('[data-close-settings]').addEventListener('click',()=>settings.close());
document.querySelector('#forget-token').addEventListener('click',async()=>{
  try {
    operation.abort();
    if(!demo) localStorage.removeItem('mkc.token'); token='';
    await forgetPosters(); clearPosters(); clearPreviews(); catalog=undefined; film=undefined; savedFile=undefined;
    settings.close(); connect();
  } catch { document.querySelector('#settings-status').textContent='Could not clear browser storage. Try again.'; }
});
window.addEventListener('offline',()=>{ if(screen!=='connect') stateScreen('offline'); });
async function start() {
  const preview=demo && params.get('state');
  if(preview==='connect' || preview==='connect-error') { connect(preview==='connect-error'?'Token is wrong or expired':''); return; }
  if(preview==='loading') { loading(); return; }
  if(preview && messages[preview]) { stateScreen(preview); return; }
  if(!demo && !token) { connect(); return; }
  await loadLibrary();
  if(demo && catalog && ['save-progress','saved'].includes(preview)) { film=catalog.films[0]; version=film.versions[0]; saveScreen(preview,true); }
}
void start();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{/* The app also works without offline shell caching. */});
