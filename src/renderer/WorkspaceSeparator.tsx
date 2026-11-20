import type { PointerEvent as ReactPointerEvent } from 'react';

export const defaultInspectorWidth = 360;
export const minInspectorWidth = 282;
const maxInspectorWidth = 520;

export function inspectorMax(viewport: number) {
  return Math.max(minInspectorWidth, Math.min(maxInspectorWidth, Math.floor(viewport * 0.46)));
}

export function WorkspaceSeparator({ width, maximum, resize }: { width: number; maximum: number; resize(value: number): void }) {
  const pointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (bounds) resize(bounds.right - event.clientX);
  };
  return <div className="workspace-separator" role="separator" aria-label="Resize editor panel" aria-orientation="vertical"
    aria-valuemin={minInspectorWidth} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0}
    onDoubleClick={() => resize(defaultInspectorWidth)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={pointer}
    onKeyDown={event => {
      const step = event.shiftKey ? 40 : 12;
      const values: Record<string, number> = { ArrowLeft: width + step, ArrowRight: width - step, Home: minInspectorWidth, End: maximum };
      if (Object.hasOwn(values, event.key)) { event.preventDefault(); resize(values[event.key]); }
    }}>
    <span />
  </div>;
}
