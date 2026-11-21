import type { LyricLine, TimedWord } from '@thepropervolume/karaoke-core';

export const lyricFonts = {
  sans: { family: 'Liberation Sans', label: 'Sans Serif' },
  serif: { family: 'Liberation Serif', label: 'Serif' },
  mono: { family: 'Liberation Mono', label: 'Monospace' },
} as const;

export type CustomLyricFont = { path: string; family: string; exportName?: string };
export type LyricBarStyle = {
  enabled: boolean; x: number; y: number; width: number; height: number;
  fillColor: string; trackColor: string; borderColor: string;
};

export type LyricStyle = {
  font: keyof typeof lyricFonts | 'custom';
  customFont?: CustomLyricFont;
  fontSize: number;
  leading: number;
  allCaps: boolean;
  linesPerScreen: number;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  backgroundColor: string;
  progressBar: LyricBarStyle;
  countdownBar: LyricBarStyle & { minimumBreak: number };
};

export const defaultLyricStyle: LyricStyle = {
  font: 'sans', allCaps: false, linesPerScreen: 1,
  fontSize: 87, leading: 160,
  textColor: '#ffffff', highlightColor: '#d5167a', outlineColor: '#101020', backgroundColor: '#171226',
  progressBar: { enabled: false, x: 50, y: 1, width: 100, height: .6, fillColor: '#601ce9', trackColor: '#2b2b2b', borderColor: '#000000' },
  countdownBar: { enabled: false, x: 50, y: 50, width: 56, height: 6, fillColor: '#0eb7ff', trackColor: '#fffff3', borderColor: '#101020', minimumBreak: 6 },
};

const numeric = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const hexColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

function barStyle(value: Partial<LyricBarStyle> | undefined, fallback: LyricBarStyle): LyricBarStyle {
  return {
    enabled: value?.enabled === true, x: numeric(value?.x, fallback.x, 0, 100), y: numeric(value?.y, fallback.y, 0, 100),
    width: numeric(value?.width, fallback.width, 1, 100), height: numeric(value?.height, fallback.height, .2, 25),
    fillColor: hexColor(value?.fillColor, fallback.fillColor), trackColor: hexColor(value?.trackColor, fallback.trackColor),
    borderColor: hexColor(value?.borderColor, fallback.borderColor),
  };
}

export function safeFontFamily(value: unknown): string {
  return typeof value === 'string' && /^[\p{L}\p{M}\p{N} ._()&+’'-]{1,120}$/u.test(value.trim()) ? value.trim() : '';
}

export function normalizeLyricStyle(value?: Partial<LyricStyle> | null): LyricStyle {
  const color = (key: 'textColor' | 'highlightColor' | 'outlineColor' | 'backgroundColor') => hexColor(value?.[key], defaultLyricStyle[key]);
  const rows = value?.linesPerScreen ?? defaultLyricStyle.linesPerScreen;
  const family = safeFontFamily(value?.customFont?.family);
  const face = safeFontFamily(value?.customFont?.exportName);
  const file = value?.customFont?.path;
  const customFont = family && typeof file === 'string' && file.length <= 8192 && /\.(ttf|otf)$/i.test(file)
    ? { path: file, family, ...(face ? { exportName: face } : {}) } : undefined;
  return {
    font: value?.font === 'custom' && customFont ? 'custom'
      : typeof value?.font === 'string' && Object.hasOwn(lyricFonts, value.font) ? value.font : defaultLyricStyle.font,
    ...(customFont ? { customFont } : {}),
    fontSize: numeric(value?.fontSize, defaultLyricStyle.fontSize, 24, 220),
    leading: numeric(value?.leading, defaultLyricStyle.leading, 105, 260),
    allCaps: value?.allCaps === true,
    linesPerScreen: [1, 2, 3, 4].includes(rows) ? rows : defaultLyricStyle.linesPerScreen,
    textColor: color('textColor'), highlightColor: color('highlightColor'), outlineColor: color('outlineColor'), backgroundColor: color('backgroundColor'),
    progressBar: barStyle(value?.progressBar, defaultLyricStyle.progressBar),
    countdownBar: { ...barStyle(value?.countdownBar, defaultLyricStyle.countdownBar),
      minimumBreak: numeric(value?.countdownBar?.minimumBreak, defaultLyricStyle.countdownBar.minimumBreak, 2, 120) },
  };
}

export function lyricFontFamily(style: LyricStyle) {
  return style.font === 'custom' ? style.customFont?.exportName ?? style.customFont?.family ?? lyricFonts.sans.family : lyricFonts[style.font].family;
}

export function portableLyricFontPath(source: string) {
  return 'fonts/lyric-font' + (/\.otf$/i.test(source) ? '.otf' : '.ttf');
}

export const lyricFrames = { video: { width: 1920, height: 1080 }, cdg: { width: 300, height: 216 } } as const;
export type LyricBar = { start: number; end: number; x: number; y: number; width: number; height: number; border: number; style: LyricBarStyle };

function timedBar(style: LyricBarStyle, width: number, height: number, start: number, end: number): LyricBar {
  const w = Math.max(2, Math.round(width * style.width / 100)), h = Math.max(2, Math.round(height * style.height / 100));
  const x = Math.min(width - w, Math.max(0, Math.round(width * style.x / 100 - w / 2)));
  const y = Math.min(height - h, Math.max(0, Math.round(height * style.y / 100 - h / 2)));
  return { start, end, x, y, width: w, height: h, border: Math.min(Math.max(1, Math.round(h * .055)), Math.floor((h - 1) / 2)), style };
}

/** One timing and geometry plan for Chromium preview and FFmpeg export. */
export function layoutLyrics(lines: readonly LyricLine[], duration: number, input?: Partial<LyricStyle>, target: 'video' | 'cdg' = 'video') {
  const style = normalizeLyricStyle(input);
  const { width, height } = lyricFrames[target];
  const side = Math.round(width * 0.065);
  const rows = style.linesPerScreen;
  const endOfVideo = Number.isFinite(duration) && duration > 0 ? duration
    : lines.reduce((last, line) => Number.isFinite(line.endSeconds) ? Math.max(last, line.endSeconds) : last, 1);
  const cues = lines
    .filter(line => line.text.trim() && Number.isFinite(line.startSeconds) && Number.isFinite(line.endSeconds) && line.startSeconds < endOfVideo)
    .map(line => ({
      line, start: Math.max(0, line.startSeconds),
      end: Math.min(endOfVideo, Math.max(line.startSeconds + 0.1, line.endSeconds)),
    }))
    .sort((first, second) => first.start - second.start);
  const phrases: typeof cues[] = [];
  let phrase: typeof cues = [], phraseEnd = 0;
  for (const cue of cues) {
    if (phrase.length && cue.start - phraseEnd >= style.countdownBar.minimumBreak) {
      phrases.push(phrase);
      phrase = [];
      phraseEnd = 0;
    }
    phrase.push(cue);
    phraseEnd = Math.max(phraseEnd, cue.end);
  }
  if (phrase.length) phrases.push(phrase);
  const entries = [];
  const bars: LyricBar[] = [];
  if (style.progressBar.enabled) bars.push(timedBar(style.progressBar, width, height, 0, endOfVideo));
  let lastPhraseEnd = 0;
  const fontHeight = style.fontSize * height / 1080;
  for (const group of phrases) {
    const phraseStart = Math.max(lastPhraseEnd, group[0].start - (rows > 1 ? 1.25 : 0));
    const slotCount = Math.min(rows, group.length);
    const rowHeight = Math.min(Math.round(fontHeight * style.leading / 100), Math.floor(height * .90 / slotCount));
    const slotEnds: number[] = [];
    if (style.countdownBar.enabled && group[0].start - lastPhraseEnd >= style.countdownBar.minimumBreak && phraseStart > lastPhraseEnd) {
      bars.push(timedBar(style.countdownBar, width, height, lastPhraseEnd, phraseStart));
    }
    // Keep each on-screen line in its row. A completed row is reused for the
    // next unsung cue, including when the current lyric wraps to the top.
    for (const [index, { line, start, end }] of group.entries()) {
      const row = index % slotCount;
      const showAt = rows === 1 ? Math.max(start, slotEnds[row] ?? 0) : slotEnds[row] ?? phraseStart;
      const hideAt = Math.min(end, group[index + slotCount]?.start ?? endOfVideo);
      if (hideAt <= showAt) continue;
      slotEnds[row] = hideAt;
      const rawWords = line.words.length && line.words.every(word => Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds))
        && line.words.map(word => word.text).join('') === line.text
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
      const fontSize = Math.max(1, Math.round(Math.min(fontHeight, rowHeight * .94, (width - side * 2) / Math.max(1, ems))));
      const fade = Math.min(.18, (hideAt - showAt) / 3);
      entries.push({ showAt, hideAt, fade, words, centerY: height / 2 + (row - (slotCount - 1) / 2) * rowHeight, fontSize });
    }
    lastPhraseEnd = group.reduce((latest, cue) => Math.max(latest, cue.end), lastPhraseEnd);
  }
  return { width, height, side, style, entries, bars };
}
