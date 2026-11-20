import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyForcedAlignment } from '../domain/forced-alignment.ts';
import { newLyricLines } from '../domain/project.ts';
import { parseLyricsFile, toLrc, toLyricsJson, toSrt } from '../domain/lyrics-formats.ts';
import { loadProject, projectRevision, projectSchema, saveProject } from '../domain/project-file.mjs';
import operations from '../main/studio-operations.cjs';
import { addProjectStems } from './project-commands.mjs';

const maximumBytes = 4 * 1024 * 1024;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const sectionLabel = /^\[(?:verse|pre[ -]chorus|chorus|post[ -]chorus|bridge|intro|outro|hook|refrain|interlude|instrumental|solo|breakdown|break|coda)(?=\s|:|\d|\]).*\]$/i;

async function readLyricText(file) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > maximumBytes) throw new Error('Choose a nonempty lyric file of up to 4 MB.');
    const data = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await handle.read(data, length, data.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size) throw new Error('The lyric file changed while reading it. Try again.');
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, length));
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) throw new Error();
      return text;
    } catch { throw new Error('Save the lyrics as UTF-8 text and try again.'); }
  } finally { await handle.close(); }
}

function graphemeCount(text) {
  let width = 0;
  for (const _segment of segmenter.segment(text)) width++;
  return width;
}

export function formatLyricText(source, width = 22) {
  if (!Number.isInteger(width) || width < 8 || width > 160) throw new Error('--max-length must be a whole number from 8 to 160.');
  const result = [];
  let stanzaBreak = false;
  for (const raw of source.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || sectionLabel.test(line)) {
      stanzaBreak ||= result.length > 0;
      continue;
    }
    if (stanzaBreak) { result.push(''); stanzaBreak = false; }
    let excerpt = '', length = 0;
    for (const word of line.split(/\s+/u)) {
      const count = graphemeCount(word);
      if (excerpt && length + 1 + count > width) {
        result.push(excerpt);
        excerpt = ''; length = 0;
      }
      if (excerpt) { excerpt += ' '; length++; }
      excerpt += word; length += count;
    }
    if (excerpt) result.push(excerpt);
  }
  if (!result.length) throw new Error('Provide at least one line of lyric text.');
  return result.join('\n') + '\n';
}

async function sameFile(left, right) {
  if (!left || !right) return false;
  const resolveExisting = file => realpath(file).catch(error => {
    if (error.code === 'ENOENT') return path.resolve(file);
    throw error;
  });
  const [a, b] = await Promise.all([resolveExisting(left), resolveExisting(right)]);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function writeText(output, contents, overwrite, beforePublish) {
  await mkdir(path.dirname(output), { recursive: true });
  await operations.writeOutput(output, overwrite, async file => {
    await writeFile(file, contents, 'utf8');
    await beforePublish?.();
  }).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Output already exists. Pass --force to replace it.');
    throw error;
  });
}

export async function formatLyricsFile({ lyricsFile, output, width, force, preferences }) {
  const source = path.resolve(lyricsFile);
  const ext = path.extname(source).toLowerCase();
  if (['.cdg', '.json', '.lrc', '.elrc', '.srt'].includes(ext)) throw new Error('Choose plain text lyrics for formatting.');
  const original = await readLyricText(source);
  const contents = formatLyricText(original, width);
  const inPlace = await sameFile(source, output);
  const destination = inPlace ? await realpath(source) : path.resolve(output);
  if (await sameFile(destination, preferences)) throw new Error('Choose an output different from the Studio settings file.');
  await writeText(destination, contents, inPlace || Boolean(force), inPlace ? async () => {
    if (await readLyricText(destination) !== original) throw new Error('The lyric file changed while formatting. Try again.');
  } : undefined);
  return { output: path.resolve(output), lines: contents.trim().split('\n').filter(Boolean).length };
}

function getLyricOutput(output, project) {
  const ext = path.extname(output).toLowerCase();
  const { title, artist, lyrics, durationSeconds } = project;
  if (ext === '.json') return toLyricsJson(title, artist, durationSeconds, lyrics);
  if (ext === '.srt') return toSrt(lyrics);
  return toLrc(title, artist, lyrics);
}

async function suppliedLyrics(input) {
  const file = path.resolve(input);
  const contents = await readLyricText(file);
  const extension = path.extname(file).toLowerCase();
  if (['.lrc', '.elrc', '.srt', '.json'].includes(extension)) return parseLyricsFile(file, contents);
  if (extension === '.cdg') throw new Error('CD+G contains graphics. Supply plain text, Enhanced LRC, SRT, or Studio lyrics JSON.');
  return { lines: newLyricLines(contents.replace(/\r\n?/g, '\n'), 0), title: '', artist: '' };
}

export async function alignLyricsFromFiles({
  file, lyricsFile, audio, output, force, language, preferences,
}, align) {
  const projectFile = file ? path.resolve(file) : null;
  if (projectFile && await sameFile(projectFile, preferences)) throw new Error('Choose a project path different from the Studio settings file.');
  const prior = projectFile ? await loadProject(projectFile).catch(error => {
    if (error.code === 'ENOENT' && lyricsFile) return null;
    throw error;
  }) : null;
  const input = lyricsFile ? await suppliedLyrics(lyricsFile) : null;
  const lines = input?.lines ?? prior?.lyrics ?? [];
  if (!lines.length) throw new Error('Import or set the lyrics before aligning.');
  const candidate = prior?.stems.find(stem => stem.role === 'lead') ?? prior?.stems.find(stem => stem.role !== 'instrumental');
  const source = audio ? path.resolve(audio) : candidate?.path;
  if (!source) throw new Error('Select a vocal or original audio file with --audio.');
  const audioPath = await operations.localFile(source, operations.AUDIO_EXTENSIONS);
  if (output && !['.json', '.lrc', '.elrc', '.srt'].includes(path.extname(output).toLowerCase())) throw new Error('Choose an .lrc, .srt, or .json output filename.');
  if (output && (await Promise.all([audioPath, lyricsFile, preferences].map(file => sameFile(file, output)))).includes(true)) {
    throw new Error('Choose an output different from your audio, lyrics, and settings files.');
  }
  if (output && !force && await lstat(output).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  })) throw new Error('Output already exists. Pass --force to replace it.');
  const result = await align({ audioPath, language, lyrics: lines.map(line => line.text) });
  const lyrics = applyForcedAlignment(lines, result.words, result.duration);
  const durationSeconds = Math.max(prior?.durationSeconds ?? 0, result.duration);
  let updated = {
    ...prior, schema: projectSchema, version: 1, durationSeconds, lyrics, stems: prior?.stems ?? [],
    title: prior?.title ?? (input?.title || path.parse(audioPath).name),
    artist: prior?.artist ?? (input?.artist || ''),
  };
  const summary = { project: projectFile, audio: audioPath, alignedWords: result.words.length };
  if (projectFile) {
    if (lyricsFile && !updated.stems.length) {
      updated = await addProjectStems(updated, [audioPath], { durationSeconds: result.duration });
    }
    if (!prior) await mkdir(path.dirname(projectFile), { recursive: true });
    await saveProject(projectFile, updated, prior ? { expectedRevision: projectRevision(prior) } : { createOnly: true });
    return summary;
  }
  if (output) {
    await writeText(output, getLyricOutput(output, updated), Boolean(force));
    return { ...summary, output };
  }
  return { ...summary, durationSeconds, lyrics };
}
