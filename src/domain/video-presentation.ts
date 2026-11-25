/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import type { LyricLine } from '@thepropervolume/karaoke-core';
import { layoutLyrics, lyricFonts, lyricFrames, normalizeLyricStyle, timedBar, type LyricStyle } from './lyric-style';

export const videoTransitions = ['cut', 'fade', 'slide-left', 'slide-right'] as const;
export type VideoTransition = typeof videoTransitions[number];
type VideoTransitions = { enter: VideoTransition; exit: VideoTransition; transitionDuration: number };

export const logoCorners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type VideoLogo = {
  path: string | null; corner: typeof logoCorners[number];
  width: number; offsetX: number; offsetY: number; opacity: number;
};
export type TitleCardStyle = VideoTransitions & {
  enabled: boolean; placement: 'opening' | 'closing' | 'both'; duration: number;
  title: string; subtitle: string; font: 'lyrics' | keyof typeof lyricFonts;
  titleSize: number; subtitleSize: number; textColor: string; subtitleColor: string;
  backgroundColor: string; allCaps: boolean; align: 'left' | 'center' | 'right'; vertical: number;
};
export type VideoAnimation = VideoTransitions & {
  path: string | null; duration: number; speed: number; muted: boolean;
};
export type VideoPresentation = {
  logo: VideoLogo; titleCard: TitleCardStyle; openingAnimation: VideoAnimation; closingAnimation: VideoAnimation;
};

export const defaultTitleCard: TitleCardStyle = {
  enabled: false, placement: 'both', duration: 5, enter: 'fade', exit: 'fade', transitionDuration: .35,
  title: '', subtitle: '', font: 'lyrics', titleSize: 116, subtitleSize: 58,
  textColor: '#ffffff', subtitleColor: '#d6bbff', backgroundColor: '#171226', allCaps: false,
  align: 'center', vertical: 50,
};
export const defaultVideoPresentation: VideoPresentation = {
  logo: { path: null, corner: 'bottom-right', width: 16, offsetX: 3, offsetY: 4, opacity: 1 },
  titleCard: defaultTitleCard,
  openingAnimation: { path: null, duration: 0, speed: 1, muted: true, enter: 'cut', exit: 'fade', transitionDuration: .35 },
  closingAnimation: { path: null, duration: 0, speed: 1, muted: true, enter: 'fade', exit: 'fade', transitionDuration: .35 },
};

export const VIDEO_ANIMATION_EXTENSIONS = ['.mp4', '.webm'] as const;
export const VIDEO_LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
const choice = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  values.includes(value as T) ? value as T : fallback;
const numeric = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const titleText = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : '';

function assetPath(value: unknown, extensions: readonly string[]) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x1f]/.test(value)) return null;
  return extensions.includes(/\.[^.\\/]+$/.exec(value)?.[0].toLowerCase() ?? '') ? value : null;
}

function normalizeTransitions(value: Partial<VideoTransitions> | undefined, defaults: VideoTransitions): VideoTransitions {
  return {
    enter: choice(value?.enter, videoTransitions, defaults.enter),
    exit: choice(value?.exit, videoTransitions, defaults.exit),
    transitionDuration: numeric(value?.transitionDuration, defaults.transitionDuration, 0, 5),
  };
}

export function normalizeTitleCard(value?: Partial<TitleCardStyle> | null): TitleCardStyle {
  const defaults = defaultTitleCard;
  return {
    enabled: value?.enabled === true, placement: choice(value?.placement, ['opening', 'closing', 'both'], defaults.placement),
    duration: numeric(value?.duration, defaults.duration, 1, 60), ...normalizeTransitions(value ?? undefined, defaults),
    title: titleText(value?.title), subtitle: titleText(value?.subtitle),
    font: choice(value?.font, ['lyrics', 'sans', 'serif', 'mono'], defaults.font),
    titleSize: numeric(value?.titleSize, defaults.titleSize, 24, 250),
    subtitleSize: numeric(value?.subtitleSize, defaults.subtitleSize, 14, 150),
    textColor: color(value?.textColor, defaults.textColor), subtitleColor: color(value?.subtitleColor, defaults.subtitleColor),
    backgroundColor: color(value?.backgroundColor, defaults.backgroundColor),
    allCaps: value?.allCaps === true, align: choice(value?.align, ['left', 'center', 'right'], defaults.align),
    vertical: numeric(value?.vertical, defaults.vertical, 15, 85),
  };
}

type PresentationInput = {
  titleCard?: Partial<TitleCardStyle>; logo?: Partial<VideoLogo>;
  openingAnimation?: Partial<VideoAnimation>; closingAnimation?: Partial<VideoAnimation>;
};

export function normalizeVideoPresentation(input?: PresentationInput | null): VideoPresentation {
  const normalizeAnimation = (value: Partial<VideoAnimation> | undefined, defaults: VideoAnimation): VideoAnimation => ({
    path: assetPath(value?.path, VIDEO_ANIMATION_EXTENSIONS), duration: numeric(value?.duration, 0, 0, 300),
    speed: numeric(value?.speed, 1, .25, 4), muted: value?.muted !== false, ...normalizeTransitions(value, defaults),
  });
  const logo = input?.logo, defaults = defaultVideoPresentation;
  return {
    titleCard: normalizeTitleCard(input?.titleCard),
    logo: {
      path: assetPath(logo?.path, VIDEO_LOGO_EXTENSIONS), corner: choice(logo?.corner, logoCorners, defaults.logo.corner),
      width: numeric(logo?.width, defaults.logo.width, 2, 70), offsetX: numeric(logo?.offsetX, defaults.logo.offsetX, 0, 30),
      offsetY: numeric(logo?.offsetY, defaults.logo.offsetY, 0, 30), opacity: numeric(logo?.opacity, 1, 0, 1),
    },
    openingAnimation: normalizeAnimation(input?.openingAnimation, defaults.openingAnimation),
    closingAnimation: normalizeAnimation(input?.closingAnimation, defaults.closingAnimation),
  };
}

export const videoPresentationAssets = (value?: VideoPresentation) =>
  [value?.logo.path, value?.openingAnimation.path, value?.closingAnimation.path].filter((file): file is string => Boolean(file));

export function portableVideoPath(kind: 'logo' | 'openingAnimation' | 'closingAnimation', source: string) {
  const stem = kind === 'logo' ? 'logo' : kind === 'openingAnimation' ? 'opening' : 'closing';
  return 'presentation/' + stem + (/\.[^.\\/]+$/.exec(source)?.[0].toLowerCase() ?? '');
}

export type VideoClip = { start: number; end: number };
export type VideoTimeline = {
  audioStart: number; audioEnd: number; duration: number; lyricStart: number; lyricEnd: number;
  countdownStart: number; openingAnimation: VideoClip | null; openingTitle: VideoClip | null;
  closingTitle: VideoClip | null; closingAnimation: VideoClip | null;
};

/** One output clock. Assets fit into real lead-in, then extend it only when required. */
export function videoTimeline(lines: readonly LyricLine[], duration: number, input?: VideoPresentation, lyricStyle?: LyricStyle): VideoTimeline {
  const songDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const presentation = normalizeVideoPresentation(input);
  const style = normalizeLyricStyle(lyricStyle);
  const { entries } = layoutLyrics(lines, songDuration, style);
  const firstCue = entries[0]?.showAt ?? songDuration;
  const lastCue = entries.length ? entries.reduce((end, entry) => Math.max(end, entry.hideAt), 0) : songDuration;
  const title = presentation.titleCard;
  const clip = (start: number, length: number): VideoClip | null => length > 0 ? { start, end: start + length } : null;
  const animationLength = (animation: VideoAnimation) => animation.path ? animation.duration / animation.speed : 0;
  const openingAnimation = clip(0, animationLength(presentation.openingAnimation));
  const openingTitle = clip(openingAnimation?.end ?? 0, title.enabled && title.placement !== 'closing' ? title.duration : 0);
  const introEnd = openingTitle?.end ?? openingAnimation?.end ?? 0;
  // A configured countdown retains a short visible interval even when the
  // opening assets use up the original lead-in. Leave ordinary songs intact.
  const reserve = entries.length && style.countdownBar.enabled ? Math.min(3, style.countdownBar.minimumBreak) : 0;
  const audioStart = introEnd ? Math.max(0, introEnd + reserve - firstCue) : 0;
  const audioEnd = audioStart + songDuration;
  const lyricStart = audioStart + firstCue, lyricEnd = Math.max(introEnd, audioStart + lastCue);
  const closingTitle = clip(lyricEnd, title.enabled && title.placement !== 'opening' ? title.duration : 0);
  const closingAnimation = clip(closingTitle?.end ?? lyricEnd, animationLength(presentation.closingAnimation));
  return {
    audioStart, audioEnd, duration: Math.max(audioEnd, introEnd, closingAnimation?.end ?? closingTitle?.end ?? 0),
    lyricStart, lyricEnd, countdownStart: introEnd, openingAnimation, openingTitle, closingTitle, closingAnimation,
  };
}

export function videoCountdownBar(timeline: VideoTimeline, lyricStyle?: LyricStyle) {
  const { countdownBar } = normalizeLyricStyle(lyricStyle);
  if (!countdownBar.enabled || (!timeline.openingTitle && !timeline.openingAnimation) ||
    timeline.countdownStart >= timeline.lyricStart || timeline.lyricStart >= timeline.audioEnd) return null;
  return timedBar(countdownBar, lyricFrames.video.width, lyricFrames.video.height, timeline.countdownStart, timeline.lyricStart);
}

export function titleCardLayout(style: TitleCardStyle, title: string, artist: string) {
  const { width, height } = lyricFrames.video;
  const applyCase = (value: string) => style.allCaps ? value.toUpperCase() : value;
  const subtitle = applyCase(style.subtitle.trim() || artist.trim());
  const anchor = style.align === 'left' ? 7 : style.align === 'right' ? 93 : 50;
  const middle = height * style.vertical / 100;
  return {
    title: applyCase(style.title.trim() || title.trim() || 'Untitled Song'), subtitle,
    x: Math.round(width * anchor / 100),
    titleY: Math.round(subtitle ? middle - style.subtitleSize * .75 : middle),
    subtitleY: Math.round(middle + style.titleSize * .65), width, height,
  };
}

export function videoTransitionLength(transition: VideoTransitions, clip: VideoClip) {
  return Math.min(transition.transitionDuration, (clip.end - clip.start) / 2);
}

export type VideoPhase =
  | { kind: 'song' | 'black' }
  | { kind: 'openingTitle' | 'closingTitle' | 'openingAnimation' | 'closingAnimation'; elapsed: number; opacity: number; translateX: number };

export function videoPresentationAt(timeline: VideoTimeline, value: VideoPresentation, at: number): VideoPhase {
  for (const kind of ['openingAnimation', 'openingTitle', 'closingTitle', 'closingAnimation'] as const) {
    const clip = timeline[kind];
    if (!clip || at < clip.start || at >= clip.end) continue;
    const settings = kind === 'openingTitle' || kind === 'closingTitle' ? value.titleCard : value[kind];
    const length = videoTransitionLength(settings, clip), elapsed = at - clip.start;
    const entering = elapsed < length;
    const remaining = entering ? elapsed : clip.end - at;
    const transition = entering ? settings.enter : settings.exit;
    const fraction = length ? 1 - Math.min(1, remaining / length) : 0;
    const direction = transition === 'slide-left' ? -1 : transition === 'slide-right' ? 1 : 0;
    return { kind, elapsed, opacity: transition === 'fade' ? 1 - fraction : 1, translateX: direction * fraction * 100 };
  }
  const closingEnd = timeline.closingAnimation?.end ?? timeline.closingTitle?.end;
  return { kind: closingEnd !== undefined && at >= closingEnd ? 'black' : 'song' };
}
