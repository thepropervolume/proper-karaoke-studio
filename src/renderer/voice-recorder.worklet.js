class StudioVoiceRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.maxSamples = options.processorOptions.maxSamples;
    this.chunk = new Int16Array(8192);
    this.offset = 0;
    this.count = 0;
    this.finished = false;
    this.port.onmessage = event => {
      if (event.data === 'stop') this.finish();
    };
  }

  flush() {
    if (!this.offset) return;
    const samples = this.chunk.subarray(0, this.offset);
    this.port.postMessage(samples, [samples.buffer]);
    this.chunk = new Int16Array(8192);
    this.offset = 0;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.flush();
    this.port.postMessage('stopped');
  }

  process(inputs) {
    if (this.finished) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    // Web Audio downmixes inputs to mono. Leave output silent to avoid feedback.
    for (let index = 0; index < samples.length && this.count < this.maxSamples; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      this.chunk[this.offset++] = sample * (sample < 0 ? 32768 : 32767);
      this.count++;
      if (this.offset === this.chunk.length) this.flush();
    }
    if (this.count === this.maxSamples) this.finish();
    return !this.finished;
  }
}

registerProcessor('studio-voice-recorder', StudioVoiceRecorder);
