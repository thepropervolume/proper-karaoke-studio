import type { LyricLine } from './project';

export type ForcedAlignedWord = { word: string; start: number; end: number };

function comparable(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Apply timestamps from a forced aligner while preserving the user's exact lyric text and line breaks. */
export function applyForcedAlignment(lines: readonly LyricLine[], aligned: readonly ForcedAlignedWord[], duration: number): LyricLine[] {
  const tokens = lines.flatMap((line, lineIndex) => (line.text.match(/\S+\s*/g) ?? []).map(text => ({ lineIndex, text })));
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
    return { ...line, startSeconds: lineWords[0].startSeconds, endSeconds: lineWords.at(-1)!.endSeconds, words: lineWords };
  });
}
