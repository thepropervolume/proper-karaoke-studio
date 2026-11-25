/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultLyricStyle } from '../src/domain/lyric-style';
import { toAss } from '../src/domain/lyrics-formats';
import { toPortableKitProject, type LyricLine, type StudioProject } from '../src/domain/project';
import {
  normalizeVideoPresentation, videoCountdownBar, videoPresentationAt, videoTimeline,
} from '../src/domain/video-presentation';
import kit from '../src/main/kit-import.cjs';
import ops from '../src/main/studio-operations.cjs';

const line = (startSeconds: number, endSeconds: number): LyricLine =>
  ({ id: 'cue', text: 'A fixture song', startSeconds, endSeconds, words: [] });

test('opening assets fit under existing lead-in before pushing song audio', () => {
  const presentation = normalizeVideoPresentation({
    openingAnimation: { path: 'opener.mp4', duration: 4, speed: 2 },
    closingAnimation: { path: 'closer.webm', duration: 2, speed: .5 },
    titleCard: { enabled: true, duration: 5 },
  });
  const style = { ...defaultLyricStyle, countdownBar: { ...defaultLyricStyle.countdownBar, enabled: true } };
  const generous = videoTimeline([line(20, 25)], 43, presentation, style);
  assert.equal(generous.audioStart, 0);
  assert.deepEqual(generous.openingTitle, { start: 2, end: 7 });
  assert.deepEqual(generous.closingTitle, { start: 25.18, end: 30.18 });
  assert.deepEqual(generous.closingAnimation, { start: 30.18, end: 34.18 });
  assert.deepEqual(videoPresentationAt(generous, presentation, 39), { kind: 'black' });
  assert.equal(generous.duration, 43);
  assert.deepEqual([videoCountdownBar(generous, style)?.start, videoCountdownBar(generous, style)?.end], [7, 18.75]);
  const short = videoTimeline([line(1, 2)], 3, presentation, style);
  assert.equal(short.audioStart, 10);
  assert.equal(short.audioEnd, 13);
  assert.equal(short.lyricStart, 10);
  assert.equal(short.duration, 21.18);
  assert.equal(videoPresentationAt(short, presentation, 7.5).kind, 'song');
  const countdown = videoCountdownBar(short, style);
  assert.equal(countdown?.start, 7);
  assert.equal(countdown?.end, 10);
  const ass = toAss('Song', 'Artist', 3, [line(1, 2)], 'video', style, { offset: short.audioStart, openingCountdown: countdown });
  assert.match(ass, /Dialogue: 0,0:00:10\.00,0:00:12\.18/);
  assert.match(ass, /Dialogue: 3,0:00:07\.00,0:00:10\.00/);
});

test('presentation transitions use bounded in/out intervals and can be previewed consistently', () => {
  const presentation = normalizeVideoPresentation({
    titleCard: { enabled: true, placement: 'opening', duration: 2, enter: 'slide-right', exit: 'fade', transitionDuration: 5 },
  });
  const timeline = videoTimeline([line(5, 8)], 9, presentation);
  assert.deepEqual(videoPresentationAt(timeline, presentation, .25), {
    kind: 'openingTitle', elapsed: .25, opacity: 1, translateX: 75,
  });
  assert.deepEqual(videoPresentationAt(timeline, presentation, 1.5), {
    kind: 'openingTitle', elapsed: 1.5, opacity: .5, translateX: 0,
  });
  assert.equal(timeline.closingTitle, null);
});

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 30000 });
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr.toString());
  return result.stdout;
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
test('FFmpeg composes a source-backed logo, title and speed-adjusted opening/closing clips', { skip: !hasFfmpeg, timeout: 90000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'tpv-presentation-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const song = join(folder, 'song.wav'), logo = join(folder, 'logo.png');
  const intro = join(folder, 'intro.mp4'), outro = join(folder, 'outro.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', song]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=yellow:s=50x50', '-frames:v', '1', '-threads', '1', logo]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=0.8', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.8',
    '-c:v', 'libx264', '-c:a', 'aac', '-shortest', intro]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=0.6', '-c:v', 'libx264', outro]);
  const presentation = normalizeVideoPresentation({
    logo: { path: logo, corner: 'top-left', width: 10, offsetX: 2, offsetY: 2, opacity: .8 },
    openingAnimation: { path: intro, duration: .8, speed: 2, muted: false, enter: 'slide-left', exit: 'fade', transitionDuration: .12 },
    closingAnimation: { path: outro, duration: .6, enter: 'fade', exit: 'slide-right', transitionDuration: .12 },
    titleCard: { enabled: true, duration: 1, backgroundColor: '#006600', enter: 'fade', exit: 'slide-right', transitionDuration: .12 },
  });
  const audioStem = { id: 'stem', path: song, name: 'Original audio', role: 'instrumental' as const, volume: 1, voice: '', durationSeconds: 3 };
  const project: StudioProject = { schema: 'com.thepropervolume.karaoke-studio', version: 1,
    title: 'Test Song', artist: 'Studio', durationSeconds: 3, stems: [audioStem], lyrics: [line(.5, 1.1)], videoPresentation: presentation };
  const output = join(folder, 'complete.mp4');
  await ops.exportVideo({ title: project.title, artist: project.artist, duration: 3, stems: [audioStem],
    ffmpegPath: 'ffmpeg', videoPresentation: presentation, lyrics: project.lyrics }, output);
  const sample = (time: string, x = 700, y = 100) => [...ffmpeg(['-ss', time, '-i', output,
    '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-c:v', 'rawvideo', '-threads', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']).subarray(0, 3)];
  const rgb = (time: string, channel: number) => sample(time)[channel] ?? 0;
  assert.ok(rgb('0.20', 0) > 220, 'opening video appears');
  assert.ok(rgb('0.44', 1) < 68, 'the title fades in from the underlying video');
  assert.ok(rgb('0.85', 1) > 70 && rgb('0.85', 0) < 15, 'opening title is composited');
  assert.ok(rgb('3.30', 1) > 70, 'closing title appears after the last lyric');
  assert.ok(rgb('3.90', 2) > 220, 'closing animation follows the closing title');
  assert.ok(sample('4.33').every(value => value < 10), 'keeping the song tail adds no scene after the outro');
  const yellow = sample('0.85', 60, 60);
  assert.ok(yellow[0] > 180 && yellow[1] > 180, 'logo stays visible over the title');
  const audioSamples = (time: string) => ffmpeg(['-ss', time, '-i', output, '-vn', '-t', '0.03', '-ac', '1', '-f', 's16le', '-']);
  assert.ok(audioSamples('0.20').some(sample => sample > 50), 'unmuted intro audio is mixed');
  assert.ok(audioSamples('0.85').every(sample => sample === 0), 'song waits when the intro cannot fit');
  assert.ok(audioSamples('4.31').some(sample => sample > 50), 'remaining song audio plays after the closing visuals');

  const pack = join(folder, 'portable.tpvkit');
  const portable = toPortableKitProject(project);
  await ops.exportKit({ manifest: JSON.stringify(portable), lyrics: {}, stems: [audioStem], videoPresentation: presentation }, pack);
  const reopened = await kit.importKit(pack, join(folder, 'restored.tpv.json'));
  const restored = reopened.project.videoPresentation;
  assert.equal(restored.titleCard.duration, 1);
  assert.equal(restored.openingAnimation.speed, 2);
  for (const name of ['logo', 'openingAnimation', 'closingAnimation'] as const) {
    assert.deepEqual(await readFile(restored[name].path), await readFile(presentation[name].path!));
  }
});
