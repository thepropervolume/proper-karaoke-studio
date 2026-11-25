/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');
const { loadProject, projectRevision } = require('../domain/project-file.mjs');

async function projectStemDirectory(origin, source) {
  if (typeof origin?.file !== 'string' || !path.isAbsolute(origin.file) || !/^[a-f0-9]{64}$/.test(origin.revision)) {
    throw new Error('Save the project before separating stems.');
  }
  const project = await loadProject(origin.file);
  if (projectRevision(project) !== origin.revision) throw new Error('The saved project changed. Save or reopen it before separating stems.');
  if (!project.stems.some(stem => path.resolve(stem.path) === path.resolve(source))) {
    throw new Error('Save the selected source in the project before separating it.');
  }
  const parent = await fs.realpath(path.dirname(origin.file));
  const destination = path.join(parent, path.basename(origin.file) + '.stems');
  await fs.mkdir(destination, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const entry = await fs.lstat(destination);
  if (!entry.isDirectory() || entry.isSymbolicLink() || await fs.realpath(destination) !== destination) {
    throw new Error('The project’s stems folder must be a local directory next to the project file.');
  }
  return destination;
}

/** Decode optional tqdm progress without treating model logs as progress. */
function stemToolProgress(report, message) {
  let partial = '', previous = '';
  return chunk => {
    const lines = (partial + chunk).split(/[\r\n]+/);
    partial = lines.pop().slice(-1024);
    for (const line of lines) {
      const match = /\b(\d{1,3})%\s*\|.*\[\d+(?::\d+){1,2}<(\d+(?::\d+){1,2})[,\]]/.exec(stripVTControlCharacters(line));
      if (!match || Number(match[1]) > 100) continue;
      const progress = Number(match[1]) / 100;
      const remainingSeconds = match[2].split(':').reduce((seconds, segment) => seconds * 60 + Number(segment), 0);
      if (!Number.isFinite(remainingSeconds)) continue;
      const next = match[1] + ':' + remainingSeconds;
      if (next !== previous) report({ message, progress, remainingSeconds });
      previous = next;
    }
  };
}

module.exports = { projectStemDirectory, stemToolProgress };
