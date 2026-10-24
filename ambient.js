// Each film lights the page behind it, like a screen in a dark room. Its poster is shrunk to a few pixels on a
// canvas and laid under the page (styles.css, .library::before) as a soft wash of its colours: a tiny image costs
// nothing to scale or blur, even on a phone. The billboard lights the home; in New & Hot the playing film does.
const W = 48, H = 27;
let canvas;

export function wash(img) {
  if (!img?.complete || !img.naturalWidth) return '';
  canvas ||= Object.assign(document.createElement('canvas'), { width: W, height: H });
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight); // cover, like the poster itself
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  try {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } catch { return ''; } // never expected: posters are same-origin blobs, so the canvas stays readable
}

export function mountAmbient(root, target = document.documentElement) {
  let lit = null;
  function paint() {
    const img = root.querySelector('.hot-item.is-active .hot-poster') || root.querySelector('.billboard-poster') || root.querySelector('.hot-poster');
    if (img && img === lit) return;
    const url = wash(img);
    lit = url ? img : null;
    if (url) target.style.setProperty('--ambient', `url("${url}")`);
    else target.style.removeProperty('--ambient');
  }
  // Posters arrive later than the page (private fetch), and New & Hot changes its playing film while you scroll.
  const observer = new MutationObserver(paint);
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
  root.addEventListener('load', paint, true);
  paint();
  return { stop() { observer.disconnect(); root.removeEventListener('load', paint, true); } };
}
