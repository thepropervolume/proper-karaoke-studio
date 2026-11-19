import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyForcedAlignment } from '../src/domain/forced-alignment';
import type { LyricLine } from '../src/domain/project';

const lines: LyricLine[] = [
  { id: 'a', text: "Don't stop", startSeconds: 0, endSeconds: 0, words: [] },
  { id: 'b', text: 'believin!', startSeconds: 0, endSeconds: 0, words: [] },
];

test('applies aligned word times while preserving supplied text and lyric lines', () => {
  const result = applyForcedAlignment(lines, [
    { word: "Don't", start: 0.5, end: 0.8 },
    { word: 'stop', start: 0.9, end: 1.2 },
    { word: 'believin', start: 1.4, end: 2.1 },
  ], 10);
  assert.deepEqual(result.map(line => line.text), ["Don't stop", 'believin!']);
  assert.deepEqual(result.map(line => line.words.map(word => word.text)), [["Don't ", 'stop'], ['believin!']]);
  assert.deepEqual(result.map(line => [line.startSeconds, line.endSeconds]), [[0.5, 1.2], [1.4, 2.1]]);
});

test('rejects a word mismatch without mutating the source lines', () => {
  assert.throws(() => applyForcedAlignment(lines, [
    { word: 'Never', start: 0.5, end: 0.8 },
    { word: 'stop', start: 0.9, end: 1.2 },
    { word: 'believin', start: 1.4, end: 2.1 },
  ], 10), /did not match/);
  assert.equal(lines[0].words.length, 0);
});

test('rejects missing and invalid timing results', () => {
  assert.throws(() => applyForcedAlignment(lines, [], 10), /word timings/);
  assert.throws(() => applyForcedAlignment(lines, [
    { word: "Don't", start: 1.5, end: 0.8 },
    { word: 'stop', start: 1.6, end: 1.8 },
    { word: 'believin', start: 1.9, end: 2.1 },
  ], 10), /invalid or out-of-order/);
});
