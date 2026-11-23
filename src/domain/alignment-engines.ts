import { alignmentLanguages } from './studio-options.json';

export const alignmentEngines = {
  whisperx: { label: 'WhisperX (Local)', cloud: false, languages: alignmentLanguages },
  qwen: { label: 'Qwen3 ForcedAligner (Local)', cloud: false, languages: ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'yue', 'zh'] },
  vultr: { label: 'Vultr Aligner 1 (Cloud)', cloud: true, languages: ['af', 'be', 'bg', 'ca', 'cs', 'cy', 'da', 'de', 'en', 'es', 'et', 'eu', 'fi', 'fr', 'ga', 'gl', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'lt', 'lv', 'mk', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sq', 'sv', 'sw', 'tl', 'tr', 'uk', 'zh'] },
  audioshake: { label: 'AudioShake (Cloud)', cloud: true, languages: [] as string[] },
};

export type AlignmentEngine = keyof typeof alignmentEngines;
export type CloudAlignmentEngine = 'vultr' | 'audioshake';

export function isAlignmentEngine(value: unknown): value is AlignmentEngine {
  return typeof value === 'string' && Object.hasOwn(alignmentEngines, value);
}

export function isCloudAlignmentEngine(value: unknown): value is CloudAlignmentEngine {
  return isAlignmentEngine(value) && alignmentEngines[value].cloud;
}

export function alignmentLanguageFor(engine: AlignmentEngine, value: unknown): string {
  if (engine === 'audioshake') return 'auto';
  const base = typeof value === 'string' ? value.trim().toLowerCase().split('-')[0] : '';
  return alignmentEngines[engine].languages.includes(base) ? base : '';
}
