import { cdgHeight, cdgPacketBytes, cdgPacketsPerSecond, cdgWidth } from './cdg';

export const cdgExportFrameRate = 25;
export const cdgRgbFrameBytes = cdgWidth * cdgHeight * 3;
const packetsPerFrame = cdgPacketsPerSecond / cdgExportFrameRate;
const tileWidth = 6, tileHeight = 12;
const tileColumns = cdgWidth / tileWidth, tileRows = cdgHeight / tileHeight;
const backgroundColor = 0, highlightColor = 1, lyricColor = 2;

type TileUpdate = {
  index: number;
  column: number;
  row: number;
  priority: number;
  colors: number;
  delta: number;
  packets: number;
};

/** Pack sprite updates into a software MP3+G stream at 300 packet slots per second. */
export class CdgEncoder {
  private readonly bytes: Uint8Array;
  private readonly screen = new Uint8Array(cdgWidth * cdgHeight);
  private readonly target = new Uint8Array(cdgWidth * cdgHeight);
  private readonly pendingSince = new Uint32Array(tileColumns * tileRows);
  private readonly scratch = new Uint8Array(tileHeight);
  private packet = 0;
  private drawn = false;
  private frame = 0;
  private frameLimit: number;

  constructor(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('CD+G export needs a project duration between zero and one hour.');
    this.frameLimit = Math.max(2, Math.ceil(duration * cdgPacketsPerSecond));
    this.bytes = new Uint8Array(this.frameLimit * cdgPacketBytes);
    this.emit(30, [0, 0, 52, 42, 63, 63]); // Black, magenta, and white.
    this.emit(1, [0]);
  }

  private emit(instruction: number, payload: readonly number[]) {
    const start = this.packet++ * cdgPacketBytes;
    this.bytes[start] = 9;
    this.bytes[start + 1] = instruction;
    this.bytes.set(payload, start + 4);
  }

  private writeTile(tile: TileUpdate, instruction: 6 | 38, zero: number, one: number, match: (at: number) => boolean) {
    const left = tile.column * tileWidth, top = tile.row * tileHeight;
    for (let y = 0; y < tileHeight; y++) {
      let mask = 0;
      const start = left + (top + y) * cdgWidth;
      for (let x = 0; x < tileWidth; x++) {
        if (match(start + x)) mask |= 32 >> x;
      }
      this.scratch[y] = mask;
    }
    this.emit(instruction, [zero, one, tile.row, tile.column, ...this.scratch]);
  }

  private applyTile(tile: TileUpdate) {
    if (tile.delta > 0) {
      this.writeTile(tile, 38, 0, tile.delta, at => this.screen[at] !== this.target[at]);
    } else if (tile.packets === 1) {
      const first = tile.colors & (1 << backgroundColor) ? backgroundColor : highlightColor;
      const second = tile.colors & (1 << lyricColor) ? lyricColor : highlightColor;
      this.writeTile(tile, 6, first, second, at => this.target[at] === second);
    } else {
      // Draw the complete glyph first, then give its highlighted pixels their own color.
      this.writeTile(tile, 6, backgroundColor, lyricColor, at => this.target[at] !== backgroundColor);
      this.writeTile(tile, 38, 0, lyricColor ^ highlightColor, at => this.target[at] === highlightColor);
    }
    const left = tile.column * tileWidth, top = tile.row * tileHeight;
    for (let y = 0; y < tileHeight; y++) {
      const start = left + (top + y) * cdgWidth;
      this.screen.set(this.target.subarray(start, start + tileWidth), start);
    }
    this.pendingSince[tile.index] = 0;
  }

  pushFrame(rgb: Uint8Array) {
    if (rgb.length !== cdgRgbFrameBytes) throw new Error('FFmpeg returned an incomplete CD+G render frame.');
    this.frameLimit = Math.min(this.bytes.length / cdgPacketBytes, (++this.frame) * packetsPerFrame);
    if (this.packet >= this.frameLimit) return;
    const before = this.packet;

    let hasInk = false;
    const updates: TileUpdate[] = [];
    // Only the tiles inside the CD+G overscan border contain lyrics.
    for (let row = 1; row < tileRows - 1; row++) {
      for (let column = 1; column < tileColumns - 1; column++) {
        const index = row * tileColumns + column;
        let colors = 0, delta = 0, highlightOnly = true;
        for (let y = 0; y < tileHeight; y++) {
          const start = column * tileWidth + (row * tileHeight + y) * cdgWidth;
          for (let x = 0; x < tileWidth; x++) {
            const at = start + x;
            const red = rgb[at * 3], green = rgb[at * 3 + 1];
            // White and magenta raster markers share red, so changing the
            // highlight cannot add or erase the antialiased edge of a letter.
            // Keep some partial coverage to retain thin strokes at CD+G resolution.
            const color = red < 96 ? backgroundColor : green * 2 >= red ? lyricColor : highlightColor;
            this.target[at] = color;
            colors |= 1 << color;
            const previous = this.screen[at];
            const difference = previous ^ color;
            if (!difference) continue;
            delta = delta === 0 || delta === difference ? difference : -1;
            highlightOnly &&= previous !== backgroundColor && color !== backgroundColor;
          }
        }
        hasInk ||= colors !== (1 << backgroundColor);
        if (!delta) {
          this.pendingSince[index] = 0;
          continue;
        }
        const pending = this.pendingSince[index] ||= this.frame;
        // Let a sweep jump a few newer page tiles, while aging ensures
        // the rest of the page draws even if the first rows keep changing.
        const priority = pending - (highlightOnly ? 2 : 0);
        const packets = delta < 0 && colors === 0b111 ? 2 : 1;
        updates.push({ index, row, column, colors, delta, priority, packets });
      }
    }
    if (hasInk) {
      updates.sort((first, second) => first.priority - second.priority || first.index - second.index);
      for (const tile of updates) {
        if (this.packet === this.frameLimit) break;
        // Do not start a three-color tile unless both packets fit together.
        if (tile.packets <= this.frameLimit - this.packet) this.applyTile(tile);
      }
      this.drawn = true;
    } else if (this.drawn) {
      this.emit(1, [0]);
      this.screen.fill(0);
      this.pendingSince.fill(0);
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
