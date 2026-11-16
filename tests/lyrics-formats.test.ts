import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyricsFile, parseLrc, parseSrt, toAss, toLrc, toLyricsJson, toSrt } from '../src/domain/lyrics-formats';
import { newLyricLines, toPortableKitProject, toRenderTiming } from '../src/domain/project';

test('round trips Enhanced LRC word timing and metadata', () => {
  const parsed = parseLrc('[ti:Popular]\n[ar:Nada Surf]\n[00:12.30]<00:12.30>Pop <00:12.70>ular');
  assert.equal(parsed.title, 'Popular');
  assert.equal(parsed.artist, 'Nada Surf');
  assert.equal(parsed.lines[0].text, 'Pop ular');
  assert.equal(parsed.lines[0].words[1].startSeconds, 12.7);
  assert.match(toLrc(parsed.title, parsed.artist, parsed.lines), /<00:12\.30>Pop /);
  assert.match(toLrc(parsed.title, parsed.artist, parsed.lines), /<00:12\.70>ular/);
});

test('imports SRT timestamps and exports numbered cues', () => {
  const lines = parseSrt('1\n00:00:01,250 --> 00:00:02,500\nHello world');
  assert.equal(lines[0].startSeconds, 1.25);
  assert.equal(lines[0].endSeconds, 2.5);
  assert.match(toSrt(lines), /00:00:01,250 --> 00:00:02,500/);
});

test('accepts Studio lyrics JSON and adapts cues for the shared renderer', () => {
  const lines = newLyricLines('First line\nSecond line', 20), json = toLyricsJson('Song', 'Artist', 20, lines);
  assert.equal(parseLyricsFile('lyrics.json', json).lines.length, 2);
  assert.equal(toRenderTiming(lines, 20).pages.length, 2);
  assert.throws(() => parseLyricsFile('other.json', '{"lines":[]}'), /not a supported/);
});

test('writes portable kit paths without host-local folders', () => {
  const project = {
    schema: 'com.thepropervolume.karaoke-studio' as const, version: 1 as const,
    title: 'Test', artist: 'Artist', durationSeconds: 8, lyrics: [],
    stems: [{ id: 'stem-1', name: 'Lead', role: 'lead' as const, voice: 'Alice', path: 'C:\\\\Music\\\\lead.wav', durationSeconds: 8, volume: 0.8 }],
    importedCdg: 'C:\\\\Music\\\\lead.cdg',
  };
  const kit = toPortableKitProject(project);
  assert.equal(kit.stems[0].path, 'stems/01-lead.wav');
  assert.equal(kit.importedCdg, 'source/lead.cdg');
  assert.doesNotMatch(JSON.stringify(kit), /C:\\\\/);
});

test('creates karaoke-tagged subtitle cues for MP4 export', () => {
  const parsed = parseLrc('[00:01.00]<00:01.00>Hello <00:01.60>there');
  const ass = toAss('Song', 'Artist', 5, parsed.lines);
  assert.match(ass, /Dialogue: 0,0:00:01\.00/);
  assert.match(ass, /\\kf/);
});

test('rejects invalid minute/second fields and backwards SRT cues', () => {
  assert.throws(() => parseLrc('[00:60.00]bad'), /under one minute/);
  assert.throws(() => parseSrt('1\n00:00:03,000 --> 00:00:02,000\nBackwards'), /ends before it begins/);
});
