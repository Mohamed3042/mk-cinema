// Each film lights the page behind it, like a screen in a dark room. Its poster is shrunk to a few pixels on a
// canvas and laid under the page (styles.css, .library::before) as a soft wash of its colours: a tiny image costs
// nothing to scale or blur, even on a phone. The billboard lights the home; in New & Hot the playing film does;
// in a grid (search, filters, Explore all, My List) the first result does.
const W = 48, H = 27;
let canvas;

// The poster (or the film's current frame) drawn small, cover like the poster itself, or null while it has not loaded.
function draw(img) {
  const width = img?.naturalWidth || img?.videoWidth, height = img?.naturalHeight || img?.videoHeight;
  if (!width || img.complete === false) return null;
  canvas ||= Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const scale = Math.max(W / width, H / height);
  const w = width * scale, h = height * scale;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  return ctx;
}

// Mean brightness and colourfulness (0 to 1) of RGBA pixels; colourfulness is the spread between a pixel's strongest
// and weakest channel.
export function tone(data) {
  let light = 0, chroma = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    light += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const n = data.length / 4 * 255;
  return { light: light / n, chroma: chroma / n };
}

// A pale poster would fog the page grey, so its wash is dimmed until its brightness is at most 0.3 to 0.5: the more
// colourful the poster, the more light it may give. Colourful and dark films pass as they are. Returns how much black
// to lay over the wash (0 to 1).
export function dimFor(data) {
  const { light, chroma } = tone(data), cap = 0.3 + 0.2 * chroma;
  return light > cap ? 1 - cap / light : 0;
}

// How pale a poster (or a film frame) is: 0 for colourful or dark art (brightness up to 0.5), 1 for a white page
// (0.8 and up). The billboard, New & Hot, the details and the reel deepen the shade under their white type by this
// much (styles.css, --pale). Null when the picture cannot be read yet, or at all (a stream from another origin).
export const paleFor = data => Math.min(1, Math.max(0, (tone(data).light - 0.5) / 0.3));
export function paleness(img) {
  try { const ctx = draw(img); return ctx ? paleFor(ctx.getImageData(0, 0, W, H).data) : null; }
  catch { return null; }
}

export function wash(img) {
  try {
    const ctx = draw(img);
    if (!ctx) return '';
    const dim = dimFor(ctx.getImageData(0, 0, W, H).data);
    if (dim) { ctx.fillStyle = `rgba(0,0,0,${dim.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    return canvas.toDataURL('image/png');
  } catch { return ''; } // never expected: posters are same-origin blobs, so the canvas stays readable
}

export function mountAmbient(root, target = document.documentElement) {
  let lit = null;
  function paint() {
    const img = root.querySelector('.hot-item.is-active .hot-poster') || root.querySelector('.billboard-poster') || root.querySelector('.hot-poster') || root.querySelector('.results-grid .poster');
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
