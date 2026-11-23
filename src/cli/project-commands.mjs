import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { newLyricLines, seedTimedWords } from '../domain/project.ts';
import { editLyricTimingText } from '../domain/lyric-timing-text.ts';
import { parseLyricsFile, parseStamp } from '../domain/lyrics-formats.ts';
import { mapJsonLyrics } from '../domain/json-lyric-mapping.ts';
import { loadProject, projectRevision, projectSchema, saveProject, stemRoles } from '../domain/project-file.mjs';
import operations from '../main/studio-operations.cjs';

export { loadProject, projectRevision, saveProject } from '../domain/project-file.mjs';

const { AUDIO_EXTENSIONS: audioExtensions, BACKGROUND_EXTENSIONS: backgroundExtensions } = operations;
const stemLimit = 24;

function option(options, name) {
  const value = options[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`--${name} needs a value.`);
  return value;
}

function flag(options, name) {
  const value = options[name];
  if (value === undefined) return false;
  if (value !== true) throw new Error(`--${name} is a switch and takes no value.`);
  return true;
}

function count(positionals, min, max, usage) {
  if (positionals.length < min || positionals.length > max) {
    throw new Error(`Usage: ${usage}`);
  }
}

function number(value, label, max = Infinity) {
  const result = typeof value === 'number' ? value : Number(value);
  if (value === '' || (typeof value === 'string' && !value.trim()) || !Number.isFinite(result) || result < 0 || result > max) {
    throw new Error(max === Infinity ? `${label} must be a nonnegative number.` : `${label} must be between 0 and ${max}.`);
  }
  return result;
}

function timeOption(options, name) {
  const value = option(options, name);
  if (value === undefined) return undefined;
  return value.includes(':') ? parseStamp(value) : number(value, `--${name}`);
}

function withDuration(project) {
  return Math.max(project.durationSeconds, 0, ...project.stems.map(stem => stem.durationSeconds));
}

export function projectFile(args) {
  return resolve(option(args.options, 'project') ?? 'studio.tpv.json');
}

async function localFile(value, extensions, label) {
  const file = resolve(value);
  if (extensions && !extensions.has(extname(file).toLowerCase())) {
    throw new Error(`Unsupported ${label} file: ${file}`);
  }
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw new Error(`Expected a non-empty ${label} file: ${file}`);
  return file;
}

function roleOption(options) {
  const role = option(options, 'role');
  if (role !== undefined && !stemRoles.includes(role)) {
    throw new Error(`--role must be one of ${stemRoles.join(', ')}.`);
  }
  return role;
}

function volumeOption(options) {
  const value = option(options, 'volume');
  return value === undefined ? undefined : number(value, '--volume', 1);
}

function findIndex(items, key, label) {
  const byId = items.findIndex(item => item.id === key);
  if (byId !== -1) return byId;
  const index = /^[1-9]\d*$/.test(key) ? Number(key) - 1 : -1;
  if (index >= 0 && index < items.length) return index;
  throw new Error(`No ${label} matches "${key}". Use an ID or a one-based index.`);
}

export async function addProjectStems(project, files, options = {}) {
  const { probeAudio, ffmpegPath, role = 'other', voice = '', volume = 1, name, durationSeconds } = options;
  if (project.stems.length + files.length > stemLimit) {
    throw new Error(`Add up to ${stemLimit} stems per project.`);
  }
  if (name !== undefined && files.length !== 1) throw new Error('--name applies to a single stem.');
  const stems = [...project.stems];
  for (const source of files) {
    const path = await localFile(source, audioExtensions, 'audio');
    if (durationSeconds === undefined && !probeAudio) throw new Error('Set --duration or configure FFmpeg to measure the stem.');
    const duration = number(durationSeconds ?? await probeAudio(path, ffmpegPath), 'Stem duration');
    stems.push({ id: randomUUID(), name: name ?? basename(path), role, voice, path, durationSeconds: duration, volume });
  }
  const result = { ...project, stems };
  return { ...result, durationSeconds: withDuration(result) };
}

function withTiming(cue, options) {
  const startSeconds = timeOption(options, 'start') ?? cue.startSeconds;
  const endSeconds = timeOption(options, 'end') ?? cue.endSeconds;
  if (endSeconds < startSeconds) throw new Error('The cue end must be at or after its start.');
  return { ...cue, startSeconds, endSeconds };
}

function updateMetadata(project, options) {
  return {
    ...project,
    title: option(options, 'title') ?? project.title,
    artist: option(options, 'artist') ?? project.artist,
    durationSeconds: timeOption(options, 'duration') ?? project.durationSeconds,
  };
}

function parseJson(content, label) {
  try {
    return JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(label + ' must contain valid JSON.');
  }
}

async function importLyrics(project, source, mapping) {
  const input = await localFile(source, null, 'lyric');
  const extension = extname(input).toLowerCase();
  if (mapping !== undefined && extension !== '.json') throw new Error('--mapping requires a JSON lyrics file.');
  if (extension === '.cdg') {
    await operations.readCdg(input);
    return { ...project, importedCdg: input };
  }
  const contents = await readFile(input, 'utf8');
  if (extension === '.txt') return withUntimedLyrics(project, contents);
  const imported = mapping === undefined
    ? parseLyricsFile(input, contents.replace(/^\uFEFF/, ''))
    : mapJsonLyrics(
        parseJson(contents, 'Source lyrics'),
        parseJson(await readFile(await localFile(mapping, null, 'mapping'), 'utf8'), 'Lyrics mapping'),
      );
  if (!imported.lines.length) throw new Error('The file contains no timed lyrics. Import a .txt file for plain text.');
  return {
    ...project,
    title: imported.title || project.title,
    artist: imported.artist || project.artist,
    lyrics: imported.lines,
  };
}

function withUntimedLyrics(project, text) {
  const lyrics = newLyricLines(text.replace(/^\uFEFF/, ''), project.durationSeconds || 240);
  if (!lyrics.length) throw new Error('Provide at least one line of lyric text.');
  return { ...project, lyrics };
}

async function runProject(action, project, positional, options) {
  switch (action) {
    case 'metadata':
      count(positional, 0, 0, 'project metadata [--title <title>] [--artist <artist>] [--duration <seconds>]');
      return updateMetadata(project, options);
    case 'backdrop':
      count(positional, 0, 1, 'project backdrop <image-or-video> [--no-loop] | project backdrop --clear');
      if (flag(options, 'clear')) {
        if (positional.length || flag(options, 'no-loop')) throw new Error('Choose backdrop media or use --clear.');
        return { ...project, backgroundPath: null, backgroundLoop: true };
      }
      if (!positional.length) throw new Error('Choose a backdrop image or video, or use --clear.');
      return { ...project, backgroundPath: await localFile(positional[0], backgroundExtensions, 'backdrop'), backgroundLoop: !flag(options, 'no-loop') };
    default:
      throw new Error(`Unknown project action: ${action}`);
  }
}

async function runStems(action, project, positional, options, probeAudio) {
  switch (action) {
    case 'add':
      count(positional, 1, stemLimit, 'stems add <audio> [<audio> ...]');
      return addProjectStems(project, positional, {
        probeAudio, ffmpegPath: option(options, 'ffmpeg'), role: roleOption(options),
        voice: option(options, 'voice'), name: option(options, 'name'), volume: volumeOption(options),
        durationSeconds: timeOption(options, 'duration'),
      });
    case 'edit': {
      count(positional, 1, 1, 'stems edit <stem ID or index> [--role <role>] [--voice <voice>] [--volume <0–1>]');
      const index = findIndex(project.stems, positional[0], 'stem');
      const current = project.stems[index];
      const source = option(options, 'path');
      const path = source === undefined ? current.path : await localFile(source, audioExtensions, 'audio');
      let durationSeconds = timeOption(options, 'duration');
      if (durationSeconds === undefined && source !== undefined) {
        if (!probeAudio) throw new Error('Set --duration or configure FFmpeg to measure the stem.');
        durationSeconds = number(await probeAudio(path, option(options, 'ffmpeg')), 'Stem duration');
      }
      const stems = project.stems.slice();
      stems[index] = {
        ...current,
        path,
        name: option(options, 'name') ?? current.name,
        voice: option(options, 'voice') ?? current.voice,
        role: roleOption(options) ?? current.role,
        volume: volumeOption(options) ?? current.volume,
        durationSeconds: durationSeconds ?? current.durationSeconds,
      };
      const result = { ...project, stems };
      return { ...result, durationSeconds: withDurationAfterStemEdit(project, result) };
    }
    case 'remove': {
      count(positional, 1, stemLimit, 'stems remove <stem ID or index> [<stem ID or index> ...]');
      const indexes = new Set(positional.map(key => findIndex(project.stems, key, 'stem')));
      const result = { ...project, stems: project.stems.filter((_stem, index) => !indexes.has(index)) };
      return { ...result, durationSeconds: withDurationAfterStemEdit(project, result) };
    }
    default:
      throw new Error(`Unknown stems action: ${action}`);
  }
}

function withDurationAfterStemEdit(prior, current) {
  const priorStemDuration = Math.max(0, ...prior.stems.map(stem => stem.durationSeconds));
  const nextStemDuration = Math.max(0, ...current.stems.map(stem => stem.durationSeconds));
  // Retain any longer duration the user entered independently of the stems.
  return prior.durationSeconds === priorStemDuration ? nextStemDuration : Math.max(prior.durationSeconds, nextStemDuration);
}

async function runLyrics(action, project, positional, options) {
  switch (action) {
    case 'import':
      count(positional, 1, 1, 'lyrics import <file> [--mapping <mapping.json>]');
      return importLyrics(project, positional[0], option(options, 'mapping'));
    case 'set': {
      count(positional, 0, 1, 'lyrics set <text-file> | lyrics set --text <lyrics>');
      const text = option(options, 'text');
      if (text !== undefined && positional.length) throw new Error('Supply a lyric file or use --text.');
      if (text !== undefined) return withUntimedLyrics(project, text);
      if (!positional.length) throw new Error('Supply a lyric file or use --text.');
      return withUntimedLyrics(project, await readFile(await localFile(positional[0], null, 'lyric'), 'utf8'));
    }
    case 'line': {
      count(positional, 1, 1, 'lyrics line <line ID or index> [--text <lyrics>] [--start <seconds>] [--end <seconds>]');
      const index = findIndex(project.lyrics, positional[0], 'line');
      const lyrics = project.lyrics.slice(), line = lyrics[index];
      const text = option(options, 'text');
      lyrics[index] = withTiming(text === undefined ? line : editLyricTimingText(line, text), options);
      return { ...project, lyrics };
    }
    case 'word': {
      count(positional, 2, 2, 'lyrics word <line ID or index> <word index> [--start <seconds>] [--end <seconds>]');
      const index = findIndex(project.lyrics, positional[0], 'line');
      const lyrics = project.lyrics.slice();
      const [line] = seedTimedWords([lyrics[index]]);
      const wordIndex = findIndex(line.words, positional[1], 'word');
      const words = line.words.slice();
      words[wordIndex] = withTiming(words[wordIndex], options);
      lyrics[index] = {
        ...line, words,
        startSeconds: Math.min(...words.map(word => word.startSeconds)),
        endSeconds: Math.max(...words.map(word => word.endSeconds)),
      };
      return { ...project, lyrics };
    }
    default:
      throw new Error(`Unknown lyrics action: ${action}`);
  }
}

export async function projectCommand(group, action, args, { probeAudio, expectedRevision } = {}) {
  const projectPath = projectFile(args);
  const { positional, options } = args;
  if (group === 'project' && action === 'init') {
    count(positional, 0, 0, 'project init [--title <title>] [--artist <artist>] [--project <file>]');
    const empty = { schema: projectSchema, version: 1, title: '', artist: '', durationSeconds: 0, stems: [], lyrics: [] };
    const project = await saveProject(projectPath, updateMetadata(empty, options), { createOnly: !flag(options, 'force') });
    return { projectPath, project };
  }
  const project = await loadProject(projectPath);
  const revision = projectRevision(project);
  if (expectedRevision !== undefined && expectedRevision !== revision) {
    throw new Error('The project changed on disk. Reload it and repeat the operation.');
  }
  if (group === 'project' && action === 'info') {
    count(positional, 0, 0, 'project info');
    return { projectPath, project };
  }
  if (group === 'stems' && action === 'list') {
    count(positional, 0, 0, 'stems list');
    return { projectPath, stems: project.stems };
  }
  if (group === 'lyrics' && action === 'show') {
    count(positional, 0, 1, 'lyrics show [<line ID or index>]');
    const lyrics = positional.length ? [project.lyrics[findIndex(project.lyrics, positional[0], 'line')]] : project.lyrics;
    return { projectPath, lyrics, importedCdg: project.importedCdg };
  }
  let updated;
  if (group === 'project') updated = await runProject(action, project, positional, options);
  else if (group === 'stems') updated = await runStems(action, project, positional, options, probeAudio);
  else if (group === 'lyrics') updated = await runLyrics(action, project, positional, options);
  else throw new Error(`Unknown command group: ${group}`);
  const saved = await saveProject(projectPath, updated, { expectedRevision: revision });
  return { projectPath, project: saved };
}
