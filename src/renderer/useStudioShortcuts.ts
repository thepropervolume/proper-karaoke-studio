/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_STUDIO_SHORTCUTS, type StudioShortcuts } from '../domain/studio-shortcuts';

export function useStudioShortcuts(): [StudioShortcuts, (value: StudioShortcuts) => Promise<void>] {
  const [shortcuts, setShortcuts] = useState(DEFAULT_STUDIO_SHORTCUTS);
  useEffect(() => {
    let stale = false;
    const unsubscribe = window.studio.onStudioShortcutsChanged(state => {
      stale = true;
      setShortcuts(state.value);
    });
    void window.studio.getStudioShortcuts().then(state => {
      if (!stale) setShortcuts(state.value);
    }).catch(() => { /* Defaults remain usable; Preferences can report the file error. */ });
    return () => { stale = true; unsubscribe(); };
  }, []);
  const save = useCallback(async (value: StudioShortcuts) => {
    setShortcuts((await window.studio.saveStudioShortcuts(value)).value);
  }, []);
  return [shortcuts, save];
}
