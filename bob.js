import { EASE, T, bobRect, claimPreview, reduced } from './motion.js';
import { startPreview } from './previews.js';

const DESKTOP = '(hover: hover) and (pointer: fine) and (min-width: 900px)';
const SCALE = 1.5, PANEL = 112;

// The desktop hover card. After a 400 ms hover the card grows 1.5x above its neighbours (the left-edge card
// grows rightward, the right-edge card leftward), a muted preview starts after 600 ms, a panel slides in with
// Play, My List and More info, and it collapses by playing the same animation backwards.
// It lives in <body>, so no row clips it and nothing about the row's layout moves.
export function createBob({ host, find, posterURL, source, enabled, autoplay, listed, actions, icon, esc, duration, isNew, topOffset }) {
  const desktop = matchMedia(DESKTOP);
  let hover = null, open = null, openTimer, closeTimer, previewTimer, closedAt = 0;
  const live = () => enabled() && desktop.matches;

  function stopFilm(bob) {
    bob.preview?.stop(); bob.preview = null; bob.release?.(); bob.release = null;
    bob.el.classList.remove('is-playing');
  }
  function startFilm(bob) {
    if (open !== bob || bob.closing || !autoplay()) return;
    const { getURL, canDownload } = source(bob.film);
    bob.release = claimPreview({ stop: () => stopFilm(bob) });
    bob.preview = startPreview(bob.el.querySelector('video'), {
      getURL, canDownload,
      onPlaying: () => bob.el.classList.add('is-playing'),
      onEnded: () => bob.el.classList.remove('is-playing'),
      onFail: () => stopFilm(bob),
    });
  }
  function dispose() {
    if (!open) return;
    const bob = open; open = null; clearTimeout(previewTimer);
    if (hover === bob.card) hover = null;
    stopFilm(bob); bob.grow.cancel(); bob.slide.cancel(); bob.el.remove(); closedAt = Date.now();
  }
  // keepOpening: a collapse that was waiting on a timer must not cancel the card the pointer has moved on to.
  function hide(instant = false, keepOpening = false) {
    if (!keepOpening) clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (!open) return;
    if (instant || reduced()) { dispose(); return; }
    if (open.closing) return; // reverse() twice would open it again
    if (hover === open.card) hover = null;
    clearTimeout(previewTimer); stopFilm(open);
    open.closing = true; open.el.dataset.state = 'closing';
    open.grow.reverse(); open.slide.reverse();
  }
  function reopen() {
    open.closing = false; open.el.dataset.state = 'opening';
    open.grow.reverse(); open.slide.reverse();
    const bob = open; clearTimeout(previewTimer); previewTimer = setTimeout(() => startFilm(bob), T.bobPreview);
  }

  function show(card) {
    if (!live() || card !== hover || !card.isConnected || card.parentElement.classList.contains('is-paging')) return;
    const button = card.querySelector('.film-card'), film = button && find(button.dataset.film);
    if (!film) return;
    dispose();
    const c = button.getBoundingClientRect();
    const area = card.closest('.row-viewport') || card.closest('.results-grid') || document.body;
    const box = area.getBoundingClientRect(), pad = getComputedStyle(card.parentElement);
    const bounds = area.classList.contains('row-viewport')
      ? { left: box.left + parseFloat(pad.paddingLeft), right: box.right - parseFloat(pad.paddingRight) } : { left: box.left, right: box.right };
    const rect = bobRect({ card: c, bounds, view: { w: innerWidth, h: innerHeight, top: topOffset() }, scale: SCALE, panel: PANEL });
    const on = listed(film);
    const el = document.createElement('div');
    el.className = 'bob'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', `Preview: ${film.title}`);
    el.dataset.film = film.id; el.dataset.edge = rect.edge; el.dataset.state = 'opening';
    el.innerHTML = `<div class="bob-media"><img class="bob-poster" alt="" src="${esc(posterURL(film))}"><video class="bob-video" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video><span class="bob-title film-title" dir="auto">${esc(film.title)}</span></div><div class="bob-panel"><div class="bob-actions"><button class="bob-button bob-play" data-bob="play" aria-label="Play ${esc(film.title)}">${icon('play')}</button><button class="bob-button" data-bob="list" aria-pressed="${on}" aria-label="${on ? 'Remove from My List' : 'Add to My List'}: ${esc(film.title)}">${icon(on ? 'check' : 'plus')}</button><button class="bob-button bob-info" data-bob="info" aria-label="More info: ${esc(film.title)}">${icon('chevron')}</button></div><p class="bob-meta">${isNew(film) ? '<span class="new-badge">NEW</span>' : ''}<span>${duration(film.seconds)}</span><span>${esc(film.kind)}</span>${film.lang === 'ar' ? '<span>Arabic</span>' : ''}</p></div>`;
    Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
    el.querySelector('.bob-poster').classList.add('is-ready');
    document.body.append(el);
    const from = `translate(${c.left - rect.left}px, ${c.top - rect.top}px) scale(${c.width / rect.width}, ${c.height / rect.media})`;
    // Only the picture shows while it grows (the clip hides the panel); once settled the clip is gone, so the shadow shows.
    const panelHeight = el.querySelector('.bob-panel').offsetHeight;
    const grow = el.animate([
      { transform: from, clipPath: `inset(0px 0px ${panelHeight}px 0px round 6px)` },
      { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 6px)' },
    ], { duration: T.bobGrow, easing: EASE, fill: 'backwards' });
    const slide = el.querySelector('.bob-panel').animate([{ opacity: 0, transform: 'translateY(-16px)' }, { opacity: 1, transform: 'none' }], { duration: T.bobPanel, delay: T.bobGrow * 0.55, easing: EASE, fill: 'both' });
    const bob = open = { el, card, film, grow, slide, closing: false, preview: null, release: null };
    grow.onfinish = () => { if (open === bob && bob.closing) dispose(); else if (open === bob) el.dataset.state = 'open'; };
    previewTimer = setTimeout(() => startFilm(bob), T.bobPreview);

    el.addEventListener('pointerenter', () => { clearTimeout(closeTimer); if (open === bob && bob.closing) reopen(); });
    el.addEventListener('pointerleave', event => { if (open === bob && !card.contains(event.relatedTarget)) closeTimer = setTimeout(() => hide(false, true), 60); });
    el.addEventListener('click', event => {
      const kind = event.target.closest('[data-bob]')?.dataset.bob ?? 'info';
      if (kind === 'list') { actions.toggle(film.id); return; } // the page repaints every list button, this one included
      const origin = el.querySelector('.bob-media').getBoundingClientRect();
      hide(true);
      if (kind === 'play') actions.play(film.id); else actions.info(film.id, origin);
    });
  }

  host.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse' || !live()) return;
    const card = event.target.closest('.card');
    if (!card || card.closest('dialog') || card === hover) return;
    hover = card; clearTimeout(openTimer);
    // Back on the card that is open: keep it. Any other card lets a pending collapse go ahead.
    if (open?.card === card) { clearTimeout(closeTimer); if (open.closing) reopen(); return; }
    openTimer = setTimeout(() => show(card), open || Date.now() - closedAt < 400 ? T.bobHotDelay : T.bobDelay);
  });
  host.addEventListener('pointerout', event => {
    const card = event.target.closest('.card');
    if (!card || card !== hover || card.contains(event.relatedTarget) || open?.el.contains(event.relatedTarget)) return;
    hover = null; clearTimeout(openTimer);
    if (open) closeTimer = setTimeout(() => hide(false, true), 60);
  });
  addEventListener('scroll', () => hide(), { passive: true });
  addEventListener('resize', () => hide(true));
  addEventListener('blur', () => hide(true));
  addEventListener('keydown', event => { if (event.key === 'Escape') hide(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(true); });

  return {
    // Closes at once and forgets the hovered card; the page calls this before it replaces its content.
    close() { hover = null; hide(true); },
    // Called when the autoplay switch or reduced motion changes.
    sync() { if (!live()) { hover = null; hide(true); } else if (open && !autoplay()) stopFilm(open); },
    get open() { return Boolean(open); },
  };
}
