import { reduced } from './motion.js';
import { startPreview } from './previews.js';
import { paleness } from './ambient.js';

// Reels: the cinema as a reel. One film fills the screen and plays from the start; at its end the next one comes
// up (or it waits, as the owner chose in Settings), and a swipe, the wheel or the arrow keys move back and forth.

const same = (a, b) => Boolean(a && b) && (a === b || (a.id !== undefined && a.id === b.id));

// Every title once, in a random order where one product never plays twice in a row if that can be avoided, so a
// brand's ads do not bunch up. Each step draws a product at random, weighted by the titles it has left, except when
// one product holds more than half of what is left: then it must go now, or it would end up back to back.
// `after` is the film that played last (the end of the previous round): the new round never opens with it or its product.
export function shuffleDeck(items, { random = Math.random, key = item => item.product, after = null } = {}) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(key(item))) groups.set(key(item), []);
    groups.get(key(item)).push(item);
  }
  for (const group of groups.values()) {
    for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
  }
  const deck = [];
  let last = after;
  while (deck.length < items.length) {
    const left = items.length - deck.length, blocked = last ? key(last) : undefined;
    const filled = [...groups].filter(([, group]) => group.length);
    const [bigKey, big] = filled.reduce((a, b) => b[1].length > a[1].length ? b : a);
    const open = filled.filter(([name]) => name !== blocked);
    let pick;
    if (big.length * 2 > left && bigKey !== blocked) pick = big;
    else if (open.length) {
      let roll = random() * open.reduce((sum, [, group]) => sum + group.length, 0);
      pick = (open.find(([, group]) => (roll -= group.length) < 0) || open.at(-1))[1];
    } else pick = filled[0][1]; // only the last film's product is left, so it has to repeat
    let item = pick.pop();
    if (same(item, after) && pick.length) { pick.unshift(item); item = pick.pop(); }
    deck.push(item);
    last = item;
  }
  return deck;
}

// The reel's behaviour over the markup app.js draws (.reel, .reel-track, .reel-item). There is one <video>, and it
// moves into whichever film is on screen: once the opening tap has started it, an iPhone lets it play with sound
// for every film after. source(id, shape) gives { getURL, canDownload } for that cut (the player's streams).
// onError gets the errors only the app can answer (token, access, rate limit); say() speaks to screen readers.
// sound: start with sound. advance(): move on when a film ends (else it waits). resume: { index, time } comes back
// to the film the reel showed when it was left, where it was. snapshot() gives that for the next visit.
const STOP_AFTER = 3; // films in a row that fail before the reel stops moving on by itself
export function mountReel(root, { source, icon, sound = true, advance = () => true, resume = null, onActive = () => {}, onError = () => {}, say = () => {}, more = () => false }) {
  const reel = root.querySelector('.reel'), track = reel.querySelector('.reel-track'), video = reel.querySelector('.reel-video');
  const count = reel.querySelector('.reel-count b'), note = reel.querySelector('.reel-note'), soundButton = reel.querySelector('[data-reel=sound]');
  // `wanted` is the owner's choice; `soundOn` is what plays now, which a browser refusing sound can turn off.
  let active = null, playback = null, frame = 0, timer = 0, held = false, soundOn = sound, wanted = sound, failures = 0, told = false, sampled = 0, from = 0;

  const items = () => [...track.querySelectorAll('.reel-item')];
  const observer = globalThis.IntersectionObserver && new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) activate(entry.target);
  }, { root: track, threshold: 0.6 });
  // Where a 16:9 film sits on a portrait phone (motion.css): between the counter (--reel-head) and the copy and rail
  // (--reel-room, per film, as titles wrap differently), so neither covers it. Measured again when anything resizes.
  function place() {
    const box = reel.getBoundingClientRect();
    const tops = [...reel.querySelectorAll('.reel-rail button')].map(button => button.getBoundingClientRect()).filter(r => r.width > 2).map(r => r.top - box.top);
    const rail = tops.length ? Math.min(...tops) : box.height;
    reel.style.setProperty('--reel-head', `${Math.round(reel.querySelector('.reel-count').getBoundingClientRect().bottom - box.top + 8)}px`);
    for (const item of items()) {
      const copy = item.querySelector('.reel-copy'), first = copy.firstElementChild;
      const top = Math.min(copy.offsetTop + (first ? first.offsetTop : 0), rail);
      item.style.setProperty('--reel-room', `${Math.round(item.clientHeight - top + 8)}px`);
    }
  }
  const resizes = globalThis.ResizeObserver && new ResizeObserver(() => place());
  resizes?.observe(track);
  const watch = () => {
    items().forEach(item => { if (!item.dataset.watched) { item.dataset.watched = '1'; observer?.observe(item); resizes?.observe(item.querySelector('.reel-copy')); } });
    place();
  };

  function setSound(on, refused = false) {
    soundOn = on; video.muted = !on;
    if (!refused) wanted = on;
    soundButton.setAttribute('aria-label', on ? 'Mute' : 'Turn sound on');
    soundButton.innerHTML = icon(on ? 'sound' : 'mute');
    reel.classList.toggle('is-quiet', refused && !on); // "Tap for sound" while the browser keeps the films muted
    if (refused && !told) { told = true; say('Sound is off. Use the sound button to turn it on.'); }
  }
  // The progress line follows the film every frame. About once a second the frame's brightness also sets the shade
  // under the white type (--pale), so a bright scene behind a dark poster still reads. A stream from another origin
  // cannot be read; then the poster's value stays.
  function tick() {
    cancelAnimationFrame(frame);
    const step = now => {
      if (active && video.duration) active.style.setProperty('--p', (video.currentTime / video.duration).toFixed(4));
      if (active && !video.paused && now - sampled > 900) {
        sampled = now;
        const pale = paleness(video);
        if (pale !== null) active.querySelector('.reel-stage').style.setProperty('--pale', pale.toFixed(2));
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }
  function activate(item) {
    if (item === active) return;
    playback?.stop(); cancelAnimationFrame(frame); clearTimeout(timer);
    active?.classList.remove('is-active', 'is-live', 'is-ended', 'is-failed');
    active?.style.removeProperty('--p');
    active?.setAttribute('aria-hidden', 'true');
    active = item; held = false;
    reel.classList.remove('is-paused');
    note.textContent = '';
    item.classList.add('is-active');
    item.removeAttribute('aria-hidden');
    const stage = item.querySelector('.reel-stage');
    stage.insertBefore(video, stage.querySelector('.reel-shade'));
    count.textContent = `${item.dataset.n} / ${reel.dataset.total}`;
    onActive(item);
    from = item === resumed ? resume.time : 0; resumed = null;
    playback = startPreview(video, {
      ...source(item.dataset.film, item.dataset.shape), start: 0, from, sound: soundOn, recover: true,
      onPlaying: () => { failures = 0; item.classList.add('is-live'); if (held) video.pause(); tick(); },
      onEnded: () => ended(item),
      onFail: error => failed(item, error),
      onMuted: () => setSound(false, true),
    });
    // The reel never runs out: near the end of a round the next round is drawn.
    const all = items();
    if (all.indexOf(item) >= all.length - 3 && more()) watch();
  }
  function go(step) {
    const all = items(), next = all[all.indexOf(active) + step];
    if (next) track.scrollTo({ top: next.offsetTop, behavior: reduced() ? 'auto' : 'smooth' });
  }
  // With reduced motion, or "When a film ends: Wait", nothing moves on by itself: a film that ends waits for a
  // swipe or a tap (which plays it again).
  function ended(item) {
    if (item !== active) return;
    if (reduced() || !advance()) { item.classList.add('is-ended'); reel.classList.add('is-paused'); } else go(1);
  }
  // A film that cannot play moves on after 2.5 s, but a run of them (no connection, GitHub down) stops the reel
  // rather than spinning through the whole cinema; a token, access or rate-limit problem goes back to the app.
  function failed(item, error) {
    if (item !== active) return;
    if (['token', 'access', 'rate-limit'].includes(error?.code)) { onError(error); return; }
    item.classList.add('is-failed');
    failures += 1;
    if (failures >= STOP_AFTER) { note.textContent = 'Films are not playing right now. Check the connection, then swipe to try again.'; return; }
    note.textContent = 'This film cannot play here. Swipe for the next one.';
    if (!reduced()) timer = setTimeout(() => { if (active === item) go(1); }, 2500);
  }
  function togglePause() {
    if (!active || active.classList.contains('is-failed')) return;
    if (active.classList.contains('is-ended')) { active.classList.remove('is-ended'); video.currentTime = 0; }
    held = !video.paused;
    if (held) video.pause(); else video.play().catch(() => {});
    reel.classList.toggle('is-paused', held);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (reel.requestFullscreen) await reel.requestFullscreen();
      else video.webkitEnterFullscreen?.();
    } catch { /* Some phones only show films full screen in their own player. */ }
  }

  function onClick(event) {
    const button = event.target.closest('[data-reel]');
    if (button) {
      ({ sound: () => setSound(!soundOn), next: () => go(1), prev: () => go(-1), fullscreen })[button.dataset.reel]?.();
      return;
    }
    if (!event.target.closest('button, a') && event.target.closest('.reel-item')) togglePause();
  }
  function onKey(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const onButton = Boolean(event.target.closest?.('button'));
    if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'j') go(1);
    else if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'k') go(-1);
    else if (event.key === ' ' && !onButton) togglePause();
    else if (event.key === 'm') setSound(!soundOn);
    else return;
    event.preventDefault();
  }
  const onHide = () => { if (document.hidden && active && !video.paused) togglePause(); };

  reel.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  setSound(soundOn);
  // Coming back: the track starts on the film it was left on, so the observer picks that one first.
  let resumed = resume && items()[resume.index] || null;
  if (resumed) track.scrollTop = resumed.offsetTop;
  watch();
  if (!observer) activate(resumed || items()[0]);
  return {
    // Where the reel is, for coming back within the visit. A film that ended or failed starts again from its start.
    snapshot() {
      const index = items().indexOf(active), time = video.currentTime || 0;
      const done = !active || active.classList.contains('is-ended') || active.classList.contains('is-failed') || (video.duration && time > video.duration - 1);
      return { index: Math.max(0, index), time: done ? 0 : time, sound: wanted };
    },
    destroy() {
      observer?.disconnect(); resizes?.disconnect(); playback?.stop(); cancelAnimationFrame(frame); clearTimeout(timer);
      reel.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    },
  };
}
