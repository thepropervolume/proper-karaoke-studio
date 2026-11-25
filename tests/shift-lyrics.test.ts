import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftLyricTimings } from '../src/domain/shift-lyrics';

const cues = () => [
  { id: 'first', text: 'First', startSeconds: 1, endSeconds: 2, words: [{ text: 'First', startSeconds: 1.1, endSeconds: 1.7 }] },
  { id: 'second', text: 'Second', startSeconds: 2, endSeconds: 3, words: [] },
  { id: 'third', text: 'Third', startSeconds: 5, endSeconds: 6, words: [] },
];

test('shifts selected lines and their word cues without moving other lines', () => {
  const lines = cues();
  const shifted = shiftLyricTimings(lines, { second: [{ endSeconds: 2.8 }] }, new Set(['first', 'second']), 0.25);
  assert.equal(shifted.lines[0].startSeconds, 1.25);
  assert.deepEqual(shifted.lines[0].words[0], { text: 'First', startSeconds: 1.35, endSeconds: 1.95 });
  assert.deepEqual(shifted.drafts.second, [{ endSeconds: 3.05 }]);
  assert.equal(shifted.lines[2], lines[2]);
});

test('preserves intervals when the whole-song shift reaches the beginning', () => {
  const shifted = shiftLyricTimings(cues(), {}, new Set(['first', 'second', 'third']), -2);
  assert.equal(shifted.delta, -1);
  assert.deepEqual(shifted.lines.map(line => [line.startSeconds, line.endSeconds]), [[0, 1], [1, 2], [4, 5]]);
  assert.equal(shiftLyricTimings(cues(), {}, new Set(['third']), 4, 7).delta, 1);
});
