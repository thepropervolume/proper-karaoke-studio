import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdgPlayer, cdgHeight, cdgPacketBytes, cdgPacketsPerSecond, cdgWidth } from '../src/domain/cdg';
import { CdgEncoder, cdgRgbFrameBytes } from '../src/domain/cdg-encode';

function packet(instruction: number, payload: number[]) {
  const bytes = Buffer.alloc(cdgPacketBytes);
  bytes[0] = 9;
  bytes[1] = instruction;
  bytes.set(payload, 4);
  return bytes;
}

function pixel(player: CdgPlayer, x: number, y: number) {
  const rgba = new Uint8ClampedArray(cdgWidth * cdgHeight * 4);
  player.writeRgba(rgba);
  const index = (y * cdgWidth + x) * 4;
  return Array.from(rgba.slice(index, index + 4));
}

const black = [0, 0, 0, 255], red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];
const palette = packet(30, [0, 0, 60, 0, 3, 48, 0, 15]);
const fullTile = (instruction: number, color: number, row = 1, column = 1) => packet(instruction, [0, color, row, column, ...Array<number>(12).fill(63)]);

test('decodes CD+G palette, border, tile and XOR and seeks backwards', () => {
  const player = new CdgPlayer(Buffer.concat([
    palette, packet(2, [3]), fullTile(6, 1), fullTile(38, 3), packet(1, [1, 1]), packet(1, [0]),
  ]));
  const atPacket = (index: number) => player.seek((index + 0.5) / cdgPacketsPerSecond);
  atPacket(0);
  assert.deepEqual(pixel(player, 0, 0), black);
  atPacket(2);
  assert.deepEqual(pixel(player, 0, 0), blue);
  assert.deepEqual(pixel(player, 6, 12), red);
  atPacket(4);
  assert.deepEqual(pixel(player, 6, 12), green);
  atPacket(5);
  assert.deepEqual(pixel(player, 6, 12), black);
  atPacket(2);
  assert.deepEqual(pixel(player, 6, 12), red);
  assert.equal(player.seek(2.5 / cdgPacketsPerSecond), false);
});

test('scroll preset fills the exposed area and scroll copy wraps it', () => {
  const gl = Buffer.concat([palette, fullTile(6, 1, 1, 49), packet(24, [2, 16, 0]), packet(20, [2, 16, 0])]);
  const player = new CdgPlayer(gl);
  player.seek(2.5 / cdgPacketsPerSecond);
  assert.deepEqual(pixel(player, 0, 12), red);
  player.seek(3.5 / cdgPacketsPerSecond);
  assert.deepEqual(pixel(player, 0, 12), green);
  assert.deepEqual(pixel(player, 6, 12), red);
});

test('rejects incomplete packets and files without graphics commands', () => {
  assert.throws(() => new CdgPlayer(new Uint8Array(23)), /complete 24-byte packets/);
  assert.throws(() => new CdgPlayer(new Uint8Array(24)), /no CD\+G graphics commands/);
});

test('restores the graphics state on a rewind across a checkpoint', () => {
  const player = new CdgPlayer(Buffer.concat([
    palette, packet(1, [1]), Buffer.alloc(40 * cdgPacketBytes * cdgPacketsPerSecond),
    packet(1, [2]),
  ]));
  player.seek(40.2);
  assert.deepEqual(pixel(player, 20, 20), green);
  player.seek(35);
  assert.deepEqual(pixel(player, 20, 20), red);
});

test('authored graphics round trip as black, magenta, and white frames', () => {
  const encoder = new CdgEncoder(0.12);
  const raster = new Uint8Array(cdgRgbFrameBytes);
  raster.set([221, 34, 170, 255, 255, 255], (12 * cdgWidth + 6) * 3);
  encoder.pushFrame(new Uint8Array(cdgRgbFrameBytes));
  encoder.pushFrame(raster);
  encoder.pushFrame(new Uint8Array(cdgRgbFrameBytes));
  const player = new CdgPlayer(encoder.finish());
  assert.equal(player.durationSeconds, 0.12);
  player.seek(0.06);
  assert.deepEqual(pixel(player, 6, 12), [221, 34, 170, 255]);
  assert.deepEqual(pixel(player, 7, 12), [255, 255, 255, 255]);
  player.seek(0.11);
  assert.deepEqual(pixel(player, 6, 12), black);
});
