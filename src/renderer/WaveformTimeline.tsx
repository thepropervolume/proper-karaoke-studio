import { useEffect, useRef, useState } from 'react';
import type { LyricLine } from '../domain/project';

type Props = {
  overview: { peaks: Float32Array; duration: number };
  duration: number;
  position: number;
  lines: readonly LyricLine[];
  disabled: boolean;
  appearance?: string;
  seek(value: number): void;
  moveCue(id: string, seconds: number): void;
};

const width = 1024;
const height = 94;
const bound = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));

export function WaveformTimeline({ overview, duration, position, lines, disabled, seek, moveCue, appearance }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedId, select] = useState('');
  const [offset, setOffset] = useState(0);
  const selected = lines.find(line => line.id === selectedId);
  const span = duration / zoom;
  const start = bound(offset, duration - span);
  const end = start + span;
  const xFor = (time: number) => (time - start) / span * width;

  useEffect(() => {
    const drawing = canvas.current;
    const context = drawing?.getContext('2d');
    if (!drawing || !context || !span) return;
    const theme = getComputedStyle(drawing);
    const color = (name: string, fallback: string) => theme.getPropertyValue(name).trim() || fallback;
    const accent = color('--accent', '#0eb7ff');
    context.fillStyle = color('--waveform-bg', '#0b121d');
    context.fillRect(0, 0, width, height);
    context.fillStyle = accent;
    const secondsPerPeak = overview.duration / overview.peaks.length;
    const visibleFirst = Math.max(0, Math.floor(start / secondsPerPeak));
    const visibleLast = Math.min(overview.peaks.length, Math.ceil(end / secondsPerPeak));
    for (let index = visibleFirst; index < visibleLast; index++) {
      const x = (index * secondsPerPeak - start) / span * width;
      const amplitude = Math.min(overview.peaks[index], 1) * 29;
      context.fillRect(x, 34 - amplitude, Math.max(2, secondsPerPeak / span * width), Math.max(1, amplitude * 2));
    }
    for (const line of lines) {
      if (line.endSeconds < start || line.startSeconds > end) continue;
      const x = Math.max(0, (line.startSeconds - start) / span * width);
      const right = Math.min(width, (line.endSeconds - start) / span * width);
      context.fillStyle = line.id === selectedId ? accent : color('--waveform-cue', '#405b72');
      context.fillRect(x, 69, Math.max(right - x - 1, 2), 19);
    }
    if (position >= start && position <= end) {
      context.fillStyle = color('--text', '#fff');
      context.fillRect((position - start) / span * width, 0, 2, height);
    }
  }, [appearance, end, lines, overview, position, selectedId, span, start]);

  const zoomTo = (value: number) => {
    const next = duration / value;
    setZoom(value);
    setOffset(bound(position - next / 2, duration - next));
  };

  if (duration <= 0) return null;
  const cueIsMovable = selected && selected.endSeconds - selected.startSeconds <= duration;
  return <div className="waveform-timeline">
    <div className="waveform-actions">
      <span className="eyebrow">Waveform</span>
      {lines.length > 0 ? <div className="row waveform-cue-control">
        <select className="grow" aria-label="Waveform lyric cue" disabled={disabled} value={selected?.id ?? ''} onChange={event => {
          const line = lines.find(entry => entry.id === event.target.value);
          select(event.target.value);
          if (line) {
            seek(bound(line.startSeconds, duration));
            if (xFor(line.startSeconds) < 0 || xFor(line.startSeconds) > width) setOffset(bound(line.startSeconds - span / 2, duration - span));
          }
        }}>
          <option value="">Select a lyric cue</option>
          {lines.map((line, index) => <option key={line.id} value={line.id}>{index + 1}. {line.text.slice(0, 90)}</option>)}
        </select>
        <button type="button" disabled={disabled || !cueIsMovable} onClick={() => {
          if (selected) moveCue(selected.id, bound(position, duration - (selected.endSeconds - selected.startSeconds)));
        }}>Move to playhead</button>
      </div> : <span />}
      <label className="row muted">Zoom
        <select value={zoom} onChange={event => zoomTo(Number(event.target.value))}>
          {[1, 2, 4, 8, 16].map(value => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
    </div>
    <canvas ref={canvas} width={width} height={height} aria-hidden="true" onPointerDown={event => {
      if (disabled) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const seconds = bound(start + (event.clientX - bounds.left) / bounds.width * span, duration);
      seek(seconds);
      if ((event.clientY - bounds.top) / bounds.height > 0.69) {
        const line = lines.find(entry => seconds >= entry.startSeconds && seconds <= entry.endSeconds);
        if (line) select(line.id);
      }
    }} />
    {zoom > 1 && <input aria-label="Waveform viewport" type="range" min={0} max={duration - span} step="0.01" value={start} onChange={event => setOffset(Number(event.target.value))} />}
  </div>;
}
