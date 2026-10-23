import { PREVIEW_START } from './motion.js';

// Plays a muted preview in a <video>. getURL({ signal, fresh, whole }) gives a playable address. Attempt 1 uses
// the cached stream, attempt 2 a fresh one (the short-lived link may have expired), attempt 3 a whole-film
// download when canDownload is set (iPhone Safari refuses GitHub's octet-stream films as a stream).
// onPlaying fires once a frame is on screen, after the jump to `start`, so the poster never flashes the first frame.
export function startPreview(video, { getURL, canDownload = false, start = PREVIEW_START, onPlaying = () => {}, onEnded = () => {}, onFail = () => {} }) {
  const abort = new AbortController();
  let dead = false, attempt = 0, loaded = false, seeking = false, shown = false;
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.loop = false;

  const stop = () => {
    if (dead) return;
    dead = true; abort.abort();
    for (const [name, handler] of Object.entries(handlers)) video.removeEventListener(name, handler);
    video.pause(); video.removeAttribute('src'); video.load();
  };
  const fail = () => { if (!dead) { stop(); onFail(); } };
  async function load() {
    let url;
    try { url = await getURL({ signal: abort.signal, ...(attempt === 1 ? { fresh: true } : attempt > 1 ? { whole: true } : {}) }); } catch { fail(); return; }
    if (dead) return;
    loaded = false; seeking = false;
    video.src = url;
    video.play().catch(playError); // iPhone fetches nothing until play() is called; it is allowed because the video is muted and inline
  }
  // A frame is on screen once the film has jumped to its start and is playing.
  const reveal = () => { if (!shown && !seeking && !video.paused) { shown = true; onPlaying(); } };
  const handlers = {
    loadedmetadata() {
      loaded = true;
      seeking = Number.isFinite(video.duration) && video.duration > 0;
      if (seeking) video.currentTime = video.duration * start;
    },
    seeked() { if (seeking) { seeking = false; video.play().catch(playError); reveal(); } },
    playing() { reveal(); },
    ended() { onEnded(); },
    error() {
      if (dead) return;
      if (loaded) { fail(); return; }
      attempt += 1;
      if (attempt === 1 || (attempt === 2 && canDownload)) void load(); else fail();
    },
  };
  // Only a refusal to autoplay ends the preview here; a stream the browser cannot open arrives as an error event, which retries.
  const playError = error => { if (error?.name === 'NotAllowedError') fail(); };
  for (const [name, handler] of Object.entries(handlers)) video.addEventListener(name, handler);
  void load();
  return { stop };
}
