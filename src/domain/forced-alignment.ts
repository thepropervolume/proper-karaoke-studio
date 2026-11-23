import type { LyricLine } from './project';
import { lyricTimingTokens, lyricWordTokens, remapTimedWords } from './lyric-timing-text';

export type ForcedAlignedWord = { word: string; start: number; end: number };

function comparable(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Reconcile provider tokenization only when the full lexical sequence still matches. */
export function matchProviderWords(lyrics: readonly string[], aligned: readonly ForcedAlignedWord[]): readonly ForcedAlignedWord[] {
  const reference = lyrics.flatMap(lyricWordTokens).map(word => word.trim());
  const keys = reference.map(comparable);
  if (aligned.length === keys.length && aligned.every((word, index) => comparable(word.word) === keys[index])) return aligned;
  if (aligned.some((word, index) => index > 0 && word.start < aligned[index - 1].start)) return aligned;
  const acoustic = aligned.map(word => ({ text: comparable(word.word), startSeconds: word.start, endSeconds: word.end }))
    .filter(word => word.text);
  const matches = remapTimedWords(acoustic, keys.filter(Boolean));
  // Let the strict mapper report the mismatch without discarding any existing cue timing.
  if (!matches.length) return aligned;
  let index = 0;
  return reference.map((word, position) => {
    if (keys[position]) {
      const match = matches[index++];
      return { word, start: match.startSeconds, end: match.endSeconds };
    }
    // A punctuation-only token has no acoustic boundary. Attach it to a nearby word.
    const previous = matches[index - 1];
    const next = matches[index];
    if (!previous) return { word, start: next.startSeconds, end: Math.min(next.endSeconds, next.startSeconds + 0.001) };
    const end = Math.min(previous.endSeconds, next ? Math.max(previous.startSeconds + 0.001, next.startSeconds) : previous.endSeconds);
    return { word, start: Math.max(previous.startSeconds, end - 0.001), end };
  });
}

/** Apply timestamps from a forced aligner while preserving the user's exact lyric text and line breaks. */
export function applyForcedAlignment(lines: readonly LyricLine[], aligned: readonly ForcedAlignedWord[], duration: number): LyricLine[] {
  const tokens = lines.flatMap((line, lineIndex) => lyricWordTokens(line.text).map(text => ({ lineIndex, text })));
  if (!tokens.length) throw new Error('Add lyric text before synchronizing.');
  if (aligned.length !== tokens.length) {
    throw new Error(`The aligner returned ${aligned.length} word timings for ${tokens.length} lyric words. Try a vocal stem or correct the lyrics, then try again.`);
  }

  let previousStart = -1;
  const words = aligned.map((item, index) => {
    if (comparable(item.word) !== comparable(tokens[index].text)) {
      throw new Error(`The alignment did not match “${tokens[index].text.trim()}” to the supplied lyrics. Your lyric text was kept unchanged.`);
    }
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.end > duration + 0.5 || item.start < previousStart) {
      throw new Error('The aligner returned invalid or out-of-order timestamps. Your existing lyric timing was kept unchanged.');
    }
    previousStart = item.start;
    return { ...tokens[index], startSeconds: item.start, endSeconds: item.end };
  });

  return lines.map((line, lineIndex) => {
    const lineWords = words.filter(word => word.lineIndex === lineIndex).map(({ text, startSeconds, endSeconds }) => ({ text, startSeconds, endSeconds }));
    if (!lineWords.length) return { ...line, words: [] };
    // The aligner matches sung words. Keep the editor's splits within each newly aligned interval.
    const fragments = remapTimedWords(lineWords, lyricTimingTokens(line));
    return {
      ...line, startSeconds: lineWords[0].startSeconds, endSeconds: lineWords.at(-1)!.endSeconds,
      words: fragments.length ? fragments : lineWords,
    };
  });
}
