import type { LyricStyle } from './lyric-style';
import type { TitleCardStyle } from './video-presentation';

export type AppearanceStyles = { lyrics: LyricStyle; title: TitleCardStyle };
export type AppearanceKind = keyof AppearanceStyles;
export type AppearancePreset<K extends AppearanceKind> = {
  id: string;
  name: string;
  style: AppearanceStyles[K];
};
export type AppearanceLibrary<K extends AppearanceKind> = {
  defaultStyle: AppearanceStyles[K];
  presets: AppearancePreset<K>[];
};
