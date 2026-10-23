import { EASE, SPRING, T, reduced } from './motion.js';

const EASE_IN = 'cubic-bezier(.8,0,.8,.2)'; // EASE played backwards, so closing is the opening in reverse
const opening = new WeakMap();

// More info opens by growing out of the clicked card (a FLIP: the dialog is laid out in its final place, then
// animated from the card's rectangle). Only the 16:9 picture shows at first and the clip opens to reveal the rest.
// On a phone it is a bottom sheet that springs up.
export function openSheet(dialog, { origin, phone }) {
  dialog.dataset.anim = 'in';
  if (reduced()) return Promise.resolve();
  const to = dialog.getBoundingClientRect();
  let frames, options = { duration: T.modal, easing: EASE, fill: 'both' };
  if (phone) {
    frames = [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }];
    options = { duration: 560, easing: SPRING, fill: 'both' };
  } else if (origin?.width > 0) {
    frames = [{ transform: flip(origin, to), clipPath: clip(dialog, to, 6) }, { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 8px)' }];
  } else frames = [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }];
  const animation = dialog.animate(frames, options);
  opening.set(dialog, animation);
  // The sheet gives its transform back once settled, so dragging can drive it.
  return animation.finished.then(() => { if (phone) animation.cancel(); }, () => {});
}

// Closing plays the opening backwards: a fresh animation from rest to wherever the card is now.
export function closeSheet(dialog, { target, phone, from = 0 }) {
  dialog.dataset.anim = 'out';
  if (reduced()) return Promise.resolve();
  const running = opening.get(dialog);
  if (running?.playState === 'running') { running.reverse(); return running.finished.catch(() => {}); }
  running?.cancel();
  const to = dialog.getBoundingClientRect();
  let frames, options = { duration: 300, easing: EASE_IN, fill: 'both' };
  if (phone) {
    frames = [{ transform: `translateY(${from}px)` }, { transform: 'translateY(100%)' }];
    options = { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'both' };
  } else if (target?.width > 0) {
    frames = [{ transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 8px)' }, { transform: flip(target, to), clipPath: clip(dialog, to, 6) }];
  } else {
    frames = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }];
    options = { duration: 200, easing: 'ease-in', fill: 'both' };
  }
  return dialog.animate(frames, options).finished.catch(() => {});
}

const flip = (rect, to) => `translate(${rect.left - to.left}px, ${rect.top - to.top}px) scale(${rect.width / to.width})`;
const clip = (dialog, to, radius) => `inset(0px 0px ${Math.max(0, to.height - dialog.querySelector('.detail-art').offsetHeight)}px 0px round ${radius}px)`;

// Phone only: pull the sheet down from the top of its content to close it. A fast flick or a pull past 110 px
// closes; a shorter pull springs back.
export function enableDrag(dialog, close) {
  let startY = 0, startScroll = 0, lastY = 0, lastTime = 0, dy = 0, velocity = 0, dragging = false;
  dialog.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    startY = lastY = event.touches[0].clientY; lastTime = event.timeStamp; startScroll = dialog.scrollTop; dragging = false; dy = velocity = 0;
  }, { passive: true });
  dialog.addEventListener('touchmove', event => {
    const y = event.touches[0].clientY, delta = y - startY;
    if (!dragging) {
      if (startScroll > 0 || dialog.scrollTop > 0 || delta < 6) return;
      dragging = true; dialog.classList.add('is-dragging');
    }
    event.preventDefault(); // the pull owns the gesture now, so the sheet's own scroll stays still
    dy = Math.max(0, delta - 6);
    velocity = (y - lastY) / Math.max(1, event.timeStamp - lastTime); lastY = y; lastTime = event.timeStamp;
    dialog.style.transform = `translateY(${dy}px)`;
    dialog.style.setProperty('--drag', (dy / innerHeight).toFixed(3));
  }, { passive: false });
  const release = () => {
    if (!dragging) return;
    dragging = false; dialog.classList.remove('is-dragging');
    if (dy > 110 || velocity > 0.6) { close(dy); return; }
    dialog.style.transform = ''; dialog.style.removeProperty('--drag');
    dialog.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 480, easing: SPRING });
  };
  dialog.addEventListener('touchend', release);
  dialog.addEventListener('touchcancel', release);
}
