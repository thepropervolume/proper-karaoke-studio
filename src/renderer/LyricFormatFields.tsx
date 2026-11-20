/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import type { LyricFormatOptions } from '../domain/lyric-format';

const fields = [
  ['minLength', 'Minimum', 'The preferred shortest line. Short phrases can stay on their own line.'],
  ['targetLength', 'Target', 'The line length Studio aims for, counting spaces.'],
  ['maxLength', 'Maximum', 'The wrapping limit. An individual word may exceed it.'],
] as const;

export function LyricFormatFields({ value, onChange, disabled = false }: {
  value: LyricFormatOptions;
  onChange: (value: LyricFormatOptions) => void;
  disabled?: boolean;
}) {
  return <fieldset className="lyric-format-lengths" disabled={disabled}>
    <legend className="muted">Characters per line</legend>
    {fields.map(([key, label, detail]) => <label className="field-label" key={key}>
      <span title={detail}>{label}</span>
      <input aria-label={label + ' lyric line length'} type="number" min="1" max="160" step="1"
        value={value[key] || ''} title={detail} onChange={event => onChange({ ...value, [key]: Number(event.target.value) })} />
    </label>)}
  </fieldset>;
}
