import { parseLrc, parseSrt, toLrc as writeLrc, toSrt as writeSrt } from '@thepropervolume/karaoke-core';
import type { LyricLine, TimedWord } from './project';
import { layoutLyrics, lyricFontFamily, lyricFonts, normalizeLyricStyle, type LyricBar, type LyricStyle } from './lyric-style';
import { savedLyricTimingText } from './lyric-timing-text';
import { titleCardLayout, type TitleCardStyle } from './video-presentation';

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

const escapeAss = (value: string) => value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r\n?|\n/g, '\\N');
const bgr = (color: string) => color.slice(5, 7) + color.slice(3, 5) + color.slice(1, 3);
const assColor = (color: string) => '&H00' + bgr(color);
const assStyles = '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
const assEvents = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
const assStamp = (seconds: number) => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return Math.floor(cs / 360000) + ':' + String(Math.floor(cs / 6000) % 60).padStart(2, '0') + ':' + String(Math.floor(cs / 100) % 60).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0');
};
const assDialogue = (layer: number, start: number, end: number, text: string) =>
  'Dialogue: ' + layer + ',' + assStamp(start) + ',' + assStamp(end) + ',Default,,0,0,0,,' + text;

export function toTitleAss(title: string, artist: string, card: TitleCardStyle, appearance?: LyricStyle) {
  const layout = titleCardLayout(card, title, artist);
  const style = normalizeLyricStyle(appearance);
  const font = card.font === 'lyrics' ? lyricFontFamily(style) : lyricFonts[card.font].family;
  const bold = card.font === 'lyrics' && style.font === 'custom' ? 0 : -1;
  const align = card.align === 'left' ? 4 : card.align === 'right' ? 6 : 5;
  const position = (y: number, size: number, color: string, value: string) =>
    '{\\an' + align + '\\pos(' + layout.x + ',' + y + ')\\fs' + size + '\\1c&H' + bgr(color) + '&}' + escapeAss(value);
  const header = '[Script Info]\nScriptType: v4.00+\nPlayResX: ' + layout.width + '\nPlayResY: ' + layout.height +
    '\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n' + assStyles + 'Style: Default,' + font +
    ',64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,' + bold + ',0,1,0,0,5,134,134,0,1\n\n' + assEvents;
  const cue = (text: string, y: number, size: number, color: string) => assDialogue(0, 0, card.duration, position(y, size, color, text));
  return header + cue(layout.title, layout.titleY, card.titleSize, card.textColor) + '\n'
    + (layout.subtitle ? cue(layout.subtitle, layout.subtitleY, card.subtitleSize, card.subtitleColor) + '\n' : '');
}

type AssVideoTiming = { offset: number; openingCountdown: LyricBar | null };
export function toAss(title: string, artist: string, duration: number, lines: readonly LyricLine[], target: 'video' | 'cdg' = 'video',
  appearance?: LyricStyle, presentation?: AssVideoTiming): string {
  const { width, height, style, entries, bars } = layoutLyrics(lines, duration, appearance, target);
  const cdg = target === 'cdg';
  const resolution = 'PlayResX: ' + width + '\nPlayResY: ' + height + '\nScaledBorderAndShadow: yes\nWrapStyle: 2';
  // libass uses the secondary color before a karaoke syllable's time.
  // These CD+G raster colors identify the two lyric states for the packet encoder.
  const palette = (cdg ? ['#ff00ff', '#ffffff', '#000000', '#000000']
    : [style.highlightColor, style.textColor, style.outlineColor, style.backgroundColor]).map(assColor).join(',');
  const styleLine = 'Style: Default,' + lyricFontFamily(style) + ',64,' + palette
    + ',' + (style.font === 'custom' && !cdg ? 0 : -1) + ',0,1,3,0,5,0,0,0,1\n\n';
  const header = '[Script Info]\nTitle: ' + escapeAss(title) + ' - ' + escapeAss(artist) + '\nScriptType: v4.00+\n' + resolution + '\n\n' +
    assStyles + styleLine + assEvents;
  const offset = presentation?.offset ?? 0;
  const events = entries.map(({ showAt, hideAt, fadeIn, fadeOut, words, centerY, fontSize }) => {
    const border = cdg ? 0 : Math.max(.5, fontSize * .0425).toFixed(2);
    const position = '{\\an5\\pos(' + width / 2 + ',' + centerY + ')\\fs' + fontSize + '\\bord' + border + '}';
    const lyrics = words.map(word => {
      const delay = Math.max(0, Math.round((word.startSeconds - showAt) * 100));
      const span = Math.max(1, Math.round((word.endSeconds - word.startSeconds) * 100));
      return '{\\kt' + delay + '\\kf' + span + '}' + escapeAss(word.text);
    }).join('');
    const fade = cdg ? '' : '{\\fad(' + Math.round(fadeIn * 1000) + ',' + Math.round(fadeOut * 1000) + ')}';
    return assDialogue(0, showAt + offset, hideAt + offset, position + fade + lyrics);
  });
  const rectangle = (left: number, top: number, right: number, bottom: number, color: string, motion = '') =>
    '{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H' + bgr(color) + '&' + motion + '\\p1}m '
      + left + ' ' + top + ' l ' + right + ' ' + top + ' ' + right + ' ' + bottom + ' ' + left + ' ' + bottom + '{\\p0}';
  const outputBars = bars.filter(bar => !presentation?.openingCountdown || bar.style !== style.countdownBar || bar.start !== 0)
    .map(bar => ({ ...bar, start: bar.start + offset, end: bar.end + offset }));
  if (presentation?.openingCountdown) outputBars.push(presentation.openingCountdown);
  for (const bar of outputBars) {
    const { x, y, start, end, border, style: colors } = bar;
    const right = x + bar.width, bottom = y + bar.height;
    const leftInside = x + border, rightInside = right - border, topInside = y + border, bottomInside = bottom - border;
    const milliseconds = Math.max(1, Math.round((end - start) * 1000));
    // libass interpolates a rectangular clip, revealing the fill from left to right.
    const animated = '\\clip(' + [leftInside, topInside, leftInside, bottomInside].join(',') + ')'
      + '\\t(0,' + milliseconds + ',\\clip(' + [leftInside, topInside, rightInside, bottomInside].join(',') + '))';
    if (border) events.push(assDialogue(1, start, end, rectangle(x, y, right, bottom, colors.borderColor)));
    events.push(assDialogue(2, start, end, rectangle(leftInside, topInside, rightInside, bottomInside, colors.trackColor)));
    events.push(assDialogue(3, start, end, rectangle(leftInside, topInside, rightInside, bottomInside, colors.fillColor, animated)));
  }
  return header + events.join('\n') + '\n';
}
