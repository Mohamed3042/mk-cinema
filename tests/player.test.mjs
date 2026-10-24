import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRotate, along, trackFraction, tapZone, fillScale, clock, SEEK_STEP, HIDE_AFTER } from '../player.js';

test('player: a landscape film turns sideways only on a phone held upright', () => {
  assert.equal(shouldRotate({ filmW: 1920, filmH: 1080, viewW: 390, viewH: 844 }), true, '16:9 on an upright phone');
  assert.equal(shouldRotate({ filmW: 1080, filmH: 1920, viewW: 390, viewH: 844 }), false, '9:16 on an upright phone fills it as it is');
  assert.equal(shouldRotate({ filmW: 1920, filmH: 1080, viewW: 844, viewH: 390 }), false, 'a phone already in landscape');
  assert.equal(shouldRotate({ filmW: 1920, filmH: 1080, viewW: 820, viewH: 1180 }), false, 'a tablet held upright');
  assert.equal(shouldRotate({ filmW: 1920, filmH: 1080, viewW: 1440, viewH: 900 }), false, 'a desktop');
  assert.equal(shouldRotate({ filmW: 1080, filmH: 1080, viewW: 390, viewH: 844 }), false, 'a square film');
});

test('player: a touch maps into the rotated frame', () => {
  // The upright phone's screen, with the frame turned 90° clockwise: its x axis runs down the screen.
  const screen = { left: 0, top: 0, width: 390, height: 844 };
  assert.deepEqual(along(100, 211, screen, true), { at: 211, size: 844 });
  assert.deepEqual(along(100, 211, screen, false), { at: 100, size: 390 });
  assert.equal(tapZone(...Object.values(along(195, 100, screen, true))), 'back', 'the top of the screen is the film\'s left');
  assert.equal(tapZone(...Object.values(along(195, 780, screen, true))), 'forward', 'the bottom of the screen is the film\'s right');
  assert.equal(tapZone(...Object.values(along(30, 422, screen, true))), 'middle');
  assert.equal(tapZone(...Object.values(along(60, 422, screen, false))), 'back');
  assert.equal(tapZone(...Object.values(along(330, 422, screen, false))), 'forward');
});

test('player: the scrubber reads the touch along its own axis and clamps', () => {
  const upright = { left: 60, top: 760, width: 270, height: 44 };
  assert.equal(trackFraction(195, 782, upright, false), 0.5);
  assert.equal(trackFraction(10, 782, upright, false), 0, 'left of the bar is the start');
  assert.equal(trackFraction(400, 782, upright, false), 1, 'right of the bar is the end');
  const sideways = { left: 80, top: 64, width: 4, height: 716 }; // the bar of a rotated frame runs down the screen
  assert.equal(trackFraction(82, 64 + 716 * 0.25, sideways, true), 0.25);
  assert.equal(trackFraction(300, 64 + 716 * 0.75, sideways, true), 0.75, 'only the position along the bar counts');
  assert.equal(trackFraction(82, 900, sideways, true), 1);
  assert.equal(trackFraction(82, 0, { left: 0, top: 0, width: 0, height: 0 }, true), 0, 'a bar not laid out yet');
});

test('player: Fill grows the picture by the shape difference; times read like a player', () => {
  assert.equal(fillScale(390, 844, 1080, 1920), 844 / 390 / (1920 / 1080));
  assert.ok(Math.abs(fillScale(844, 390, 1920, 1080) - (844 / 390) / (1920 / 1080)) < 1e-9);
  assert.equal(fillScale(1600, 900, 1920, 1080), 1, 'same shape: nothing to fill');
  assert.equal(fillScale(390, 844, 0, 0), 1, 'no picture yet');
  assert.equal(clock(0), '0:00'); assert.equal(clock(65.9), '1:05'); assert.equal(clock(3725), '1:02:05');
  assert.equal(clock(NaN), '0:00'); assert.equal(clock(-3), '0:00');
  assert.equal(SEEK_STEP, 10); assert.equal(HIDE_AFTER, 3000);
});
