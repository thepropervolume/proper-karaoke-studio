import type { WordTimingDrafts } from './manual-timing';
import type { LyricLine } from './project';

export function shiftLyricTimings(lines: LyricLine[], drafts: WordTimingDrafts, ids: ReadonlySet<string>, requested: number, limit = Infinity) {
  let first = Infinity, last = 0;
  const track = (time: number | undefined) => {
    if (time === undefined) return;
    first = Math.min(first, time);
    last = Math.max(last, time);
  };
  for (const line of lines) {
    if (!ids.has(line.id)) continue;
    track(line.startSeconds);
    track(line.endSeconds);
    for (const word of line.words) { track(word.startSeconds); track(word.endSeconds); }
    if (Object.hasOwn(drafts, line.id)) {
      for (const word of drafts[line.id]) { track(word.startSeconds); track(word.endSeconds); }
    }
  }
  if (!Number.isFinite(first) || !Number.isFinite(requested)) return { lines, drafts, delta: 0 };
  // Apply one shared offset to preserve spacing, even at the start of the song.
  const delta = Math.max(-first, Math.min(requested, Math.max(0, limit - last)));
  if (!delta) return { lines, drafts, delta };
  const move = (time: number) => Math.max(0, Math.round((time + delta) * 1000000) / 1000000);
  const movedDrafts = { ...drafts };
  const movedLines = lines.map(line => {
    if (!ids.has(line.id)) return line;
    if (Object.hasOwn(drafts, line.id)) {
      movedDrafts[line.id] = drafts[line.id].map(word => ({
        ...(word.startSeconds === undefined ? {} : { startSeconds: move(word.startSeconds) }),
        ...(word.endSeconds === undefined ? {} : { endSeconds: move(word.endSeconds) }),
      }));
    }
    return { ...line, startSeconds: move(line.startSeconds), endSeconds: move(line.endSeconds),
      words: line.words.map(word => ({ ...word, startSeconds: move(word.startSeconds), endSeconds: move(word.endSeconds) })) };
  });
  return { lines: movedLines, drafts: movedDrafts, delta };
}
