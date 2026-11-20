import { parseLrc, parseSrt, toLrc as writeLrc, toSrt as writeSrt } from '@thepropervolume/karaoke-core';
import type { LyricLine, TimedWord } from './project';

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

export function toAss(title: string, artist: string, duration: number, lines: readonly LyricLine[], target: 'video' | 'cdg' = 'video'): string {
  const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r?\n/g, '\\N');
  const resolution = target === 'cdg' ? 'PlayResX: 300\nPlayResY: 216\nWrapStyle: 0' : 'PlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2';
  const style = target === 'cdg'
    ? 'Style: Default,Arial,20,&H00FFFFFF,&H00AA22DD,&H00000000,&H00000000,-1,0,1,0,0,2,14,14,72,1\n\n'
    : 'Style: Default,Arial,64,&H00FFFFFF,&H007A16D5,&H80101020,&H80101020,-1,0,1,4,1,2,110,110,120,1\n\n';
  const header = '[Script Info]\nTitle: ' + esc(title) + ' - ' + esc(artist) + '\nScriptType: v4.00+\n' + resolution + '\n\n' +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    style +
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const stamp = (seconds: number) => {
    const cs = Math.max(0, Math.round(seconds * 100));
    return Math.floor(cs / 360000) + ':' + String(Math.floor(cs / 6000) % 60).padStart(2, '0') + ':' + String(Math.floor(cs / 100) % 60).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0');
  };
  const events = lines.filter(line => line.text.trim()).map(line => {
    const start = Math.min(duration, Math.max(0, line.startSeconds)), end = Math.min(duration, Math.max(start + 0.1, line.endSeconds));
    let text = '';
    if (line.words.length) {
      let cursor = start;
      for (const word of line.words) {
        const wordStart = Math.max(cursor, word.startSeconds), wordEnd = Math.max(wordStart, word.endSeconds);
        if (wordStart > cursor) text += '{\\k' + Math.max(1, Math.round((wordStart - cursor) * 100)) + '}';
        text += '{\\kf' + Math.max(1, Math.round((wordEnd - wordStart) * 100)) + '}' + esc(word.text);
        cursor = wordEnd;
      }
      if (cursor < end) text += '{\\k' + Math.max(1, Math.round((end - cursor) * 100)) + '}';
    } else text = '{\\kf' + Math.max(1, Math.round((end - start) * 100)) + '}' + esc(line.text);
    return 'Dialogue: 0,' + stamp(start) + ',' + stamp(end) + ',Default,,0,0,0,,' + text;
  });
  return header + events.join('\n') + '\n';
}
