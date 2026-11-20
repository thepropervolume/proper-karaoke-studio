import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alignLyricsFromFiles, formatLyricsFile, formatLyricText } from '../src/cli/standalone-lyrics.mjs';
import { loadProject } from '../src/domain/project-file.mjs';
import separation from '../src/main/separation-options.cjs';

test('formats UTF-8 lyrics into karaoke lines, safely including in-place output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-format-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'Lyric input.txt');
  const output = join(directory, 'nested', 'Lyric output.txt');
  const input = '\uFEFF[Verse 1]\r\n One    two three four five six.\r\n\r\n[Chorus]\r\nHéllo again!\r\n';
  const expected = 'One two three\nfour five six.\n\nHéllo again!\n';
  await writeFile(source, input, 'utf8');
  assert.deepEqual(await formatLyricsFile({ lyricsFile: source, output, width: 16 }), { output, lines: 3 });
  assert.equal(await readFile(output, 'utf8'), expected);
  assert.equal(await readFile(source, 'utf8'), input);
  await assert.rejects(formatLyricsFile({ lyricsFile: source, output, width: 16 }), /Pass --force/);
  await formatLyricsFile({ lyricsFile: source, output: source, width: 16 });
  assert.equal(await readFile(source, 'utf8'), expected);
  assert.equal(formatLyricText('👩‍🎤 abcd efg', 8), '👩‍🎤 abcd\nefg\n');
});

test('standalone alignment exports timed lyrics and can create an editable project after success', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-align-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lyricsFile = join(directory, 'Song.txt');
  const audio = join(directory, 'Song mix.wav');
  const output = join(directory, 'Song.lrc');
  const file = join(directory, 'nested', 'Song.tpv.json');
  await Promise.all([writeFile(lyricsFile, 'Hello there!\nSweet voice.\n'), writeFile(audio, 'test alignment source')]);
  const align = async (input: { audioPath: string; language: string; lyrics: string[] }) => {
    assert.deepEqual(input, { audioPath: audio, language: 'en', lyrics: ['Hello there!', 'Sweet voice.'] });
    return { duration: 6, words: ['Hello', 'there', 'Sweet', 'voice'].map((word, i) => ({ word, start: i + 0.2, end: i + 0.5 })) };
  };
  const data = { lyricsFile, audio, language: 'en' };
  const inline = await alignLyricsFromFiles(data, align);
  assert.equal(inline.project, null);
  assert.equal(inline.alignedWords, 4);
  assert.equal(inline.lyrics?.[1].text, 'Sweet voice.');
  await alignLyricsFromFiles({ ...data, output }, align);
  assert.match(await readFile(output, 'utf8'), /\[00:00\.20\].*Hello/);
  await assert.rejects(alignLyricsFromFiles({ ...data, file }, async () => { throw new Error('Audio alignment failed.'); }), /alignment failed/);
  await assert.rejects(access(file), { code: 'ENOENT' });
  assert.equal((await alignLyricsFromFiles({ ...data, file }, align)).project, file);
  const project = await loadProject(file);
  assert.equal(project.title, 'Song mix');
  assert.equal(project.durationSeconds, 6);
  assert.equal(project.stems[0].path, audio);
  assert.equal(project.lyrics[1].startSeconds, 2.2);
  assert.deepEqual(project.lyrics[0].words.map(word => word.text), ['Hello ', 'there!']);
  assert.equal(await readFile(lyricsFile, 'utf8'), 'Hello there!\nSweet voice.\n');
});

test('model options use each backend’s supported flags and reject unknown or malformed settings', () => {
  const { parseModelOptions, validatedModelOptions, localSeparatorArgs } = separation;
  assert.deepEqual(localSeparatorArgs('audio-separator', parseModelOptions('mdx_overlap=0.5,mdx_enable_denoise=true,format=flac')),
    ['--mdx_overlap', '0.5', '--mdx_enable_denoise', '--output_format', 'FLAC']);
  assert.deepEqual(localSeparatorArgs('demucs', parseModelOptions('two-stems=vocals,shifts=0,format=wav')),
    ['--two-stems', 'vocals', '--shifts', '0']);
  assert.deepEqual(validatedModelOptions('dango', parseModelOptions('separateBackingVocals=true,modelType=conserve,format=mp3')),
    { separateBackingVocals: true, modelType: 'conserve', format: 'mp3' });
  assert.throws(() => localSeparatorArgs('demucs', parseModelOptions('splitType=3')), /Unsupported model option/);
  assert.throws(() => localSeparatorArgs('demucs', parseModelOptions('two-stems=--help')), /Choose vocals/);
  assert.throws(() => parseModelOptions('format=wav,format=mp3'), /more than once/);
});
