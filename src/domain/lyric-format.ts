/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { parseLyricsFile } from './lyrics-formats';

export type LyricFormatOptions = {
  minLength: number;
  targetLength: number;
  maxLength: number;
};

export const DEFAULT_LYRIC_FORMAT_OPTIONS: LyricFormatOptions = { minLength: 10, targetLength: 19, maxLength: 26 };
export const MAXIMUM_LYRIC_TEXT_BYTES = 4 * 1024 * 1024;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const sectionLabel = /^\[(?:verse|pre[ -]chorus|chorus|post[ -]chorus|bridge|intro|outro|hook|refrain|interlude|instrumental|solo|breakdown|break|coda)(?=\s|:|\d|\]).*\]$/i;

export function validateLyricFormatOptions(value: unknown = DEFAULT_LYRIC_FORMAT_OPTIONS): LyricFormatOptions {
  if (!value || typeof value !== 'object') throw new Error('Set minimum, target, and maximum lyric lengths.');
  const { minLength, targetLength, maxLength } = value as Partial<LyricFormatOptions>;
  if (typeof minLength !== 'number' || typeof targetLength !== 'number' || typeof maxLength !== 'number' ||
      ![minLength, targetLength, maxLength].every(Number.isInteger) ||
      minLength < 1 || maxLength > 160 || minLength > targetLength || targetLength > maxLength) {
    throw new Error('Lyric lengths must be whole numbers from 1 to 160, ordered minimum, target, then maximum.');
  }
  return { minLength, targetLength, maxLength };
}

export function normalizeLyricFormatOptions(value: unknown): LyricFormatOptions {
  try { return validateLyricFormatOptions(value); }
  catch { return { ...DEFAULT_LYRIC_FORMAT_OPTIONS }; }
}

function graphemeCount(text: string) {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

function wrapPhrase(words: string[], { minLength, targetLength, maxLength }: LyricFormatOptions): string[] {
  const widths = words.map(graphemeCount);
  const cost = new Float64Array(words.length + 1);
  const next = new Uint32Array(words.length);

  // Choose breaks across the whole source phrase so greedy wrapping does not
  // strand a short tail. Source phrasing and indivisible words stay intact.
  for (let start = words.length - 1; start >= 0; start--) {
    let best = Infinity;
    let length = 0;
    for (let end = start; end < words.length; end++) {
      length += widths[end] + (end === start ? 0 : 1);
      if (end > start && length > maxLength) break;
      const distance = length - targetLength;
      const shortfall = Math.max(0, minLength - length);
      const score = distance * distance + 4 * shortfall * shortfall + cost[end + 1];
      if (score < best) {
        best = score;
        next[start] = end + 1;
      }
    }
    cost[start] = best;
  }

  const lines = [];
  for (let start = 0; start < words.length; start = next[start]) {
    lines.push(words.slice(start, next[start]).join(' '));
  }
  return lines;
}

export function formatLyricText(source: string, options?: LyricFormatOptions | number): string {
  // Numeric widths are retained for callers of the original formatter.
  const resolved = validateLyricFormatOptions(typeof options === 'number'
    ? { minLength: Math.min(DEFAULT_LYRIC_FORMAT_OPTIONS.minLength, options), targetLength: options, maxLength: options }
    : options);
  const result: string[] = [];
  let stanzaBreak = false;
  for (const raw of source.split(/\r\n|\n|\r/)) {
    const phrase = raw.trim();
    if (!phrase || sectionLabel.test(phrase)) {
      stanzaBreak ||= result.length > 0;
      continue;
    }
    if (stanzaBreak) {
      result.push('');
      stanzaBreak = false;
    }
    for (const line of wrapPhrase(phrase.split(/\s+/u), resolved)) result.push(line);
  }
  if (!result.length) throw new Error('Provide at least one line of lyric text.');
  return result.join('\n') + '\n';
}

export type LyricVersion = { text: string; track?: string; artist?: string; album?: string; duration?: number };

/** LRCLIB and similar lyric search responses may list several recordings. */
export function readLyricVersions(content: string): LyricVersion[] | null {
  const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
  const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const found: LyricVersion[] = [];
  let isCatalog = false;
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('plainLyrics' in record || 'syncedLyrics' in record)) continue;
    isCatalog = true;
    const item = record as Record<string, unknown>;
    if (item.instrumental === true) continue;
    const value = (key: string) => typeof item[key] === 'string' ? item[key].trim() || undefined : undefined;
    let lyricText = value('plainLyrics');
    if (!lyricText) {
      const synchronized = value('syncedLyrics');
      if (synchronized) {
        try { lyricText = parseLyricsFile('catalog.lrc', synchronized).lines.map(line => line.text).join('\n'); }
        catch { /* Other entries may still provide usable lyrics. */ }
      }
    }
    if (!lyricText) continue;
    found.push({
      text: lyricText, track: value('trackName') || value('name'), artist: value('artistName'),
      album: value('albumName'), duration: typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0 ? item.duration : undefined,
    });
  }
  if (!isCatalog) return null;
  if (!found.length) throw new Error('The JSON search results contain no lyric text.');
  return found;
}

export function readTextForLyricFormat(name: string, content: string, candidate?: number): string {
  const extension = name.toLowerCase().split('.').at(-1);
  const cleanContent = content.replace(/^\uFEFF/, '');
  if (extension === 'cdg') throw new Error('Choose a text lyric file. CD+G contains graphics.');
  const versions = extension === 'json' ? readLyricVersions(cleanContent) : null;
  if (versions) {
    if (candidate === undefined && versions.length > 1) {
      throw new Error('This JSON contains ' + versions.length + ' lyric versions. Choose one with --candidate (1–' + versions.length + ').');
    }
    if (candidate !== undefined && (!Number.isInteger(candidate) || candidate < 1 || candidate > versions.length)) {
      throw new Error('Choose a lyric version from 1 to ' + versions.length + '.');
    }
    return versions[(candidate ?? 1) - 1].text;
  }
  if (candidate !== undefined) throw new Error('--candidate applies to JSON lyric search results.');
  if (extension === 'lrc' || extension === 'elrc' || extension === 'srt' || extension === 'json') {
    return parseLyricsFile(name, cleanContent).lines.map(line => line.text).join('\n');
  }
  return cleanContent;
}
