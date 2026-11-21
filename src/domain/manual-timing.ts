/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { seedTimedWords, type LyricLine, type TimedWord } from './project';

export type CaptureMode = 'line' | 'word';
export type TimingField = 'startSeconds' | 'endSeconds';
type DraftWord = Partial<Pick<TimedWord, TimingField>>;
export type WordTimingDrafts = Record<string, DraftWord[]>;
type TimingTarget = { line: number; word?: number };
type Frame = { lines: LyricLine[]; at: number | null };

export type TimingSession = {
  mode: CaptureMode;
  targets: TimingTarget[];
  prepared: LyricLine[];
  frames: Frame[];
  cursor: number;
};

export function timingPosition(value: number): number {
  return Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1000) / 1000;
}

export function lyricWordTokens(text: string): string[] {
  // Include whitespace in the original text so splitting and joining remains lossless.
  return text.match(/^\s*\S+\s*|\S+\s*/g) ?? [];
}

export function splitLineWords(lines: readonly LyricLine[], index: number): { words: TimedWord[]; draft: DraftWord[] } {
  const line = lines[index];
  const tokens = lyricWordTokens(line.text);
  const hasSpan = line.endSeconds > line.startSeconds;
  const previous = lines[index - 1];
  const start = !hasSpan && line.startSeconds === 0 && previous?.endSeconds > 0 ? previous.endSeconds : line.startSeconds;
  const end = hasSpan ? line.endSeconds : lines[index + 1]?.startSeconds ?? start;
  if (end <= start) return { words: [], draft: tokens.map(() => ({})) };
  return { draft: [], words: tokens.map((text, index) => ({
    text, startSeconds: start + (end - start) * index / tokens.length,
    endSeconds: start + (end - start) * (index + 1) / tokens.length,
  })) };
}

export function completedDraftWords(text: string, draft: DraftWord[]): TimedWord[] | null {
  const tokens = lyricWordTokens(text);
  if (draft.length !== tokens.length || draft.some(({ startSeconds, endSeconds }) =>
    startSeconds === undefined || endSeconds === undefined || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
    startSeconds < 0 || endSeconds < startSeconds)) return null;
  return draft.map((word, index) => ({ text: tokens[index], startSeconds: word.startSeconds!, endSeconds: word.endSeconds! }));
}

export function normalizeWordTimingDrafts(input: unknown, lines: readonly LyricLine[]): WordTimingDrafts {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const drafts = input as Record<string, unknown>;
  return Object.fromEntries(lines.flatMap(line => {
    if (line.words.length || !Object.hasOwn(drafts, line.id)) return [];
    const value = drafts[line.id];
    const count = lyricWordTokens(line.text).length;
    if (!Array.isArray(value) || !count || value.length !== count) return [];
    const words = value.map(word => {
      const result: DraftWord = {};
      for (const field of ['startSeconds', 'endSeconds'] as const) {
        if (typeof word?.[field] === 'number' && Number.isFinite(word[field]) && word[field] >= 0) result[field] = word[field];
      }
      return result;
    });
    return [[line.id, words]];
  }));
}

export function startTimingSession(mode: CaptureMode, lines: LyricLine[], position: number): TimingSession | null {
  const prepared = mode === 'word' ? seedTimedWords(lines) : lines;
  const cues = prepared.flatMap<TimingTarget & { at: number; until: number }>((line, lineIndex) => mode === 'line'
    ? [{ line: lineIndex, at: line.startSeconds, until: line.endSeconds }]
    : line.words.map((word, wordIndex) => ({
      line: lineIndex, word: wordIndex, at: word.startSeconds, until: word.endSeconds,
    })));
  const start = cues.findIndex(cue => cue.until > position || cue.at >= position);
  if (start < 0) return null;
  const targets = cues.slice(start).map(({ line, word }) => ({ line, word }));
  return { mode, targets, prepared, frames: [{ lines, at: null }], cursor: 0 };
}

function resizeLine(line: LyricLine, startSeconds: number, endSeconds: number): LyricLine {
  const span = line.endSeconds - line.startSeconds;
  const range = endSeconds - startSeconds;
  const move = (time: number) => span <= 0 ? startSeconds
    : startSeconds + Math.max(0, Math.min(1, (time - line.startSeconds) / span)) * range;
  return {
    ...line, startSeconds, endSeconds,
    words: line.words.map(word => ({ ...word, startSeconds: move(word.startSeconds), endSeconds: move(word.endSeconds) })),
  };
}

function updateCapturedWord(line: LyricLine, template: LyricLine, index: number, at: number, starting: boolean) {
  const words = [...(line.words.length ? line.words : template.words)];
  const word = words[index];
  words[index] = starting
    ? { ...word, startSeconds: at, endSeconds: Math.max(at + .01, word.endSeconds) }
    : { ...word, endSeconds: Math.max(word.startSeconds + .01, at) };
  return {
    ...line, words, startSeconds: Math.min(...words.map(word => word.startSeconds)),
    endSeconds: Math.max(...words.map(word => word.endSeconds)),
  };
}

function closeCapturedCue(lines: LyricLine[], session: TimingSession, at: number) {
  const last = session.targets[session.cursor - 1];
  if (!last) return;
  const line = lines[last.line];
  lines[last.line] = last.word === undefined
    ? resizeLine(line, line.startSeconds, Math.max(line.startSeconds + .01, at))
    : updateCapturedWord(line, session.prepared[last.line], last.word, at, false);
}

export function recordTimingTap(session: TimingSession, position: number): TimingSession {
  const target = session.targets[session.cursor];
  const frame = session.frames[session.cursor];
  const at = timingPosition(position);
  if (!target || (frame.at !== null && at <= frame.at)) return session;
  const lines = [...frame.lines];
  closeCapturedCue(lines, session, at);
  const line = lines[target.line];
  lines[target.line] = target.word === undefined
    ? resizeLine(line, at, at + Math.max(.01, line.endSeconds - line.startSeconds))
    : updateCapturedWord(line, session.prepared[target.line], target.word, at, true);
  // A new tap after undo replaces the undone branch.
  return { ...session, cursor: session.cursor + 1, frames: [...session.frames.slice(0, session.cursor + 1), { lines, at }] };
}

export function stepTimingHistory(session: TimingSession, delta: -1 | 1): TimingSession {
  const cursor = session.cursor + delta;
  return cursor < 0 || cursor >= session.frames.length ? session : { ...session, cursor };
}

export function completeTimingSession(session: TimingSession, position: number): LyricLine[] {
  const lines = [...session.frames[session.cursor].lines];
  closeCapturedCue(lines, session, timingPosition(position));
  return lines;
}
