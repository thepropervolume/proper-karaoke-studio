import type { LyricLine, TimedWord } from './project';

const escapeSlash = (text: string) => text.replaceAll('/', '\\/');

export function lyricWordTokens(text: string): string[] {
  return text.match(/^\s*\S+\s*|\S+\s*/g) ?? [];
}

function parseTimingText(input: string) {
  const tokens: string[] = [];
  let pending = '';
  for (const part of input.match(/\\\/|\/|\s+|[^/\\\s]+|\\/g) ?? []) {
    if (part === '/') {
      if (pending.trim()) { tokens.push(pending); pending = ''; }
    } else if (part.trim()) {
      pending += part === '\\/' ? '/' : part;
    } else if (pending.trim()) {
      tokens.push(pending + part);
      pending = '';
    } else if (tokens.length) {
      tokens[tokens.length - 1] += part;
    } else {
      pending += part;
    }
  }
  if (pending.trim()) { tokens.push(pending); pending = ''; }
  const text = tokens.join('') + pending;
  return { text, tokens, timingText: input === escapeSlash(text) ? undefined : input };
}

export function lyricTextFields(input: string) {
  const { text, timingText } = parseTimingText(input);
  return { text, timingText };
}

export function savedLyricTimingText(text: string, input: unknown): string | undefined {
  return typeof input === 'string' && parseTimingText(input).text === text ? input : undefined;
}

function matchingWords(line: LyricLine): boolean {
  return line.words.length > 0 && line.words.map(word => word.text).join('') === line.text;
}

export function lyricTimingInput(line: LyricLine): string {
  if (line.timingText !== undefined) return line.timingText;
  if (!matchingWords(line)) return escapeSlash(line.text);
  // Timed imports can carry parts of a word without any Studio-specific metadata.
  return line.words.map(({ text }, index) => {
    const previous = line.words[index - 1]?.text;
    const boundary = previous && text && !/\s$/.test(previous) && !/^\s/.test(text);
    return (boundary ? '/' : '') + escapeSlash(text);
  }).join('');
}

export function lyricTimingTokens(line: LyricLine): string[] {
  if (line.timingText !== undefined) return parseTimingText(line.timingText).tokens;
  if (matchingWords(line)) return line.words.map(word => word.text);
  return lyricWordTokens(line.text);
}

/** Preserve existing endpoints. Estimate any new splits inside the original word's interval. */
export function remapTimedWords(words: readonly TimedWord[], tokens: readonly string[]): TimedWord[] {
  if (!words.length || words.map(word => word.text).join('') !== tokens.join('')) return [];
  let source = 0, sourceOffset = 0, tokenOffset = 0;
  const findTime = (offset: number, start: boolean) => {
    while (source < words.length - 1) {
      const boundary = sourceOffset + words[source].text.length;
      if (offset < boundary || (!start && offset === boundary)) break;
      sourceOffset = boundary;
      source++;
    }
    const word = words[source];
    const index = offset - sourceOffset;
    if (index === 0) return word.startSeconds;
    if (index === word.text.length) return word.endSeconds;
    const fraction = word.text.slice(0, index).trim().length / Math.max(1, word.text.trim().length);
    return word.startSeconds + (word.endSeconds - word.startSeconds) * fraction;
  };
  return tokens.map(text => {
    const startSeconds = findTime(tokenOffset, true);
    tokenOffset += text.length;
    const endSeconds = Math.max(startSeconds, findTime(tokenOffset, false));
    return { text, startSeconds, endSeconds };
  });
}

export function editLyricTimingText(line: LyricLine, input: string): LyricLine {
  if (input === lyricTimingInput(line)) return line;
  const { text, tokens, timingText } = parseTimingText(input);
  const words = text === line.text ? remapTimedWords(line.words, tokens) : [];
  return { ...line, text, timingText, words };
}
