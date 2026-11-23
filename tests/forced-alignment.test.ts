import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyForcedAlignment, matchProviderWords } from '../src/domain/forced-alignment';
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

test('applies AI word times to marked and imported fragments while keeping literal slashes', () => {
  const result = applyForcedAlignment([
    { id: 'marked', text: 'sunset up/down', timingText: 'sun/set up\\/down', startSeconds: 0, endSeconds: 0, words: [] },
    { id: 'imported', text: 'daybreak', startSeconds: 12, endSeconds: 14, words: [
      { text: 'day', startSeconds: 12, endSeconds: 13 },
      { text: 'break', startSeconds: 13, endSeconds: 14 },
    ] },
  ], [
    { word: 'sunset', start: 1, end: 3 },
    { word: 'up/down', start: 4, end: 5 },
    { word: 'daybreak', start: 6, end: 10 },
  ], 15);
  assert.equal(result[0].text, 'sunset up/down');
  assert.equal(result[0].timingText, 'sun/set up\\/down');
  assert.deepEqual(result[0].words, [
    { text: 'sun', startSeconds: 1, endSeconds: 2 },
    { text: 'set ', startSeconds: 2, endSeconds: 3 },
    { text: 'up/down', startSeconds: 4, endSeconds: 5 },
  ]);
  assert.deepEqual(result[1].words.map(word => word.text), ['day', 'break']);
  assert.equal(result[1].words[0].startSeconds, 6);
  assert.equal(result[1].words[0].endSeconds, result[1].words[1].startSeconds);
  assert.equal(result[1].words[1].endSeconds, 10);
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

test('matches cloud tokenizer boundaries only when the full lexical sequence matches', () => {
  const aligned = [
    { word: 'Don', start: .5, end: .8 }, { word: 't', start: .8, end: .9 },
    { word: '停', start: 1.2, end: 1.4 }, { word: '下', start: 1.4, end: 1.6 },
  ];
  assert.deepEqual(matchProviderWords(["Don't / 停下"], aligned), [
    { word: "Don't", start: .5, end: .9 }, { word: '/', start: .9 - .001, end: .9 },
    { word: '停下', start: 1.2, end: 1.6 },
  ]);
  assert.equal(matchProviderWords(["Don't / 停不下"], aligned), aligned);
  const reversed = aligned.slice().reverse();
  assert.equal(matchProviderWords(['下停 Don’t'], reversed), reversed);
});
