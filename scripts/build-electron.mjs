import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

const noticesDir = 'dist-electron/licenses';
await mkdir(noticesDir, { recursive: true });

const bundledPackages = [
  'buffer-crc32', 'pend', 'react', 'react-dom', 'scheduler', 'xmlchars', 'yauzl', 'yazl',
];

// esbuild and Vite inline dependencies, so their source notices must travel
// with the executable even when the original packages are absent at runtime.
await Promise.all([
  ...['LICENSE', 'LICENSING.md', 'TRADEMARKS.md'].map(file => copyFile(file, `${noticesDir}/${file}`)),
  ...bundledPackages.map(name => copyFile(`node_modules/${name}/LICENSE`, `${noticesDir}/${name}-LICENSE`)),
  copyFile('assets/licenses/saxes-6.0.0-LICENSE', `${noticesDir}/saxes-LICENSE`),
  copyFile('node_modules/@thepropervolume/karaoke-core/LICENSING.md', `${noticesDir}/karaoke-core-LICENSING.md`),
]);
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
