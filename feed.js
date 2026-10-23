import { chase, feedWindow, feedProgress, feedTime } from './motion.js';

// New & Hot: scroll-driven films, adapted from the portfolio's pop-and-ship film. The film nearest the middle of
// the screen moves only while you scroll and stops about 50 ms after the last input (see chase in motion.js).
// Its time is a function of scroll position, so scrolling back rewinds it. Only that one film holds a video source.
export function mountFeed(root, { source, enabled }) {
  const items = [...root.querySelectorAll('.hot-item')].map(el => ({ el, stage: el.querySelector('.hot-stage'), video: el.querySelector('video'), bar: el.querySelector('.hot-bar'), id: el.dataset.film }));
  const dots = [...root.querySelectorAll('.hot-rail i')], count = root.querySelector('.hot-rail-count');
  let active = null, candidate = null, frame = 0, held = false;
  // Only films on screen are candidates, so anything offscreen is let go of (and a long feed stays cheap).
  const onScreen = new Set(), observer = globalThis.IntersectionObserver && new IntersectionObserver(entries => {
    for (const entry of entries) { const item = items.find(film => film.stage === entry.target); if (entry.isIntersecting) onScreen.add(item); else onScreen.delete(item); }
  });
  items.forEach(item => observer?.observe(item.stage));

  // Distance between this film's centre and its neighbour's: the scroll one film is given.
  function pitchOf(item) {
    const index = items.indexOf(item), here = item.stage.getBoundingClientRect(), next = items[index + 1] || items[index - 1];
    return next ? Math.abs(next.stage.getBoundingClientRect().top - here.top) : here.height;
  }
  const progress = item => { const rect = item.stage.getBoundingClientRect(); return feedProgress(rect.top + rect.height / 2, innerHeight / 2, pitchOf(item)); };

  function deactivate() {
    if (!active) return;
    const { item, abort } = active; active = null;
    abort.abort();
    item.el.classList.remove('is-active', 'is-live'); delete item.el.dataset.active; delete item.el.dataset.live;
    item.video.onloadedmetadata = item.video.onseeked = item.video.onplaying = item.video.onerror = null;
    item.video.pause(); item.video.removeAttribute('src'); item.video.load();
    item.bar.style.transform = '';
    dots.forEach(dot => dot.classList.remove('on'));
  }
  function fetchSource(a) {
    a.src.getURL({ signal: a.abort.signal, ...(a.attempt === 1 ? { fresh: true } : a.attempt > 1 ? { whole: true } : {}) }).then(url => {
      if (active === a) a.item.video.src = url;
    }, () => {});
  }
  function activate(item) {
    deactivate();
    const a = active = { item, abort: new AbortController(), ready: false, window: null, target: -1, changedAt: 0, seekAt: 0, stepping: false, attempt: 0, src: source(item.id) };
    item.el.classList.add('is-active'); item.el.dataset.active = 'true';
    const index = items.indexOf(item);
    dots.forEach((dot, at) => dot.classList.toggle('on', at === index));
    if (count) count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
    if (!enabled()) return;
    const video = item.video, reveal = () => { if (active === a) { item.el.classList.add('is-live'); item.el.dataset.live = 'true'; } };
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.loop = false;
    video.onloadedmetadata = () => {
      if (active !== a) return;
      a.duration = video.duration; a.ready = true;
      video.currentTime = feedTime(progress(item), feedWindow(a.duration, pitchOf(item))); // go where the scroll is before anything shows
    };
    video.onseeked = reveal; video.onplaying = reveal;
    video.onerror = () => {
      if (active !== a || a.ready) return;
      a.attempt += 1;
      if (a.attempt === 1 || (a.attempt === 2 && a.src.canDownload)) fetchSource(a);
    };
    fetchSource(a);
  }
  function drive(a, now, q) {
    const video = a.item.video, target = feedTime(q, feedWindow(a.duration, pitchOf(a.item)));
    if (Math.abs(target - a.target) > 1e-4) { a.target = target; a.changedAt = now; }
    if (video.readyState < 1) return;
    const move = chase({ target, time: video.currentTime, quietFor: now - a.changedAt });
    if (move.act === 'seek') {
      if (now - a.seekAt < 70) return; // one seek at a time keeps a streamed film from stalling
      a.seekAt = now; video.pause(); video.currentTime = move.to;
    } else if (move.act === 'play') {
      if (a.stepping) { if (now - a.seekAt > 70) { a.seekAt = now; video.currentTime = target; } return; }
      if (Math.abs(video.playbackRate - move.rate) > Math.max(0.02, move.rate * 0.06)) video.playbackRate = move.rate;
      // Low Power Mode on iPhone refuses play(); stepping the time still shows every frame.
      if (video.paused && !video.seeking) video.play().catch(error => { if (error.name === 'NotAllowedError') a.stepping = true; });
    } else if (!video.paused) video.pause();
  }
  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (document.hidden) return;
    let best = null, nearest = Infinity;
    for (const item of observer ? onScreen : items) {
      const rect = item.stage.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight || Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0) < rect.height * 0.25) continue;
      const distance = Math.abs(rect.top + rect.height / 2 - innerHeight / 2);
      if (distance < nearest) { best = item; nearest = distance; }
    }
    if (!best) { candidate = null; deactivate(); }
    else if (best !== active?.item) {
      // A new film must stay nearest the middle for 150 ms before it loads, so a fast flick does not start a download per film.
      if (candidate?.item !== best) candidate = { item: best, since: now };
      if (now - candidate.since >= 150) activate(best);
    } else candidate = null;
    if (!active) return;
    const q = progress(active.item);
    active.item.bar.style.transform = `scaleX(${q.toFixed(4)})`;
    if (held) active.item.video.pause();
    else if (active.ready && enabled()) drive(active, now, q);
  }
  const onHidden = () => { if (document.hidden) active?.item.video.pause(); };
  document.addEventListener('visibilitychange', onHidden);
  frame = requestAnimationFrame(tick);

  return {
    // Called when the autoplay switch or reduced motion changes.
    sync() { const item = active?.item; deactivate(); if (item) activate(item); },
    // The More info sheet covers the feed, so it holds the film while open.
    hold(on) { held = on; },
    destroy() { cancelAnimationFrame(frame); observer?.disconnect(); deactivate(); document.removeEventListener('visibilitychange', onHidden); },
  };
}
