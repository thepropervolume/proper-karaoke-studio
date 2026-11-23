import type { LyricLine as CoreLyricLine, TimedWord } from '@thepropervolume/karaoke-core';
import { layoutLyrics, portableLyricFontPath, type LyricStyle } from './lyric-style';
import { lyricTextFields, lyricTimingTokens } from './lyric-timing-text';
import type { WordTimingDrafts } from './manual-timing';

export type { TimedWord } from '@thepropervolume/karaoke-core';
export type LyricLine = CoreLyricLine & { timingText?: string };

export type StudioRole = 'instrumental' | 'lead' | 'backing' | 'other';
export type StudioStem = {
  id: string; name: string; role: StudioRole; voice: string; path: string; url: string;
  file?: File; durationSeconds: number; volume: number;
};
export type StudioProject = {
  schema: 'com.thepropervolume.karaoke-studio'; version: 1; title: string; artist: string;
  durationSeconds: number; stems: Omit<StudioStem, 'file' | 'url'>[]; lyrics: LyricLine[]; importedCdg?: string | null;
  backgroundPath?: string | null; backgroundLoop?: boolean; lyricStyle?: LyricStyle;
  wordTimingDrafts?: WordTimingDrafts;
};

export function newLyricLines(text: string, duration: number): LyricLine[] {
  const source = text.split(/\r\n?|\n/).map(line => lyricTextFields(line.trim())).filter(line => line.text.trim());
  const cueDuration = Math.max(0.5, duration) / Math.max(1, source.length);
  return source.map((line, index) => ({
    id: crypto.randomUUID(), ...line, startSeconds: cueDuration * index,
    endSeconds: Math.min(Math.max(0.5, duration), cueDuration * (index + 1)), words: [],
  }));
}

/** Give each lyric token a temporary even span before the singer times it. */
export function seedTimedWords(lines: readonly LyricLine[]): LyricLine[] {
  return lines.map(line => {
    // Keep imported word cues when their text still matches the editable line.
    if (line.words.length && line.words.map(word => word.text).join('') === line.text) return line;
    const tokens = lyricTimingTokens(line);
    if (!tokens.length) return { ...line, words: [] };
    const start = Math.max(0, line.startSeconds), end = Math.max(start + 0.05, line.endSeconds);
    const duration = (end - start) / tokens.length;
    return {
      ...line,
      words: tokens.map((text, index) => ({
        text,
        startSeconds: start + duration * index,
        endSeconds: start + duration * (index + 1),
      })),
    };
  });
}

function withWordBounds(line: LyricLine, words: TimedWord[]): LyricLine {
  if (!words.length) return { ...line, words };
  return {
    ...line,
    words,
    startSeconds: Math.max(0, words[0].startSeconds),
    endSeconds: Math.max(words[0].startSeconds + 0.05, words.at(-1)!.endSeconds),
  };
}

/** Record one word's start and close the preceding word at the same playhead. */
export function recordTimedWordStart(lines: readonly LyricLine[], wordIndex: number, atSeconds: number): LyricLine[] {
  const target = Math.max(0, Math.floor(wordIndex));
  const at = Math.max(0, Number.isFinite(atSeconds) ? atSeconds : 0);
  let cursor = 0;
  let previous: { lineIndex: number; wordIndex: number } | undefined;
  let selected: { lineIndex: number; wordIndex: number } | undefined;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    for (let index = 0; index < lines[lineIndex].words.length; index++, cursor++) {
      if (cursor === target - 1) previous = { lineIndex, wordIndex: index };
      if (cursor === target) selected = { lineIndex, wordIndex: index };
    }
  }
  if (!selected) return lines.slice();

  const next = lines.map(line => ({ ...line, words: line.words.slice() }));
  if (previous) {
    const line = next[previous.lineIndex], word = line.words[previous.wordIndex];
    line.words[previous.wordIndex] = { ...word, endSeconds: Math.max(word.startSeconds + 0.01, at) };
    next[previous.lineIndex] = withWordBounds(line, line.words);
  }
  const line = next[selected.lineIndex], word = line.words[selected.wordIndex];
  line.words[selected.wordIndex] = {
    ...word,
    startSeconds: at,
    endSeconds: Math.max(at + 0.01, word.endSeconds),
  };
  next[selected.lineIndex] = withWordBounds(line, line.words);
  return next;
}

/** Finish the final captured word at the playhead when manual sync is stopped. */
export function finishTimedWord(lines: readonly LyricLine[], wordIndex: number, atSeconds: number): LyricLine[] {
  const target = Math.max(0, Math.floor(wordIndex));
  const at = Math.max(0, Number.isFinite(atSeconds) ? atSeconds : 0);
  let cursor = 0;
  return lines.map(line => {
    const words = line.words.map(word => {
      if (cursor++ !== target) return word;
      return { ...word, endSeconds: Math.max(word.startSeconds + 0.01, at) };
    });
    return withWordBounds(line, words);
  });
}

export function timedWordCount(lines: readonly LyricLine[]): number {
  return lines.reduce((count, line) => count + line.words.length, 0);
}

function archiveName(sourcePath: string): string {
  const name = sourcePath.split(/[\\/]/).at(-1) || 'source-file';
  return name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 140) || 'source-file';
}

// Strip host-local paths from the portable manifest and align each path with
// the corresponding entry name that the streaming ZIP writer creates.
export function toPortableKitProject(project: StudioProject): StudioProject {
  const { backgroundPath, ...portable } = project;
  const customFont = portable.lyricStyle?.customFont;
  if (customFont && portable.lyricStyle) {
    const { customFont: _font, ...style } = portable.lyricStyle;
    portable.lyricStyle = style.font === 'custom'
      ? { ...style, customFont: { ...customFont, path: portableLyricFontPath(customFont.path) } } : style;
  }
  return {
    ...portable,
    stems: project.stems.map((stem, index) => ({
      ...stem,
      path: 'stems/' + String(index + 1).padStart(2, '0') + '-' + archiveName(stem.path),
    })),
    importedCdg: project.importedCdg ? 'source/' + archiveName(project.importedCdg) : null,
    backgroundPath: backgroundPath ? portableBackgroundPath(backgroundPath) : null,
  };
}

export function portableBackgroundPath(source: string): string {
  const extension = /\.[^.\\/]+$/.exec(source)?.[0].toLowerCase() ?? '';
  return 'background/backdrop' + extension;
}

// Adapt editor cues to the Booth canvas renderer so preview and playback share
// the same drawing path instead of growing a second lyric renderer.
export function toRenderTiming(lines: readonly LyricLine[], duration: number, style?: LyricStyle) {
  const { width, height, side, style: palette, entries, bars } = layoutLyrics(lines, duration, style);
  return {
    durationSeconds: Math.max(1, duration), bounds: { x: 0, y: 0, width, height },
    rightToLeft: false, tracks: [], files: [], countIns: [], bars,
    pages: entries.map(({ showAt: startSeconds, hideAt: endSeconds, fadeIn, fadeOut, words: syllables, centerY, fontSize }, index) => {
      const lineHeight = fontSize / .8;
      return {
        id: index, startSeconds, endSeconds, fadeIn: { startSeconds, durationSeconds: fadeIn },
        fadeOut: { startSeconds: endSeconds - fadeOut, durationSeconds: fadeOut }, activeColor: palette.highlightColor, inactiveColor: palette.textColor,
        rightToLeft: false, trackId: null, voice: 'Lead',
        lines: [{
          id: index, box: { x: side, y: centerY - lineHeight / 2, width: width - side * 2, height: lineHeight }, leadIn: null,
          words: syllables.map((item, wordIndex) => ({ id: wordIndex, syllables: [item] })), syllables,
        }],
      };
    }),
  };
}
