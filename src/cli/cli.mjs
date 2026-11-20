import { spawn } from 'node:child_process';
import { access, mkdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import operations from '../main/studio-operations.cjs';
import ktools from '../main/ktools.cjs';
import kitImport from '../main/kit-import.cjs';
import { applyForcedAlignment } from '../domain/forced-alignment.ts';
import { toAss, toLrc, toLyricsJson, toSrt } from '../domain/lyrics-formats.ts';
import { toPortableKitProject } from '../domain/project.ts';
import { addProjectStems, loadProject, projectCommand, projectFile, projectRevision, saveProject } from './project-commands.mjs';
import { version } from '../../package.json';

const commands = {
  'project init': ' [--title <title>] [--artist <artist>] [--duration <seconds>] [--force]',
  'project info': '',
  'project open': ' [--app <desktop-executable>]',
  'project import-kit': ' <kit.tpvkit>',
  'project metadata': ' [--title <title>] [--artist <artist>] [--duration <seconds>]',
  'project backdrop': ' <image> | --clear',
  'stems add': ' <audio...> [--role <role>] [--voice <name>] [--name <name>] [--volume <gain>] [--duration <seconds>] [--ffmpeg <exe>]',
  'stems list': '',
  'stems edit': ' <stem> [--path <audio>] [--role <role>] [--voice <name>] [--name <name>] [--volume <gain>] [--duration <seconds>] [--ffmpeg <exe>]',
  'stems remove': ' <stem...>',
  'stems separate': ' <audio> --output-dir <directory> [--add] [--executable <exe>] [--model <model>] [--ffmpeg <exe>]',
  'lyrics import': ' <file>',
  'lyrics show': ' [<line>]',
  'lyrics set': ' <text-file> | --text <lyrics>',
  'lyrics line': ' <line> [--text <text>] [--start <seconds>] [--end <seconds>]',
  'lyrics word': ' <line> <word> [--start <seconds>] [--end <seconds>]',
  'lyrics download': ' [--artist <artist>] [--title <title>] [--album <album>] [--duration <seconds>] [--source <source>] [--output-dir <directory>] [--ktools-home <directory>] [--python <exe>] [--input-lyrics <file>] [--no-format] [--force] [--import] [--use <plain|formatted|synced>]',
  'lyrics align': ' [--audio <file>] [--language <code>] [--python <exe>]',
  'export lyrics': ' <json|lrc|srt|cdg> --output <file> [--force] [--original] [--ffmpeg <exe>]',
  'export video': ' --output <file> [--ffmpeg <exe>] [--force]',
  'export kit': ' --output <file> [--force]',
  'settings show': '',
  'settings set': ' <key> <value>',
};

const booleanOptions = new Set(['help', 'json', 'force', 'add', 'import', 'no-format', 'clear', 'original']);
const settingsKeys = Object.keys(operations.defaultSettings);
const help = 'The Proper Volume Karaoke Studio ' + version + '\n\n' +
  'Usage: tpv-studio [--project <file>] [--settings <file>] [--json] <command>\n\n' +
  Object.entries(commands).map(([command, syntax]) => '  ' + command + syntax).join('\n') + '\n\n' +
  'Project default: studio.tpv.json in the current directory. Use --help after a command for its options.\n';

function parse(argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true });
  } catch (error) {
    error.exitCode = 2;
    throw error;
  }
}

function optionDefinitions(names) {
  return Object.fromEntries(names.map(name => [name, { type: booleanOptions.has(name) ? 'boolean' : 'string' }]));
}

function usage(message) {
  throw Object.assign(new Error(message), { exitCode: 2 });
}

function requiredOption(options, name) {
  if (!options[name]?.trim()) usage('Provide --' + name + '.');
  return options[name];
}

function positionals(args, count) {
  if (args.positional.length !== count) usage('Use --help after the command for its arguments.');
}

function settingsFile(options) {
  if (options.settings) return path.resolve(options.settings);
  const directory = process.platform === 'win32'
    ? process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin' ? path.join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(directory, 'tpv-karaoke-studio-cli', 'settings.json');
}

function lyricContents(project) {
  const { title, artist, durationSeconds, lyrics } = project;
  return {
    json: toLyricsJson(title, artist, durationSeconds, lyrics),
    lrc: toLrc(title, artist, lyrics),
    srt: toSrt(lyrics),
  };
}

async function exportProject(action, args, settings) {
  positionals(args, action === 'lyrics' ? 1 : 0);
  const destination = path.resolve(requiredOption(args.options, 'output'));
  const file = projectFile(args);
  const project = await loadProject(file);
  const protectedFiles = [file, settingsFile(args.options), project.backgroundPath, project.importedCdg, ...project.stems.map(stem => stem.path)];
  const resolvedDestination = await realpath(destination).catch(() => destination);
  const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  for (const input of protectedFiles.filter(Boolean)) {
    const resolvedInput = await realpath(input).catch(() => input);
    if (samePath(resolvedInput, resolvedDestination)) throw new Error('Choose an output path different from project, settings, and source files.');
  }
  const overwrite = Boolean(args.options.force);
  if (!overwrite && await access(destination).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) throw new Error('Output already exists. Pass --force to replace it.');
  if (action === 'lyrics') {
    const format = args.positional[0] === 'elrc' ? 'lrc' : args.positional[0];
    if (format === 'cdg') {
      if (args.options.original || !project.lyrics.length) {
        if (!project.importedCdg) throw new Error('Attach an original CD+G file or add timed lyric cues first.');
        await operations.exportCdg({ cdgPath: project.importedCdg }, destination, overwrite);
      } else {
        const duration = project.durationSeconds || project.lyrics.reduce((end, line) => Math.max(end, line.endSeconds), 0);
        await operations.exportCdg({
          duration,
          ass: toAss(project.title, project.artist, duration, project.lyrics, 'cdg'),
          ffmpegPath: args.options.ffmpeg || settings.ffmpegPath,
        }, destination, overwrite);
      }
    } else {
      if (!['json', 'lrc', 'srt'].includes(format)) usage('Choose json, lrc, srt, or cdg.');
      if (args.options.original || args.options.ffmpeg) usage('--original and --ffmpeg apply to CD+G export.');
      await operations.writeOutput(destination, overwrite, file => writeFile(file, lyricContents(project)[format], 'utf8'));
    }
  } else if (action === 'video') {
    await operations.exportVideo({
      title: project.title,
      artist: project.artist,
      duration: project.durationSeconds,
      stems: project.stems,
      backgroundPath: project.backgroundPath,
      cdgPath: project.lyrics.length ? null : project.importedCdg,
      ffmpegPath: args.options.ffmpeg || settings.ffmpegPath,
      ass: toAss(project.title, project.artist, project.durationSeconds, project.lyrics),
    }, destination, overwrite);
  } else {
    const { json, lrc, srt } = lyricContents(project);
    await operations.exportKit({
      manifest: JSON.stringify(toPortableKitProject(project), null, 2),
      lyrics: { 'lyrics.json': json, 'lyrics.enhanced.lrc': lrc, 'lyrics.srt': srt },
      stems: project.stems,
      cdgPath: project.importedCdg,
    }, destination, overwrite);
  }
  return { output: destination };
}

async function fetchLyrics(args, dependencies) {
  positionals(args, 0);
  const { options } = args;
  const file = projectFile(args);
  const needsProject = options.project || options.import || !options.artist || !options.title;
  const project = needsProject ? await loadProject(file).catch(error => {
    if (!options.project && !options.import && error.code === 'ENOENT') return null;
    throw error;
  }) : null;
  const use = options.use || 'auto';
  if (!['auto', 'plain', 'formatted', 'synced'].includes(use)) usage('Choose plain, formatted, or synced for --use.');
  if (options.use && !options.import) usage('--use requires --import.');
  const duration = options.duration === undefined ? project?.durationSeconds || undefined : Number(options.duration);
  const result = await ktools.downloadLyrics({
    artist: options.artist ?? project?.artist,
    title: options.title ?? project?.title,
    album: options.album,
    duration,
    source: options.source,
    outputDirectory: options['output-dir'] || path.resolve('lyrics'),
    ktoolsHome: options['ktools-home'],
    python: options.python,
    inputLyrics: options['input-lyrics'],
    noFormat: options['no-format'],
    force: options.force,
  });
  if (!options.import) return result;
  const selected = use === 'auto'
    ? (result.synced_timing_verified && result.synced_file) || result.plain_file
    : result[use + '_file'];
  if (!selected) throw new Error('The requested lyrics were unavailable. See the download manifest at ' + result.manifest_file + '.');
  try {
    const imported = await projectCommand('lyrics', 'import', {
      positional: [selected],
      options: { project: file },
    }, { ...dependencies, expectedRevision: projectRevision(project) });
    return { ...result, importedFile: selected, project: file, imported };
  } catch (error) {
    throw new Error('Lyrics downloaded, but import failed. See ' + result.manifest_file + '. ' + error.message);
  }
}

async function align(args, settings) {
  positionals(args, 0);
  const file = projectFile(args);
  const project = await loadProject(file);
  if (!project.lyrics.length) throw new Error('Import or set the lyrics before aligning.');
  const candidate = project.stems.find(stem => stem.role === 'lead') || project.stems.find(stem => stem.role !== 'instrumental');
  const audioPath = args.options.audio ? path.resolve(args.options.audio) : candidate?.path;
  if (!audioPath) usage('Select a vocal or original audio file with --audio.');
  const packagedScript = path.join(__dirname, 'scripts', 'align_lyrics.py');
  const script = await access(packagedScript).then(() => packagedScript, () => path.join(__dirname, '..', 'scripts', 'align_lyrics.py'));
  const result = await operations.alignLyrics({
    audioPath,
    language: args.options.language || settings.alignmentLanguage,
    executable: args.options.python || settings.lyricAlignerExecutable,
    lyrics: project.lyrics.map(line => line.text),
  }, script);
  const lyrics = applyForcedAlignment(project.lyrics, result.words, result.duration);
  const durationSeconds = project.durationSeconds || result.duration;
  await saveProject(file, { ...project, lyrics, durationSeconds }, { expectedRevision: projectRevision(project) });
  return { project: file, audio: audioPath, alignedWords: result.words.length };
}

async function separate(args, settings, dependencies) {
  positionals(args, 1);
  const file = projectFile(args);
  const project = args.options.add ? await loadProject(file) : null;
  const directory = path.resolve(requiredOption(args.options, 'output-dir'));
  await mkdir(directory, { recursive: true });
  const result = await operations.separate({
    sourcePath: path.resolve(args.positional[0]),
    executable: args.options.executable || settings.separatorExecutable,
    model: args.options.model || settings.separatorModel,
  }, directory);
  if (project) {
    try {
      const updated = await addProjectStems(project, result.files, { ...dependencies, ffmpegPath: args.options.ffmpeg || settings.ffmpegPath });
      await saveProject(file, updated, { expectedRevision: projectRevision(project) });
    } catch (error) {
      throw new Error('Stems were saved in ' + result.outputDirectory + ', but were not added to the project. ' + error.message);
    }
  }
  return { ...result, project: project ? file : null };
}

async function openDesktop(args) {
  positionals(args, 0);
  const file = projectFile(args);
  await loadProject(file);

  const root = path.join(__dirname, '..');
  const electronDirectory = path.join(root, 'node_modules', 'electron', 'dist');
  const product = 'The Proper Volume Karaoke Studio';
  const candidates = args.options.app ? [[path.resolve(args.options.app), []]] : process.platform === 'win32'
    ? [[path.join(root, product + '.exe'), []], [path.join(electronDirectory, 'electron.exe'), [root]]]
    : process.platform === 'darwin'
      ? [[path.join(root, 'MacOS', product), []], [path.join(electronDirectory, 'Electron.app', 'Contents', 'MacOS', 'Electron'), [root]]]
      : [[path.join(root, 'proper-karaoke-studio'), []], [path.join(electronDirectory, 'electron'), [root]]];
  for (const [executable, prefix] of candidates) {
    const available = await access(executable).then(() => true, () => false);
    if (!available) continue;
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [...prefix, '--studio-project=' + file], { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    return { project: file, executable };
  }
  throw new Error('Desktop Studio was not found. Set --app to the installed executable.');
}

async function dispatch(command, args) {
  const [group, action] = command.split(' ');
  const preferences = settingsFile(args.options);
  const settings = operations.loadSettings(preferences);
  const dependencies = { probeAudio: (file, executable) => operations.probeAudio(file, executable || settings.ffmpegPath) };
  if (group === 'settings') {
    positionals(args, action === 'show' ? 0 : 2);
    if (action === 'show') return { path: preferences, settings };
    const [key, value] = args.positional;
    if (!settingsKeys.includes(key)) usage('Choose a setting: ' + settingsKeys.join(', '));
    return { path: preferences, settings: operations.saveSettings(preferences, { ...settings, [key]: value }) };
  }
  if (group === 'export') return exportProject(action, args, settings);
  if (command === 'project open') return openDesktop(args);
  if (command === 'project import-kit') {
    positionals(args, 1);
    const { file, project, mediaDirectory } = await kitImport.importKit(args.positional[0], projectFile(args));
    return { projectPath: file, project, mediaDirectory };
  }
  if (command === 'stems separate') return separate(args, settings, dependencies);
  if (command === 'lyrics download') return fetchLyrics(args, dependencies);
  if (command === 'lyrics align') return align(args, settings);
  return projectCommand(group, action, args, dependencies);
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--version') { console.log(version); return; }
  if (!argv.length || (argv.length === 1 && ['--help', 'help', '-h'].includes(argv[0]))) { console.log(help); return; }
  // Discover command position while leaving validation to the command-specific parser.
  const [group, action] = parseArgs({ args: argv, options: optionDefinitions([
    'project', 'settings', 'json', 'help',
    ...Object.values(commands).flatMap(syntax => [...syntax.matchAll(/--([a-z-]+)/g)].map(match => match[1])),
  ]), strict: false, allowPositionals: true }).positionals;
  const command = group + ' ' + action;
  if (!Object.hasOwn(commands, command)) usage('Unknown command. Run tpv-studio --help.');
  const names = [...commands[command].matchAll(/--([a-z-]+)/g)].map(match => match[1]);
  const parsed = parse(argv, optionDefinitions(['project', 'settings', 'json', 'help', ...names]));
  if (parsed.values.help) { console.log('Usage: tpv-studio ' + command + commands[command] + ' [--project <file>] [--settings <file>] [--json]'); return; }
  const result = await dispatch(command, { positional: parsed.positionals.slice(2), options: parsed.values });
  console.log(JSON.stringify(result, null, parsed.values.json ? undefined : 2));
}

const argv = process.argv.slice(2);
main(argv).catch(error => {
  const exitCode = error.exitCode || (error.code?.startsWith('ERR_PARSE_ARGS_') ? 2 : 1);
  const message = error instanceof Error ? error.message : String(error);
  console.error(argv.includes('--json') ? JSON.stringify({ error: message, exitCode }) : 'TPV Studio: ' + message);
  process.exitCode = exitCode;
});
