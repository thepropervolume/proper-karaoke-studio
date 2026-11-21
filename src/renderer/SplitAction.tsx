/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { useEffect, useId, useRef, useState } from 'react';
import { StudioIcon } from './StudioIcon';

type Action = { label: string; help: string; run(): void };

export function SplitAction({ primary, alternatives, menuLabel, upward = false, emphasized = false, disabled = false }: {
  primary: Action; alternatives: Action[]; menuLabel: string; upward?: boolean; emphasized?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const caret = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menu.current?.querySelector('button')?.focus();
  }, [open]);

  function dismiss() {
    caret.current?.focus();
    setOpen(false);
  }

  return <div className={'split-action' + (upward ? ' split-action-upward' : '')}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); dismiss();
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...(menu.current?.querySelectorAll('button') ?? [])];
      if (!buttons.length) return;
      const current = buttons.findIndex(button => button === document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    <button type="button" className={emphasized ? 'primary' : ''} data-tip={primary.help} disabled={disabled} onClick={primary.run}>{primary.label}</button>
    <button ref={caret} type="button" className={'split-action-caret' + (emphasized ? ' primary' : '')}
      aria-label={menuLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={id} data-tip={menuLabel}
      disabled={disabled} onKeyDown={event => {
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault(); setOpen(true);
        }
      }} onClick={() => setOpen(previous => !previous)}>
      <StudioIcon name="chevronDown" />
    </button>
    {open && <div className="split-action-menu" id={id} ref={menu} role="menu" aria-label={menuLabel}>
      {alternatives.map(action => <button key={action.label} type="button" role="menuitem" data-tip={action.help}
        onClick={() => { dismiss(); action.run(); }}>{action.label}</button>)}
    </div>}
  </div>;
}
