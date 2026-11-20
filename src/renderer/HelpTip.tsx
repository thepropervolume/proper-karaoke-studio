/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { useId } from 'react';

export function HelpTip({ label, children }: { label: string; children: string }) {
  const id = useId();
  return <span className="help-tip">
    <button type="button" className="help-trigger" aria-label={'About ' + label} aria-describedby={id}>?</button>
    <span id={id} className="help-message" role="tooltip">{children}</span>
  </span>;
}
