import { CinemaError, getCatalog, getPoster, getVideoURL, downloadVideo, forgetPosters } from './api.js';
import { PRODUCTS, groupFilms, filterFilms, readProgress, saveProgress, continueFilms } from './catalog.js';

const main = document.querySelector('main');
const settings = document.querySelector('#settings');
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
let token = '';
try { if (!demo) token = localStorage.getItem('mkc.token') || ''; } catch { /* The connect form explains storage failures. */ }
let catalog, film, version, screen, revision = 0, operation = new AbortController();
let savedFile, mediaURL, posterURLs = new Map();
let activeFilter = 'All', query = '', searching = false, gridMode = false, detailOpener;
let storage;
try { storage = localStorage; } catch { /* Watching also works with storage blocked. */ }
const progressKey = demo ? 'mkc.demo.progress' : 'mkc.progress';
const filters = ['All', 'MK Voice', 'Business OS', 'Talent Atlas', 'Job Orbit', 'Suite & apps', 'More', 'Ads', 'Demos', 'Arabic'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const kindName = kind => kind === 'phone' ? 'Phone' : 'Desktop';
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
  expand: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>', arrow: '<path d="m9 5 7 7-7 7"/>', alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || ''}</svg>`;
const title = (f, tag = 'h2', cls = '') => `<${tag} dir="auto" class="film-title ${cls}">${escape(f.title)}</${tag}>`;
const badges = f => `<div class="badges">${f.versions.map(v => `<span class="badge">${icon(v.kind)}${kindName(v.kind)}</span>`).join('')}</div>`;
const poster = (f, cls = '') => `<img class="poster ${cls}" data-poster="${escape(f.id)}" alt="" width="640" height="800">`;
const brand = '<span class="wordmark">MK <span>Cinema</span></span>';
function header(back = false) {
  return `<header class="header ${back ? 'compact' : ''}">${back ? `<button class="icon-button" data-action="back" aria-label="Back to film">${icon('back')}</button>` : ''}<div class="brand">${brand}</div>${!back ? `<div class="header-actions">${screen === 'library' ? `<button class="icon-button" data-action="search" aria-label="Search" aria-expanded="${searching}">${icon('search')}</button>` : ''}<button class="icon-button settings-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div>` : ''}</header>`;
}
function mount(next, html, { focus = true } = {}) {
  persistPlayback();
  operation.abort(); operation = new AbortController(); revision++;
  const oldVideo = main.querySelector('video');
  if (oldVideo) { oldVideo.pause(); oldVideo.removeAttribute('src'); oldVideo.load(); }
  if (mediaURL?.startsWith('blob:')) URL.revokeObjectURL(mediaURL);
  mediaURL = undefined;
  screen = next; main.className = `screen ${next}`; main.innerHTML = html;
  if (focus) main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  void fillPosters(revision);
}
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
      if (stamp === revision) images.forEach(img => { img.src = url; });
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
  const filterScroll = main.querySelector('.filters')?.scrollLeft || 0;
  const groups = groupFilms(catalog.films), featured = groups[0];
  const progress = readProgress(storage, progressKey);
  const matches = filterFilms(groups, activeFilter, query);
  const filtered = gridMode || activeFilter !== 'All' || query.trim();
  const recent = groups.filter(f => Date.parse(f.added) >= Date.now() - 7 * 86400000 && Date.parse(f.added) <= Date.now());
  const rows = [
    ['Continue watching', continueFilms(groups, progress)], ['New this week', recent],
    ...PRODUCTS.map(product => [product, groups.filter(f => f.variants.some(v => v.product === product))]),
    ['Ads & loops', filterFilms(groups, 'Ads')], ['Demos', filterFilms(groups, 'Demos')], ['Arabic', filterFilms(groups, 'Arabic')],
  ];
  screen = 'library';
  mount('library', `${header()}<nav class="filters" aria-label="Filter films">${filters.map(f => `<button class="filter-chip" data-filter="${f}" aria-pressed="${activeFilter === f}">${f}</button>`).join('')}</nav>${searching ? `<div class="search-bar"><label class="sr-only" for="film-search">Search films</label>${icon('search')}<input id="film-search" type="search" placeholder="Titles, products, and cuts" value="${escape(query)}" autocomplete="off"><button class="icon-button" data-action="close-search" aria-label="Close search">${icon('close')}</button></div>` : ''}${filtered ? `<section class="results"><div class="results-head"><div><p class="eyebrow">YOUR COLLECTION</p><h1>${query.trim() ? 'Search results' : escape(activeFilter)}</h1><p class="results-count" role="status">${matches.length} ${matches.length === 1 ? 'title' : 'titles'}</p></div><button class="text-button" data-action="clear-filter">Clear filters</button></div><div class="results-grid">${matches.map(f => card(f, progress)).join('')}</div>${!matches.length ? '<p class="no-results">No films match. Try another title or clear the filters.</p>' : ''}</section>` : `<section class="billboard" aria-label="Newest film">${poster(featured, 'billboard-poster')}<div class="billboard-shade"></div><div class="billboard-copy"><p class="eyebrow">YOUR PRIVATE CINEMA</p>${title(featured, 'h1')}<p class="hero-meta"><span class="new-badge">NEW</span><span>${duration(featured.seconds)}</span><span>${escape(featured.product)}</span><span>${escape(featured.kind)}</span></p><p class="blurb">${escape(featured.blurb)}</p><div class="billboard-actions"><button class="primary" data-action="hero-play" data-id="${escape(featured.id)}">${icon('play')}Play</button><button class="secondary" data-action="hero-info" data-id="${escape(featured.id)}">${icon('info')}More info</button></div></div></section><div class="shelves">${rows.map(([name, films]) => shelf(name, films, progress)).join('')}</div>`}<footer>${groups.length} titles${demo ? ' · Demo collection' : ' · Your private collection'}</footer>`, { focus: false });
  main.querySelector('.filters').scrollLeft = filterScroll;
}
function card(f, progress = {}) {
  const id = f.resumeFilmId || f.id, saved = progress[id];
  return `<article class="card"><button class="film-card" data-film="${escape(id)}" aria-label="More info: ${escape(f.title)}">${poster(f)}<span class="card-title film-title" dir="auto">${escape(f.title)}</span>${f.variants.length > 1 ? `<span class="cut-count">${f.variants.length} cuts</span>` : ''}</button><div class="card-hover"><button class="icon-button card-play" data-play-film="${escape(id)}" aria-label="Play ${escape(f.title)}">${icon('play')}</button><span>${duration(f.seconds)}<br>${escape(f.product)}</span></div>${f.resumeFilmId && saved ? `<progress class="watch-progress" value="${saved.time}" max="${saved.duration}" aria-label="Watch progress for ${escape(f.title)}"></progress>` : ''}</article>`;
}
function shelf(name, films, progress = {}) {
  return films.length ? `<section class="shelf" aria-label="${escape(name)}"><div class="shelf-heading"><h2>${escape(name)}</h2><span>${films.length} ${films.length === 1 ? 'title' : 'titles'}</span></div><div class="card-track">${films.map(f => card(f, progress)).join('')}</div></section>` : '';
}
function chooseFilm(id, directPlay = false) {
  if (screen !== 'film') detailOpener = document.activeElement;
  film = catalog.films.find(f => f.id === id);
  if (!film) return;
  version = film.versions.find(v => v.kind === (matchMedia('(min-width: 900px)').matches ? 'desktop' : 'phone')) || film.versions[0];
  if (directPlay) void play(); else filmPage();
}
function versionChoices(tiles = true) {
  return `<div class="version-choices ${tiles ? 'tiles' : 'chips'}" role="group" aria-label="Film version">${film.versions.map(v=>`<button class="version ${v===version ? 'selected' : ''}" data-version="${v.kind}" aria-pressed="${v===version}">${tiles ? poster(film) : ''}<span>${icon(v.kind)}${kindName(v.kind)} ${v.kind==='phone'?'9:16':'16:9'}</span>${v===version && tiles ? `<span class="selected-mark">${icon('check')}</span>`:''}</button>`).join('')}</div>`;
}
function filmPage() {
  savedFile = undefined;
  if (!main.classList.contains('library')) library();
  main.querySelector('#film-detail')?.remove();
  const group = groupFilms(catalog.films).find(g => g.variants.some(v => v.id === film.id));
  const selected = group.variants.find(v => v.id === film.id);
  const related = groupFilms(catalog.films).filter(g => g.id !== group.id && g.product === selected.product);
  let release = '';
  try { const url = new URL(film.release); if (url.protocol === 'https:') release = `<a class="release-link" href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">View release ${icon('arrow')}</a>`; } catch { /* Old catalogs can omit a release link. */ }
  main.insertAdjacentHTML('beforeend', `<dialog id="film-detail" aria-labelledby="detail-title"><button class="icon-button detail-close" data-action="close-detail" aria-label="Close details">${icon('close')}</button><div class="detail-art">${poster(film, 'detail-poster')}</div><div class="detail-body"><h1 id="detail-title" class="film-title" dir="auto">${escape(film.title)}</h1><p class="detail-meta">${duration(film.seconds)} · ${escape(selected.product)} · ${escape(selected.kind)}</p><p class="detail-blurb">${escape(selected.blurb)}</p><div class="film-actions"><button class="primary" data-action="play">${icon('play')}Play</button><button class="secondary" data-action="save">${icon('download')}Save to phone</button></div>${group.variants.length > 1 ? `<div class="variant-choices" role="group" aria-label="Film cut">${group.variants.map(v => `<button class="variant filter-chip" data-variant="${escape(v.id)}" aria-pressed="${v.id === film.id}">${escape(v.variant || v.title)}</button>`).join('')}</div>` : ''}${versionChoices(false)}<p class="date-added">Added <time>${escape(film.added || 'Date unavailable')}</time></p>${release}${shelf('More like this', related)}</div></dialog>`);
  screen = 'film';
  const detail = main.querySelector('#film-detail');
  detail.addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
  detail.showModal();
  void fillPosters(revision);
}
function closeDetail() {
  main.querySelector('#film-detail')?.close();
  main.querySelector('#film-detail')?.remove();
  screen = 'library';
  if (detailOpener?.isConnected) detailOpener.focus({ preventScroll: true });
  else main.querySelector('[data-action="hero-info"], .film-card, [data-action="clear-filter"]')?.focus({ preventScroll: true });
}
function persistPlayback() {
  const video = main.querySelector('video');
  if (video && film && video.readyState >= 1) saveProgress(storage, film.id, video.currentTime, video.duration, progressKey);
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
main.addEventListener('click',async event=>{
  const button=event.target.closest('button'); if(!button) return;
  if(button.dataset.playFilm) { chooseFilm(button.dataset.playFilm, true); return; }
  if(button.dataset.filter) { activeFilter=button.dataset.filter; gridMode=true; library(); main.querySelector(`[data-filter="${activeFilter}"]`)?.focus({preventScroll:true}); return; }
  if(button.dataset.variant) { chooseFilm(button.dataset.variant); [...main.querySelectorAll('[data-variant]')].find(el => el.dataset.variant === film.id)?.focus(); return; }
  if(button.dataset.film) { chooseFilm(button.dataset.film); return; }
  if(button.dataset.version) { version=film.versions.find(v=>v.kind===button.dataset.version); filmPage(); main.querySelector(`[data-version="${version.kind}"]`)?.focus(); return; }
  switch(button.dataset.action) {
    case 'hero-play': chooseFilm(button.dataset.id, true); break;
    case 'hero-info': chooseFilm(button.dataset.id); break;
    case 'close-detail': closeDetail(); break;
    case 'search': searching=true; gridMode=true; library(); main.querySelector('#film-search').focus(); break;
    case 'close-search': searching=false; query=''; gridMode=activeFilter!=='All'; library(); main.querySelector('[data-action="search"]').focus(); break;
    case 'clear-filter': activeFilter='All'; query=''; searching=false; gridMode=false; library(); main.querySelector('.filters').scrollLeft=0; main.querySelector('[data-filter="All"]').focus({preventScroll:true}); break;
    case 'back': screen==='film' ? library() : filmPage(); break;
    case 'retry': await loadLibrary(); break;
    case 'connect': connect(); break;
    case 'settings': settings.showModal(); break;
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
});
main.addEventListener('input', event => {
  if(event.target.id !== 'film-search') return;
  const caret = event.target.selectionStart;
  query = event.target.value; library();
  const input = main.querySelector('#film-search'); input.focus(); input.setSelectionRange(caret, caret);
});
window.addEventListener('pagehide', persistPlayback);
document.addEventListener('visibilitychange', () => { if(document.hidden) persistPlayback(); });
document.querySelector('[data-close-settings]').addEventListener('click',()=>settings.close());
document.querySelector('#forget-token').addEventListener('click',async()=>{
  try {
    operation.abort();
    if(!demo) localStorage.removeItem('mkc.token'); token='';
    await forgetPosters(); clearPosters(); catalog=undefined; film=undefined; savedFile=undefined;
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
