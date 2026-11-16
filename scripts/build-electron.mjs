import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist-electron', { recursive: true });
for (const name of ['main.cjs', 'preload.cjs']) await copyFile('src/main/' + name, 'dist-electron/' + name);
