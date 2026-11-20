import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectCommand } from '../src/cli/project-commands.mjs';
import { loadProject, projectRevision, saveProject } from '../src/domain/project-file.mjs';

test('project commands retain media references, metadata, and editable lyric cues', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-studio-project-test-'));
  try {
    const projectPath = join(directory, 'song.tpv.json');
    const songPath = join(directory, 'song.wav');
    const lyricsPath = join(directory, 'lyrics.txt');
    await assert.rejects(loadProject(projectPath), { code: 'ENOENT' });
    await writeFile(songPath, 'test audio fixture');
    await writeFile(lyricsPath, '\uFEFFFirst line\nSecond line\n');
    const run = (group: string, action: string, positional: string[] = [], options = {}) =>
      projectCommand(group, action, { positional, options: { project: projectPath, ...options } }, {
        async probeAudio(file: string) {
          assert.equal(file, songPath);
          return 8;
        },
      });

    await run('project', 'init', [], { title: 'Studio CLI', artist: 'TPV' });
    await assert.rejects(run('project', 'init'), /already exists/);
    await run('stems', 'add', [songPath], { role: 'lead', volume: '0.7' });
    await run('lyrics', 'import', [lyricsPath]);
    await run('lyrics', 'line', ['2'], { start: '00:04.000', end: '7.5' });
    await run('lyrics', 'word', ['2', '1'], { start: '4.2', end: '4.8' });
    const project = await loadProject(projectPath);
    assert.equal(project.title, 'Studio CLI');
    assert.equal(project.durationSeconds, 8);
    assert.equal(project.stems[0].role, 'lead');
    assert.equal(project.stems[0].volume, 0.7);
    assert.equal(project.lyrics[0].text, 'First line');
    assert.deepEqual(project.lyrics[1].words[0], { text: 'Second ', startSeconds: 4.2, endSeconds: 4.8 });

    await run('stems', 'edit', [project.stems[0].id], { voice: 'Primary vocal' });
    await assert.rejects(saveProject(projectPath, project, { expectedRevision: projectRevision(project) }), /changed on disk/);
    await assert.rejects(projectCommand('lyrics', 'import', {
      positional: [lyricsPath], options: { project: projectPath },
    }, { expectedRevision: projectRevision(project) }), /changed on disk/);
    await run('stems', 'remove', ['1']);
    assert.deepEqual((await loadProject(projectPath)).stems, []);
    assert.equal(await readFile(songPath, 'utf8'), 'test audio fixture');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
