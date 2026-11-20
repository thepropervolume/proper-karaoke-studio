import { parseLrc, parseSrt, toLrc as writeLrc, toSrt as writeSrt } from '@thepropervolume/karaoke-core';
import type { LyricLine, TimedWord } from './project';
import { layoutLyrics, lyricFonts, type LyricStyle } from './lyric-style';

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
      return asLine(line.text, line.startSeconds, line.endSeconds, Array.isArray(line.words) ? line.words : []);
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
  const { width, height, style, entries } = layoutLyrics(lines, duration, appearance, target);
  const resolution = 'PlayResX: ' + width + '\nPlayResY: ' + height + '\nScaledBorderAndShadow: yes\nWrapStyle: 2';
  const assColor = (color: string) => '&H00' + color.slice(5, 7) + color.slice(3, 5) + color.slice(1, 3);
  // libass uses the secondary color before a karaoke syllable's time.
  const palette = [style.highlightColor, style.textColor, style.outlineColor, style.backgroundColor].map(assColor).join(',');
  const styleLine = 'Style: Default,' + lyricFonts[style.font].family + ',64,' + palette + ',-1,0,1,3,0,5,0,0,0,1\n\n';
  const header = '[Script Info]\nTitle: ' + esc(title) + ' - ' + esc(artist) + '\nScriptType: v4.00+\n' + resolution + '\n\n' +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    styleLine +
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const stamp = (seconds: number) => {
    const cs = Math.max(0, Math.round(seconds * 100));
    return Math.floor(cs / 360000) + ':' + String(Math.floor(cs / 6000) % 60).padStart(2, '0') + ':' + String(Math.floor(cs / 100) % 60).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0');
  };
  const events = entries.map(({ showAt, hideAt, words, centerY, fontSize }) => {
    const position = '{\\an5\\pos(' + width / 2 + ',' + centerY + ')\\fs' + fontSize + '\\bord' + Math.max(.5, fontSize * .0425).toFixed(2) + '}';
    const lyrics = words.map(word => {
      const delay = Math.max(0, Math.round((word.startSeconds - showAt) * 100));
      const span = Math.max(1, Math.round((word.endSeconds - word.startSeconds) * 100));
      return '{\\kt' + delay + '\\kf' + span + '}' + esc(word.text);
    }).join('');
    return 'Dialogue: 0,' + stamp(showAt) + ',' + stamp(hideAt) + ',Default,,0,0,0,,' + position + lyrics;
  });
  return header + events.join('\n') + '\n';
}
