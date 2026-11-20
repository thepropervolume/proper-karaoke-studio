import type { StudioProject } from '../domain/project';
declare global {
  type SeparatorAdapter = 'audio-separator' | 'demucs' | 'dango';
  type StudioSettings = { ffmpegPath: string; separatorAdapter: SeparatorAdapter; separatorExecutable: string; separatorModel: string; lyricAlignerExecutable: string; alignmentLanguage: string };
  type SeparatorModel = { id: string; label: string; group: string };
  type SeparatorCatalog = { models: SeparatorModel[]; source: 'installed' | 'fallback' | 'provider' };
  type AlignmentStatus = { state: 'ready' | 'missing' | 'installing' | 'unsupported'; message: string; pythonVersion?: string };
  type AlignmentProgress = { phase: 'downloading-tool' | 'installing-python' | 'installing-packages' | 'checking' | 'aligning'; message: string };
  type StudioIntegration = { id: string; name: string; website: string | null; kind: 'dango' | 'custom'; configured: boolean; storageAvailable: boolean };
  type ExportStem = { path: string; name: string; role: string; voice: string; volume: number };
  type OpenedStudioProject = { file: string; project: StudioProject; revision: string };
  type StudioProjectOrigin = { file: string; revision: string };
  type StudioRecoveryDraft = { project: StudioProject; origin: StudioProjectOrigin | null; lyricsDraft: string | null };
  type StudioRecoveryEntry = { id: string; savedAt: number; title: string; artist: string; sourceFile: string | null };
  type StudioMenuAction = 'open' | 'save' | 'save-as' | 'preferences' | 'appearance' | 'lyrics-style'
    | 'theme-day' | 'theme-night' | 'accent-blue' | 'accent-pink' | 'accent-purple'
    | 'export-mp4' | 'export-kit' | 'export-cdg' | 'export-cdg-original' | 'export-lrc' | 'export-srt' | 'export-json';
  type StudioMenuState = {
    editing: boolean; stems: boolean; lyrics: boolean; cdg: boolean; styling: boolean;
    theme: 'day' | 'night'; accent: 'blue' | 'pink' | 'purple';
  };
  type StudioBridge = {
    getSettings(): Promise<StudioSettings>; saveSettings(settings: StudioSettings): Promise<StudioSettings>;
    onMenuAction(listener: (action: StudioMenuAction) => void): () => void;
    updateMenu(state: StudioMenuState): Promise<void>;
    getSeparatorModels(input: { adapter: SeparatorAdapter; executable: string; refresh?: boolean }): Promise<SeparatorCatalog>;
    getAlignmentStatus(): Promise<AlignmentStatus>;
    installAlignment(): Promise<AlignmentStatus>;
    onAlignmentProgress(listener: (progress: AlignmentProgress) => void): () => void;
    listIntegrations(): Promise<StudioIntegration[]>;
    addIntegration(input: { name: string; website: string }): Promise<StudioIntegration[]>;
    removeIntegration(id: string): Promise<StudioIntegration[]>;
    saveIntegrationKey(input: { id: string; key: string; appKey?: string }): Promise<StudioIntegration[]>;
    removeIntegrationKey(id: string): Promise<StudioIntegration[]>;
    verifyDango(): Promise<{ connected: true }>;
    openIntegrationWebsite(id: string): Promise<void>;
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
    exportCdg(input: { name: string; cdgPath: string } | { name: string; ass: string; duration: number; ffmpegPath: string; backgroundColor?: string }): Promise<string | null>;
    chooseAudioFiles(): Promise<string[]>; chooseImageFile(): Promise<string | null>;
    armVoiceRecording(): Promise<void>;
    disarmVoiceRecording(): Promise<void>;
    saveVoiceRecording(input: { name: string; wav: Uint8Array }): Promise<string | null>;
    saveText(input: { name: string; extension: string; content: string }): Promise<string | null>;
    exportKit(input: { name: string; manifest: string; lyrics: Record<string, string>; stems: ExportStem[]; cdgPath?: string | null }): Promise<string | null>;
    exportVideo(input: { name: string; duration: number; artist: string; title: string; ffmpegPath: string; backgroundPath?: string | null; backgroundColor?: string; stems: ExportStem[]; ass: string; cdgPath?: string | null }): Promise<string | null>;
    separate(input: { sourcePath: string; adapter: SeparatorAdapter; executable: string; model: string }): Promise<{ files: string[]; outputDirectory: string }>;
    alignLyrics(input: { audioPath: string; language: string; lyrics: string[] }): Promise<{ duration: number; words: { word: string; start: number; end: number }[] }>;
  };
  interface Window { studio: StudioBridge; }
}
