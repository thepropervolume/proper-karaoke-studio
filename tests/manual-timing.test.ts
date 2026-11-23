/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { completeTimingSession, completedDraftWords, normalizeWordTimingDrafts, recordTimingTap, splitLineWords, startTimingSession, stepTimingHistory } from '../src/domain/manual-timing';
import type { LyricLine } from '../src/domain/project';
import { validateProject } from '../src/domain/project-file.mjs';

const line = (id: string, startSeconds: number, endSeconds: number, text: string = id): LyricLine =>
  ({ id, text, startSeconds, endSeconds, words: [] });

test('line timing starts at the playhead, preserves earlier cues, and undoes or redoes one tap', () => {
  const original = [line('A', 0, 3), line('B', 6, 8), line('C', 10, 12)];
  const entered = startTimingSession('line', original, 5)!;
  assert.equal(entered.targets[0].line, 1);
  const first = recordTimingTap(entered, 5.75);
  const second = recordTimingTap(first, 9.5);
  assert.equal(second.frames[2].lines[0], original[0]);
  assert.deepEqual(second.frames[2].lines.slice(1).map(cue => [cue.startSeconds, cue.endSeconds]), [[5.75, 9.5], [9.5, 11.5]]);
  assert.equal(stepTimingHistory(second, -1).frames[1], first.frames[1]);
  const undone = stepTimingHistory(second, -1);
  assert.equal(stepTimingHistory(undone, 1).frames[2], second.frames[2]);
  const replaced = recordTimingTap(undone, 9);
  assert.equal(replaced.frames[2].lines[2].startSeconds, 9);
  assert.equal(stepTimingHistory(replaced, 1), replaced);
  assert.deepEqual(second.frames[0].lines, original);
  assert.deepEqual(completeTimingSession(entered, 5.9), original);
  assert.equal(completeTimingSession(second, 11)[2].endSeconds, 11);
  assert.equal(startTimingSession('line', original, 15), null);
});

test('word timing starts at the matching word, preserves untouched rows, and rejects backwards taps', () => {
  const original = [line('A', 0, 3, 'Earlier words'), line('B', 4, 8, 'First second third fourth'), line('C', 10, 12, 'Later words')];
  const entered = startTimingSession('word', original, 5.35)!;
  assert.deepEqual(entered.targets[0], { line: 1, word: 1 });
  const first = recordTimingTap(entered, 5.5251);
  assert.equal(first.frames[1].lines[1].words[1].startSeconds, 5.525);
  assert.equal(recordTimingTap(first, 5.4), first);
  const second = recordTimingTap(first, 7);
  assert.equal(second.frames[2].lines[1].words[1].endSeconds, 7);
  assert.equal(second.frames[2].lines[1].words[2].startSeconds, 7);
  assert.equal(second.frames[2].lines[0], original[0]);
  assert.equal(second.frames[2].lines[2], original[2]);
  assert.deepEqual(second.frames[0].lines[1].words, []);
});

test('splits evenly by an explicit or neighboring span and preserves genuinely blank drafts', () => {
  const explicit = splitLineWords([line('A', 35, 40, '  One two three four five')], 0);
  assert.equal(explicit.words.map(word => word.text).join(''), '  One two three four five');
  assert.deepEqual(explicit.words.map(word => [word.startSeconds, word.endSeconds]), [[35, 36], [36, 37], [37, 38], [38, 39], [39, 40]]);
  const inferred = splitLineWords([line('X', 28, 35), line('Y', 0, 0, 'First second'), line('Z', 37, 40)], 1);
  assert.deepEqual(inferred.words.map(word => [word.startSeconds, word.endSeconds]), [[35, 36], [36, 37]]);
  const unresolved = splitLineWords([line('Unknown', 0, 0, 'Two words')], 0);
  assert.deepEqual(unresolved, { words: [], draft: [{}, {}] });
  const rows = [line('Unknown', 0, 0, 'Two words')];
  const drafts = { Unknown: [{ startSeconds: 0 }, {}], leftover: [{ startSeconds: 5 }] };
  const project = validateProject({
    schema: 'com.thepropervolume.karaoke-studio', version: 1, title: '', artist: '',
    durationSeconds: 10, stems: [], lyrics: rows, wordTimingDrafts: drafts,
  }, 'fixture.tpv.json');
  assert.deepEqual(project.wordTimingDrafts, { Unknown: [{ startSeconds: 0 }, {}] });
  assert.deepEqual(project.lyrics[0].words, []);
  assert.deepEqual(normalizeWordTimingDrafts({ Unknown: [{ startSeconds: Infinity }, { endSeconds: -1 }] }, rows), { Unknown: [{}, {}] });
  assert.equal(completedDraftWords(rows[0], [{ startSeconds: 0, endSeconds: 1 }, { startSeconds: 2 }]), null);
  assert.deepEqual(completedDraftWords(rows[0], [{ startSeconds: 0, endSeconds: 1 }, { startSeconds: 1, endSeconds: 2 }]), [
    { text: 'Two ', startSeconds: 0, endSeconds: 1 }, { text: 'words', startSeconds: 1, endSeconds: 2 },
  ]);
});
