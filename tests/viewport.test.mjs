import test from 'node:test';
import assert from 'node:assert/strict';
import { appHeight } from '../viewport.js';

const phone = { screenW: 393, screenH: 852 };
test('viewport: a home-screen app whose window falls short of the screen fills the screen', () => {
  assert.equal(appHeight({ standalone: true, innerW: 393, innerH: 797, ...phone }), 852, 'upright: the screen height');
  assert.equal(appHeight({ standalone: true, innerW: 393, innerH: 600, ...phone }), null, 'short by far more than a status bar: a resized window, left alone');
  assert.equal(appHeight({ standalone: true, innerW: 852, innerH: 370, ...phone }), 393, 'landscape: the short side');
});
test('viewport: nothing changes when the window is the screen, or in a browser tab', () => {
  assert.equal(appHeight({ standalone: true, innerW: 393, innerH: 852, ...phone }), null);
  assert.equal(appHeight({ standalone: false, innerW: 393, innerH: 797, ...phone }), null, 'Safari tab: its toolbars are real');
  assert.equal(appHeight({ standalone: true, innerW: 1440, innerH: 900, screenW: 1920, screenH: 1080 }), null, 'a desktop window far from its screen size');
  assert.equal(appHeight({ standalone: true, innerW: 0, innerH: 0, ...phone }), null);
});
