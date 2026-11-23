/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */

export const studioUpdateModes = ['notify', 'download', 'install', 'off'] as const;
export type StudioUpdateMode = typeof studioUpdateModes[number];

export function isStudioUpdateMode(value: unknown): value is StudioUpdateMode {
  return typeof value === 'string' && (studioUpdateModes as readonly string[]).includes(value);
}
