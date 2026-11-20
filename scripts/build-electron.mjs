import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist-electron', { recursive: true });
await Promise.all([
  copyFile('src/main/preload.cjs', 'dist-electron/preload.cjs'),
  build({
    entryPoints: ['src/main/main.cjs'],
    outfile: 'dist-electron/main.cjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    external: ['electron'],
  }),
  build({
    entryPoints: ['src/cli/cli.mjs'],
    outfile: 'dist-electron/cli.cjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    banner: { js: '#!/usr/bin/env node' },
  }),
]);
