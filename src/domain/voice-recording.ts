export const maxRecordingSeconds = 5 * 60;
export const recordingSampleRate = 48_000;
const headerSize = 44;

/** Build a mono, 16-bit PCM WAV from samples collected by the capture worklet. */
export function encodeVoiceRecording(chunks: readonly Int16Array[]): Uint8Array {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (sampleCount < 1 || sampleCount > recordingSampleRate * maxRecordingSeconds) {
    throw new Error('Record between one sample and five minutes of audio.');
  }
  const dataSize = sampleCount * 2;
  const bytes = new Uint8Array(headerSize + dataSize);
  const header = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0); // RIFF
  header.setUint32(4, bytes.length - 8, true);
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8); // WAVEfmt
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, recordingSampleRate, true);
  header.setUint32(28, recordingSampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  bytes.set([100, 97, 116, 97], 36); // data
  header.setUint32(40, dataSize, true);
  // Electron's supported CPU architectures use little-endian PCM.
  const data = new Int16Array(bytes.buffer, headerSize);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function validateVoiceRecording(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array) || input.length <= headerSize || input.length % 2
    || input.length > headerSize + recordingSampleRate * maxRecordingSeconds * 2) {
    throw new Error('The voice recording is empty or exceeds the five-minute limit.');
  }
  const header = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57415645
    || header.getUint32(12) !== 0x666d7420 || header.getUint32(36) !== 0x64617461
    || header.getUint32(4, true) !== input.length - 8 || header.getUint32(16, true) !== 16
    || header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 1
    || header.getUint32(24, true) !== recordingSampleRate || header.getUint32(28, true) !== recordingSampleRate * 2
    || header.getUint16(32, true) !== 2 || header.getUint16(34, true) !== 16
    || header.getUint32(40, true) !== input.length - headerSize) {
    throw new Error('Studio could not verify the voice recording as a PCM WAV.');
  }
}
