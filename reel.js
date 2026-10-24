import { reduced } from './motion.js';
import { startPreview } from './previews.js';

// Shuffle: the whole cinema as a reel. One film fills the screen and plays from the start; at its end the next one
// comes up, and a swipe, the wheel or the arrow keys move back and forth. The order is new every time it opens.

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
// for every film after. source(id) gives { getURL, canDownload } (the same streams as previews and the player).
export function mountReel(root, { source, icon, onActive = () => {}, onClose = () => {}, more = () => false }) {
  const reel = root.querySelector('.reel'), track = reel.querySelector('.reel-track'), video = reel.querySelector('.reel-video');
  const count = reel.querySelector('.reel-count b'), note = reel.querySelector('.reel-note'), soundButton = reel.querySelector('[data-reel=sound]');
  let active = null, playback = null, frame = 0, timer = 0, held = false, soundOn = true;

  const items = () => [...track.querySelectorAll('.reel-item')];
  const observer = globalThis.IntersectionObserver && new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) activate(entry.target);
  }, { root: track, threshold: 0.6 });
  const watch = () => items().forEach(item => { if (!item.dataset.watched) { item.dataset.watched = '1'; observer?.observe(item); } });

  function setSound(on, refused = false) {
    soundOn = on; video.muted = !on;
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.setAttribute('aria-label', on ? 'Mute' : 'Turn sound on');
    soundButton.innerHTML = icon(on ? 'sound' : 'mute');
    reel.classList.toggle('is-quiet', refused && !on); // "Tap for sound" while the browser keeps the first film muted
  }
  // The progress line under the film follows its time every frame.
  function tick() {
    cancelAnimationFrame(frame);
    const step = () => {
      if (active && video.duration) active.style.setProperty('--p', (video.currentTime / video.duration).toFixed(4));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }
  function activate(item) {
    if (item === active) return;
    playback?.stop(); cancelAnimationFrame(frame); clearTimeout(timer);
    active?.classList.remove('is-active', 'is-live', 'is-ended', 'is-failed');
    active?.style.removeProperty('--p');
    active = item; held = false;
    reel.classList.remove('is-paused');
    note.textContent = '';
    item.classList.add('is-active');
    const stage = item.querySelector('.reel-stage');
    stage.insertBefore(video, stage.querySelector('.reel-shade'));
    count.textContent = `${item.dataset.n} / ${reel.dataset.total}`;
    onActive(item);
    playback = startPreview(video, {
      ...source(item.dataset.film), start: 0, sound: soundOn,
      onPlaying: () => { item.classList.add('is-live'); if (held) video.pause(); tick(); },
      onEnded: () => ended(item),
      onFail: () => failed(item),
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
  // With reduced motion the reel waits at the end of a film instead of moving on by itself.
  function ended(item) {
    if (item !== active) return;
    if (reduced()) { item.classList.add('is-ended'); reel.classList.add('is-paused'); } else go(1);
  }
  function failed(item) {
    if (item !== active) return;
    item.classList.add('is-failed');
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
      ({ close: onClose, sound: () => setSound(!soundOn), next: () => go(1), prev: () => go(-1), fullscreen })[button.dataset.reel]?.();
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
    else if (event.key === 'Escape') onClose();
    else return;
    event.preventDefault();
  }
  const onHide = () => { if (document.hidden && active && !video.paused) togglePause(); };

  reel.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  watch();
  if (!observer) activate(items()[0]);
  return {
    destroy() {
      observer?.disconnect(); playback?.stop(); cancelAnimationFrame(frame); clearTimeout(timer);
      reel.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    },
  };
}
