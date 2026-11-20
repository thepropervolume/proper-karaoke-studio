import { defaultLyricStyle, lyricFonts, type LyricStyle } from '../domain/lyric-style';

const palette = [
  ['textColor', 'Lyric Text'], ['highlightColor', 'Sung Text'],
  ['outlineColor', 'Text Outline'], ['backgroundColor', 'Background'],
] as const;

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
        <label className="field-label">Font
          <select value={value.font} onChange={event => change({ ...value, font: event.target.value as LyricStyle['font'] })}>
            {Object.entries(lyricFonts).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}
          </select>
        </label>
        <label className="field-label">Lines on Screen
          <select value={value.linesPerScreen} onChange={event => change({ ...value, linesPerScreen: Number(event.target.value) })}>
            {[1, 2, 3, 4].map(count => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </div>
      <label className="row lyric-caps"><input type="checkbox" checked={value.allCaps} onChange={event => change({ ...value, allCaps: event.target.checked })} />All Caps</label>
      <div className="lyric-color-grid">
        {palette.map(([key, label]) => <label key={key} className="field-label">{label}
          <input type="color" value={value[key]} onChange={event => change({ ...value, [key]: event.target.value })} />
        </label>)}
      </div>
      <div className="row preference-actions"><button type="button" onClick={() => change({ ...defaultLyricStyle })}>Reset Defaults</button></div>
    </section>
  </div>;
}
