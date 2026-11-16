export const KARAFUN_STEM_ROLES = ['instrumental', 'backing', 'lead', 'other'] as const;
export type KaraFunStemRole = typeof KARAFUN_STEM_ROLES[number];
export type KaraFunMix = Record<KaraFunStemRole, number>;
export const DEFAULT_KARAFUN_MIX: Readonly<KaraFunMix> = Object.freeze({ instrumental: 1, backing: 1, lead: 0, other: 1 });
export const KARAFUN_ROLE_LABELS: Readonly<Record<KaraFunStemRole, string>> = {
  instrumental: 'Instrumental', backing: 'Backing Vocals', lead: 'Lead Vocals', other: 'Other Audio',
};
export type KaraFunStemVolumes = Readonly<Record<number, number>>;
export type KaraFunMixStatus = {
  generation: string; versionId: string;
  stems: { id: number; role: KaraFunStemRole; label: string; volume: number }[];
};
export type KaraFunMixCommand = { generation: string; stemId: number; volume: number } | { generation: string; reset: true };
export type KaraFunMixBridge = {
  status(): Promise<KaraFunMixStatus | null>;
  set(input: KaraFunMixCommand): Promise<KaraFunMixStatus>;
  subscribe(callback: (status: KaraFunMixStatus | null) => void): () => void;
};

export function validStemVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
