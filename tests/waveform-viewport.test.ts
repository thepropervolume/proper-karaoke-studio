/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { maxWaveformZoom, panWaveform, zoomWaveform } from '../src/domain/waveform-viewport';

test('waveform zoom keeps the timestamp under the cursor fixed unless it meets an edge', () => {
  const initial = { zoom: 1, offset: 0 };
  const focus = zoomWaveform(initial, 120, 2, .75);
  assert.deepEqual(focus, { zoom: 2, offset: 45 });
  assert.equal(focus.offset + (120 / focus.zoom) * .75, 90);
  assert.deepEqual(zoomWaveform(focus, 120, 1, .75), initial);
  assert.deepEqual(zoomWaveform(initial, 120, 2, 0), { zoom: 2, offset: 0 });
  assert.deepEqual(zoomWaveform(initial, 120, 2, 1), { zoom: 2, offset: 60 });
  assert.equal(zoomWaveform(initial, 120, 900, .5).zoom, maxWaveformZoom);
});

test('wheel pan moves by a fraction of the zoomed span and stops at the track edges', () => {
  const focused = { zoom: 4, offset: 30 };
  assert.deepEqual(panWaveform(focused, 120, .25), { zoom: 4, offset: 37.5 });
  assert.equal(panWaveform(focused, 120, -100).offset, 0);
  assert.equal(panWaveform(focused, 120, 100).offset, 90);
  assert.equal(panWaveform({ zoom: 1, offset: 0 }, 120, 100).offset, 0);
});
