export type Appearance = { theme: 'day' | 'night'; accent: 'blue' | 'pink' | 'purple' };

export const appearanceKey = 'tpv-studio-appearance';

export function readAppearance(): Appearance {
  try {
    const saved: Partial<Appearance> | null = JSON.parse(window.localStorage.getItem(appearanceKey) ?? '{}');
    return {
      theme: saved?.theme === 'day' ? 'day' : 'night',
      accent: saved?.accent === 'pink' || saved?.accent === 'purple' ? saved.accent : 'blue',
    };
  } catch {
    return { theme: 'night', accent: 'blue' };
  }
}
