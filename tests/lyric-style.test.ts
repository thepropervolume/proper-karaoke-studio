import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutLyrics, defaultLyricStyle, normalizeLyricStyle } from '../src/domain/lyric-style';
import { toAss, toLrc } from '../src/domain/lyrics-formats';
import { toRenderTiming, type LyricLine } from '../src/domain/project';
import { validateProject } from '../src/domain/project-file.mjs';
import { karaFunLyricFrame } from '../src/shared/from-booth/display/karafun-lyrics';

const line = (id: string, text: string, startSeconds: number, endSeconds: number): LyricLine => ({
  id, text, startSeconds, endSeconds, words: [{ text, startSeconds, endSeconds }],
});

test('preview and exports share centered lyric rows with independent visibility and highlights', () => {
  const lines = [line('one', 'First line', 2, 4), line('two', 'Second line', 4.25, 6), line('three', 'Final line', 8, 9)];
  const style = { ...defaultLyricStyle, allCaps: true, font: 'mono' as const, linesPerScreen: 2, highlightColor: '#112233' };
  const layout = layoutLyrics(lines, 12, style);
  const pages = toRenderTiming(lines, 12, style).pages;
  assert.deepEqual(layout.entries.map(cue => [cue.showAt, cue.hideAt]), [[.75, 4], [.75, 6], [4, 9]]);
  assert.equal((layout.entries[0].centerY + layout.entries[1].centerY) / 2, 540);
  assert.equal(layout.entries[2].centerY, layout.entries[0].centerY);
  assert.deepEqual(pages.map(page => [page.startSeconds, page.endSeconds]), [[.75, 4], [.75, 6], [4, 9]]);
  assert.equal(pages[0].lines[0].syllables[0].startSeconds, 2);
  assert.equal(pages[0].lines[0].syllables[0].text, 'FIRST LINE');
  const ass = toAss('Song', 'Artist', 12, lines, 'video', style);
  assert.match(ass, /Liberation Mono,64,&H00332211,&H00ffffff/);
  assert.match(ass, /\\pos\(960,470\.5\).+\\fad\(180,180\).+\\kt125\\kf200\}FIRST LINE/);
  assert.match(ass, /\\pos\(960,609\.5\)/);
  assert.match(toLrc('Song', 'Artist', lines), /First line/);
});

test('four lyric rows roll independently and long breaks show a countdown', () => {
  const lines = [8, 10, 12, 14, 16, 28].map((start, index) => line(String(index), 'Line ' + index, start, start + 1.5));
  const style = {
    ...defaultLyricStyle, linesPerScreen: 4, fontSize: 98, leading: 170,
    progressBar: { ...defaultLyricStyle.progressBar, enabled: true },
    countdownBar: { ...defaultLyricStyle.countdownBar, enabled: true },
  };
  const timing = toRenderTiming(lines, 32, style);
  assert.equal(karaFunLyricFrame(timing, 8.5).pages.length, 4);
  const leaving = karaFunLyricFrame(timing, 9.4).pages[0];
  const replacement = karaFunLyricFrame(timing, 9.6).pages.find(frame => frame.page.id === 4);
  assert(replacement);
  assert(leaving.opacity > 0 && leaving.opacity < 1);
  assert(replacement.opacity > 0 && replacement.opacity < 1);
  assert.equal(replacement.page.lines[0].box.y, leaving.page.lines[0].box.y);
  assert.equal(karaFunLyricFrame(timing, 21).pages.length, 0);
  assert.deepEqual(timing.bars.map(({ start, end }) => [start, end]), [[0, 32], [0, 6.75], [17.5, 26.75]]);
  assert.match(toAss('Song', 'Artist', 32, lines, 'video', style), /\\t\(0,9250,\\clip/);
});

test('legacy projects get defaults and saved styles round-trip with bounded values', () => {
  const project = { schema: 'com.thepropervolume.karaoke-studio', version: 1, title: '', artist: '', durationSeconds: 0, lyrics: [], stems: [] };
  assert.deepEqual(validateProject(project, 'studio.tpv.json').lyricStyle, defaultLyricStyle);
  assert.deepEqual(validateProject({ ...project, lyricStyle: { font: 'serif', linesPerScreen: 4, outlineColor: '#FF44CC' } }, 'studio.tpv.json').lyricStyle,
    { ...defaultLyricStyle, font: 'serif', linesPerScreen: 4, outlineColor: '#ff44cc' });
  assert.deepEqual(normalizeLyricStyle({ font: ['serif'], linesPerScreen: 8, textColor: ['#ffffff'] } as unknown as typeof defaultLyricStyle), defaultLyricStyle);
});
