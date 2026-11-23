import { parseLrc, parseSrt, toLrc as writeLrc, toSrt as writeSrt } from '@thepropervolume/karaoke-core';
import type { LyricLine, TimedWord } from './project';
import { layoutLyrics, lyricFontFamily, type LyricStyle } from './lyric-style';
import { savedLyricTimingText } from './lyric-timing-text';

export { parseLrc, parseSrt, parseStamp } from '@thepropervolume/karaoke-core';
export type LyricsFormat = 'json' | 'lrc' | 'srt';

const asLine = (text: string, startSeconds: number, endSeconds: number, words: TimedWord[] = []): LyricLine => ({
  id: crypto.randomUUID(), text, startSeconds, endSeconds, words,
});

export function parseLyricsFile(name: string, content: string): { title?: string; artist?: string; lines: LyricLine[] } {
  const extension = name.toLowerCase().split('.').at(-1);
  if (extension === 'lrc' || extension === 'elrc') return parseLrc(content);
  if (extension === 'srt') return { lines: parseSrt(content) };
  if (extension === 'json') {
    const value = JSON.parse(content);
    if (!value || value.schema !== 'com.thepropervolume.karaoke-studio' || value.version !== 1 || !Array.isArray(value.lyrics))
      throw new Error('This is not a supported TPV Studio lyrics JSON file.');
    const lines = value.lyrics.map((line: any) => {
      if (typeof line.text !== 'string' || !Number.isFinite(line.startSeconds) || !Number.isFinite(line.endSeconds))
        throw new Error('The JSON file contains an invalid lyric line.');
      const cue = asLine(line.text, line.startSeconds, line.endSeconds, Array.isArray(line.words) ? line.words : []);
      const timingText = savedLyricTimingText(cue.text, line.timingText);
      return timingText === undefined ? cue : { ...cue, timingText };
    });
    return { title: typeof value.title === 'string' ? value.title : undefined, artist: typeof value.artist === 'string' ? value.artist : undefined, lines };
  }
  throw new Error('Choose a TPV lyrics JSON, Enhanced LRC, or SRT file.');
}

export function toLrc(title: string, artist: string, lines: readonly LyricLine[]): string {
  // Studio edits line bounds and words independently. Export a valid sequence without rewriting the project.
  return writeLrc(title, artist, lines.map(line => {
    const startSeconds = Math.max(0, Math.min(line.startSeconds, line.words[0]?.startSeconds ?? line.startSeconds));
    let cursor = startSeconds;
    const words = line.words.map(word => {
      cursor = Math.max(cursor, word.startSeconds);
      return { ...word, startSeconds: cursor };
    });
    return { ...line, words, startSeconds, endSeconds: Math.max(cursor, line.endSeconds) };
  }));
}
export function toSrt(lines: readonly LyricLine[]): string {
  return writeSrt(lines.map(line => {
    const startSeconds = Math.max(0, line.startSeconds);
    return { ...line, startSeconds, endSeconds: Math.max(startSeconds, line.endSeconds) };
  }));
}
export function toLyricsJson(title: string, artist: string, durationSeconds: number, lines: readonly LyricLine[]): string {
  return JSON.stringify({ schema: 'com.thepropervolume.karaoke-studio', version: 1, title, artist, durationSeconds, lyrics: lines }, null, 2) + '\n';
}

export function toAss(title: string, artist: string, duration: number, lines: readonly LyricLine[], target: 'video' | 'cdg' = 'video', appearance?: LyricStyle): string {
  const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r?\n/g, '\\N');
  const { width, height, style, entries, bars } = layoutLyrics(lines, duration, appearance, target);
  const resolution = 'PlayResX: ' + width + '\nPlayResY: ' + height + '\nScaledBorderAndShadow: yes\nWrapStyle: 2';
  const bgr = (color: string) => color.slice(5, 7) + color.slice(3, 5) + color.slice(1, 3);
  const assColor = (color: string) => '&H00' + bgr(color);
  // libass uses the secondary color before a karaoke syllable's time.
  const palette = [style.highlightColor, style.textColor, style.outlineColor, style.backgroundColor].map(assColor).join(',');
  const styleLine = 'Style: Default,' + lyricFontFamily(style) + ',64,' + palette
    + ',' + (style.font === 'custom' ? 0 : -1) + ',0,1,3,0,5,0,0,0,1\n\n';
  const header = '[Script Info]\nTitle: ' + esc(title) + ' - ' + esc(artist) + '\nScriptType: v4.00+\n' + resolution + '\n\n' +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    styleLine +
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const stamp = (seconds: number) => {
    const cs = Math.max(0, Math.round(seconds * 100));
    return Math.floor(cs / 360000) + ':' + String(Math.floor(cs / 6000) % 60).padStart(2, '0') + ':' + String(Math.floor(cs / 100) % 60).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0');
  };
  const line = (layer: number, start: number, end: number, text: string) =>
    'Dialogue: ' + layer + ',' + stamp(start) + ',' + stamp(end) + ',Default,,0,0,0,,' + text;
  const events = entries.map(({ showAt, hideAt, fade, words, centerY, fontSize }) => {
    const position = '{\\an5\\pos(' + width / 2 + ',' + centerY + ')\\fs' + fontSize + '\\bord' + Math.max(.5, fontSize * .0425).toFixed(2) + '}';
    const lyrics = words.map(word => {
      const delay = Math.max(0, Math.round((word.startSeconds - showAt) * 100));
      const span = Math.max(1, Math.round((word.endSeconds - word.startSeconds) * 100));
      return '{\\kt' + delay + '\\kf' + span + '}' + esc(word.text);
    }).join('');
    const fadeMs = Math.round(fade * 1000);
    return line(0, showAt, hideAt, position + '{\\fad(' + fadeMs + ',' + fadeMs + ')}' + lyrics);
  });
  const rectangle = (left: number, top: number, right: number, bottom: number, color: string, motion = '') =>
    '{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H' + bgr(color) + '&' + motion + '\\p1}m '
      + left + ' ' + top + ' l ' + right + ' ' + top + ' ' + right + ' ' + bottom + ' ' + left + ' ' + bottom + '{\\p0}';
  for (const bar of bars) {
    const { x, y, start, end, border, style: colors } = bar;
    const right = x + bar.width, bottom = y + bar.height;
    const leftInside = x + border, rightInside = right - border, topInside = y + border, bottomInside = bottom - border;
    const milliseconds = Math.max(1, Math.round((end - start) * 1000));
    // libass interpolates a rectangular clip, revealing the fill from left to right.
    const animated = '\\clip(' + [leftInside, topInside, leftInside, bottomInside].join(',') + ')'
      + '\\t(0,' + milliseconds + ',\\clip(' + [leftInside, topInside, rightInside, bottomInside].join(',') + '))';
    if (border) events.push(line(1, start, end, rectangle(x, y, right, bottom, colors.borderColor)));
    events.push(line(2, start, end, rectangle(leftInside, topInside, rightInside, bottomInside, colors.trackColor)));
    events.push(line(3, start, end, rectangle(leftInside, topInside, rightInside, bottomInside, colors.fillColor, animated)));
  }
  return header + events.join('\n') + '\n';
}
