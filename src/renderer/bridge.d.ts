import type { StudioProject } from '../domain/project';
declare global {
  type StudioSettings = { ffmpegPath: string; separatorExecutable: string; separatorModel: string; lyricAlignerExecutable: string; alignmentLanguage: string };
  type ExportStem = { path: string; name: string; role: string; voice: string; volume: number };
  type OpenedStudioProject = { file: string; project: StudioProject; revision: string };
  type StudioProjectOrigin = { file: string; revision: string };
  type StudioRecoveryDraft = { project: StudioProject; origin: StudioProjectOrigin | null; lyricsDraft: string | null };
  type StudioRecoveryEntry = { id: string; savedAt: number; title: string; artist: string; sourceFile: string | null };
  type StudioBridge = {
    getSettings(): Promise<StudioSettings>; saveSettings(settings: StudioSettings): Promise<StudioSettings>;
    startRecovery(): Promise<StudioRecoveryEntry[]>;
    updateRecovery(draft: StudioRecoveryDraft | null): Promise<void>;
    listRecovery(): Promise<StudioRecoveryEntry[]>;
    loadRecovery(id: string): Promise<StudioRecoveryDraft | null>;
    discardRecovery(id: string): Promise<void>;
    initialProject(): Promise<OpenedStudioProject | null>;
    openProject(): Promise<OpenedStudioProject | null>;
    saveProject(project: StudioProject, opened?: { file: string; revision: string }): Promise<OpenedStudioProject | null>;
    getPathForFile(file: File): string; registerMedia(filePath: string): Promise<string>;
    readCdg(filePath: string): Promise<Uint8Array>;
    exportCdg(input: { name: string; cdgPath: string } | { name: string; ass: string; duration: number; ffmpegPath: string }): Promise<string | null>;
    chooseAudioFiles(): Promise<string[]>; chooseImageFile(): Promise<string | null>;
    saveText(input: { name: string; extension: string; content: string }): Promise<string | null>;
    exportKit(input: { name: string; manifest: string; lyrics: Record<string, string>; stems: ExportStem[]; cdgPath?: string | null }): Promise<string | null>;
    exportVideo(input: { name: string; duration: number; artist: string; title: string; ffmpegPath: string; backgroundPath?: string | null; stems: ExportStem[]; ass: string; cdgPath?: string | null }): Promise<string | null>;
    separate(input: { sourcePath: string; executable: string; model: string }): Promise<{ files: string[]; outputDirectory: string }>;
    alignLyrics(input: { audioPath: string; executable: string; language: string; lyrics: string[] }): Promise<{ duration: number; words: { word: string; start: number; end: number }[] }>;
  };
  interface Window { studio: StudioBridge; }
}
