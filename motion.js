// Motion tokens and pure helpers. The easing and the scroll-film chase come from the owner's flagship portfolio
// (--w-ease in its world chrome, and the pop-and-ship script that moves a film only while you scroll).
// Row paging, hover delays and card growth follow Netflix.
export const EASE = 'cubic-bezier(.2,.8,.2,1)';
export const EASE_ROW = 'cubic-bezier(.5,0,.1,1)';
export const T = {
  tab: 250, row: 750,
  bobDelay: 400, bobHotDelay: 120, bobGrow: 340, bobPanel: 260, bobPreview: 600,
  posterToFilm: 2000, billboardQuiet: 6000, modal: 480,
};
// Previews start 10% into the film, past any title card.
export const PREVIEW_START = 0.1;
// Largest film a phone downloads whole to preview it, when the browser refuses the stream.
export const MAX_WHOLE_BYTES = 40 * 1024 * 1024;

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const reducedQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
export const reduced = () => Boolean(reducedQuery?.matches);
export const onReducedChange = listener => reducedQuery?.addEventListener?.('change', listener);

export const readAutoplay = (storage, key = 'mkc.autoplay') => { try { return storage.getItem(key) !== '0'; } catch { return true; } };
export function writeAutoplay(storage, on, key = 'mkc.autoplay') {
  try { storage.setItem(key, on ? '1' : '0'); } catch { /* The switch still works for this visit when storage is blocked. */ }
}

// Port of the portfolio's pop-and-ship controller. A film cannot play backwards, so it plays forward at a rate
// that closes the gap to the scroll-set target, seeks when the gap is big or the user scrolled back, and pauses
// when it has caught up. Once input has been quiet for stopMs the film finishes at full speed, or jumps when the
// gap is bigger than quietFar, so it stops about 50 ms after the last input. (The original finished with a rate
// that shrank with the gap, which kept the film moving for about 0.3 s after the finger stopped.)
export const CHASE = { far: 0.8, quietFar: 0.2, back: -0.04, near: 0.02, slow: 0.25, minRate: 0.1, maxRate: 3, stopMs: 50 };
export function chase({ target, time, quietFor }, c = CHASE) {
  const gap = target - time, quiet = quietFor > c.stopMs;
  if (gap > (quiet ? c.quietFar : c.far) || gap < c.back) return { act: 'seek', to: target };
  if (gap <= c.near) return { act: 'pause' };
  return { act: 'play', rate: quiet ? c.maxRate : clamp(gap / c.slow, c.minRate, c.maxRate) };
}

// New & Hot: a film is active while it is the nearest to the middle of the screen, and scrolling plays a window
// of it. The window spans one pitch (the distance between two films' centres) of scroll, and one second of film
// costs PX_PER_SEC pixels, so normal scrolling plays near real time and no scroll distance is wasted.
export const PX_PER_SEC = 120;
export function feedWindow(duration, pitch) {
  const start = duration * PREVIEW_START;
  return { start, span: Math.max(0.5, Math.min(duration - start - 0.1, pitch / PX_PER_SEC)) };
}
// 0.5 when the film is centred, 0 half a pitch below the middle (it just became active), 1 half a pitch above.
export const feedProgress = (center, middle, pitch) => clamp(0.5 - (center - middle) / pitch, 0, 1);
export const feedTime = (q, window) => window.start + clamp(q, 0, 1) * window.span;

// Where the hover card goes. It grows 1.5x from the card's centre; the left-edge card grows rightward and the
// right-edge card leftward so it stays inside the row, and the result is kept inside the viewport.
export function bobRect({ card, bounds, view, scale = 1.5, panel = 112, margin = 8 }) {
  const width = card.width * scale, media = card.height * scale, grow = width - card.width;
  let edge = 'center', left = card.left - grow / 2;
  if (left < bounds.left - 0.5) { edge = 'left'; left = card.left; }
  else if (card.right + grow / 2 > bounds.right + 0.5) { edge = 'right'; left = card.right - width; }
  left = clamp(left, margin, Math.max(margin, view.w - width - margin));
  const total = media + panel;
  const top = clamp(card.top - (media - card.height) / 2, view.top + margin, Math.max(view.top + margin, view.h - total - margin));
  return { left, top, width, media, total, edge };
}

// At most one preview plays at a time (the billboard is separate). A new owner stops the previous one.
let holder = null;
export function claimPreview(next) {
  if (holder && holder !== next) holder.stop();
  holder = next;
  return () => { if (holder === next) holder = null; };
}

// Calls onChange(true|false) when the element is at least `threshold` visible. Without IntersectionObserver it stays "visible".
export function watchVisible(element, onChange, threshold = 0.35) {
  if (!globalThis.IntersectionObserver) { onChange(true); return () => {}; }
  const observer = new IntersectionObserver(entries => onChange(entries.at(-1).isIntersecting), { threshold });
  observer.observe(element);
  return () => observer.disconnect();
}

// A damped spring as a CSS linear() easing (Chrome 113+, Safari 17.2+). Older browsers get an overshooting bezier.
export function spring(zeta = 0.62, omega = 14, seconds = 0.52, steps = 28) {
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const time = index / steps * seconds;
    return 1 - Math.exp(-zeta * omega * time) * (Math.cos(damped * time) + zeta * omega / damped * Math.sin(damped * time));
  });
  points[steps] = 1;
  return `linear(${points.map(point => point.toFixed(4)).join(', ')})`;
}
export const SPRING = globalThis.CSS?.supports?.('animation-timing-function', 'linear(0, 1)') ? spring() : 'cubic-bezier(.3,1.35,.45,1)';
