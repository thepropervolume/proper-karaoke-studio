import { useEffect, useMemo, useRef, useState } from 'react';
import { toRenderTiming, type LyricLine, type StudioStem } from '../domain/project';
import { lyricFonts, type LyricStyle } from '../domain/lyric-style';
import { titleCardLayout, videoCountdownBar, videoPresentationAt, videoTimeline,
  type VideoAnimation, type VideoLogo, type VideoPresentation } from '../domain/video-presentation';
import { KaraFunPlayer } from '../shared/from-booth/display/karafun-player';
import { paintKaraFunLyrics } from '../shared/from-booth/display/karafun-lyrics';
import { BackdropPreview } from './BackdropPreview';
import { CdgPreview } from './CdgPreview';
import type { CdgPlayer } from '../domain/cdg';
import { paintStudioBars } from './lyric-bars';

export function PreviewLogo({ url, value }: { url?: string; value: VideoLogo }) {
  if (!url) return null;
  return <img className="presentation-logo" alt="Overlay logo" src={url} style={{
    width: value.width + '%', opacity: value.opacity,
    maxHeight: 100 - value.offsetY + '%', objectPosition: value.corner.endsWith('left') ? 'left center' : 'right center',
    [value.corner.endsWith('left') ? 'left' : 'right']: value.offsetX + '%',
    [value.corner.startsWith('top') ? 'top' : 'bottom']: value.offsetY + '%',
  }} />;
}

function AnimationPreview({ url, settings, elapsed, playing, opacity, translateX, report }: {
  url: string; settings: VideoAnimation; elapsed: number; playing: boolean; opacity: number; translateX: number; report(error: string): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const sync = () => {
    const element = video.current;
    if (!element || element.readyState < 1) return;
    const target = Math.min(element.duration, elapsed * settings.speed);
    element.playbackRate = settings.speed;
    if (Number.isFinite(target) && Math.abs(element.currentTime - target) > (playing ? .22 : .015)) element.currentTime = target;
    if (playing && element.paused) void element.play().catch(() => {
      if (!element.muted) report('The animation audio could not play. Press Play again or mute the animation.');
    });
    if (!playing) element.pause();
  };
  useEffect(sync, [elapsed, playing, settings.speed, url]);
  return <video className="presentation-clip" ref={video} src={url} muted={settings.muted} playsInline preload="auto"
    aria-label="Animation preview" onLoadedMetadata={sync} onError={() => report('Studio could not decode the animation preview.')}
    style={{ opacity, transform: `translateX(${translateX}%)` }} />;
}

type Props = {
  lines: LyricLine[]; duration: number; stems: StudioStem[]; volume: number; title: string; artist: string;
  style: LyricStyle; font: string; value: VideoPresentation;
  assets: { logo?: string; openingAnimation?: string; closingAnimation?: string };
  backdrop: { url: string; motion: boolean } | null; loop: boolean; cdg: CdgPlayer | null;
};
const labelTime = (time: number) => Math.floor(time / 60) + ':' + (time % 60).toFixed(1).padStart(4, '0');

/** The presentation clock leaves the editor playhead on the original audio timeline. */
export function VideoPreview({ lines, duration, stems, volume, title, artist, style, font, value, assets, backdrop, loop, cdg }: Props) {
  const plan = useMemo(() => videoTimeline(lines, duration, value, style), [lines, duration, value, style]);
  const lyrics = useMemo(() => toRenderTiming(lines, duration, style), [lines, duration, style]);
  const openingCountdown = useMemo(() => videoCountdownBar(plan, style), [plan, style]);
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [audioReady, setAudioReady] = useState(false);
  const clock = useRef(0), active = useRef(false), pending = useRef(false);
  const audio = useRef<{ player: KaraFunPlayer; id: string } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hasAudio = duration > 0 && stems.some(stem => stem.url);
  const at = Math.min(position, plan.duration);
  const songPosition = Math.max(0, Math.min(duration, at - plan.audioStart));
  const phase = videoPresentationAt(plan, value, at);

  useEffect(() => {
    if (!hasAudio) return;
    setAudioReady(false);
    const id = crypto.randomUUID();
    const player = new KaraFunPlayer({ autoTick: false, onEvent(event) {
      if (event.type === 'error' || event.type === 'output-error') setError(event.message);
    } });
    const session = { id, player };
    audio.current = session;
    const available = stems.filter(stem => stem.url);
    void player.load({ generation: id, durationSeconds: duration, outputId: '', volume,
      mix: { instrumental: 1, lead: 1, backing: 1, other: 1 },
      stems: available.map((stem, index) => ({ id: index + 1, role: stem.role, src: stem.url, voice: stem.voice })),
      stemVolumes: Object.fromEntries(available.map((stem, index) => [index + 1, stem.volume])),
    }).then(() => { if (audio.current === session) setAudioReady(true); })
      .catch(cause => { if (audio.current === session) { setError(String(cause)); setAudioReady(true); } });
    return () => { audio.current = null; void player.dispose(); };
  }, [stems, duration, volume, hasAudio]);

  function seek(next: number) {
    clock.current = Math.max(0, Math.min(next, plan.duration));
    setPosition(clock.current);
  }
  function pause() {
    active.current = false;
    setPlaying(false);
    if (audio.current) audio.current.player.pause(audio.current.id);
  }
  const toggle = () => {
    if (playing) { pause(); return; }
    if (clock.current >= plan.duration) seek(0);
    active.current = true;
    setPlaying(true);
    const session = audio.current;
    // Prime Web Audio from the button gesture even when the opening starts before the song.
    if (session) {
      void session.player.prime(session.id).catch(cause => setError(String(cause)));
    }
  };
  useEffect(() => {
    if (!playing) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      if (!active.current) return;
      const next = Math.min(plan.duration, clock.current + (now - previous) / 1000);
      previous = now;
      clock.current = next;
      setPosition(next);
      const session = audio.current;
      if (session) {
        const { player, id } = session;
        const snapshot = player.snapshot(), target = next - plan.audioStart;
        if (target < 0 || next >= plan.audioEnd) {
          if (snapshot?.status === 'playing') player.pause(id);
        }
        else if (snapshot?.ready && !pending.current && (snapshot.status !== 'playing' || Math.abs(snapshot.position - target) > .2)) {
          pending.current = true;
          void player.seek(id, target).then(() => {
            if (active.current && clock.current >= plan.audioStart && clock.current < plan.audioEnd) return player.play(id);
          }).catch(cause => setError(String(cause))).finally(() => { pending.current = false; });
        }
      }
      if (next < plan.duration) frame = requestAnimationFrame(tick);
      else pause();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, plan]);

  useEffect(() => {
    const layer = canvas.current;
    if (phase.kind === 'black' || !layer) return;
    const paint = () => {
      const hasSong = at >= plan.audioStart;
      paintKaraFunLyrics(layer, hasSong ? lyrics : { ...lyrics, pages: [] }, songPosition, {
        fontFamily: `"${font}", sans-serif`, primarySingerColor: style.highlightColor, outlineColor: style.outlineColor,
      });
      if (hasSong) paintStudioBars(layer, openingCountdown ? lyrics.bars.filter((bar, index) => bar.start !== 0 || index === 0 && style.progressBar.enabled) : lyrics.bars, songPosition);
      if (openingCountdown) paintStudioBars(layer, [openingCountdown], at);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [phase.kind, songPosition, at, lyrics, font, style, openingCountdown, plan.audioStart]);

  const card = value.titleCard;
  const titleLayout = titleCardLayout(card, title, artist);
  const titlePosition = {
    left: titleLayout.x / titleLayout.width * 100 + '%', width: '86%',
    transform: `translate(${card.align === 'left' ? 0 : card.align === 'right' ? -100 : -50}%, -50%)`,
  };
  return <div className="stack">
    <div className="preview-stage presentation-preview" aria-label="Exported video preview">
      {phase.kind !== 'black' && <div className="presentation-song" style={{ backgroundColor: style.backgroundColor }}>
        {cdg ? <CdgPreview player={cdg} seconds={songPosition} playing={false} livePosition={() => songPosition} /> : <>
          {backdrop?.url && <BackdropPreview url={backdrop.url} motion={backdrop.motion} looping={loop} position={songPosition} playing={playing && at >= plan.audioStart} onError={setError} />}
          <canvas ref={canvas} />
        </>}
      </div>}
      {(phase.kind === 'openingTitle' || phase.kind === 'closingTitle') && <div className="presentation-title"
        style={{ backgroundColor: card.backgroundColor, textAlign: card.align,
          fontFamily: card.font === 'lyrics' ? font : lyricFonts[card.font].family,
          opacity: phase.opacity, transform: `translateX(${phase.translateX}%)` }}>
        <strong style={{ ...titlePosition, color: card.textColor, top: titleLayout.titleY / 10.8 + '%',
          fontSize: card.titleSize / 19.2 + 'cqw' }}>{titleLayout.title}</strong>
        <span style={{ ...titlePosition, color: card.subtitleColor, top: titleLayout.subtitleY / 10.8 + '%',
          fontSize: card.subtitleSize / 19.2 + 'cqw' }}>{titleLayout.subtitle}</span>
      </div>}
      {(phase.kind === 'openingAnimation' || phase.kind === 'closingAnimation') && assets[phase.kind] &&
        <AnimationPreview key={phase.kind + assets[phase.kind]} url={assets[phase.kind]!} settings={value[phase.kind]} {...phase} playing={playing} report={setError} />}
      <PreviewLogo url={assets.logo} value={value.logo} />
    </div>
    <div className="row presentation-transport">
      <button type="button" className="primary" disabled={!plan.duration || hasAudio && !audioReady} onClick={toggle}>{playing ? 'Pause' : 'Play Preview'}</button>
      <span>{labelTime(at)}</span>
      <input className="grow" aria-label="Video preview position" type="range" min={0} max={plan.duration || 1} step={0.01} value={at}
        disabled={!plan.duration} onChange={event => seek(event.target.valueAsNumber)} />
      <span>{labelTime(plan.duration)}</span>
    </div>
    {plan.audioStart > 0 && <p className="muted">Song audio starts at {labelTime(plan.audioStart)} to make room for the opening.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
