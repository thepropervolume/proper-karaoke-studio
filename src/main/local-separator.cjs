/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const downloads = require('../domain/model-downloads.json');

const modelId = /^(?!\.{1,2}$)[\w.-]{1,160}$/;
const backingModels = new Set(downloads.filter(model => model.purpose === 'backing').map(model => model.id));

/** Win32 cannot spawn pyenv's batch shim without a shell. Look up its executable directly. */
async function resolveSeparatorExecutable(adapter, executable) {
  if (process.platform !== 'win32' || executable !== adapter || !['audio-separator', 'demucs'].includes(adapter)) return executable;
  const pyenv = process.env.PYENV_ROOT || process.env.PYENV_HOME || path.join(os.homedir(), '.pyenv', 'pyenv-win');
  const selected = (process.env.PYENV_VERSION || await fs.readFile(path.join(pyenv, 'version'), 'utf8').catch(() => '')).trim();
  if (!/^[\w.-]{1,60}$/.test(selected) || selected === '.' || selected === '..') return executable;
  const candidate = path.join(pyenv, 'versions', selected, 'Scripts', executable + '.exe');
  const info = await fs.stat(candidate).catch(() => null);
  return info?.isFile() ? candidate : executable;
}

function normalizeEnsemble(primary, extra = [], backing = '') {
  if (!Array.isArray(extra) || extra.length > 3 || extra.some(id => typeof id !== 'string' || !modelId.test(id))) {
    throw new Error('Choose up to three additional models in Preferences.');
  }
  if (backing && !backingModels.has(backing)) throw new Error('Choose a supported lead and backing splitter in Preferences.');
  return { extra: [...new Set(extra)].filter(id => id !== primary), backing };
}

async function audioFiles(directory, extensions) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter(item => item.isFile() && extensions.has(path.extname(item.name).toLowerCase()))
    .map(item => path.join(directory, item.name)).sort();
}

function identifyStem(files, aliases, stage) {
  const matching = files.filter(file => {
    const name = path.basename(file, path.extname(file)).toLowerCase();
    const firstLabel = name.match(/\(([^()]+)\)/)?.[1];
    return aliases.includes(name) || firstLabel && aliases.includes(firstLabel);
  });
  if (matching.length !== 1) {
    throw new Error(stage + ' did not return one identifiable ' + aliases[0] + ' stem. Choose a model that separates those stems.');
  }
  return matching[0];
}

/** Blend the first-pass models, then run a backing-specific model on the isolated vocal stem. */
async function runAudioSeparator({ source, executable, model, modelDirectory, modelArgs, extra, backing, extensions }, outputDirectory, runTool) {
  const modelLocation = modelDirectory ? ['--model_file_dir', modelDirectory] : [];
  const ensembleArgs = extra.length ? ['--extra_models', ...extra, '--ensemble_algorithm', 'avg_wave'] : [];
  const run = (input, primary, destination, args) => runTool(executable,
    [input, '--model_filename', primary, '--output_dir', destination, ...modelLocation, ...args], 'Audio Separator');
  if (!backing) {
    await run(source, model, outputDirectory, [...modelArgs, ...ensembleArgs]);
    const files = await audioFiles(outputDirectory, extensions);
    if (!files.length) throw new Error('Separation completed but produced no supported audio files.');
    return { files, outputDirectory };
  }

  const working = await fs.mkdtemp(path.join(os.tmpdir(), 'tpv-vocal-split-'));
  const first = path.join(working, 'vocals'), second = path.join(working, 'split');
  try {
    await fs.mkdir(first);
    await fs.mkdir(second);
    await run(source, model, first, [...modelArgs, ...ensembleArgs, '--output_format', 'WAV',
      '--custom_output_names', JSON.stringify({ Vocals: 'Vocals', Instrumental: 'Instrumental' })]);
    const firstPass = await audioFiles(first, extensions);
    const instrumental = identifyStem(firstPass, ['instrumental', 'no vocals', 'other'], 'The first pass');
    const vocals = identifyStem(firstPass, ['vocals', 'lead vocals', 'main vocals'], 'The first pass');
    await run(vocals, backing, second, ['--output_format', 'WAV', '--custom_output_names', JSON.stringify({
      Vocals: 'Lead Vocals', 'Lead Vocals': 'Lead Vocals', 'Main Vocals': 'Lead Vocals',
      Instrumental: 'Backing Vocals', 'Backing Vocals': 'Backing Vocals', 'Background Vocals': 'Backing Vocals',
    })]);
    const split = await audioFiles(second, extensions);
    const lead = identifyStem(split, ['lead vocals', 'main vocals', 'vocals'], 'The vocal split');
    const background = identifyStem(split, ['backing vocals', 'background vocals', 'instrumental'], 'The vocal split');
    const output = [[instrumental, 'Instrumental.wav', 'instrumental'], [lead, 'Lead Vocals.wav', 'lead'], [background, 'Backing Vocals.wav', 'backing']];
    const files = [];
    const roles = {};
    for (const [file, label, role] of output) {
      const destination = path.join(outputDirectory, label);
      await fs.copyFile(file, destination);
      files.push(destination);
      roles[destination] = role;
    }
    return { files, roles, outputDirectory };
  } finally {
    await fs.rm(working, { recursive: true, force: true });
  }
}

module.exports = { resolveSeparatorExecutable, normalizeEnsemble, runAudioSeparator };
