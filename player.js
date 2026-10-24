// The film player, Netflix phone style: the film fills the screen edge to edge and the controls float over it,
// fading 3 s after the last touch while it plays. A landscape cut on a phone held upright is turned sideways with
// CSS (iPhone Safari cannot lock the orientation or put an element full screen), so it fills the phone as if the
// phone were turned. Every touch is mapped into that rotated frame: taps, double-taps and the scrubber.
// The DOM is drawn by app.js (playerView); this module owns what happens in it. app.js keeps the stream, the
// fresh-link retry and the saved progress.

export const SEEK_STEP = 10;
export const HIDE_AFTER = 3000;
const DOUBLE_TAP = 260; // ms between the taps of a double-tap
const TAP_SLOP = 12; // px a finger may move and still tap
const PINCH = 1.12; // spread (or squeeze) ratio that switches Fill (or Fit)

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const clock = seconds => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
};
// A phone held upright turns a landscape film sideways. A phone in landscape, a tablet or a desktop never rotates.
export const shouldRotate = ({ filmW, filmH, viewW, viewH }) => filmW > filmH && viewH > viewW && Math.min(viewW, viewH) < 600;
// The player is turned 90° clockwise: the frame's left edge lies along the top of the screen and its x axis runs
// down the screen. These map a screen point into the frame.
export const along = (x, y, rect, rotated) => rotated ? { at: y - rect.top, size: rect.height } : { at: x - rect.left, size: rect.width };
export const trackFraction = (x, y, rect, rotated) => { const { at, size } = along(x, y, rect, rotated); return size > 0 ? clamp(at / size, 0, 1) : 0; };
export const tapZone = (at, size) => at < size / 3 ? 'back' : at > size * 2 / 3 ? 'forward' : 'middle';
// How much larger a picture shown whole must grow to fill the frame (1 when the shapes match).
export const fillScale = (frameW, frameH, filmW, filmH) => filmW && filmH && frameW && frameH ? Math.max(frameW / filmW, frameH / filmH) / Math.min(frameW / filmW, frameH / filmH) : 1;

export function mountPlayer(root, { video, landscape, seconds = 0, fit = 'fit', reduced = () => false, icon, onFit = () => {}, onBack = () => {}, onCut = () => {} }) {
  const frame = root.querySelector('.np');
  const $ = selector => frame.querySelector(selector);
  const playButton = $('[data-np=play]'), muteButton = $('[data-np=mute]'), fitButton = $('[data-np=fit]');
  const fullButton = $('[data-np=fullscreen]'), airButton = $('[data-np=airplay]');
  const scrub = $('.np-scrub'), track = $('.np-track'), bubble = $('.np-bubble');
  const elapsed = $('[data-np-elapsed]'), left = $('[data-np-left]');
  let hideTimer = 0, tapTimer = 0, frameLoop = 0, rippleTimer = 0, dead = false;
  let mouse = false, keyboard = false, rotated = false, scrubbing = null, lastTap = null, streak = { side: '', count: 0, until: 0 };
  const pointers = new Map();
  let pinch = null;

  const length = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  // --- Layout: the frame is the viewport, or the viewport turned sideways. -----------------------------------
  function layout() {
    const viewW = innerWidth, viewH = innerHeight;
    const filmW = video.videoWidth || (landscape ? 16 : 9), filmH = video.videoHeight || (landscape ? 9 : 16);
    rotated = shouldRotate({ filmW, filmH, viewW, viewH });
    frame.style.setProperty('--vw', `${viewW}px`); frame.style.setProperty('--vh', `${viewH}px`);
    frame.toggleAttribute('data-rotated', rotated);
  }
  // --- Controls: shown on a touch, gone 3 s after the last one while the film plays, kept while it is paused. --
  const showing = () => frame.dataset.ui === 'on';
  function show() {
    frame.dataset.ui = 'on';
    clearTimeout(hideTimer);
    if (!video.paused && !scrubbing) hideTimer = setTimeout(hide, HIDE_AFTER);
    tick();
  }
  function hide() {
    clearTimeout(hideTimer);
    // A keyboard user on a control keeps them, and so does a mouse resting on one; a finger that tapped one does not.
    if ((keyboard && frame.querySelector('.np-ui :focus-visible')) || (mouse && frame.querySelector('.np-ui button:hover, .np-scrub:hover'))) { hideTimer = setTimeout(hide, HIDE_AFTER); return; }
    frame.dataset.ui = 'off';
  }
  // --- Time: the scrubber, elapsed and remaining. Smooth while the controls are up and the film plays. ---------
  let said = '';
  function paint(time = video.currentTime) {
    const total = length() || seconds, p = total ? clamp(time / total, 0, 1) : 0; // the catalog length until the film says
    frame.style.setProperty('--p', p.toFixed(4));
    const text = `${clock(time)} of ${clock(total)}`;
    if (text !== said) {
      said = text;
      elapsed.textContent = clock(time); left.textContent = `-${clock(total - time)}`;
      scrub.setAttribute('aria-valuemax', String(Math.round(total)));
      scrub.setAttribute('aria-valuenow', String(Math.round(time)));
      scrub.setAttribute('aria-valuetext', text);
    }
    let buffered = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= time + 0.5) buffered = Math.max(buffered, video.buffered.end(i));
    frame.style.setProperty('--b', total ? clamp(buffered / total, 0, 1).toFixed(4) : '0');
  }
  function tick() {
    cancelAnimationFrame(frameLoop);
    if (dead) return;
    if (!scrubbing) paint();
    if (!video.paused && showing()) frameLoop = requestAnimationFrame(tick);
  }
  function syncPlay() {
    playButton.innerHTML = icon(video.paused ? 'play' : 'pause');
    playButton.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    frame.toggleAttribute('data-paused', video.paused);
  }
  function syncMute() {
    muteButton.innerHTML = icon(video.muted ? 'mute' : 'sound');
    muteButton.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  }
  function syncFit() {
    const fill = fit === 'fill';
    video.style.objectFit = fill ? 'cover' : 'contain';
    frame.dataset.fit = fit;
    fitButton.setAttribute('aria-pressed', String(fill));
    fitButton.querySelector('svg').outerHTML = icon(fill ? 'fit' : 'fill');
  }
  function setFit(next) {
    if (next === fit) return;
    const before = frame.getBoundingClientRect();
    const [w, h] = rotated ? [before.height, before.width] : [before.width, before.height];
    const grow = fillScale(w, h, video.videoWidth, video.videoHeight);
    fit = next; syncFit(); onFit(fit);
    // The picture zooms between whole and filled instead of jumping (object-fit itself cannot animate).
    if (!reduced() && grow > 1.01 && video.animate) video.animate([{ transform: `scale(${next === 'fill' ? 1 / grow : grow})` }, { transform: 'scale(1)' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function seekTo(time) {
    const total = length();
    if (!total) return;
    video.currentTime = clamp(time, 0, total);
    paint(video.currentTime);
  }
  const seekBy = delta => seekTo(video.currentTime + delta);
  async function togglePlay() {
    if (video.paused || video.ended) {
      try { await video.play(); $('.player-status').textContent = ''; }
      catch (error) { if (error?.name !== 'AbortError') $('.player-status').textContent = 'Could not play. Return to the film and retry.'; }
    } else video.pause();
  }
  function toggleMute() { video.muted = !video.muted; syncMute(); }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await root.requestFullscreen({ navigationUI: 'hide' });
      // Android Chrome can hold landscape once the player is full screen; iPhone Safari never gets here.
      const orientation = globalThis.screen?.orientation;
      if (landscape && orientation?.lock) await orientation.lock('landscape').catch(() => {});
    } catch { $('.player-status').textContent = 'Full screen is not available on this device.'; }
  }
  function syncFullscreen() {
    if (!fullButton) return;
    const on = document.fullscreenElement === root;
    fullButton.innerHTML = icon(on ? 'collapse' : 'expand');
    fullButton.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  }
  // --- The -10 / +10 ripple on a double-tap; several taps in a row add up, as on Netflix and YouTube. ----------
  function ripple(side) {
    const now = performance.now();
    streak = streak.side === side && now < streak.until ? { side, count: streak.count + 1 } : { side, count: 1 };
    streak.until = now + 700;
    if (reduced()) return;
    const node = $(`.np-ripple[data-side=${side}]`);
    node.querySelector('b').textContent = `${side === 'back' ? '−' : '+'}${SEEK_STEP * streak.count}`;
    node.classList.remove('go'); void node.offsetWidth; node.classList.add('go');
    clearTimeout(rippleTimer); rippleTimer = setTimeout(() => node.classList.remove('go'), 700);
  }
  // --- Gestures on the picture: tap shows or hides the controls, double-tap a side jumps, pinch fills or fits. --
  const touch = $('.np-touch');
  function handleTap(event) {
    const box = frame.getBoundingClientRect(), { at, size } = along(event.clientX, event.clientY, box, rotated);
    const side = tapZone(at, size), now = performance.now();
    // A tap that follows a jump on the same side keeps jumping.
    if (side !== 'middle' && streak.side === side && now < streak.until) { seekBy(side === 'back' ? -SEEK_STEP : SEEK_STEP); ripple(side); return; }
    if (side !== 'middle' && lastTap && lastTap.side === side && now - lastTap.time < DOUBLE_TAP) {
      clearTimeout(tapTimer); lastTap = null;
      seekBy(side === 'back' ? -SEEK_STEP : SEEK_STEP); ripple(side); return;
    }
    clearTimeout(tapTimer);
    const toggle = () => { lastTap = null; if (showing()) hide(); else show(); };
    // The middle third has no double-tap, so it answers at once; a side waits to see whether a second tap comes.
    if (side === 'middle') { lastTap = null; toggle(); return; }
    lastTap = { side, time: now };
    tapTimer = setTimeout(toggle, DOUBLE_TAP);
  }
  // Fingers are followed over the whole player, so a pinch counts even when one finger lands on a control; a tap
  // counts only on the picture. The scrubber keeps its own finger.
  frame.addEventListener('pointerdown', event => {
    mouse = event.pointerType === 'mouse'; keyboard = false;
    if (event.target.closest('.np-scrub')) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, x0: event.clientX, y0: event.clientY, t: performance.now(), type: event.pointerType, picture: event.target === touch });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { start: Math.hypot(a.x - b.x, a.y - b.y), done: false };
      clearTimeout(tapTimer); lastTap = null;
    }
  });
  frame.addEventListener('pointermove', event => {
    mouse = event.pointerType === 'mouse';
    // A moving mouse brings the controls back, anywhere over the player.
    if (mouse) { keyboard = false; if (!scrubbing) show(); return; }
    const p = pointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX; p.y = event.clientY;
    if (pinch && !pinch.done && pointers.size === 2) {
      const [a, b] = [...pointers.values()], ratio = Math.hypot(a.x - b.x, a.y - b.y) / (pinch.start || 1);
      if (ratio > PINCH) { pinch.done = true; setFit('fill'); }
      else if (ratio < 1 / PINCH) { pinch.done = true; setFit('fit'); }
    }
  });
  const lift = event => {
    const p = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (!p || event.type === 'pointercancel') { if (!pointers.size) pinch = null; return; }
    if (pinch) { if (!pointers.size) pinch = null; return; }
    if (!p.picture || performance.now() - p.t > 450 || Math.hypot(event.clientX - p.x0, event.clientY - p.y0) > TAP_SLOP) return;
    // A mouse click plays or pauses, as on a desktop film site; a finger brings the controls.
    if (p.type === 'mouse') { if (event.button === 0) { void togglePlay(); show(); } return; }
    handleTap(event);
  };
  frame.addEventListener('pointerup', lift);
  frame.addEventListener('pointercancel', lift);
  // A mouse double-click toggles full screen; a finger's double-tap is the 10 s jump, never full screen.
  touch.addEventListener('dblclick', () => { if (mouse && fullButton) void toggleFullscreen(); });
  // iPhone Safari zooms the page on a pinch even under touch-action: none; the pinch is ours.
  const noZoom = event => event.preventDefault();
  frame.addEventListener('gesturestart', noZoom);
  frame.addEventListener('gestureend', event => { if (event.scale > PINCH) setFit('fill'); else if (event.scale < 1 / PINCH) setFit('fit'); });
  // --- The scrubber: pointer events mapped into the (maybe rotated) frame, so it works sideways too. -----------
  function scrubAt(event) {
    const p = trackFraction(event.clientX, event.clientY, track.getBoundingClientRect(), rotated), time = p * length();
    scrubbing.time = time;
    paint(time);
    bubble.textContent = clock(time);
    if (video.fastSeek && !scrubbing.precise) video.fastSeek(time); else video.currentTime = time;
  }
  scrub.addEventListener('pointerdown', event => {
    if (!length() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    scrub.setPointerCapture?.(event.pointerId);
    scrubbing = { id: event.pointerId, time: video.currentTime, precise: false };
    frame.dataset.scrubbing = '';
    clearTimeout(hideTimer);
    scrubAt(event);
  });
  scrub.addEventListener('pointermove', event => { if (scrubbing?.id === event.pointerId) scrubAt(event); });
  const release = event => {
    if (scrubbing?.id !== event.pointerId) return;
    if (event.type === 'pointerup') { scrubbing.precise = true; scrubAt(event); }
    video.currentTime = scrubbing.time;
    scrubbing = null; delete frame.dataset.scrubbing;
    show();
  };
  scrub.addEventListener('pointerup', release);
  scrub.addEventListener('pointercancel', release);
  // --- Buttons ------------------------------------------------------------------------------------------------
  frame.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !frame.contains(button)) return;
    show();
    switch (button.dataset.np) {
      case 'play': void togglePlay(); break;
      case 'back10': seekBy(-SEEK_STEP); break;
      case 'fwd10': seekBy(SEEK_STEP); break;
      case 'mute': toggleMute(); break;
      case 'fit': setFit(fit === 'fill' ? 'fit' : 'fill'); break;
      case 'fullscreen': void toggleFullscreen(); break;
      case 'airplay': video.webkitShowPlaybackTargetPicker?.(); break;
      case 'cut': if (button.getAttribute('aria-pressed') !== 'true') onCut(button.dataset.cut); break;
    }
  });
  // --- Keyboard: Space plays, arrows jump 10 s, F full screen, M sound, Esc leaves full screen then the player. -
  function onKey(event) {
    if (dead || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    keyboard = true;
    if (document.querySelector('dialog[open]')) return;
    const target = event.target, onButton = target.closest?.('button, a, input, select, textarea');
    const onScrub = target === scrub, key = event.key;
    let done = true;
    if ((key === ' ' || key === 'Spacebar' || key === 'Enter') && onButton) { show(); return; } // the button acts
    if (key === ' ' || key === 'Spacebar' || key === 'k' || key === 'K') void togglePlay();
    else if (key === 'ArrowLeft' || (onScrub && key === 'ArrowDown')) seekBy(-SEEK_STEP);
    else if (key === 'ArrowRight' || (onScrub && key === 'ArrowUp')) seekBy(SEEK_STEP);
    else if (onScrub && key === 'PageDown') seekBy(-60);
    else if (onScrub && key === 'PageUp') seekBy(60);
    else if (onScrub && key === 'Home') seekTo(0);
    else if (onScrub && key === 'End') seekTo(length());
    else if ((key === 'f' || key === 'F') && fullButton) void toggleFullscreen();
    else if (key === 'm' || key === 'M') toggleMute();
    else if (key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else onBack(); }
    else done = false;
    if (done) event.preventDefault();
    show();
  }
  document.addEventListener('keydown', onKey);
  frame.addEventListener('focusin', show);
  // --- Video events --------------------------------------------------------------------------------------------
  video.addEventListener('loadedmetadata', () => { layout(); paint(); });
  video.addEventListener('durationchange', () => paint());
  video.addEventListener('progress', () => { if (showing() && !scrubbing) paint(); });
  video.addEventListener('timeupdate', () => { if (!scrubbing && video.paused) paint(); });
  video.addEventListener('seeked', () => { if (!scrubbing) paint(); });
  video.addEventListener('play', () => { syncPlay(); show(); });
  video.addEventListener('pause', () => { syncPlay(); show(); });
  video.addEventListener('ended', () => { syncPlay(); show(); });
  video.addEventListener('waiting', () => frame.setAttribute('data-busy', ''));
  for (const name of ['playing', 'canplay', 'seeked', 'pause', 'error']) video.addEventListener(name, () => frame.removeAttribute('data-busy'));
  video.addEventListener('volumechange', syncMute);
  // AirPlay shows only where Safari offers a target.
  if (airButton && globalThis.WebKitPlaybackTargetAvailabilityEvent) video.addEventListener('webkitplaybacktargetavailabilitychanged', event => { airButton.hidden = event.availability !== 'available'; });
  const onResize = () => layout();
  addEventListener('resize', onResize);
  globalThis.visualViewport?.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', syncFullscreen);

  frame.setAttribute('data-busy', '');
  layout(); syncFit(); syncPlay(); syncMute(); syncFullscreen(); paint(); show();

  return {
    destroy() {
      dead = true;
      clearTimeout(hideTimer); clearTimeout(tapTimer); clearTimeout(rippleTimer); cancelAnimationFrame(frameLoop);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', syncFullscreen);
      removeEventListener('resize', onResize);
      globalThis.visualViewport?.removeEventListener('resize', onResize);
      // A cut switch draws a new player in place: full screen stays. Any other screen leaves it.
      queueMicrotask(() => {
        if (root.classList.contains('player')) return;
        if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
        try { globalThis.screen?.orientation?.unlock?.(); } catch { /* not locked */ }
      });
    },
  };
}
