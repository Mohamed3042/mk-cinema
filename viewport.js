// The real screen height for iPhone home-screen apps. With `black-translucent`, iOS can give a fixed, non-scrolling
// screen (Reels, the player) a window shorter than the screen by about the status bar, and every `inset: 0` or
// 100svh layer then stops ~55 pt above the bottom, over a black band. When a home-screen app's window is shorter
// than its screen, --app-h on <html> holds the screen's height and those layers use it; otherwise it stays unset
// and nothing changes.

// The height the app should fill, or null when the window already is the screen. Screen sizes on iOS are given
// for the upright phone, so the long side is the height in portrait and the short side in landscape.
export function appHeight({ standalone, innerW, innerH, screenW, screenH }) {
  if (!standalone || !screenW || !screenH || !innerW || !innerH) return null;
  const tall = Math.max(screenW, screenH), short = Math.min(screenW, screenH);
  const wanted = innerH >= innerW ? tall : short;
  // Only ever taller than the window, and only by a status bar's worth or so: anything else is a resized window.
  return wanted > innerH + 1 && wanted - innerH <= 120 ? wanted : null;
}

// Only iOS/iPadOS WebKit has navigator.standalone. Android and desktop app windows are left alone: their window
// is short of the screen for real (system bars, a title bar), and filling the screen would slide under them.
const standalone = () => 'standalone' in navigator && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);
const measure = () => appHeight({ standalone: standalone(), innerW: innerWidth, innerH: innerHeight, screenW: screen.width, screenH: screen.height });

// The size full-screen layers should take: the window, or the screen height where the window falls short.
export function viewSize() {
  return { width: innerWidth, height: measure() ?? innerHeight };
}

let listeners = [];
export function onViewChange(callback) { listeners.push(callback); return () => { listeners = listeners.filter(item => item !== callback); }; }

function apply() {
  const root = document.documentElement, height = measure();
  if (height) { root.style.setProperty('--app-h', `${height}px`); root.classList.add('app-h'); }
  else { root.style.removeProperty('--app-h'); root.classList.remove('app-h'); }
  for (const callback of listeners) callback();
}
export function watchViewport() {
  apply();
  addEventListener('resize', apply);
  addEventListener('orientationchange', () => { apply(); setTimeout(apply, 300); }); // iOS settles the new size late
  globalThis.visualViewport?.addEventListener('resize', apply);
}

// One line for Settings → About, so a wrong layout on the phone can be screenshotted and read.
export function diagnostics() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const style = getComputedStyle(probe), top = Math.round(parseFloat(style.paddingTop) || 0), bottom = Math.round(parseFloat(style.paddingBottom) || 0);
  probe.remove();
  const height = measure();
  return `Screen ${screen.height} × ${screen.width} · window ${innerHeight}${height ? ` · filled to ${height}` : ''} · safe ${top} / ${bottom} · ${standalone() ? 'home-screen app' : 'browser'}`;
}
