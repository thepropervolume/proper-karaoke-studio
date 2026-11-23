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
  const expectedWindows = [[750, 5305], [750, 8680], [5305, 9180]];
  assert.deepEqual(layout.entries.map(cue => [cue.showAt, cue.hideAt].map(seconds => Math.round(seconds * 1000))), expectedWindows);
  assert.equal((layout.entries[0].centerY + layout.entries[1].centerY) / 2, 540);
  assert.equal(layout.entries[2].centerY, layout.entries[0].centerY);
  assert.deepEqual(pages.map(page => [page.startSeconds, page.endSeconds].map(seconds => Math.round(seconds * 1000))), expectedWindows);
  assert.equal(pages[0].lines[0].syllables[0].startSeconds, 2);
  assert.equal(pages[0].lines[0].syllables[0].endSeconds, 4);
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
  assert.equal(karaFunLyricFrame(timing, 10.6).pages[0].opacity, 1);
  assert.equal(timing.pages[0].fadeOut.startSeconds, 10.75);
  const leaving = karaFunLyricFrame(timing, 10.85).pages[0];
  const replacement = karaFunLyricFrame(timing, 11).pages.find(frame => frame.page.id === 4);
  assert(replacement);
  assert(leaving.opacity > 0 && leaving.opacity < 1);
  assert(replacement.opacity > 0 && replacement.opacity < 1);
  assert.equal(replacement.page.lines[0].box.y, leaving.page.lines[0].box.y);
  assert.equal(karaFunLyricFrame(timing, 21).pages.length, 0);
  assert.deepEqual(timing.bars.map(({ start, end }) => [start, end]), [[0, 32], [0, 6.75], [17.68, 26.75]]);
  for (const target of ['video', 'cdg'] as const) {
    const ass = toAss('Song', 'Artist', 32, lines, target, style);
    assert.match(ass, /Dialogue: 0,0:00:06\.75,0:00:10\.93,.+\\fad\(180,180\).+\\kt125\\kf150\}Line 0/);
    assert.match(ass, /\\t\(0,9070,\\clip/);
  }
});

test('overlapping cues make room for their replacements and finish fading by the end of the track', () => {
  const lines = [line('one', 'One', 1, 3), line('two', 'Two', 2.8, 4), line('three', 'Three', 3.3, 4.5)];
  const { pages } = toRenderTiming(lines, 4.6, { ...defaultLyricStyle, linesPerScreen: 2 });
  assert.equal(pages[0].endSeconds, 3.3);
  assert.equal(pages[2].startSeconds, 3.3);
  assert.equal(pages[2].fadeOut.startSeconds, 4.5);
  assert.equal(pages[2].endSeconds, 4.6);
});

test('six rows fit in both render targets', () => {
  const lines = Array.from({ length: 6 }, (_, index) => line(String(index), 'Line ' + index, 2 + index, 3 + index));
  for (const target of ['video', 'cdg'] as const) {
    const { entries, height } = layoutLyrics(lines, 10, { linesPerScreen: 6, fontSize: 200, leading: 220 }, target);
    assert.equal(entries.length, 6);
    assert(entries.every(({ centerY, fontSize }) => centerY - fontSize / 2 > 0 && centerY + fontSize / 2 < height));
    assert.equal(new Set(entries.map(entry => entry.centerY)).size, 6);
  }
});

test('legacy projects get defaults and saved styles round-trip with bounded values', () => {
  const project = { schema: 'com.thepropervolume.karaoke-studio', version: 1, title: '', artist: '', durationSeconds: 0, lyrics: [], stems: [] };
  assert.equal(defaultLyricStyle.linesPerScreen, 4);
  assert.deepEqual(validateProject(project, 'studio.tpv.json').lyricStyle, defaultLyricStyle);
  assert.deepEqual(validateProject({ ...project, lyricStyle: { font: 'serif', linesPerScreen: 1, outlineColor: '#FF44CC' } }, 'studio.tpv.json').lyricStyle,
    { ...defaultLyricStyle, font: 'serif', linesPerScreen: 2, outlineColor: '#ff44cc' });
  assert.deepEqual(normalizeLyricStyle({ font: ['serif'], linesPerScreen: 8, textColor: ['#ffffff'] } as unknown as typeof defaultLyricStyle), defaultLyricStyle);
});
