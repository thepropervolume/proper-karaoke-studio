import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeVoiceRecording, recordingSampleRate, validateVoiceRecording } from '../src/domain/voice-recording';

test('encodes consecutive microphone chunks in a valid mono PCM WAV', () => {
  const bytes = encodeVoiceRecording([Int16Array.of(-32768, 0), Int16Array.of(32767)]);
  validateVoiceRecording(bytes);
  const wav = new DataView(bytes.buffer);
  assert.equal(wav.getUint32(24, true), recordingSampleRate);
  assert.equal(wav.getUint32(40, true), 6);
  assert.deepEqual([44, 46, 48].map(offset => wav.getInt16(offset, true)), [-32768, 0, 32767]);
});

test('rejects an empty take and malformed WAV headers at the save boundary', () => {
  assert.throws(() => encodeVoiceRecording([]), /five minutes/);
  const bytes = encodeVoiceRecording([Int16Array.of(42, 43)]);
  bytes[22] = 2;
  assert.throws(() => validateVoiceRecording(bytes), /verify/);
  assert.throws(() => validateVoiceRecording('not audio'), /empty or exceeds/);
});
