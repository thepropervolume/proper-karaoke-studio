/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
export type WaveformViewport = { zoom: number; offset: number };

export const waveformZoomSteps = [1, 2, 4, 8, 16, 32] as const;
export const maxWaveformZoom = waveformZoomSteps.at(-1)!;

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function zoomWaveform(view: WaveformViewport, duration: number, zoom: number, cursor: number): WaveformViewport {
  const nextZoom = clamp(zoom, 1, maxWaveformZoom);
  const span = duration / view.zoom;
  const offset = clamp(view.offset, 0, duration - span);
  const position = clamp(cursor, 0, 1);
  const nextSpan = duration / nextZoom;
  return {
    zoom: nextZoom,
    offset: clamp(offset + position * (span - nextSpan), 0, duration - nextSpan),
  };
}

export function panWaveform(view: WaveformViewport, duration: number, fraction: number): WaveformViewport {
  const span = duration / view.zoom;
  return { ...view, offset: clamp(view.offset + span * fraction, 0, duration - span) };
}
