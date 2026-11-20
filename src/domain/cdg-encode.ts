import { cdgHeight, cdgPacketBytes, cdgPacketsPerSecond, cdgWidth } from './cdg';

export const cdgExportFrameRate = 25;
export const cdgRgbFrameBytes = cdgWidth * cdgHeight * 3;
const packetsPerFrame = cdgPacketsPerSecond / cdgExportFrameRate;
const tileWidth = 6, tileHeight = 12;

/** Pack sprite updates into a software MP3+G stream at 300 packet slots per second. */
export class CdgEncoder {
  private readonly bytes: Uint8Array;
  private readonly screen = new Uint8Array(cdgWidth * cdgHeight);
  private readonly target = new Uint8Array(cdgWidth * cdgHeight);
  private readonly scratch = new Uint8Array(tileHeight);
  private packet = 0;
  private drawn = false;
  private frame = 0;
  private frameLimit: number;

  constructor(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('CD+G export needs a project duration between zero and one hour.');
    this.frameLimit = Math.max(2, Math.ceil(duration * cdgPacketsPerSecond));
    this.bytes = new Uint8Array(this.frameLimit * cdgPacketBytes);
    this.emit(30, [0, 0, 52, 42, 63, 63, 52, 42]); // Black, magenta, white, and magenta during an XOR transition.
    this.emit(1, [0]);
  }

  private emit(instruction: number, payload: readonly number[]) {
    if (this.packet >= this.frameLimit) return false;
    const start = this.packet++ * cdgPacketBytes;
    this.bytes[start] = 9;
    this.bytes[start + 1] = instruction;
    this.bytes.set(payload, start + 4);
    return true;
  }

  private writeTile(column: number, row: number, plane: number) {
    const left = column * tileWidth, top = row * tileHeight;
    let changed = false;
    for (let y = 0; y < tileHeight; y++) {
      let mask = 0;
      const start = (top + y) * cdgWidth + left;
      for (let x = 0; x < tileWidth; x++) {
        const at = start + x;
        if ((this.screen[at] ^ this.target[at]) & plane) mask |= 32 >> x;
      }
      this.scratch[y] = mask;
      changed ||= mask !== 0;
    }
    if (!changed || !this.emit(38, [0, plane, row, column, ...this.scratch])) return;
    for (let y = 0; y < tileHeight; y++) {
      const start = (top + y) * cdgWidth + left;
      for (let x = 0; x < tileWidth; x++) {
        if (this.scratch[y] & (32 >> x)) this.screen[start + x] ^= plane;
      }
    }
  }

  pushFrame(rgb: Uint8Array) {
    if (rgb.length !== cdgRgbFrameBytes) throw new Error('FFmpeg returned an incomplete CD+G render frame.');
    this.frameLimit = Math.min(this.bytes.length / cdgPacketBytes, (++this.frame) * packetsPerFrame);
    if (this.packet >= this.frameLimit) return;
    const before = this.packet;

    let hasInk = false;
    // Leave the CD+G overscan border clear and reduce antialiasing to two ink colors.
    for (let y = tileHeight; y < cdgHeight - tileHeight; y++) {
      for (let x = tileWidth; x < cdgWidth - tileWidth; x++) {
        const at = y * cdgWidth + x;
        const red = rgb[at * 3], green = rgb[at * 3 + 1];
        const color = Math.max(red, green) < 95 ? 0 : green > red * 0.65 ? 2 : 1;
        this.target[at] = color;
        hasInk ||= color !== 0;
      }
    }
    if (hasInk) {
      draw: for (let row = 1; row < cdgHeight / tileHeight - 1; row++) {
        for (let column = 1; column < cdgWidth / tileWidth - 1; column++) {
          this.writeTile(column, row, 1);
          this.writeTile(column, row, 2);
          if (this.packet === this.frameLimit) break draw;
        }
      }
      this.drawn = true;
    } else if (this.drawn) {
      this.emit(1, [0]);
      this.screen.fill(0);
      this.drawn = false;
    }
    // Keep the frame timestamp visible to decoders that skip empty packets.
    if (this.packet === before) this.emit(0, []);
    this.packet = this.frameLimit;
  }

  finish(): Uint8Array {
    if (!this.frame) throw new Error('FFmpeg did not render any CD+G frames.');
    return this.bytes;
  }
}
