// The window the full-screen layers fill, and one line of measurements for Settings → About.
// Reels and the player are `position: fixed; inset: 0` and fill the window as it is. They never lock the page
// (no overflow:hidden on html/body): an iPhone home-screen app shrinks its window by the status bar while the
// page is locked, which left a black band under them (owner's iPhone, 2026-10-24).

const standalone = () => 'standalone' in navigator && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);

// The size full-screen layers take: the window.
export function viewSize() {
  return { width: innerWidth, height: innerHeight };
}

let listeners = [];
export function onViewChange(callback) { listeners.push(callback); return () => { listeners = listeners.filter(item => item !== callback); }; }

function changed() { for (const callback of listeners) callback(); }
export function watchViewport() {
  // Set once, never toggled: styles.css keeps an iPhone home-screen app's page 1 px taller than its window, the
  // only way iOS gives such an app the whole screen on pages that fit (Reels, the player).
  if (standalone()) document.documentElement.classList.add('ios-app');
  addEventListener('resize', changed);
  addEventListener('orientationchange', () => { changed(); setTimeout(changed, 300); }); // iOS settles the new size late
  globalThis.visualViewport?.addEventListener('resize', changed);
}

// One line for Settings → About, so a wrong layout on the phone can be screenshotted and read.
export function diagnostics() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const style = getComputedStyle(probe), top = Math.round(parseFloat(style.paddingTop) || 0), bottom = Math.round(parseFloat(style.paddingBottom) || 0);
  probe.remove();
  return `Screen ${screen.height} × ${screen.width} · window ${innerHeight} · safe ${top} / ${bottom} · ${standalone() ? 'home-screen app' : 'browser'}`;
}
