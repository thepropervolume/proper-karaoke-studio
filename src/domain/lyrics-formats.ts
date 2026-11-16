import type { LyricLine, TimedWord } from './project';
export type LyricsFormat = 'json' | 'lrc' | 'srt';

const stampPattern = /^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/;
export function parseStamp(value: string): number {
  const match = stampPattern.exec(value.trim());
  if (!match) throw new Error('Invalid timestamp.');
  const withinMinute = Number(match[2]);
  if (withinMinute > 59) throw new Error('Timestamp seconds must be under one minute.');
  const seconds = Number(match[1]) * 60 + withinMinute + (match[3] ? Number('0.' + match[3]) : 0);
  if (!Number.isFinite(seconds) || seconds > 24 * 60 * 60) throw new Error('Timestamp is outside the supported range.');
  return seconds;
}
const asLine = (text: string, startSeconds: number, endSeconds: number, words: TimedWord[] = []): LyricLine => ({
  id: crypto.randomUUID(), text, startSeconds, endSeconds, words,
});

export function parseLrc(input: string): { title: string; artist: string; lines: LyricLine[] } {
  const raw: { start: number; text: string; words: TimedWord[] }[] = [];
  let title = '', artist = '';
  for (const source of input.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const meta = /^\[(ti|ar):([^\]]*)\]$/i.exec(source.trim());
    if (meta) { if (meta[1].toLowerCase() === 'ti') title = meta[2].trim(); else artist = meta[2].trim(); continue; }
    const lineTag = /^\[(\d{1,3}:\d{2}(?:\.\d{1,3})?)\](.*)$/.exec(source.trim());
    if (!lineTag) continue;
    const start = parseStamp(lineTag[1]), body = lineTag[2], timedWords: TimedWord[] = [];
    const wordTag = /<((?:\d{1,3}:)?\d{2}:\d{2}(?:\.\d{1,3})?)>([^<]*)/g;
    let word: RegExpExecArray | null;
    while ((word = wordTag.exec(body))) {
      const parts = word[1].split(':');
      const stamp = parts.length === 3 ? Number(parts[0]) * 3600 + parseStamp(parts[1] + ':' + parts[2]) : parseStamp(word[1]);
      if (word[2]) timedWords.push({ text: word[2], startSeconds: stamp, endSeconds: stamp });
    }
    const text = timedWords.length ? timedWords.map(item => item.text).join('') : body.trim();
    if (text) raw.push({ start, text, words: timedWords });
  }
  return {
    title, artist,
    lines: raw.map((item, index) => {
      const endSeconds = raw[index + 1]?.start ?? item.start + 2;
      const words = item.words.map((entry, wordIndex) => ({ ...entry, endSeconds: item.words[wordIndex + 1]?.startSeconds ?? endSeconds }));
      return asLine(item.text, item.start, endSeconds, words);
    }),
  };
}

export function parseSrt(input: string): LyricLine[] {
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  const lines: LyricLine[] = [];
  for (const block of blocks) {
    const rows = block.split('\n'), timeIndex = rows.findIndex(row => row.includes('-->'));
    if (timeIndex < 0) continue;
    const match = /^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})/.exec(rows[timeIndex].trim());
    if (!match) throw new Error('An SRT cue has an invalid time range.');
    const toSeconds = (value: string) => {
      const [hh, mm, ss] = value.replace(',', '.').split(':');
      if (Number(mm) > 59 || Number(ss) >= 60) throw new Error('An SRT timestamp is outside the valid range.');
      return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    };
    const text = rows.slice(timeIndex + 1).join('\n').replace(/<[^>]*>/g, '').trim();
    const startSeconds = toSeconds(match[1]), endSeconds = toSeconds(match[2]);
    if (endSeconds < startSeconds) throw new Error('An SRT cue ends before it begins.');
    if (text) lines.push(asLine(text, startSeconds, endSeconds));
  }
  return lines;
}

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

function lrcTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100)), minutes = Math.floor(centiseconds / 6000);
  const rest = (centiseconds % 6000) / 100;
  return String(minutes).padStart(2, '0') + ':' + rest.toFixed(2).padStart(5, '0');
}
function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(f).padStart(3, '0');
}
export function toLrc(title: string, artist: string, lines: readonly LyricLine[]): string {
  return ['[ti:' + title + ']', '[ar:' + artist + ']', ...lines.map(line => {
    const words = line.words.length ? line.words.map(word => '<' + lrcTime(word.startSeconds) + '>' + word.text).join('') : line.text;
    return '[' + lrcTime(line.startSeconds) + ']' + words;
  })].join('\n') + '\n';
}
export function toSrt(lines: readonly LyricLine[]): string {
  return lines.map((line, index) => (index + 1) + '\n' + srtTime(line.startSeconds) + ' --> ' + srtTime(line.endSeconds) + '\n' + line.text).join('\n\n') + (lines.length ? '\n' : '');
}
export function toLyricsJson(title: string, artist: string, durationSeconds: number, lines: readonly LyricLine[]): string {
  return JSON.stringify({ schema: 'com.thepropervolume.karaoke-studio', version: 1, title, artist, durationSeconds, lyrics: lines }, null, 2) + '\n';
}

export function toAss(title: string, artist: string, duration: number, lines: readonly LyricLine[]): string {
  const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r?\n/g, '\\N');
  const header = '[Script Info]\nTitle: ' + esc(title) + ' - ' + esc(artist) + '\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n' +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    'Style: Default,Arial,64,&H00FFFFFF,&H007A16D5,&H80101020,&H80101020,-1,0,1,4,1,2,110,110,120,1\n\n' +
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
