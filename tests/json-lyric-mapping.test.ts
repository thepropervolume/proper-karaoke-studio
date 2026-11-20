import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectCommand } from '../src/cli/project-commands.mjs';
import { mapJsonLyrics } from '../src/domain/json-lyric-mapping';

const source = {
  track: { name: 'New Song' },
  'lyrics/one': {
    '~lines': [{ caption: 'Three  words here', time: [1200, 3200],
      tokens: [
        { value: 'Three', fromMs: 0, forMs: 400 },
        { value: 'words', fromMs: 500, forMs: 400 },
        { value: 'here', fromMs: 1200, forMs: 600 },
      ],
    }],
  },
};

const mapping = {
  cues: '/lyrics~1one/~0lines', timeUnit: 'milliseconds', title: '/track/name',
  line: { text: '/caption', start: '/time/0', end: '/time/1', words: '/tokens' },
  word: { text: '/value', start: '/fromMs', duration: '/forMs', relativeTo: 'line' },
};

test('imports nested JSON through explicit pointers and keeps line-relative timing and spaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-studio-json-lyric-test-'));
  try {
    const project = join(directory, 'song.tpv.json');
    const lyrics = join(directory, 'external.json');
    const rules = join(directory, 'mapping.json');
    await writeFile(lyrics, JSON.stringify(source));
    await writeFile(rules, JSON.stringify(mapping));
    await projectCommand('project', 'init', { positional: [], options: { project, artist: 'Existing Artist' } });
    const args = { positional: [lyrics], options: { project } };
    await assert.rejects(projectCommand('lyrics', 'import', args), /not a supported TPV Studio/);
    const result = await projectCommand('lyrics', 'import', { ...args, options: { project, mapping: rules } });
    const [line] = result.project.lyrics;
    assert.equal(result.project.title, 'New Song');
    assert.equal(result.project.artist, 'Existing Artist');
    assert.equal(line.startSeconds, 1.2);
    assert.equal(line.endSeconds, 3.2);
    assert.equal(line.words.map((word: { text: string }) => word.text).join(''), line.text);
    assert.equal(line.words[1].startSeconds, 1.7);
    assert.equal(line.words[2].endSeconds, 3);

    const validProject = await readFile(project, 'utf8');
    await writeFile(rules, JSON.stringify({ ...mapping, cues: '/missing' }));
    await assert.rejects(projectCommand('lyrics', 'import', { ...args, options: { project, mapping: rules } }), /non-empty array/);
    assert.equal(await readFile(project, 'utf8'), validProject);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects malformed pointers, ambiguous timing, and invalid cue data', () => {
  assert.throws(() => mapJsonLyrics(source, { ...mapping, cues: '/bad~3pointer' }), /JSON Pointer/);
  assert.throws(() => mapJsonLyrics(source, {
    ...mapping, line: { ...mapping.line, duration: '/duration' },
  }), /exactly one/);
  assert.throws(() => mapJsonLyrics(source, {
    ...mapping, word: { ...mapping.word, relativeTo: 'timeline' },
  }), /outside its cue/);
  assert.throws(() => mapJsonLyrics(source, {
    ...mapping, word: { ...mapping.word, text: '/fromMs' },
  }), /non-empty text/);
  assert.throws(() => mapJsonLyrics({}, { ...mapping, title: '/constructor/name' }), /non-empty text/);
  const [line] = mapJsonLyrics([{ line: 'A standalone cue', start: 2, length: 3 }], {
    cues: '', timeUnit: 'seconds', line: { text: '/line', start: '/start', duration: '/length' },
  }).lines;
  assert.equal(line.endSeconds, 5);
  assert.deepEqual(line.words, []);
});
