import { T, watchVisible } from './motion.js';
import { startPreview } from './previews.js';

// The billboard timeline. The poster crossfades to the muted film after about 2 s; after about 6 s the blurb
// fades out and the title shrinks and slides down; at the end the film fades back to the poster with a replay
// button. data-preview on the billboard reports the state: off, poster, loading, playing, paused, ended, failed.
export function mountBillboard(el, { getURL, canDownload, enabled, icon }) {
  const video = el.querySelector('.billboard-video'), tool = el.querySelector('[data-action="billboard-tool"]');
  let state = '', preview, timer, quietTimer, waiting = false, visible = true, held = false, armedAt = 0, playedAt = 0;
  const active = () => visible && !document.hidden && !held;

  function paintTool() {
    tool.hidden = !['playing', 'paused', 'ended'].includes(state);
    const [name, label] = state === 'ended' ? ['retry', 'Replay'] : video.muted ? ['mute', 'Unmute'] : ['sound', 'Mute'];
    tool.innerHTML = icon(name); tool.setAttribute('aria-label', label);
  }
  function set(next) { state = next; el.dataset.preview = next; paintTool(); }
  function clear() {
    preview?.stop(); preview = null;
    clearTimeout(timer); clearTimeout(quietTimer); waiting = false;
    el.classList.remove('is-playing', 'is-quiet');
  }
  function begin() {
    if (!enabled()) { set('off'); return; }
    if (!active()) { waiting = true; return; }
    set('loading');
    preview = startPreview(video, {
      getURL, canDownload,
      onPlaying() {
        set('playing'); el.classList.add('is-playing'); playedAt = performance.now();
        // About 6 s into the billboard, but never before the film has had 2 s on screen.
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => el.classList.add('is-quiet'), Math.max(armedAt + T.billboardQuiet, playedAt + 2000) - playedAt);
        update();
      },
      onEnded() { clearTimeout(quietTimer); el.classList.remove('is-playing', 'is-quiet'); set('ended'); },
      onFail() { clear(); set('failed'); },
    });
  }
  function arm() {
    clear();
    if (!enabled()) { set('off'); return; }
    set('poster'); armedAt = performance.now();
    timer = setTimeout(begin, T.posterToFilm);
  }
  function update() {
    if (state === 'playing' && !active()) { video.pause(); set('paused'); }
    else if (state === 'paused' && active()) { video.play().catch(() => {}); set('playing'); }
    else if (waiting && active()) { waiting = false; begin(); }
  }
  const unwatch = watchVisible(el, isVisible => { visible = isVisible; update(); });
  document.addEventListener('visibilitychange', update);
  tool.addEventListener('click', () => {
    if (state === 'ended') { clear(); begin(); return; }
    video.muted = !video.muted; paintTool();
  });
  arm();

  return {
    // Called when the autoplay switch or reduced motion changes.
    sync() { if (!enabled()) { clear(); set('off'); } else if (state === 'off') arm(); },
    // The More info sheet covers the billboard, so it holds the film while open.
    hold(on) { held = on; update(); },
    destroy() { clear(); unwatch(); document.removeEventListener('visibilitychange', update); },
  };
}
