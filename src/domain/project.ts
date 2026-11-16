export type StudioRole = 'instrumental' | 'lead' | 'backing' | 'other';
export type TimedWord = { text: string; startSeconds: number; endSeconds: number };
export type LyricLine = { id: string; text: string; startSeconds: number; endSeconds: number; words: TimedWord[] };
export type StudioStem = {
  id: string; name: string; role: StudioRole; voice: string; path: string; url: string;
  file?: File; durationSeconds: number; volume: number;
};
export type StudioProject = {
  schema: 'com.thepropervolume.karaoke-studio'; version: 1; title: string; artist: string;
  durationSeconds: number; stems: Omit<StudioStem, 'file' | 'url'>[]; lyrics: LyricLine[]; importedCdg?: string | null;
};

export function newLyricLines(text: string, duration: number): LyricLine[] {
  const source = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const cueDuration = Math.max(0.5, duration) / Math.max(1, source.length);
  return source.map((line, index) => ({
    id: crypto.randomUUID(), text: line, startSeconds: cueDuration * index,
    endSeconds: Math.min(Math.max(0.5, duration), cueDuration * (index + 1)), words: [],
  }));
}

function archiveName(sourcePath: string): string {
  const name = sourcePath.split(/[\\/]/).at(-1) || 'source-file';
  return name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 140) || 'source-file';
}

// Strip host-local paths from the portable manifest and align each path with
// the corresponding entry name that the streaming ZIP writer creates.
export function toPortableKitProject(project: StudioProject): StudioProject {
  return {
    ...project,
    stems: project.stems.map((stem, index) => ({
      ...stem,
      path: 'stems/' + String(index + 1).padStart(2, '0') + '-' + archiveName(stem.path),
    })),
    importedCdg: project.importedCdg ? 'source/' + archiveName(project.importedCdg) : null,
  };
}

// Adapt editor cues to the Booth canvas renderer so preview and playback share
// the same drawing path instead of growing a second lyric renderer.
export function toRenderTiming(lines: readonly LyricLine[], duration: number) {
  const safeDuration = Math.max(1, Number.isFinite(duration) ? duration : 1);
  return {
    durationSeconds: safeDuration, bounds: { x: 0, y: 0, width: 640, height: 360 },
    rightToLeft: false, tracks: [], files: [], countIns: [],
    pages: lines.filter(line => line.text.trim()).map((line, index) => {
      const startSeconds = Math.max(0, line.startSeconds);
      const endSeconds = Math.min(safeDuration, Math.max(startSeconds + 0.05, line.endSeconds));
      const words = line.words.length ? line.words : [{ text: line.text, startSeconds, endSeconds }];
      const syllables = words.map(word => ({
        text: word.text, startSeconds: Math.max(startSeconds, word.startSeconds),
        endSeconds: Math.min(endSeconds, Math.max(word.startSeconds, word.endSeconds)),
      }));
      return {
        id: index, startSeconds, endSeconds, fadeIn: { startSeconds, durationSeconds: 0 },
        fadeOut: { startSeconds: endSeconds, durationSeconds: 0 }, activeColor: null, inactiveColor: '#FFFFFF',
        rightToLeft: false, trackId: null, voice: 'Lead',
        lines: [{
          id: index, box: { x: 24, y: 236, width: 592, height: 74 }, leadIn: null,
          words: syllables.map((item, wordIndex) => ({ id: wordIndex, syllables: [item] })), syllables,
        }],
      };
    }),
  };
}
