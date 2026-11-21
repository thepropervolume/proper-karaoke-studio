/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import type { LyricBar } from '../domain/lyric-style';

// The lyric painter has already set the canvas transform to video coordinates.
export function paintStudioBars(canvas: HTMLCanvasElement, bars: readonly LyricBar[], position: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.save();
  for (const { start, end, x, y, width, height, border, style } of bars) {
    if (position < start || position >= end) continue;
    const progress = (position - start) / (end - start);
    const innerWidth = width - 2 * border, innerHeight = height - 2 * border;
    if (border) {
      context.fillStyle = style.borderColor;
      context.fillRect(x, y, width, height);
    }
    context.fillStyle = style.trackColor;
    context.fillRect(x + border, y + border, innerWidth, innerHeight);
    context.fillStyle = style.fillColor;
    context.fillRect(x + border, y + border, innerWidth * progress, innerHeight);
  }
  context.restore();
}
