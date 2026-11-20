import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const target = 'tpv-studio-release@apps.thepropervolume.com';
const downloadBase = 'https://release.thepropervolume.com/studio';
const assets = {
  'windows-x64': ['-setup.exe', '.zip'],
  'linux-x64': ['.AppImage', '.deb'],
  'macos-arm64': ['.dmg', '.zip'],
  'macos-x64': ['.dmg', '.zip'],
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(command + ' failed (' + (result.signal || result.status) + ')' + (detail ? '. ' + detail : '.'));
  }
  return result.stdout?.toString().trim();
}

function files(platform) {
  if (!Object.hasOwn(assets, platform)) throw new Error('Choose a platform: ' + Object.keys(assets).join(', '));
  return assets[platform].map(suffix => {
    const extension = suffix === '-setup.exe' ? '.exe' : suffix;
    return { name: 'tpv-karaoke-studio-' + version + '-' + platform + suffix, extension };
  });
}

function outputDirectory(platform) {
  return join(root, 'release', 'staged', platform);
}

async function validate(file, extension) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 512) throw new Error('Missing or incomplete package: ' + file);
  const prefix = {
    '.exe': Buffer.from('MZ'),
    '.zip': Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    '.AppImage': Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    '.deb': Buffer.from('!<arch>\n'),
    '.dmg': Buffer.from('koly'),
  }[extension];
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(prefix.length);
    const offset = extension === '.dmg' ? info.size - 512 : 0;
    await handle.read(buffer, 0, prefix.length, offset);
    if (!buffer.equals(prefix)) throw new Error('Unexpected file format: ' + file);
  } finally {
    await handle.close();
  }
}

async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepare(platform, inputFolder) {
  const expected = files(platform);
  const input = resolve(inputFolder || join(root, 'release', platform));
  const entries = await readdir(input, { withFileTypes: true });
  const output = outputDirectory(platform);
  const pairs = await Promise.all(expected.map(async ({ name, extension }) => {
    const matches = entries.filter(entry =>
      entry.isFile() && entry.name.includes(version) && entry.name.toLowerCase().endsWith(extension.toLowerCase()));
    if (matches.length !== 1) throw new Error('Expected one ' + extension + ' package for ' + version + ' in ' + input + '.');
    const source = join(input, matches[0].name);
    await validate(source, extension);
    return { source, name };
  }));
  await mkdir(output, { recursive: true });
  const sums = [];
  for (const { source, name } of pairs) {
    const destination = join(output, name);
    if (source !== destination) await copyFile(source, destination);
    sums.push(await checksum(destination) + '  ' + name);
  }
  await writeFile(join(output, 'SHA256SUMS'), sums.join('\n') + '\n', 'utf8');
  console.log('Prepared ' + platform + ' release files in ' + output);
}

function restrictWindowsKey(file) {
  if (process.platform !== 'win32') return;
  const sid = run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { stdio: 'pipe' }).match(/S-1-[\d-]+/i)?.[0];
  if (!sid) throw new Error('Could not identify the Windows SSH key owner.');
  run('icacls.exe', [file, '/inheritance:r', '/grant:r', '*' + sid + ':(R)'], { stdio: 'pipe' });
}

async function connect(args, makeBatch) {
  const admin = process.env.STUDIO_RELEASE_SERVER_ADMIN === '1';
  const key = process.env.STUDIO_RELEASE_SSH_KEY;
  const hosts = process.env.STUDIO_RELEASE_SSH_KNOWN_HOSTS;
  if (!admin && (!key?.trim() || !hosts?.trim())) {
    throw new Error('Use authorized server SSH or set STUDIO_RELEASE_SSH_KEY and STUDIO_RELEASE_SSH_KNOWN_HOSTS.');
  }
  const temporaryRoot = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'tpv-studio-upload-'));
  if (dirname(temporary) !== temporaryRoot) throw new Error('Unexpected release scratch directory.');
  const identity = join(temporary, 'studio_release');
  const knownHosts = join(temporary, 'known_hosts');
  let input;
  try {
    if (makeBatch) input = openSync(await makeBatch(temporary), 'r');
    let connection;
    if (admin) {
      // An existing verified admin identity can invoke the same restricted
      // publisher as the release user. No release signing key leaves the host.
      connection = ['root@apps.thepropervolume.com', 'runuser -u tpv-studio-release -- python3 /opt/tpv-studio-releases/release-command.py ' + args.join(' ')];
    } else {
      await writeFile(identity, key.trim().replace(/\r\n/g, '\n') + '\n', { mode: 0o600 });
      await writeFile(knownHosts, hosts.trim().replace(/\r\n/g, '\n') + '\n', { mode: 0o600 });
      restrictWindowsKey(identity);
      const pinnedHosts = knownHosts.replaceAll('\\', '/');
      connection = ['-F', 'none', '-p', '22', '-i', identity, '-o', 'IdentitiesOnly=yes',
        '-o', 'GlobalKnownHostsFile=none', '-o', 'UserKnownHostsFile="' + pinnedHosts + '"', target, args.join(' ')];
    }
    run('ssh', [
      '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=30', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=4',
      ...connection,
    ], { stdio: [input ?? 'ignore', 'inherit', 'inherit'] });
  } finally {
    if (input !== undefined) closeSync(input);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function stage(platform, commit) {
  const expected = files(platform);
  const directory = outputDirectory(platform);
  await Promise.all(expected.map(({ name, extension }) => validate(join(directory, name), extension)));
  await connect(['stage', version, commit, platform], async temporary => {
    const batch = join(temporary, 'batch.tar');
    // Explicit names and USTAR keep the payload portable and flat. The server checks those names again.
    const file = openSync(batch, 'wx', 0o600);
    try {
      run('tar', ['--format=ustar', '-cf', '-', ...expected.map(({ name }) => name)], {
        cwd: directory, stdio: ['ignore', file, 'inherit'],
      });
    } finally {
      closeSync(file);
    }
    return batch;
  });
}

async function verifyPublished(commit, allowPartial) {
  const releaseUrl = downloadBase + '/v' + version + '/';
  const response = await fetch(releaseUrl + 'release-manifest.json', {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Could not read the published Studio manifest (HTTP ' + response.status + ').');
  const manifest = await response.json();
  if (manifest.version !== version || manifest.sourceCommit !== commit || !Array.isArray(manifest.assets)
      || !manifest.assets.length || manifest.assets.some(asset => !Object.hasOwn(assets, asset.platform))) {
    throw new Error('The public Studio manifest does not match the completed release.');
  }
  const platforms = allowPartial ? [...new Set(manifest.assets.map(asset => asset.platform))] : Object.keys(assets);
  const expected = platforms.flatMap(platform => files(platform).map(file => file.name));
  if (manifest.partial !== (platforms.length < Object.keys(assets).length) || manifest.assets.length !== expected.length) {
    throw new Error('The public Studio manifest is missing expected packages.');
  }
  for (const name of expected) {
    const asset = manifest.assets.find(entry => entry.name === name);
    if (!asset || !Number.isSafeInteger(asset.bytes) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error('Missing package or SHA-256 in the public manifest: ' + name);
    }
    const result = await fetch(releaseUrl + encodeURIComponent(name), {
      method: 'HEAD',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!result.ok || Number(result.headers.get('content-length')) !== asset.bytes) {
      throw new Error('Public package size does not match the manifest: ' + name);
    }
  }
  console.log('Verified ' + expected.length + ' Studio download URLs at ' + releaseUrl);
}

async function main() {
  const [command, platform, input] = process.argv.slice(2);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Expected a stable numeric version in package.json.');
  }
  if (command === 'prepare') return prepare(platform, input);
  if (!['stage', 'publish', 'publish-available', 'verify', 'verify-available'].includes(command)) {
    throw new Error('Use prepare <platform> [build-directory], stage <platform>, publish, publish-available, verify, or verify-available.');
  }
  const commit = run('git', ['rev-parse', '--verify', '--end-of-options', (process.env.STUDIO_RELEASE_COMMIT || 'HEAD') + '^{commit}'], { cwd: root, stdio: 'pipe' });
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected a full Git commit ID.');
  if (command === 'stage') return stage(platform, commit);
  if (platform !== undefined) throw new Error(command + ' accepts no arguments.');
  if (command.startsWith('publish')) await connect([command, version, commit]);
  return verifyPublished(commit, command.endsWith('-available'));
}

main().catch(error => {
  console.error('Studio release: ' + error.message);
  process.exitCode = 1;
});
