import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { LyricLine } from '../domain/project';
import { clamp, maxWaveformZoom, panWaveform, waveformZoomSteps, zoomWaveform, type WaveformViewport } from '../domain/waveform-viewport';
import { StudioIcon } from './StudioIcon';

type Props = {
  overview: { peaks: Float32Array; duration: number };
  duration: number;
  position: number;
  lines: readonly LyricLine[];
  disabled: boolean;
  appearance?: string;
  seek(value: number): void;
  moveCue(id: string, seconds: number): void;
  onCueSelection?(id: string | undefined): void;
};

const width = 1024;
const cueTop = .73;
const cueHeight = .2;
const defaultHeight = 108;
const minHeight = 52;
const storedHeightKey = 'tpv-studio-waveform-height';

function savedHeight() {
  try {
    const value = Number(localStorage.getItem(storedHeightKey));
    if (Number.isFinite(value) && value >= minHeight) return value;
  } catch { /* Local storage may be unavailable. */ }
  return defaultHeight;
}

export function WaveformTimeline({ overview, duration, position, lines, disabled, seek, moveCue, appearance, onCueSelection }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const resizeStart = useRef<{ pointer: number; y: number; height: number } | null>(null);
  const [viewport, setViewport] = useState<WaveformViewport>({ zoom: 1, offset: 0 });
  const [height, setHeight] = useState(savedHeight);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const [zoomCursor, setZoomCursor] = useState<'in' | 'out' | ''>('');
  const [selectedId, select] = useState('');
  const { zoom, offset } = viewport;
  const selected = lines.find(line => line.id === selectedId);
  const span = duration / zoom;
  const start = clamp(offset, 0, duration - span);
  const end = start + span;
  const maximumHeight = Math.max(minHeight, Math.min(350, Math.floor(windowHeight * .43)));
  const drawHeight = clamp(height, minHeight, maximumHeight);
  const xFor = (time: number) => (time - start) / span * width;
  const selectCue = (id: string) => { select(id); onCueSelection?.(id || undefined); };
  const visibleCues = useMemo(() => {
    if (!span) return [];
    return lines.filter(line => line.endSeconds >= start && line.startSeconds < end).map(line => {
      const left = Math.max(0, (line.startSeconds - start) / span * width);
      const right = Math.min(width, (line.endSeconds - start) / span * width);
      return { id: line.id, left, width: Math.max(right - left - 1, 2) };
    });
  }, [lines, span, start, end]);

  useEffect(() => {
    const resizeWindow = () => setWindowHeight(window.innerHeight);
    const modifiersChanged = (event: KeyboardEvent) => setZoomCursor(event.ctrlKey ? event.shiftKey ? 'out' : 'in' : '');
    const reset = () => setZoomCursor('');
    window.addEventListener('resize', resizeWindow);
    window.addEventListener('keydown', modifiersChanged);
    window.addEventListener('keyup', modifiersChanged);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('resize', resizeWindow);
      window.removeEventListener('keydown', modifiersChanged);
      window.removeEventListener('keyup', modifiersChanged);
      window.removeEventListener('blur', reset);
    };
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !duration) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && zoom <= 1) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width) return;
      event.preventDefault();
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rect.width : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      if (event.ctrlKey) {
        const delta = clamp((event.deltaY || event.deltaX) * pixels, -220, 220);
        const cursor = (event.clientX - rect.left) / rect.width;
        setViewport(current => zoomWaveform(current, duration, current.zoom * Math.exp(-delta * .004), cursor));
      } else {
        const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * pixels;
        setViewport(current => panWaveform(current, duration, delta / rect.width));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [duration, zoom]);

  useEffect(() => {
    const drawing = canvas.current;
    const context = drawing?.getContext('2d');
    if (!drawing || !context || !span) return;
    const theme = getComputedStyle(drawing);
    const color = (name: string, fallback: string) => theme.getPropertyValue(name).trim() || fallback;
    const accent = color('--accent', '#0eb7ff');
    context.fillStyle = color('--waveform-bg', '#0b121d');
    context.fillRect(0, 0, width, drawHeight);
    context.fillStyle = accent;
    const secondsPerPeak = overview.duration / overview.peaks.length;
    const visibleFirst = Math.max(0, Math.floor(start / secondsPerPeak));
    const visibleLast = Math.min(overview.peaks.length, Math.ceil(end / secondsPerPeak));
    for (let index = visibleFirst; index < visibleLast; index++) {
      const x = (index * secondsPerPeak - start) / span * width;
      const amplitude = Math.min(overview.peaks[index], 1) * drawHeight * .32;
      context.fillRect(x, drawHeight * .37 - amplitude, Math.max(2, secondsPerPeak / span * width), Math.max(1, amplitude * 2));
    }
    for (const cue of visibleCues) {
      context.fillStyle = cue.id === selectedId ? accent : color('--waveform-cue', '#405b72');
      context.fillRect(cue.left, drawHeight * cueTop, cue.width, drawHeight * cueHeight);
    }
    if (position >= start && position <= end) {
      context.fillStyle = color('--text', '#fff');
      context.fillRect((position - start) / span * width, 0, 2, drawHeight);
    }
  }, [appearance, drawHeight, end, overview, position, selectedId, span, start, visibleCues]);

  const zoomTo = (value: number) => {
    const cursor = position >= start && position <= end ? (position - start) / span : .5;
    setViewport(current => zoomWaveform(current, duration, value, cursor));
  };
  const resize = (value: number) => {
    const next = Math.round(clamp(value, minHeight, maximumHeight));
    setHeight(next);
    try { localStorage.setItem(storedHeightKey, String(next)); } catch { /* Resize still works for this session. */ }
  };
  const dragResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const anchor = resizeStart.current;
    if (anchor?.pointer === event.pointerId) resize(anchor.height + anchor.y - event.clientY);
  };

  if (duration <= 0) return null;
  const cueIsMovable = selected && selected.endSeconds - selected.startSeconds <= duration;
  return <div className="waveform-timeline">
    <div className="waveform-resizer" role="separator" aria-label="Resize waveform" aria-orientation="horizontal"
      aria-valuenow={drawHeight} aria-valuemin={minHeight} aria-valuemax={maximumHeight} tabIndex={0}
      onPointerDown={event => {
        if (event.button !== 0) return;
        resizeStart.current = { pointer: event.pointerId, y: event.clientY, height: drawHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={dragResize} onLostPointerCapture={() => { resizeStart.current = null; }}
      onDoubleClick={() => resize(defaultHeight)}
      onKeyDown={event => {
        const step = event.shiftKey ? 36 : 10;
        const next = event.key === 'ArrowUp' ? drawHeight + step : event.key === 'ArrowDown' ? drawHeight - step
          : event.key === 'Home' ? minHeight : event.key === 'End' ? maximumHeight : undefined;
        if (next !== undefined) { event.preventDefault(); resize(next); }
      }}>
      <span />
    </div>
    <div className="waveform-actions">
      <span className="eyebrow">Waveform</span>
      {lines.length > 0 ? <div className="row waveform-cue-control">
        <select className="grow" aria-label="Waveform lyric cue" disabled={disabled} value={selected?.id ?? ''} onChange={event => {
          const line = lines.find(entry => entry.id === event.target.value);
          selectCue(event.target.value);
          if (line) {
            seek(clamp(line.startSeconds, 0, duration));
            if (xFor(line.startSeconds) < 0 || xFor(line.startSeconds) > width) {
              setViewport(current => ({ ...current, offset: clamp(line.startSeconds - span / 2, 0, duration - span) }));
            }
          }
        }}>
          <option value="">Select a lyric cue</option>
          {lines.map((line, index) => <option key={line.id} value={line.id}>{index + 1}. {line.text.slice(0, 90)}</option>)}
        </select>
        <button type="button" disabled={disabled || !cueIsMovable} onClick={() => {
          if (selected) moveCue(selected.id, clamp(position, 0, duration - (selected.endSeconds - selected.startSeconds)));
        }}>Move to playhead</button>
      </div> : <span />}
      <div className="row waveform-zoom">
        <button type="button" className="icon-button small-button" aria-label="Zoom out of waveform" disabled={zoom <= 1}
          data-tip="Zoom out. Ctrl+Shift+click the waveform also zooms out." onClick={() => zoomTo(zoom / 2)}><StudioIcon name="zoomOut" /></button>
        <label className="row muted">Zoom
          <select value={zoom} onChange={event => zoomTo(Number(event.target.value))}>
            {waveformZoomSteps.map(value => <option key={value} value={value}>{value}×</option>)}
            {!waveformZoomSteps.some(value => value === zoom) && <option value={zoom}>{zoom.toFixed(1)}×</option>}
          </select>
        </label>
        <button type="button" className="icon-button small-button" aria-label="Zoom into waveform" disabled={zoom >= maxWaveformZoom}
          data-tip="Zoom in. Ctrl+click or Ctrl+scroll to zoom around the pointer." onClick={() => zoomTo(zoom * 2)}><StudioIcon name="zoomIn" /></button>
      </div>
    </div>
    <canvas ref={canvas} width={width} height={drawHeight} style={{ height: drawHeight }} aria-hidden="true"
      data-zoom-cursor={zoomCursor || undefined} onPointerEnter={event => setZoomCursor(event.ctrlKey ? event.shiftKey ? 'out' : 'in' : '')}
      onContextMenu={event => { if (event.ctrlKey) event.preventDefault(); }}
      onPointerDown={event => {
      if (event.button !== 0) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const cursor = (event.clientX - bounds.left) / bounds.width;
      if (event.ctrlKey) {
        event.preventDefault();
        setViewport(current => zoomWaveform(current, duration, current.zoom * (event.shiftKey ? .5 : 2), cursor));
        return;
      }
      if (disabled) return;
      const seconds = clamp(start + cursor * span, 0, duration);
      seek(seconds);
      const relativeY = (event.clientY - bounds.top - event.currentTarget.clientTop) / event.currentTarget.clientHeight;
      if (relativeY >= cueTop && relativeY <= cueTop + cueHeight) {
        const x = (event.clientX - bounds.left - event.currentTarget.clientLeft) / event.currentTarget.clientWidth * width;
        // Match the topmost painted block, including the minimum width for short cues.
        for (let index = visibleCues.length - 1; index >= 0; index--) {
          const cue = visibleCues[index];
          if (x >= cue.left && x < cue.left + cue.width) {
            selectCue(cue.id);
            break;
          }
        }
      }
    }} />
    {zoom > 1 && <input aria-label="Waveform viewport" type="range" min={0} max={duration - span} step="0.01" value={start}
      onChange={event => setViewport(current => ({ ...current, offset: Number(event.target.value) }))} />}
  </div>;
}
