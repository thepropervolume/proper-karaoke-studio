import type { LyricLine, TimedWord } from '@thepropervolume/karaoke-core';

export const lyricFonts = {
  sans: { family: 'Liberation Sans', label: 'Sans Serif' },
  serif: { family: 'Liberation Serif', label: 'Serif' },
  mono: { family: 'Liberation Mono', label: 'Monospace' },
} as const;

export type LyricStyle = {
  font: keyof typeof lyricFonts;
  allCaps: boolean;
  linesPerScreen: number;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  backgroundColor: string;
};

export const defaultLyricStyle: LyricStyle = {
  font: 'sans', allCaps: false, linesPerScreen: 1,
  textColor: '#ffffff', highlightColor: '#d5167a', outlineColor: '#101020', backgroundColor: '#171226',
};

export function normalizeLyricStyle(value?: Partial<LyricStyle> | null): LyricStyle {
  const color = (key: 'textColor' | 'highlightColor' | 'outlineColor' | 'backgroundColor') => {
    const field = value?.[key];
    return typeof field === 'string' && /^#[0-9a-f]{6}$/i.test(field) ? field.toLowerCase() : defaultLyricStyle[key];
  };
  const rows = value?.linesPerScreen ?? defaultLyricStyle.linesPerScreen;
  return {
    font: typeof value?.font === 'string' && Object.hasOwn(lyricFonts, value.font) ? value.font : defaultLyricStyle.font,
    allCaps: value?.allCaps === true,
    linesPerScreen: [1, 2, 3, 4].includes(rows) ? rows : defaultLyricStyle.linesPerScreen,
    textColor: color('textColor'), highlightColor: color('highlightColor'), outlineColor: color('outlineColor'), backgroundColor: color('backgroundColor'),
  };
}

export const lyricFrames = { video: { width: 1920, height: 1080 }, cdg: { width: 300, height: 216 } } as const;

/** One timing and geometry plan for Chromium preview and FFmpeg export. */
export function layoutLyrics(lines: readonly LyricLine[], duration: number, input?: Partial<LyricStyle>, target: 'video' | 'cdg' = 'video') {
  const style = normalizeLyricStyle(input);
  const { width, height } = lyricFrames[target];
  const side = Math.round(width * 0.065), rowHeight = Math.round(height * 0.13);
  const rows = style.linesPerScreen;
  const endOfVideo = Number.isFinite(duration) && duration > 0 ? duration
    : lines.reduce((last, line) => Number.isFinite(line.endSeconds) ? Math.max(last, line.endSeconds) : last, 1);
  const cues = lines
    .filter(line => line.text.trim() && Number.isFinite(line.startSeconds) && line.startSeconds < endOfVideo)
    .map(line => ({
      line, start: Math.max(0, line.startSeconds),
      end: Math.min(endOfVideo, Math.max(line.startSeconds + 0.1, line.endSeconds)),
    }))
    .sort((first, second) => first.start - second.start);
  const entries = [];
  let previousEnd = 0;
  for (let offset = 0; offset < cues.length; offset += rows) {
    const group = cues.slice(offset, offset + rows);
    const nextStart = cues[offset + rows]?.start ?? endOfVideo;
    // Reserve centered rows as a group so an already visible line stays put.
    // Each row still comes in and clears on its own timing.
    const groupStarts = Math.max(previousEnd, group[0].start - (rows > 1 ? 1.25 : 0));
    previousEnd = group.reduce((end, cue) => Math.max(end, Math.min(cue.end, nextStart)), groupStarts);
    for (const [row, { line, start, end }] of group.entries()) {
      const showAt = row === 0 ? groupStarts : Math.max(groupStarts, group[row - 1].start, start - 3.5);
      const hideAt = Math.min(end, nextStart);
      if (hideAt <= showAt) continue;
      const rawWords = line.words.length && line.words.map(word => word.text).join('') === line.text
        ? line.words : [{ text: line.text, startSeconds: start, endSeconds: end }];
      let wordCursor = start;
      const words: TimedWord[] = rawWords.map(word => {
        const startSeconds = Math.min(hideAt, Math.max(wordCursor, word.startSeconds));
        wordCursor = Math.min(hideAt, Math.max(startSeconds, word.endSeconds));
        return { text: style.allCaps ? word.text.toUpperCase() : word.text, startSeconds, endSeconds: wordCursor };
      });
      // Leave the same room for wide glyphs in both renderers.
      const ems = [...words.map(word => word.text).join('')].reduce((total, char) =>
        total + (/\p{Mark}/u.test(char) ? 0 : /[^\u0000-\u024f]/u.test(char) ? 1.08 : /[MW@%]/.test(char) ? .95 : .68), 0);
      const fontSize = Math.max(1, Math.round(Math.min(rowHeight * .62, (width - side * 2) / Math.max(1, ems))));
      entries.push({ showAt, hideAt, words, centerY: height / 2 + (row - (group.length - 1) / 2) * rowHeight, fontSize });
    }
  }
  return { width, height, side, style, entries };
}
