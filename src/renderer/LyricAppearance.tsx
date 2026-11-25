import { useEffect, useState, type ReactNode } from 'react';
import { defaultLyricStyle, lyricFonts, lyricLineCounts, type CustomLyricFont, type LyricBarStyle, type LyricStyle } from '../domain/lyric-style';
import { HelpTip } from './HelpTip';
import { AppearancePresetControls } from './AppearancePresetControls';
import { PreferenceField, preferenceError } from './PreferencesDialog';

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

function NumberControl({ label, hint, value, min, max, step = 1, change, reset }: {
  label: string; hint: string; value: number; min: number; max: number; step?: number; change(value: number): void; reset(): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <PreferenceField label={label} hint={hint} reset={() => { reset(); setDraft(String(value)); }}>
    {id => <input id={id} type="number" min={min} max={max} step={step} value={draft} onChange={event => {
      const typed = event.target.value;
      setDraft(typed);
      const parsed = Number(typed);
      if (typed && Number.isFinite(parsed) && parsed >= min && parsed <= max) change(parsed);
    }} onBlur={() => setDraft(String(value))} />}
  </PreferenceField>;
}

const barGeometry = [
  ['width', 'Width (%)', 1, 100, 1, 'Width relative to the video frame.'],
  ['height', 'Height (%)', .2, 25, .1, 'Height relative to the video frame.'],
  ['x', 'Horizontal Position (%)', 0, 100, 1, 'Left to right position of the bar center.'],
  ['y', 'Vertical Position (%)', 0, 100, 1, 'Top to bottom position of the bar center.'],
] as const;
const barColors = [
  ['fillColor', 'Fill', 'Color of the filled portion.'],
  ['trackColor', 'Track', 'Color of the space still to fill.'],
  ['borderColor', 'Border', 'Outline around the bar.'],
] as const;

function BarControls<Style extends LyricBarStyle>({ title, description, value, defaults, change, children }: {
  title: string; description: string; value: Style; defaults: Style; change(next: Style): void; children?: ReactNode;
}) {
  return <details className="settings-group">
    <summary>{title}</summary>
    <div className="bar-settings">
      <div className="row"><label className="row lyric-caps">
        <input type="checkbox" checked={value.enabled} onChange={event => change({ ...value, enabled: event.target.checked })} />Show {title}
      </label><HelpTip label={title}>{description}</HelpTip>
        <button type="button" className="field-reset" onClick={() => change(defaults)} aria-label={'Reset ' + title}>Reset</button></div>
      <div className="preferences-fields">{barGeometry.map(([key, label, min, max, step, hint]) => (
        <NumberControl key={key} label={title + ' ' + label} hint={hint} min={min} max={max} step={step} value={value[key]}
          change={number => change({ ...value, [key]: number })} reset={() => change({ ...value, [key]: defaults[key] })} />
      ))}{children}</div>
      <div className="preferences-fields">{barColors.map(([key, label, hint]) => (
        <ColorControl key={key} label={title + ' ' + label} hint={hint} value={value[key]}
          change={color => change({ ...value, [key]: color })} reset={() => change({ ...value, [key]: defaults[key] })} />
      ))}</div>
    </div>
  </details>;
}

export function LyricAppearance({ value, change, close, backdrop, chooseBackdrop, clearBackdrop, busy, onDefaultSaved }: {
  value: LyricStyle; change(next: LyricStyle): void; close(): void;
  backdrop?: string; chooseBackdrop(): void; clearBackdrop(): void; busy: boolean;
  onDefaultSaved(value: LyricStyle): void;
}) {
  const [fonts, setFonts] = useState<CustomLyricFont[]>([]);
  const [fontBusy, setFontBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void window.studio.listLyricFonts().then(setFonts).catch(cause => setError(preferenceError(cause))); }, []);
  const selected = value.font === 'custom' && value.customFont ? value.customFont.path : value.font;
  const custom = [...new Map([...(value.customFont ? [value.customFont] : []), ...fonts].map(font => [font.path, font])).values()];
  async function addFont() {
    setFontBusy(true); setError('');
    try {
      const font = await window.studio.addLyricFont();
      if (font) {
        setFonts(current => [...current.filter(item => item.path !== font.path), font]);
        change({ ...value, font: 'custom', customFont: font });
      }
    } catch (cause) { setError(preferenceError(cause)); }
    finally { setFontBusy(false); }
  }
  return <div className="settings" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}>
    <section className="settings-card lyric-appearance" aria-labelledby="lyric-appearance-title" role="dialog" aria-modal="true"
      onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <div className="row spaced"><h2 id="lyric-appearance-title">Lyric Appearance</h2>
        <button type="button" autoFocus onClick={close}>Done</button>
      </div>
      <AppearancePresetControls kind="lyrics" value={value} onChange={change} onDefaultSaved={onDefaultSaved} />
      <div className="preferences-fields">
        <PreferenceField label="Font" hint="The selected font is used in both the singer preview and video exports." reset={() => change({ ...value, font: defaultLyricStyle.font })}>
          {id => <div className="row font-select"><select id={id} value={selected} onChange={event => {
            const font = custom.find(item => item.path === event.target.value);
            change(font ? { ...value, font: 'custom', customFont: font } : { ...value, font: event.target.value as LyricStyle['font'] });
          }}>
            {Object.entries(lyricFonts).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}
            {!!custom.length && <optgroup label="Custom Fonts">{custom.map(font => <option key={font.path} value={font.path}>{font.family}</option>)}</optgroup>}
          </select><button type="button" disabled={fontBusy} data-tip="Import a TrueType or OpenType font into your Studio library." onClick={() => void addFont()}>Add Font…</button></div>}
        </PreferenceField>
        <PreferenceField label="Lines on Screen" hint="Reserve this many centered lyric rows and show nearby upcoming lines." reset={() => change({ ...value, linesPerScreen: defaultLyricStyle.linesPerScreen })}>
          {id => <select id={id} value={value.linesPerScreen} onChange={event => change({ ...value, linesPerScreen: Number(event.target.value) })}>
            {lyricLineCounts.map(count => <option key={count} value={count}>{count}</option>)}
          </select>}
        </PreferenceField>
      </div>
      <div className="preferences-fields">
        <NumberControl label="Font Size (px)" hint="Target size in a 1080p video. Long lines and crowded layouts can shrink to fit." min={24} max={220}
          value={value.fontSize} change={fontSize => change({ ...value, fontSize })} reset={() => change({ ...value, fontSize: defaultLyricStyle.fontSize })} />
        <NumberControl label="Line Height (%)" hint="Spacing between lyric rows as a percentage of the font size." min={105} max={260}
          value={value.leading} change={leading => change({ ...value, leading })} reset={() => change({ ...value, leading: defaultLyricStyle.leading })} />
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
      <div className="settings-group">
        <div className="row spaced"><div className="row"><h3>Backdrop</h3><HelpTip label="Backdrop">Use a still image, animated GIF, or muted MP4 behind the lyrics.</HelpTip></div>
          <div className="toolbar"><button type="button" disabled={busy} onClick={chooseBackdrop}>{backdrop ? 'Change Backdrop…' : 'Choose Backdrop…'}</button>
            {backdrop && <button type="button" disabled={busy} onClick={clearBackdrop}>Remove</button>}</div></div>
        {backdrop && <span className="muted" title={backdrop}>{backdrop.split(/[\\/]/).at(-1)}</span>}
      </div>
      <BarControls title="Song Progress Bar" description="Fill from left to right as the song plays." value={value.progressBar}
        defaults={defaultLyricStyle.progressBar} change={progressBar => change({ ...value, progressBar })} />
      <BarControls title="Countdown Bar" description="Fill during long breaks and clear before the next lyrics fade in." value={value.countdownBar}
        defaults={defaultLyricStyle.countdownBar} change={countdownBar => change({ ...value, countdownBar })}>
        <NumberControl label="Minimum Break (seconds)" hint="The shortest gap that can show a countdown." min={2} max={120} step={.5}
          value={value.countdownBar.minimumBreak} change={minimumBreak => change({ ...value, countdownBar: { ...value.countdownBar, minimumBreak } })}
          reset={() => change({ ...value, countdownBar: { ...value.countdownBar, minimumBreak: defaultLyricStyle.countdownBar.minimumBreak } })} />
      </BarControls>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row preference-actions"><button type="button" onClick={() => change({ ...defaultLyricStyle })}>Reset to Factory Defaults</button></div>
    </section>
  </div>;
}
