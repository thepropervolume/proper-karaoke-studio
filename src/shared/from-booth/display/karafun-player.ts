import { AudioOutputRouter } from './audio-output';
import { DEFAULT_KARAFUN_MIX, validStemVolume, type KaraFunStemRole, type KaraFunMix, type KaraFunStemVolumes } from '../domain/karafun-mix';

export type { KaraFunStemRole, KaraFunMix } from '../domain/karafun-mix';
export type KaraFunStemSource = { id: number; role: KaraFunStemRole; src: string; voice?: string | null };
export type KaraFunPlaybackInput = {
  generation: string; stems: readonly KaraFunStemSource[]; durationSeconds: number;
  position?: number; volume: number; outputId: string; mix?: Partial<KaraFunMix>; stemVolumes?: KaraFunStemVolumes;
};
export type KaraFunPlayerSnapshot = {
  generation: string; status: 'loading' | 'paused' | 'playing' | 'ended' | 'error';
  position: number; duration: number; ready: boolean; outputBlocked: boolean; outputRevision: number;
};
export type KaraFunPlayerEvent =
  | { type: 'timeline'; generation: string; position: number; duration: number; seekable: true }
  | { type: 'ended'; generation: string; position: number }
  | { type: 'output-error'; generation: string; position: number; revision: number; message: string }
  | { type: 'error'; generation: string; position: number; code: 'decode' | 'requires-premix'; message: string };

type DecodedAudio = Pick<AudioBuffer, 'duration' | 'length' | 'numberOfChannels'> & Partial<Pick<AudioBuffer, 'getChannelData'>>;
// These narrow ports also let the timing tests run without a physical audio device.
type Gain = { gain: { value: number; cancelAndHoldAtTime?(time: number): unknown; linearRampToValueAtTime?(value: number, time: number): unknown }; connect(destination: any): unknown; disconnect(): void };
type Source = { buffer: DecodedAudio | null; onended: (() => void) | null; connect(destination: any): unknown; start(when: number, offset: number): void; stop(): void; disconnect(): void };
export type KaraFunAudioContext = {
  readonly currentTime: number; readonly state: string; readonly destination: unknown;
  createGain(): Gain; createBufferSource(): Source; decodeAudioData(data: ArrayBuffer): Promise<DecodedAudio>;
  resume(): Promise<void>; close(): Promise<void>; setSinkId?: (id: string) => Promise<void>;
};
type LoadedStem = { input: KaraFunStemSource; buffer: DecodedAudio };
type Current = KaraFunPlayerSnapshot & { savedPosition: number; anchor: number; outputId: string; signature: string; stems: LoadedStem[]; stemIds: Set<number> };
export type KaraFunPlayerOptions = {
  onEvent(event: KaraFunPlayerEvent): void;
  createContext?: () => KaraFunAudioContext;
  fetchAudio?: (src: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  listOutputs?: () => Promise<readonly { kind: string; deviceId: string }[]>;
  maximumDecodedBytes?: number;
  autoTick?: boolean;
};

export class KaraFunPlayerError extends Error {
  constructor(readonly code: 'decode' | 'requires-premix', message: string) { super(message); }
}

const DEFAULT_MIX = DEFAULT_KARAFUN_MIX;
// Studio opens larger local masters than the streaming client, within a fixed memory bound.
const MAX_ENCODED_BYTES = 256 * 1024 * 1024;
const level = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const replaced = () => new DOMException('The prepared performance was replaced.', 'AbortError');

async function fetchAudio(src: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const url = new URL(src);
  if (url.protocol !== 'tpv-media:' && url.protocol !== 'studio-media:' && url.protocol !== 'blob:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('Prepared audio must come from the local media authority.');
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('The prepared audio could not be read.');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ENCODED_BYTES) {
    await response.body.cancel(); throw new KaraFunPlayerError('requires-premix', 'This recording needs a prepared fixed audio mix.');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      size += value.value.byteLength;
      if (size > MAX_ENCODED_BYTES) throw new KaraFunPlayerError('requires-premix', 'This recording needs a prepared fixed audio mix.');
      chunks.push(value.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

/** One Web Audio clock and one routed destination own every stem. Loading never plays. */
export class KaraFunPlayer {
  private context: KaraFunAudioContext | null = null;
  private master: Gain | null = null;
  private current: Current | null = null;
  private nodes: { source: Source; gain: Gain; role: KaraFunStemRole; id: number }[] = [];
  private controller: AbortController | null = null;
  // epoch invalidates asynchronous loading; action invalidates transport intents
  // within the same song (for example Pause while AudioContext.resume awaits).
  private epoch = 0;
  private action = 0;
  private muted = true;
  private volume = 1;
  private mix: KaraFunMix = { ...DEFAULT_MIX };
  private stemVolumes: KaraFunStemVolumes = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly output: AudioOutputRouter;
  private readonly maximumDecodedBytes: number;
  private readonly sink = {
    get muted() { return this.owner.muted; },
    set muted(value: boolean) { this.owner.muted = value; this.owner.applyVolume(); },
    pause: () => { if (this.current) this.pause(this.current.generation); },
    setSinkId: async (id: string) => {
      if (this.context?.setSinkId) await this.context.setSinkId(id);
      else if (id) throw new Error('This platform cannot select a Web Audio output.');
    },
    owner: this,
  };

  constructor(private readonly options: KaraFunPlayerOptions) {
    this.maximumDecodedBytes = options.maximumDecodedBytes ?? 512 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maximumDecodedBytes) || this.maximumDecodedBytes < 1 || this.maximumDecodedBytes > 1024 ** 3)
      throw new Error('Invalid decoded-audio budget.');
    this.output = new AudioOutputRouter(options.listOutputs ?? (async () => {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Audio output enumeration is unavailable.');
      return navigator.mediaDevices.enumerateDevices();
    }));
  }

  private ensureContext(): KaraFunAudioContext {
    if (!this.context) {
      this.context = this.options.createContext?.() ?? new AudioContext() as unknown as KaraFunAudioContext;
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }
  private matches(generation: string): Current | null { return this.current?.generation === generation ? this.current : null; }
  private position(current: Current): number {
    return Math.min(current.duration, Math.max(0, current.savedPosition +
      (current.status === 'playing' ? Math.max(0, (this.context?.currentTime ?? current.anchor) - current.anchor) : 0)));
  }
  private applyVolume(): void { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }
  private report(): void {
    const current = this.current;
    if (current?.ready) this.options.onEvent({ type: 'timeline', generation: current.generation,
      position: this.position(current), duration: current.duration, seekable: true });
  }
  private stopNodes(): void {
    const nodes = this.nodes; this.nodes = [];
    for (const { source, gain } of nodes) {
      source.onended = null;
      try { source.stop(); } catch { /* Already-ended sources can refuse Stop. */ }
      try { source.disconnect(); gain.disconnect(); } catch { /* Disconnected nodes are already silent. */ }
      source.buffer = null;
    }
  }

  /** Read an overview from the buffers already owned by the preview player. */
  waveform(generation: string, stemId: number, buckets = 1024): { peaks: Float32Array; duration: number } | null {
    const buffer = this.matches(generation)?.stems.find(stem => stem.input.id === stemId)?.buffer;
    if (!buffer?.getChannelData || !Number.isInteger(buckets) || buckets < 1 || buckets > 4096) return null;
    const peaks = new Float32Array(buckets);
    for (let channel = 0; channel < Math.min(buffer.numberOfChannels, 2); channel++) {
      const samples = buffer.getChannelData(channel);
      for (let bucket = 0; bucket < buckets; bucket++) {
        const first = Math.floor(bucket * samples.length / buckets);
        const last = Math.floor((bucket + 1) * samples.length / buckets);
        // A bounded sample within each bucket avoids blocking the editor on long tracks.
        const step = Math.max(1, Math.floor((last - first) / 256));
        for (let index = first; index < last; index += step) {
          peaks[bucket] = Math.max(peaks[bucket], Math.abs(samples[index]));
        }
      }
    }
    return { peaks, duration: buffer.duration };
  }

  async load(input: KaraFunPlaybackInput): Promise<void> {
    if (!input || typeof input.generation !== 'string' || !input.generation || input.generation.length > 500 ||
        !Array.isArray(input.stems) || !input.stems.length || input.stems.length > 12 ||
        !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 3600 ||
        typeof input.outputId !== 'string' || input.outputId.length > 4096 || !Number.isFinite(input.volume) ||
        (input.position !== undefined && (!Number.isFinite(input.position) || input.position < 0)))
      throw new Error('Invalid native KaraFun playback preparation.');
    const ids = new Set<number>();
    for (const stem of input.stems) {
      if (!stem || !Number.isSafeInteger(stem.id) || stem.id < 0 || stem.id > 255 || ids.has(stem.id) ||
          !Object.hasOwn(DEFAULT_MIX, stem.role) || typeof stem.src !== 'string' || !stem.src || stem.src.length > 8192 || /[\x00-\x1f\x7f]/.test(stem.src))
        throw new Error('Invalid prepared KaraFun stem.');
      ids.add(stem.id);
    }
    this.validateStemVolumes(ids, input.stemVolumes ?? {});
    const signature = JSON.stringify([input.durationSeconds, input.stems.map(({ id, role, src }) => [id, role, src])]);
    if (this.current?.generation === input.generation) {
      if (this.current.signature !== signature) throw new Error('A playback generation cannot change its prepared recording.');
      this.setVolume(input.generation, input.volume);
      if (input.mix) this.setMix(input.generation, input.mix);
      if (input.stemVolumes) this.setStemVolumes(input.generation, input.stemVolumes);
      if (this.current.outputId !== input.outputId && !this.current.outputBlocked)
        this.invalidateOutput('The chosen audio output changed. Resume deliberately after checking it.');
      return;
    }
    this.stop();
    const epoch = ++this.epoch, context = this.ensureContext(), controller = new AbortController();
    this.controller = controller; this.volume = level(input.volume); this.mix = { ...DEFAULT_MIX };
    this.stemVolumes = { ...input.stemVolumes };
    if (input.mix) for (const role of Object.keys(DEFAULT_MIX) as KaraFunStemRole[]) {
      if (input.mix[role] !== undefined) this.mix[role] = level(input.mix[role]!);
    }
    const current: Current = { generation: input.generation, status: 'loading', position: 0,
      savedPosition: input.position ?? 0, anchor: 0, duration: input.durationSeconds, ready: false,
      outputBlocked: false, outputRevision: 0, outputId: input.outputId, signature, stems: [], stemIds: ids };
    this.current = current;
    let decodedBytes = 0, encodedBytes = 0;
    try {
      for (const stem of input.stems) {
        const bytes = await (this.options.fetchAudio ?? fetchAudio)(stem.src, controller.signal);
        if (epoch !== this.epoch || controller.signal.aborted) throw replaced();
        encodedBytes += bytes.byteLength;
      if (!bytes.byteLength || bytes.byteLength > MAX_ENCODED_BYTES || encodedBytes > 512 * 1024 * 1024)
          throw new KaraFunPlayerError('requires-premix', 'This recording needs a prepared fixed audio mix.');
        const buffer = await context.decodeAudioData(bytes);
        if (epoch !== this.epoch || controller.signal.aborted) throw replaced();
        const bytesInBuffer = buffer.length * buffer.numberOfChannels * 4;
        if (!Number.isSafeInteger(bytesInBuffer) || bytesInBuffer < 1 || !Number.isFinite(buffer.duration) || buffer.duration <= 0)
          throw new KaraFunPlayerError('decode', 'A prepared audio stem could not be decoded.');
        decodedBytes += bytesInBuffer;
        if (decodedBytes > this.maximumDecodedBytes || buffer.duration > 3600)
          throw new KaraFunPlayerError('requires-premix', 'This recording is too large for live stem decoding. Prepare a fixed audio mix.');
        current.stems.push({ input: { ...stem }, buffer });
        current.duration = Math.max(current.duration, buffer.duration);
      }
      current.savedPosition = Math.min(current.duration, current.savedPosition);
      current.ready = true; current.status = 'paused';
      const outputRevision = current.outputRevision;
      try {
        await this.output.prepare(this.sink, input.outputId, () => this.current === current && epoch === this.epoch &&
          !current.outputBlocked && current.outputRevision === outputRevision);
      } catch {
        if (this.current === current) this.invalidateOutput('The selected audio output is unavailable. Choose an output and resume deliberately.');
      }
      if (epoch !== this.epoch || controller.signal.aborted) throw replaced();
      if (this.options.autoTick !== false && !this.timer) this.timer = setInterval(() => this.tick(), 250);
      this.report();
    } catch (error) {
      if (epoch !== this.epoch || controller.signal.aborted) throw replaced();
      current.stems = []; current.ready = false; current.status = 'error';
      this.muted = true; this.applyVolume(); this.stopNodes();
      const failure = error instanceof KaraFunPlayerError ? error : new KaraFunPlayerError('decode', 'Prepared KaraFun audio could not be read or decoded.');
      this.options.onEvent({ type: 'error', generation: current.generation, position: current.savedPosition, code: failure.code, message: failure.message });
      throw failure;
    }
  }

  async play(generation: string): Promise<boolean> {
    const current = this.matches(generation);
    if (!current?.ready || current.outputBlocked || current.status === 'error' || current.savedPosition >= current.duration) return false;
    if (current.status === 'playing') return true;
    const action = ++this.action, context = this.ensureContext();
    try { await context.resume(); }
    catch {
      if (this.current === current && action === this.action)
        this.invalidateOutput('Audio playback could not start. Check the output and resume deliberately.');
      return false;
    }
    if (this.current !== current || action !== this.action || current.outputBlocked) return false;
    this.stopNodes();
    // Schedule every source at the same future instant on ONE AudioContext.
    // Starting independent HTML audio elements would let duet voices drift.
    const when = context.currentTime + .025;
    current.anchor = when; current.status = 'playing';
    this.muted = false; this.applyVolume();
    try {
      for (const stem of current.stems) {
        if (stem.buffer.duration <= current.savedPosition) continue;
        const gain = context.createGain(), source = context.createBufferSource();
        gain.gain.value = this.stemVolumes[stem.input.id] ?? this.mix[stem.input.role]; source.buffer = stem.buffer;
        source.connect(gain); gain.connect(this.master);
        const node = { source, gain, role: stem.input.role, id: stem.input.id }; this.nodes.push(node);
        source.onended = () => { if (this.current === current && this.nodes.includes(node)) this.tick(); };
        source.start(when, current.savedPosition);
      }
      this.report(); return true;
    } catch {
      this.pause(generation); this.invalidateOutput('Audio playback could not start. Check the output and resume deliberately.');
      return false;
    }
  }

  pause(generation: string): boolean {
    const current = this.matches(generation);
    if (!current) return false;
    ++this.action; current.savedPosition = this.position(current);
    if (current.status === 'playing') current.status = 'paused';
    this.muted = true; this.applyVolume(); this.stopNodes(); this.report(); return true;
  }

  async seek(generation: string, position: number): Promise<boolean> {
    const current = this.matches(generation);
    if (!current?.ready || !Number.isFinite(position) || position < 0 || position >= current.duration) return false;
    const playing = current.status === 'playing';
    // AudioBufferSourceNodes are one-shot. Seeking recreates sources at the new
    // offset while retaining decoded buffers and the performance identity.
    this.pause(generation); current.savedPosition = position; current.status = 'paused'; this.report();
    return playing && !current.outputBlocked ? this.play(generation) : true;
  }

  setVolume(generation: string, volume: number): void { if (this.matches(generation) && Number.isFinite(volume)) { this.volume = level(volume); this.applyVolume(); } }
  setMix(generation: string, mix: Partial<KaraFunMix>): void {
    if (!this.matches(generation)) return;
    for (const role of Object.keys(DEFAULT_MIX) as KaraFunStemRole[]) if (mix[role] !== undefined && Number.isFinite(mix[role])) this.mix[role] = level(mix[role]!);
    this.applyStemVolumes();
  }

  private validateStemVolumes(ids: ReadonlySet<number>, volumes: KaraFunStemVolumes): void {
    if (!volumes || typeof volumes !== 'object' || Array.isArray(volumes) ||
        Object.entries(volumes).some(([id, value]) => !/^(?:0|[1-9]\d{0,2})$/.test(id) || !ids.has(Number(id)) || !validStemVolume(value)))
      throw new Error('Invalid prepared KaraFun channel volumes.');
  }
  setStemVolumes(generation: string, volumes: KaraFunStemVolumes): void {
    const current = this.matches(generation);
    if (!current) return;
    this.validateStemVolumes(current.stemIds, volumes);
    // Replace the full projection, including Reset. It can arrive during decode;
    // available IDs come from the manifest rather than only decoded buffers.
    this.stemVolumes = { ...volumes }; this.applyStemVolumes();
  }
  private applyStemVolumes(): void {
    const now = this.context?.currentTime ?? 0;
    for (const node of this.nodes) {
      const value = this.stemVolumes[node.id] ?? this.mix[node.role], parameter = node.gain.gain;
      // A short gain ramp avoids clicks without restarting a source or its clock.
      if (parameter.cancelAndHoldAtTime && parameter.linearRampToValueAtTime) {
        parameter.cancelAndHoldAtTime(now); parameter.linearRampToValueAtTime(value, now + .015);
      } else parameter.value = value;
    }
  }

  invalidateOutput(message = 'Audio devices changed. Check the output and resume deliberately.'): number {
    const current = this.current;
    if (!current) return 0;
    current.outputBlocked = true; ++current.outputRevision;
    this.output.invalidate(this.sink);
    this.options.onEvent({ type: 'output-error', generation: current.generation, position: this.position(current), revision: current.outputRevision, message });
    return current.outputRevision;
  }

  async recoverOutput(generation: string, revision: number, outputId: string): Promise<boolean> {
    const current = this.matches(generation);
    if (!current?.ready || !current.outputBlocked || current.outputRevision !== revision || typeof outputId !== 'string') return false;
    const epoch = this.epoch;
    try {
      const routed = await this.output.prepare(this.sink, outputId, () => this.current === current && epoch === this.epoch && current.outputRevision === revision);
      if (!routed || this.current !== current || current.outputRevision !== revision) return false;
      current.outputId = outputId; current.outputBlocked = false;
      // Routing authorizes a future Play; it must not itself resume audio.
      this.muted = true; this.applyVolume(); this.report(); return true;
    } catch { if (this.current === current) { this.muted = true; this.applyVolume(); } return false; }
  }

  snapshot(): KaraFunPlayerSnapshot | null {
    const current = this.current;
    return current ? { generation: current.generation, status: current.status, position: this.position(current), duration: current.duration,
      ready: current.ready, outputBlocked: current.outputBlocked, outputRevision: current.outputRevision } : null;
  }
  tick(): void {
    const current = this.current;
    if (!current) return;
    if (current.status === 'playing' && this.position(current) >= current.duration) {
      current.savedPosition = current.duration; current.status = 'ended'; ++this.action;
      this.muted = true; this.applyVolume(); this.stopNodes(); this.report();
      this.options.onEvent({ type: 'ended', generation: current.generation, position: current.duration });
    } else if (current.status === 'playing') this.report();
  }
  stop(generation?: string): boolean {
    if (generation !== undefined && !this.matches(generation)) return false;
    ++this.epoch; ++this.action; this.controller?.abort(); this.controller = null;
    this.muted = true; this.applyVolume(); this.stopNodes(); this.current = null;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    return true;
  }
  async dispose(): Promise<void> {
    this.stop(); const context = this.context; this.context = null;
    try { this.master?.disconnect(); } catch { /* Already disconnected. */ }
    this.master = null; if (context) await context.close();
  }
}
