import { CinemaError, getCatalog, getPoster, getVideoURL, downloadVideo, forgetPosters } from './api.js';

const main = document.querySelector('main');
const settings = document.querySelector('#settings');
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
let token = '';
try { if (!demo) token = localStorage.getItem('mkc.token') || ''; } catch { /* The connect form explains storage failures. */ }
let catalog, film, version, screen, revision = 0, operation = new AbortController();
let savedFile, mediaURL, posterURLs = new Map();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const kindName = kind => kind === 'phone' ? 'Phone' : 'Desktop';
const iconPaths = {
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
  return `<header class="header ${back ? 'compact' : ''}">${back ? `<button class="icon-button" data-action="back" aria-label="Back to ${screen === 'film' ? 'library' : 'film'}">${icon('back')}</button>` : ''}<div class="brand">${brand}${!back ? '<span class="owner">MK’S PRIVATE COLLECTION</span>' : ''}</div>${!back ? `<button class="icon-button settings-button" data-action="settings" aria-label="Settings">${icon('settings')}</button>` : ''}</header>`;
}
function mount(next, html, { focus = true } = {}) {
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
  const featured = catalog.films[0];
  screen = 'library';
  mount('library', `${header()}<div class="programme"><section class="feature"><div class="issue" aria-hidden="true">PRIVATE SCREENING</div>${poster(featured,'feature-poster')}<div class="feature-copy"><p class="eyebrow">NEW DROP</p>${title(featured,'h1')}<p class="runtime">${duration(featured.seconds)}</p>${badges(featured)}<button class="primary watch" data-film="${escape(featured.id)}">${icon('play')}Watch film</button></div></section><section class="collection"><div class="collection-head"><h2>All films</h2><span>${catalog.films.length} FILMS</span></div><div class="film-list">${catalog.films.map((f,i)=>`<button class="film-row" data-film="${escape(f.id)}">${poster(f)}<span class="row-copy">${i===0 ? '<span class="new-badge">NEW</span>' : ''}<span dir="auto" class="film-title">${escape(f.title)}</span><span class="row-meta"><span class="runtime">${duration(f.seconds)}</span>${badges(f)}</span></span>${icon('arrow')}</button>`).join('')}</div></section></div><footer>Library${demo ? ' · Demo collection' : ''}</footer>`);
}
function chooseFilm(id) {
  film = catalog.films.find(f => f.id === id);
  if (!film) return;
  version = film.versions.find(v => v.kind === (matchMedia('(min-width: 900px)').matches ? 'desktop' : 'phone')) || film.versions[0];
  filmPage();
}
function versionChoices(tiles = true) {
  return `<div class="version-choices ${tiles ? 'tiles' : 'chips'}" role="group" aria-label="Film version">${film.versions.map(v=>`<button class="version ${v===version ? 'selected' : ''}" data-version="${v.kind}" aria-pressed="${v===version}">${tiles ? poster(film) : ''}<span>${icon(v.kind)}${kindName(v.kind)} ${v.kind==='phone'?'9:16':'16:9'}</span>${v===version && tiles ? `<span class="selected-mark">${icon('check')}</span>`:''}</button>`).join('')}</div>`;
}
function filmPage() {
  savedFile = undefined; screen = 'film';
  mount('film', `${header(true)}<div class="film-layout">${poster(film,'film-poster')}<section class="film-info">${title(film,'h1')}<p class="runtime">${duration(film.seconds)}</p>${versionChoices()}<div class="film-actions"><button class="primary" data-action="play">${icon('play')}Play</button><button class="secondary" data-action="save">${icon('download')}Save to phone</button></div></section></div>`);
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
  video.addEventListener('timeupdate',()=>{ if(stamp!==revision) return; lastTime=video.currentTime; if(recoveryUsed && lastTime>recoveryTime+1) recoveryUsed=false; main.querySelector('#elapsed').textContent=duration(lastTime); main.querySelector('#seek').value=video.duration ? lastTime/video.duration*100 : 0; });
  video.addEventListener('durationchange',()=>{ if(stamp===revision && Number.isFinite(video.duration)) main.querySelector('#total').textContent=duration(video.duration); });
  video.addEventListener('play',updatePlayButton); video.addEventListener('pause',updatePlayButton);
  video.addEventListener('ended',updatePlayButton);
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
  try { await source(); } catch(error) { if(stamp===revision && error.name!=='AbortError') showError(error); }
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
  if(button.dataset.film) { chooseFilm(button.dataset.film); return; }
  if(button.dataset.version) { version=film.versions.find(v=>v.kind===button.dataset.version); filmPage(); return; }
  switch(button.dataset.action) {
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
