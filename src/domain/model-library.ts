export type StudioLibraryModel = {
  id: string;
  label: string;
  group: string;
  adapter: 'audio-separator' | 'demucs';
  purpose: 'separation' | 'backing';
  downloaded: boolean;
  foundInUvr: boolean;
};

export type StudioModelLibrary = {
  studioDirectory: string;
  detectedFolders: string[];
  uvrDirectory: string | null;
  models: StudioLibraryModel[];
};
