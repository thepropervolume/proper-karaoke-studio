export const cdgWidth = 300;
export const cdgHeight = 216;
export const cdgPacketBytes = 24;
export const cdgPacketsPerSecond = 300;
export const cdgByteLimit = cdgPacketBytes * cdgPacketsPerSecond * 3600;

const tileWidth = 6;
const tileHeight = 12;
const checkpointsPerSong = 120;
const packetsPerCheckpoint = 30 * cdgPacketsPerSecond;
const instructions = new Set([1, 2, 6, 20, 24, 28, 30, 31, 38]);

type Screen = {
  pixels: Uint8Array;
  palette: Uint8Array;
  horizontal: number;
  vertical: number;
};

function blankScreen(): Screen {
  return {
    pixels: new Uint8Array(cdgWidth * cdgHeight),
    palette: new Uint8Array(16 * 3),
    horizontal: 0,
    vertical: 0,
  };
}

function snapshot(screen: Screen): Screen {
  return { ...screen, pixels: screen.pixels.slice(), palette: screen.palette.slice() };
}

function tile(screen: Screen, payload: Uint8Array, xor: boolean): boolean {
  const left = (payload[3] & 63) * tileWidth + screen.horizontal;
  const top = (payload[2] & 31) * tileHeight + screen.vertical;
  if (left + tileWidth > cdgWidth || top + tileHeight > cdgHeight) return false;
  const colors = [payload[0] & 15, payload[1] & 15];
  for (let y = 0; y < tileHeight; y++) {
    const start = left + (top + y) * cdgWidth;
    for (let x = 0; x < tileWidth; x++) {
      const color = colors[payload[4 + y] >> (tileWidth - 1 - x) & 1];
      screen.pixels[start + x] = xor ? screen.pixels[start + x] ^ color : color;
    }
  }
  return true;
}

function border(screen: Screen, color: number) {
  const { pixels } = screen;
  for (let y = 0; y < cdgHeight; y++) {
    const start = y * cdgWidth;
    if (y < tileHeight || y >= cdgHeight - tileHeight) pixels.fill(color, start, start + cdgWidth);
    else {
      pixels.fill(color, start, start + tileWidth);
      pixels.fill(color, start + cdgWidth - tileWidth, start + cdgWidth);
    }
  }
}

function scroll(screen: Screen, payload: Uint8Array, wrap: boolean): boolean {
  const horizontal = Math.min(payload[1] & 7, tileWidth - 1);
  const vertical = Math.min(payload[2] & 15, tileHeight - 1);
  const shifts = [0, 1, -1, 0];
  const dx = horizontal - screen.horizontal + shifts[(payload[1] >> 4) & 3] * tileWidth;
  const dy = screen.vertical - vertical + shifts[(payload[2] >> 4) & 3] * tileHeight;
  screen.horizontal = horizontal;
  screen.vertical = vertical;
  if (!dx && !dy) return false;

  const previous = screen.pixels;
  const next = new Uint8Array(previous.length);
  const fill = payload[0] & 15;
  for (let y = 0; y < cdgHeight; y++) {
    const sourceY = y - dy;
    if (!wrap && (sourceY < 0 || sourceY >= cdgHeight)) {
      next.fill(fill, y * cdgWidth, (y + 1) * cdgWidth);
      continue;
    }
    const sourceRow = ((sourceY + cdgHeight) % cdgHeight) * cdgWidth;
    for (let x = 0; x < cdgWidth; x++) {
      const sourceX = x - dx;
      next[y * cdgWidth + x] = wrap || (sourceX >= 0 && sourceX < cdgWidth)
        ? previous[sourceRow + (sourceX + cdgWidth) % cdgWidth]
        : fill;
    }
  }
  screen.pixels = next;
  return true;
}

function applyPacket(screen: Screen, instruction: number, payload: Uint8Array): boolean {
  switch (instruction) {
    case 1: // Memory presets may be repeated. Only the first changes the screen.
      if (payload[1] & 15) return false;
      screen.pixels.fill(payload[0] & 15);
      return true;
    case 2:
      border(screen, payload[0] & 15);
      return true;
    case 6:
    case 38:
      return tile(screen, payload, instruction === 38);
    case 20:
    case 24:
      return scroll(screen, payload, instruction === 24);
    case 30:
    case 31:
      for (let entry = 0; entry < 8; entry++) {
        const rgb = (payload[entry * 2] & 63) * 64 + (payload[entry * 2 + 1] & 63);
        const offset = (entry + (instruction === 30 ? 0 : 8)) * 3;
        screen.palette[offset] = (rgb >> 8 & 15) * 17;
        screen.palette[offset + 1] = (rgb >> 4 & 15) * 17;
        screen.palette[offset + 2] = (rgb & 15) * 17;
      }
      return true;
    default:
      // Studio displays the source's solid colors, including any backdrop index.
      return false;
  }
}

/** Decode the flat 16-color graphics at the playhead. Checkpoints keep rewinds cheap. */
export class CdgPlayer {
  readonly durationSeconds: number;
  private screen = blankScreen();
  private nextPacket = 0;
  private readonly checkpoints = new Map<number, Screen>();
  private readonly totalPackets: number;

  constructor(private readonly data: Uint8Array) {
    if (!data.length || data.length % cdgPacketBytes !== 0 || data.length > cdgByteLimit) {
      throw new Error('Choose a CD+G file with complete 24-byte packets and no more than one hour of graphics.');
    }
    this.totalPackets = data.length / cdgPacketBytes;
    this.durationSeconds = this.totalPackets / cdgPacketsPerSecond;
    for (let start = 0; start < data.length; start += cdgPacketBytes) {
      if ((data[start] & 63) === 9 && instructions.has(data[start + 1] & 63)) return;
    }
    throw new Error('The selected file contains no CD+G graphics commands.');
  }

  seek(seconds: number): boolean {
    const at = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    // A packet at time zero is visible at the beginning of the song.
    const target = Math.min(this.totalPackets, Math.floor(at * cdgPacketsPerSecond) + 1);
    let changed = false;
    if (target < this.nextPacket) {
      const checkpoint = Math.floor(target / packetsPerCheckpoint) * packetsPerCheckpoint;
      const saved = this.checkpoints.get(checkpoint);
      this.screen = saved ? snapshot(saved) : blankScreen();
      this.nextPacket = saved ? checkpoint : 0;
      changed = true;
    }
    while (this.nextPacket < target) {
      const start = this.nextPacket * cdgPacketBytes;
      if ((this.data[start] & 63) === 9 && applyPacket(this.screen, this.data[start + 1] & 63, this.data.subarray(start + 4, start + 20))) changed = true;
      this.nextPacket++;
      if (this.nextPacket % packetsPerCheckpoint === 0 && this.checkpoints.size < checkpointsPerSong && !this.checkpoints.has(this.nextPacket)) {
        this.checkpoints.set(this.nextPacket, snapshot(this.screen));
      }
    }
    return changed;
  }

  writeRgba(output: Uint8ClampedArray): void {
    const { pixels, palette } = this.screen;
    for (let i = 0; i < pixels.length; i++) {
      const color = pixels[i] * 3;
      const at = i * 4;
      output[at] = palette[color];
      output[at + 1] = palette[color + 1];
      output[at + 2] = palette[color + 2];
      output[at + 3] = 255;
    }
  }
}
