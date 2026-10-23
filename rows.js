const DESKTOP = '(hover: hover) and (pointer: fine) and (min-width: 900px)';

// Desktop rows page by one view with a transform; the 750 ms easing lives in CSS (--ease-row). On touch the track
// stays a native scroller with momentum and snap, so the paddles and dashes stay hidden and nothing here moves it.
export function mountRows(root) {
  const query = matchMedia(DESKTOP);
  const observers = [];
  const rows = [...root.querySelectorAll('.shelf[data-row]')].map(shelf => {
    const view = shelf.querySelector('.row-viewport'), track = shelf.querySelector('.card-track');
    const prev = shelf.querySelector('.paddle-prev'), next = shelf.querySelector('.paddle-next'), dashes = shelf.querySelector('.row-dashes');
    const row = { page: 0, pages: 1, per: 1, step: 0, max: 0 };

    function measure() {
      const cards = track.children, count = cards.length;
      if (!count || !view.clientWidth) return false;
      const style = getComputedStyle(track), pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), gap = parseFloat(style.columnGap) || 0;
      const card = cards[0].offsetWidth; // layout width: the track's transform does not change it
      row.step = card + gap;
      row.per = Math.max(1, Math.floor((view.clientWidth - pad + gap) / row.step + 0.01));
      row.pages = Math.ceil(count / row.per);
      row.max = Math.max(0, pad + count * card + (count - 1) * gap - view.clientWidth);
      row.page = Math.min(row.page, row.pages - 1);
      return true;
    }
    function show(animate) {
      const x = Math.min(row.page * row.per * row.step, row.max);
      if (!animate) track.style.transition = 'none';
      track.style.transform = `translate3d(${-x}px,0,0)`;
      if (!animate) { void track.offsetWidth; track.style.transition = ''; }
      prev.disabled = row.page === 0;
      next.disabled = row.page >= row.pages - 1;
      shelf.dataset.pages = String(row.pages); shelf.dataset.page = String(row.page);
      dashes.replaceChildren(...Array.from({ length: row.pages }, (_, index) => { const dash = document.createElement('i'); if (index === row.page) dash.className = 'on'; return dash; }));
    }
    let paging;
    const go = page => {
      page = Math.max(0, Math.min(row.pages - 1, page));
      if (page === row.page) return;
      row.page = page; show(true);
      // No hover card opens under a stationary pointer while the row slides.
      track.classList.add('is-paging'); clearTimeout(paging); paging = setTimeout(() => track.classList.remove('is-paging'), 800);
    };
    function apply() {
      if (!query.matches) { track.style.transform = ''; delete shelf.dataset.pages; return; }
      if (measure()) show(false);
    }
    prev.addEventListener('click', () => go(row.page - 1));
    next.addEventListener('click', () => go(row.page + 1));
    // A card reached with the keyboard must never sit hidden off the edge.
    track.addEventListener('focusin', event => {
      const card = event.target.closest('.card');
      if (card && query.matches && measure()) go(Math.floor([...track.children].indexOf(card) / row.per));
    });
    const observer = new ResizeObserver(apply);
    observer.observe(view); observers.push(observer);
    apply();
    return apply;
  });
  const onChange = () => rows.forEach(apply => apply());
  query.addEventListener('change', onChange);
  return { destroy() { observers.forEach(observer => observer.disconnect()); query.removeEventListener('change', onChange); } };
}
