import { useEffect, useState } from 'react';
import { defaultLyricStyle, lyricFonts, type LyricStyle } from '../domain/lyric-style';
import { HelpTip } from './HelpTip';
import { PreferenceField } from './PreferencesDialog';

const palette = [
  ['textColor', 'Lyric Text', 'Color of lyrics before the singer reaches them.'],
  ['highlightColor', 'Sung Text', 'Highlight moves through the lyric as the words are sung.'],
  ['outlineColor', 'Text Outline', 'A contrasting edge keeps the lyric readable over images and video.'],
  ['backgroundColor', 'Background', 'Used when no backdrop is selected or when a non-looping backdrop finishes.'],
] as const;

function ColorControl({ label, hint, value, change, reset }: {
  label: string; hint: string; value: string; change(value: string): void; reset(): void;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const valid = /^#?[a-f0-9]{6}$/i.test(hex);
  return <div className="color-control">
    <div className="preference-field-label"><span>{label}</span><HelpTip label={label}>{hint}</HelpTip></div>
    <div className="row">
      <input type="color" aria-label={label + ' color picker'} value={value} onChange={event => change(event.target.value)} />
      <input type="text" spellCheck={false} maxLength={7} aria-label={label + ' hex code'} aria-invalid={!valid} value={hex}
        placeholder="#601CE9" onChange={event => {
          const next = event.target.value;
          setHex(next);
          if (/^#?[a-f0-9]{6}$/i.test(next)) change('#' + next.replace(/^#/, '').toLowerCase());
        }} />
      <button type="button" className="field-reset" aria-label={'Reset ' + label} onClick={() => { reset(); setHex(value); }}>Reset</button>
    </div>
  </div>;
}

export function LyricAppearance({ value, change, close }: {
  value: LyricStyle; change(next: LyricStyle): void; close(): void;
}) {
  return <div className="settings" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}>
    <section className="settings-card lyric-appearance" aria-labelledby="lyric-appearance-title" role="dialog" aria-modal="true"
      onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <div className="row spaced"><h2 id="lyric-appearance-title">Lyric Appearance</h2>
        <button type="button" autoFocus onClick={close}>Done</button>
      </div>
      <div className="preferences-fields">
        <PreferenceField label="Font" hint="The selected font is used in both the singer preview and video exports." reset={() => change({ ...value, font: defaultLyricStyle.font })}>
          {id => <select id={id} value={value.font} onChange={event => change({ ...value, font: event.target.value as LyricStyle['font'] })}>
            {Object.entries(lyricFonts).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}
          </select>}
        </PreferenceField>
        <PreferenceField label="Lines on Screen" hint="Reserve this many centered lyric rows and show nearby upcoming lines." reset={() => change({ ...value, linesPerScreen: defaultLyricStyle.linesPerScreen })}>
          {id => <select id={id} value={value.linesPerScreen} onChange={event => change({ ...value, linesPerScreen: Number(event.target.value) })}>
            {[1, 2, 3, 4].map(count => <option key={count} value={count}>{count}</option>)}
          </select>}
        </PreferenceField>
      </div>
      <div className="row">
        <label className="row lyric-caps"><input type="checkbox" checked={value.allCaps} onChange={event => change({ ...value, allCaps: event.target.checked })} />All Caps</label>
        <HelpTip label="All Caps">Display lyrics in uppercase while keeping the original text in the lyric editor and lyric files.</HelpTip>
        <button type="button" className="field-reset" aria-label="Reset All Caps" onClick={() => change({ ...value, allCaps: defaultLyricStyle.allCaps })}>Reset</button>
      </div>
      <div className="preferences-fields">
        {palette.map(([key, label, hint]) => <ColorControl key={key} label={label} hint={hint} value={value[key]}
          change={color => change({ ...value, [key]: color })} reset={() => change({ ...value, [key]: defaultLyricStyle[key] })} />)}
      </div>
      <div className="row preference-actions"><button type="button" onClick={() => change({ ...defaultLyricStyle })}>Reset Defaults</button></div>
    </section>
  </div>;
}
