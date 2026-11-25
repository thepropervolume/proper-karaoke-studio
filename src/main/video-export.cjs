/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { normalizeVideoPresentation, videoTimeline, videoTransitionLength } = require('../domain/video-presentation.ts');

const decimal = value => Number(value.toFixed(6)).toString();
const colorValue = color => '0x' + color.slice(1);
const fullFrame = 'fps=30:start_time=0,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1';

async function readVideoPresentation(input, duration, openAsset, probe) {
  const presentation = normalizeVideoPresentation(input.videoPresentation);
  if (presentation.logo.path) presentation.logo.path = await openAsset('logo', presentation.logo.path);
  for (const kind of ['openingAnimation', 'closingAnimation']) {
    const animation = presentation[kind];
    if (!animation.path) continue;
    animation.path = await openAsset(kind, animation.path);
    const result = await probe(animation.path);
    animation.duration = result.duration;
    animation.hasAudio = result.hasAudio;
  }
  const lines = Array.isArray(input.lyrics) ? input.lyrics : [];
  return { presentation, timeline: videoTimeline(lines, duration, presentation, input.lyricStyle) };
}

function motionX(style, clip, length) {
  const direction = transition => transition === 'slide-left' ? -1 : transition === 'slide-right' ? 1 : 0;
  const signedIn = direction(style.enter), signedOut = direction(style.exit);
  if (!length || (!signedIn && !signedOut)) return '0';
  const startFade = decimal(clip.start + length), endFade = decimal(clip.end - length);
  return `'W*(${signedIn}*max(0,(${startFade}-t)/${decimal(length)})+${signedOut}*max(0,(t-${endFade})/${decimal(length)}))'`;
}

function atempo(speed) {
  return speed > 2 ? `atempo=2,atempo=${decimal(speed / 2)}`
    : speed < .5 ? `atempo=0.5,atempo=${decimal(speed * 2)}` : `atempo=${decimal(speed)}`;
}

/** Append the output-clock overlays, with the logo composited last. */
function appendVideoPresentation({ args, filters, presentation, timeline, firstInput }) {
  const audio = [];
  let video = 'song', nextInput = firstInput;
  for (const kind of ['openingAnimation', 'openingTitle', 'closingTitle', 'closingAnimation']) {
    const clip = timeline[kind];
    if (!clip) continue;
    const title = kind.endsWith('Title');
    const media = title ? presentation.titleCard : presentation[kind];
    const length = clip.end - clip.start, seconds = decimal(length);
    const transition = videoTransitionLength(media, clip);
    const index = nextInput++;
    if (title) args.push('-f', 'lavfi', '-i', 'color=c=' + colorValue(media.backgroundColor) + ':s=1920x1080:r=30:d=' + seconds);
    else args.push('-i', media.path);
    const visual = title ? 'subtitles=filename=title.ass:fontsdir=fonts' : 'setpts=(PTS-STARTPTS)/' + decimal(media.speed) + ',' + fullFrame;
    const pad = title ? '' : ',tpad=stop_mode=clone:stop_duration=' + seconds;
    const fadeIn = transition && media.enter === 'fade' ? ',fade=t=in:st=0:d=' + decimal(transition) + ':alpha=1' : '';
    const fadeOut = transition && media.exit === 'fade'
      ? ',fade=t=out:st=' + decimal(length - transition) + ':d=' + decimal(transition) + ':alpha=1' : '';
    filters.push(`[${index}:v:0]${visual}${pad},trim=duration=${seconds},format=rgba${fadeIn}${fadeOut},setpts=PTS-STARTPTS+${decimal(clip.start)}/TB[${kind}]`);
    const active = `enable='gte(t,${decimal(clip.start)})*lt(t,${decimal(clip.end)})'`;
    const next = kind + 'Mix';
    filters.push(`[${video}][${kind}]overlay=x=${motionX(media, clip, transition)}:y=0:eof_action=pass:repeatlast=0:${active}[${next}]`);
    video = next;
    if (!title && !media.muted && media.hasAudio) {
      const label = kind + 'Audio';
      filters.push(`[${index}:a:0]asetpts=PTS-STARTPTS,${atempo(media.speed)},atrim=duration=${seconds},adelay=${Math.round(clip.start * 1000)}:all=1[${label}]`);
      audio.push(label);
    }
  }
  const closingEnd = timeline.closingAnimation?.end ?? timeline.closingTitle?.end;
  if (closingEnd !== undefined && closingEnd < timeline.duration) {
    filters.push(`[${video}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='gte(t,${decimal(closingEnd)})'[afterClosing]`);
    video = 'afterClosing';
  }
  const logo = presentation.logo;
  if (logo.path && logo.opacity > 0) {
    args.push('-i', logo.path);
    const width = Math.round(1920 * Math.min(logo.width, 100 - logo.offsetX) / 100);
    const height = Math.round(1080 * (100 - logo.offsetY) / 100);
    const offsetX = Math.round(1920 * logo.offsetX / 100), offsetY = Math.round(1080 * logo.offsetY / 100);
    const x = logo.corner.endsWith('right') ? 'W-w-' + offsetX : String(offsetX);
    const y = logo.corner.startsWith('bottom') ? 'H-h-' + offsetY : String(offsetY);
    filters.push(`[${nextInput}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1,format=rgba,colorchannelmixer=aa=${decimal(logo.opacity)}[logo]`);
    filters.push(`[${video}][logo]overlay=x=${x}:y=${y}[withLogo]`);
    video = 'withLogo';
  }
  return { video, audio };
}

module.exports = { appendVideoPresentation, readVideoPresentation, decimal };
