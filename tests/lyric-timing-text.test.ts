import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLyricsFile, toAss, toLrc, toLyricsJson, toSrt } from '../src/domain/lyrics-formats';
import { editLyricTimingText, lyricTimingInput, lyricTimingTokens } from '../src/domain/lyric-timing-text';
import { completedDraftWords, splitLineWords } from '../src/domain/manual-timing';
import { validateProject } from '../src/domain/project-file.mjs';
import { newLyricLines, seedTimedWords } from '../src/domain/project';

test('inserting and removing a split preserves the original word span and surrounding timings', () => {
  const [line] = newLyricLines('So perfect tonight', 12);
  line.words = [
    { text: 'So ', startSeconds: 1, endSeconds: 2 },
    { text: 'perfect ', startSeconds: 4, endSeconds: 11 },
    { text: 'tonight', startSeconds: 11.5, endSeconds: 12 },
  ];
  const split = editLyricTimingText(line, 'So per/fec/t tonight');
  assert.equal(split.text, line.text);
  assert.equal(lyricTimingInput(split), 'So per/fec/t tonight');
  assert.deepEqual(split.words, [line.words[0],
    { text: 'per', startSeconds: 4, endSeconds: 7 },
    { text: 'fec', startSeconds: 7, endSeconds: 10 },
    { text: 't ', startSeconds: 10, endSeconds: 11 },
    line.words[2],
  ]);
  assert.deepEqual(editLyricTimingText(split, line.text).words, line.words);
});

test('split notation survives project saves and only literal slashes are shown in exports', () => {
  const [draft] = newLyricLines(String.raw`per//fect \/ yes`, 4);
  const [line] = seedTimedWords([draft]);
  assert.equal(line.text, 'perfect / yes');
  assert.deepEqual(lyricTimingTokens(line), ['per', 'fect ', '/ ', 'yes']);

  const { lyrics: [saved] } = validateProject({ schema: 'com.thepropervolume.karaoke-studio', version: 1,
    title: 'Song', artist: 'Artist', durationSeconds: 4, stems: [], lyrics: [line] }, 'fixture.tpv.json');
  const { lines: [json] } = parseLyricsFile('fixture.json', toLyricsJson('Song', 'Artist', 4, [saved]));
  assert.equal(lyricTimingInput(json), String.raw`per//fect \/ yes`);
  assert.deepEqual(json.words, line.words);

  const { lines: [enhanced] } = parseLyricsFile('fixture.lrc', toLrc('Song', 'Artist', [json]));
  assert.equal(enhanced.text, line.text);
  assert.deepEqual(lyricTimingTokens(enhanced), ['per', 'fect ', '/ ', 'yes']);
  assert.match(toSrt([json]), /\nperfect \/ yes\n/);
  for (const target of ['video', 'cdg'] as const) {
    assert.match(toAss('Song', 'Artist', 4, [json], target), /\}per\{[^}]+\}fect \{[^}]+\}\/ /);
  }
});

test('untimed fragments get individual draft fields and existing literal slashes stay literal', () => {
  const [draft] = newLyricLines('a/gain', 4);
  const line = { ...draft, endSeconds: draft.startSeconds };
  const { draft: fields } = splitLineWords([line], 0);
  assert.deepEqual(fields, [{}, {}]);
  assert.deepEqual(completedDraftWords(line, [
    { startSeconds: 0, endSeconds: 1 }, { startSeconds: 1, endSeconds: 3 },
  ])?.map(word => word.text), ['a', 'gain']);
  const { lines: [imported] } = parseLyricsFile('literal.srt', '1\n00:00:00,000 --> 00:00:01,000\nup/down\n');
  assert.equal(lyricTimingInput(imported), String.raw`up\/down`);
  assert.deepEqual(lyricTimingTokens(imported), ['up/down']);
});
