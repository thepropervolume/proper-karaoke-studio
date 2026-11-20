import { encodeVoiceRecording, maxRecordingSeconds, recordingSampleRate } from '../domain/voice-recording';
import workletSource from './voice-recorder.worklet.js?raw';

export async function captureVoice(signal: AbortSignal, onProgress: (seconds: number) => void) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable in this session.');
  signal.throwIfAborted();
  await window.studio.armVoiceRecording();
  let stream: MediaStream;
  try {
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } finally { void window.studio.disarmVoiceRecording().catch(() => undefined); }
  const stopTracks = () => stream.getTracks().forEach(track => track.stop());
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode;
  let processor: AudioWorkletNode;
  try {
    signal.throwIfAborted();
    context = new AudioContext({ sampleRate: recordingSampleRate });
    const module = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(module); }
    finally { URL.revokeObjectURL(module); }
    await context.resume();
    signal.throwIfAborted();
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'studio-voice-recorder', {
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { maxSamples: recordingSampleRate * maxRecordingSeconds },
    });
  } catch (error) {
    stopTracks();
    if (context) void context.close();
    throw error;
  }

  const audio = context;
  const chunks: Int16Array[] = [];
  let samples = 0;
  let settled = false;
  let timeout: number | undefined;
  let resolveRecording: (wav: Uint8Array) => void;
  let rejectRecording: (cause: unknown) => void;
  const recording = new Promise<Uint8Array>((resolve, reject) => {
    resolveRecording = resolve;
    rejectRecording = reject;
  });
  const close = () => {
    if (settled) return false;
    settled = true;
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    processor.port.close();
    source.disconnect();
    processor.disconnect();
    stopTracks();
    void audio.close();
    return true;
  };
  const fail = (error: unknown) => { if (close()) rejectRecording(error); };
  const abort = () => fail(new DOMException('Recording discarded.', 'AbortError'));
  const stop = () => {
    if (settled || timeout !== undefined) return;
    processor.port.postMessage('stop');
    // Release the microphone even if a suspended or disconnected audio graph cannot reply.
    timeout = window.setTimeout(() => fail(new Error('The microphone stopped responding. Try recording again.')), 2_000);
  };
  signal.addEventListener('abort', abort, { once: true });
  processor.onprocessorerror = () => fail(new Error('The microphone recording could not continue.'));
  for (const track of stream.getAudioTracks()) {
    if (track.readyState === 'ended') stop();
    else track.addEventListener('ended', stop, { once: true });
  }
  processor.port.onmessage = event => {
    if (event.data === 'stopped') {
      if (!close()) return;
      try { resolveRecording(encodeVoiceRecording(chunks)); }
      catch (error) { rejectRecording(error); }
    } else if (event.data instanceof Int16Array) {
      chunks.push(event.data);
      samples += event.data.length;
      onProgress(samples / recordingSampleRate);
    }
  };
  try { source.connect(processor).connect(audio.destination); }
  catch (error) { fail(error); }
  return { recording, stop };
}
