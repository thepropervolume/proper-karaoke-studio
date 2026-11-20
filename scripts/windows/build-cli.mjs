import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Build Windows Studio packages on Windows.');

const source = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(source, '../../dist-electron/windows-cli');
const windows = process.env.WINDIR ?? 'C:\\Windows';
const tools = ['Framework64', 'Framework'].map(platform =>
  path.join(windows, 'Microsoft.NET', platform, 'v4.0.30319', 'csc.exe'));
const available = await Promise.all(tools.map(tool => access(tool).then(() => true, () => false)));
const compiler = tools[available.indexOf(true)];
if (!compiler) throw new Error('The Windows .NET Framework 4 C# compiler is required to build the Studio CLI launcher.');
await mkdir(output, { recursive: true });

for (const [file, executable] of [
  ['cli-launcher.cs', 'tpv-karaoke-studio.exe'],
  ['cli-path.cs', 'studio-path.exe'],
]) {
  const result = spawnSync(compiler, ['/nologo', '/optimize+', '/warnaserror', '/target:exe',
    '/platform:anycpu', '/out:' + path.join(output, executable), path.join(source, file)],
  { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
