import { useEffect, useRef, useState, type ReactNode } from 'react';
import { logoCorners, normalizeVideoPresentation, videoTransitions, type TitleCardStyle, type VideoAnimation, type VideoPresentation, type VideoTransition } from '../domain/video-presentation';
import { TitlePresetControls } from './AppearancePresetControls';

const nameOf = (file: string | null) => file?.split(/[\\/]/).at(-1);
type Animation = 'openingAnimation' | 'closingAnimation';
export type PresentationAsset = 'logo' | Animation;
const labelOf = (value: string) => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');

function NumberField({ name, value, min, max, step = 1, change }: {
  name: string; value: number; min: number; max: number; step?: number; change(value: number): void;
}) {
  const [draft, setDraft] = useState<string>();
  return <label className="field-label">{name}
    <input type="number" min={min} max={max} step={step} value={draft ?? value}
      onChange={event => setDraft(event.target.value)}
      onBlur={event => {
        if (Number.isFinite(event.target.valueAsNumber)) change(Math.min(max, Math.max(min, event.target.valueAsNumber)));
        setDraft(undefined);
      }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
  </label>;
}

function ColorField({ label, value, change }: { label: string; value: string; change(value: string): void }) {
  const [draft, setDraft] = useState<string>();
  return <div className="field-label">{label}
    <div className="color-control">
      <input type="color" aria-label={label} value={value} onChange={event => change(event.target.value)} />
      <input type="text" aria-label={label + ' hex code'} value={draft ?? value} maxLength={7}
        onChange={event => setDraft(event.target.value)}
        onBlur={event => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) change(event.target.value); setDraft(undefined); }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </div>
  </div>;
}

function Transitions({ value, change }: {
  value: Pick<VideoAnimation, 'enter' | 'exit' | 'transitionDuration'>;
  change(update: Partial<typeof value>): void;
}) {
  return <div className="presentation-fields">
    {(['enter', 'exit'] as const).map(key => <label key={key} className="field-label">{key === 'enter' ? 'Entrance' : 'Exit'}
      <select value={value[key]} onChange={event => change({ [key]: event.target.value as VideoTransition })}>
        {videoTransitions.map(transition => <option key={transition} value={transition}>{labelOf(transition)}</option>)}
      </select>
    </label>)}
    <NumberField name="Transition Seconds" value={value.transitionDuration} min={0} max={5} step={0.05}
      change={transitionDuration => change({ transitionDuration })} />
  </div>;
}

export function VideoPresentationDialog({ value, change, close, pick, preview, songTitle, artist, titleDefault, missing }: {
  value: VideoPresentation; change(value: VideoPresentation): void; close(): void;
  pick(asset: PresentationAsset): Promise<void>; preview: ReactNode; songTitle: string; artist: string;
  titleDefault(value: TitleCardStyle): void; missing: boolean;
}) {
  const [section, setSection] = useState<'title' | 'logo' | 'clips' | 'preview'>('title');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => { modal.current?.showModal(); }, []);
  const { titleCard, logo } = value;
  const title = (update: Partial<typeof titleCard>) => change(normalizeVideoPresentation({ ...value, titleCard: { ...titleCard, ...update } }));
  const logoStyle = (update: Partial<typeof logo>) => change(normalizeVideoPresentation({ ...value, logo: { ...logo, ...update } }));
  const animation = (key: Animation, update: Partial<VideoAnimation>) =>
    change(normalizeVideoPresentation({ ...value, [key]: { ...value[key], ...update } }));
  const choose = async (asset: PresentationAsset) => {
    setPicking(true); setError('');
    try { await pick(asset); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPicking(false); }
  };

  return <dialog ref={modal} className="settings-card presentation-dialog" aria-labelledby="presentation-title"
    onCancel={event => { event.preventDefault(); if (!picking) close(); }}>
    <div className="row spaced">
      <h2 id="presentation-title">Video Presentation</h2>
      <button autoFocus type="button" disabled={picking} onClick={close}>Close</button>
    </div>
    <nav className="preferences-nav toolbar" aria-label="Video presentation sections">
      {([['title', 'Title Screens'], ['logo', 'Overlay Logo'], ['clips', 'Animations'], ['preview', 'Preview Video']] as const)
        .map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} disabled={picking} onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="error">{error}</p>}
    {missing && <p className="error" role="status">A presentation file is missing. Restore it or select a replacement.</p>}
    {section === 'title' && <div className="stack">
      <TitlePresetControls value={titleCard} onChange={next => change({ ...value, titleCard: next })} onDefaultSaved={titleDefault} />
      <div className="settings-group">
        <label className="row"><input type="checkbox" checked={titleCard.enabled} onChange={event => title({ enabled: event.target.checked })} /> Show Title Screens</label>
        <div className="presentation-fields">
          <label className="field-label">Placement<select value={titleCard.placement} onChange={event => title({ placement: event.target.value as typeof titleCard.placement })}>
            <option value="both">Opening and Closing</option><option value="opening">Opening Only</option><option value="closing">Closing Only</option>
          </select></label>
          <NumberField name="Display Seconds" value={titleCard.duration} min={1} max={60} step={0.1} change={duration => title({ duration })} />
          <label className="field-label">Text Alignment<select value={titleCard.align} onChange={event => title({ align: event.target.value as typeof titleCard.align })}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select></label>
        </div>
        <div className="presentation-fields">
          <label className="field-label">Title<input maxLength={200} placeholder={songTitle || 'Song title'} value={titleCard.title} onChange={event => title({ title: event.target.value })} /></label>
          <label className="field-label">Subtitle<input maxLength={200} placeholder={artist || 'Artist'} value={titleCard.subtitle} onChange={event => title({ subtitle: event.target.value })} /></label>
          <label className="field-label">Font<select value={titleCard.font} onChange={event => title({ font: event.target.value as typeof titleCard.font })}>
            <option value="lyrics">Match Lyric Font</option><option value="sans">Sans Serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
          </select></label>
          <NumberField name="Title Size" value={titleCard.titleSize} min={24} max={250} change={titleSize => title({ titleSize })} />
          <NumberField name="Subtitle Size" value={titleCard.subtitleSize} min={14} max={150} change={subtitleSize => title({ subtitleSize })} />
          <NumberField name="Vertical Position (%)" value={titleCard.vertical} min={15} max={85} change={vertical => title({ vertical })} />
          <ColorField label="Title Color" value={titleCard.textColor} change={textColor => title({ textColor })} />
          <ColorField label="Subtitle Color" value={titleCard.subtitleColor} change={subtitleColor => title({ subtitleColor })} />
          <ColorField label="Background Color" value={titleCard.backgroundColor} change={backgroundColor => title({ backgroundColor })} />
        </div>
        <label className="row"><input type="checkbox" checked={titleCard.allCaps} onChange={event => title({ allCaps: event.target.checked })} /> All Caps</label>
        <Transitions value={titleCard} change={title} />
      </div>
    </div>}
    {section === 'logo' && <div className="stack">
      <div className="toolbar">
        <button type="button" disabled={picking} onClick={() => void choose('logo')}>{logo.path ? 'Change Logo…' : 'Choose Logo…'}</button>
        {logo.path && <><span className="muted" title={logo.path}>{nameOf(logo.path)}</span><button type="button" disabled={picking} onClick={() => logoStyle({ path: null })}>Remove</button></>}
      </div>
      <div className="presentation-fields">
        <label className="field-label">Corner<select value={logo.corner} onChange={event => logoStyle({ corner: event.target.value as typeof logo.corner })}>
          {logoCorners.map(corner => <option key={corner} value={corner}>{labelOf(corner)}</option>)}
        </select></label>
        <NumberField name="Width (% of frame)" value={logo.width} min={2} max={70} change={width => logoStyle({ width })} />
        <NumberField name="Horizontal Padding (%)" value={logo.offsetX} min={0} max={30} step={0.1} change={offsetX => logoStyle({ offsetX })} />
        <NumberField name="Vertical Padding (%)" value={logo.offsetY} min={0} max={30} step={0.1} change={offsetY => logoStyle({ offsetY })} />
        <NumberField name="Opacity (%)" value={logo.opacity * 100} min={0} max={100} change={opacity => logoStyle({ opacity: opacity / 100 })} />
      </div>
    </div>}
    {section === 'clips' && <div className="stack">
      {(['openingAnimation', 'closingAnimation'] as const).map(key => {
        const clip = value[key];
        return <div className="settings-group" key={key}>
          <h3>{key === 'openingAnimation' ? 'Opening Animation' : 'Closing Animation'}</h3>
          <div className="toolbar">
            <button type="button" disabled={picking} onClick={() => void choose(key)}>{clip.path ? 'Change Video…' : 'Choose Video…'}</button>
            {clip.path && <><span className="muted" title={clip.path}>{nameOf(clip.path)}</span>
              <button type="button" disabled={picking} onClick={() => animation(key, { path: null, duration: 0 })}>Remove</button></>}
            {key === 'closingAnimation' && value.openingAnimation.path && !clip.path && <button type="button" disabled={picking}
              onClick={() => animation(key, { path: value.openingAnimation.path, duration: value.openingAnimation.duration })}>Use Opening Video</button>}
          </div>
          <div className="presentation-fields">
            <NumberField name="Playback Speed (×)" value={clip.speed} min={0.25} max={4} step={0.05} change={speed => animation(key, { speed })} />
            <label className="row"><input type="checkbox" checked={clip.muted} onChange={event => animation(key, { muted: event.target.checked })} /> Remove Animation Audio</label>
          </div>
          <Transitions value={clip} change={update => animation(key, update)} />
        </div>;
      })}
    </div>}
    {section === 'preview' && preview}
  </dialog>;
}
