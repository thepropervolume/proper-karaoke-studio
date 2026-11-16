import { SaxesParser } from 'saxes';

/** TPV's provider-neutral drawing values, interpreted from the kit wire format. */
export type KaraFunBox = { x: number; y: number; width: number; height: number };
export type KaraFunSyllable = { startSeconds: number; endSeconds: number; text: string };
export type KaraFunWord = { id: number; syllables: KaraFunSyllable[] };
export type KaraFunLine = { id: number; box: KaraFunBox | null; leadIn: { x: number; startSeconds: number } | null; words: KaraFunWord[]; syllables: KaraFunSyllable[] };
export type KaraFunPage = {
  id: number; startSeconds: number; endSeconds: number;
  fadeIn: { startSeconds: number; durationSeconds: number }; fadeOut: { startSeconds: number; durationSeconds: number };
  activeColor: string | null; inactiveColor: string | null; rightToLeft: boolean;
  trackId: number | null; voice: string | null; lines: KaraFunLine[];
};
export type KaraFunCountIn = {
  startSeconds: number; endSeconds: number; stepSeconds: number; steps: number; box: KaraFunBox | null;
  activeColor: string | null; inactiveColor: string | null; activeBorderColor: string | null; inactiveBorderColor: string | null; borderWidth: number;
};
export type KaraFunTrack = { id: number; caption: string | null; fileIndex: number | null };
export type KaraFunFileLabel = { id: number; label: string };
// The parser converts provider units/layout into this bounded model. Drawing
// depends on these values, not on XML nodes, URLs or account credentials.
export type KaraFunTiming = {
  durationSeconds: number; bounds: KaraFunBox; rightToLeft: boolean;
  pages: KaraFunPage[]; countIns: KaraFunCountIn[]; tracks: KaraFunTrack[]; files: KaraFunFileLabel[];
};

export type KaraFunKitErrorCode = 'invalid-container' | 'container-limit' | 'invalid-timing' | 'timing-limit' | 'unsupported-audio';
export class KaraFunKitError extends Error {
  constructor(readonly code: KaraFunKitErrorCode, message: string) { super(message); this.name = 'KaraFunKitError'; }
}
export type KaraFunTimingLimits = { xmlBytes: number; nodes: number; depth: number; attributes: number; syllables: number; textLength: number };
export const KARAFUN_TIMING_LIMITS: Readonly<KaraFunTimingLimits> = Object.freeze({ xmlBytes: 8 * 1024 * 1024, nodes: 150_000, depth: 40, attributes: 64, syllables: 40_000, textLength: 8192 });
type Element = { name: string; attributes: Record<string, string>; children: Element[]; content: (string | Element)[] };
const MAX_SECONDS = 24 * 60 * 60;
function fail(): never { throw new KaraFunKitError('invalid-timing', 'The KaraFun timing data is invalid or unsupported.'); }
function tooLarge(): never { throw new KaraFunKitError('timing-limit', 'The KaraFun timing data exceeds the supported limits.'); }

function effectiveLimits(overrides: Partial<KaraFunTimingLimits>): KaraFunTimingLimits {
  const limits = { ...KARAFUN_TIMING_LIMITS, ...overrides };
  for (const key of Object.keys(KARAFUN_TIMING_LIMITS) as (keyof KaraFunTimingLimits)[])
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > KARAFUN_TIMING_LIMITS[key]) tooLarge();
  return limits;
}

/** Strict SAX parsing has no external entity resolver; reject DTDs before use. */
function readXml(xml: string, limits: KaraFunTimingLimits): Element {
  if (typeof xml !== 'string') fail();
  if (xml.length > limits.xmlBytes || new TextEncoder().encode(xml).byteLength > limits.xmlBytes) tooLarge();
  const stack: Element[] = [];
  let root: Element | undefined, count = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => fail());
  parser.on('error', () => fail());
  parser.on('opentag', tag => {
    if (++count > limits.nodes || stack.length >= limits.depth || Object.keys(tag.attributes).length > limits.attributes) tooLarge();
    const attributes: Record<string, string> = Object.create(null);
    for (const [name, value] of Object.entries(tag.attributes)) {
      if (name.length > 256 || value.length > limits.textLength) tooLarge();
      attributes[name] = value;
    }
    const element: Element = { name: tag.name.split(':').at(-1)!, attributes, children: [], content: [] };
    const parent = stack.at(-1);
    if (parent) { parent.children.push(element); parent.content.push(element); }
    else if (root) fail();
    else root = element;
    stack.push(element);
  });
  const text = (value: string) => {
    if (value.length > limits.xmlBytes) tooLarge();
    if (stack.length) stack.at(-1)!.content.push(value);
    else if (value.trim()) fail();
  };
  parser.on('text', text); parser.on('cdata', text);
  parser.on('closetag', () => { if (!stack.pop()) fail(); });
  try { parser.write(xml).close(); }
  catch (error) { if (error instanceof KaraFunKitError) throw error; fail(); }
  if (!root || stack.length) fail();
  return root;
}

function children(node: Element, name: string): Element[] { return node.children.filter(item => item.name === name); }
function child(node: Element, name: string): Element | undefined {
  const result = children(node, name);
  if (result.length > 1) fail();
  return result[0];
}
function content(node: Element | undefined, limit = 8192): string {
  if (!node) return '';
  let value = '';
  for (const part of node.content) {
    value += typeof part === 'string' ? part : content(part, limit);
    if (value.length > limit) tooLarge();
  }
  return value;
}
function number(value: string | undefined, fallback = 0, min = 0, max = MAX_SECONDS): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) fail();
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) fail();
  return result;
}
function integer(value: string | undefined, fallback = 0, max = 0x7fffffff): number {
  const result = number(value, fallback, 0, max);
  if (!Number.isSafeInteger(result)) fail();
  return result;
}
export function parseKaraFunCue(value: string): number {
  if (!value.trim()) return 0;
  const match = /^(\d{2,3}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(value.trim());
  if (!match) fail();
  const result = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  if (result > MAX_SECONDS) fail();
  return result;
}
function cue(node: Element, name: string): number { return parseKaraFunCue(content(child(node, name), 32)); }
function color(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) fail();
  // The format carries RGB; an optional trailing byte is not CSS alpha.
  return '#' + normalized.slice(0, 6).toUpperCase();
}
function box(node: Element | undefined): KaraFunBox | null {
  if (!node) return null;
  const a = node.attributes;
  const result = { x: number(a.x, 0, -1_000_000, 1_000_000), y: number(a.y, 0, -1_000_000, 1_000_000), width: number(a.width, 0, 0, 1_000_000), height: number(a.height, 0, 0, 1_000_000) };
  return result.width > 0 && result.height > 0 ? result : null;
}
/** Role facts are taken from labels, never guessed from numeric stream IDs. */
export function describeKaraFunStemLabel(label: string, caption: string | null = null): { role: 'instrumental' | 'backing' | 'lead' | 'other'; voice: string | null } {
  const base = label.trim().split(/[\\/]/).at(-1)!.replace(/\.[^.]*$/, '');
  if (/^ins(?:_|$)/i.test(base)) return { role: 'instrumental', voice: null };
  if (/^bv(?:_|$)/i.test(base)) return { role: 'backing', voice: caption?.trim() || base.slice(3).trim() || null };
  if (/^ld(?:_|$)/i.test(base)) return { role: 'lead', voice: caption?.trim() || base.slice(3).trim() || null };
  return { role: 'other', voice: null };
}

export function parseKaraFunTiming(xml: string, overrides: Partial<KaraFunTimingLimits> = {}): KaraFunTiming {
  const limits = effectiveLimits(overrides), document = readXml(xml, limits);
  const karaoke = document.name === 'karaoke' ? document : child(document, 'karaoke');
  if (!karaoke) fail();
  const files: KaraFunFileLabel[] = [], fileIds = new Set<number>();
  for (const group of children(document, 'files')) for (const file of children(group, 'file')) {
    if (file.attributes.index === undefined || !file.attributes.label?.trim()) fail();
    const id = integer(file.attributes.index, 0, 255);
    if (fileIds.has(id)) fail(); fileIds.add(id);
    files.push({ id, label: file.attributes.label });
  }
  const tracks: KaraFunTrack[] = [], trackIds = new Set<number>();
  for (const group of children(karaoke, 'kfntracks')) for (const track of children(group, 'kfntrack')) {
    if (track.attributes.id === undefined) fail();
    const id = integer(track.attributes.id);
    if (trackIds.has(id)) fail(); trackIds.add(id);
    tracks.push({ id, caption: track.attributes.caption?.trim() || null, fileIndex: track.attributes.file_index === undefined ? null : integer(track.attributes.file_index, 0, 255) });
  }
  const voice = (trackId: number | null): string | null => {
    const track = tracks.find(item => item.id === trackId);
    if (!track) return null;
    if (track.fileIndex === null) return track.caption;
    const label = files.find(item => item.id === track.fileIndex)?.label;
    const caption = tracks.find(item => item.fileIndex === track.fileIndex && item.caption)?.caption || null;
    return label ? describeKaraFunStemLabel(label, caption).voice : track.caption;
  };
  let syllables = 0;
  const pages: KaraFunPage[] = children(karaoke, 'page').map((page, pageIndex) => {
    const lines: KaraFunLine[] = children(page, 'line').map((line, lineIndex) => {
      const words: KaraFunWord[] = children(line, 'word').map((word, wordIndex) => ({ id: integer(word.attributes.id, wordIndex), syllables: children(word, 'syllabe').map(syllable => {
        if (++syllables > limits.syllables) tooLarge();
        const startSeconds = cue(syllable, 'start'), endSeconds = cue(syllable, 'end');
        if (endSeconds < startSeconds) fail();
        return { startSeconds, endSeconds, text: content(child(syllable, 'text'), limits.textLength) };
      }) }));
      const flattened = words.flatMap((word, wordIndex) => word.syllables.map((item, index) => ({ ...item, text: wordIndex > 0 && index === 0 ? ' ' + item.text : item.text })));
      const lead = child(line, 'progressivebar');
      return { id: integer(line.attributes.id, lineIndex), box: box(child(line, 'position')), leadIn: lead ? { x: number(lead.attributes.x, 0, -1_000_000, 1_000_000), startSeconds: cue(lead, 'start') } : null, words, syllables: flattened };
    });
    const fadeIn = { startSeconds: cue(page, 'fadeinstart'), durationSeconds: cue(page, 'fadeinduration') };
    const fadeOut = { startSeconds: cue(page, 'fadeoutstart'), durationSeconds: cue(page, 'fadeoutduration') };
    const times = lines.flatMap(line => line.syllables);
    let startSeconds = fadeIn.startSeconds, endSeconds = fadeOut.startSeconds + fadeOut.durationSeconds;
    if (endSeconds <= startSeconds) {
      startSeconds = times.length ? Math.max(0, Math.min(...times.map(item => item.startSeconds)) - .5) : 0;
      endSeconds = times.length ? Math.max(...times.map(item => item.endSeconds)) + 1 : 0;
    }
    if (endSeconds > MAX_SECONDS || fadeIn.startSeconds + fadeIn.durationSeconds > MAX_SECONDS) fail();
    const trackId = page.attributes.kfntrackid === undefined ? null : integer(page.attributes.kfntrackid);
    if (page.attributes.isrighttoleft !== undefined && !['0', '1'].includes(page.attributes.isrighttoleft)) fail();
    return { id: integer(page.attributes.id, pageIndex), startSeconds, endSeconds, fadeIn, fadeOut, activeColor: color(page.attributes.activecolor), inactiveColor: color(page.attributes.inactivecolor), rightToLeft: page.attributes.isrighttoleft === '1', trackId, voice: voice(trackId), lines };
  });
  const countIns: KaraFunCountIn[] = children(karaoke, 'silence').map(silence => {
    const startSeconds = cue(silence, 'start'), endSeconds = cue(silence, 'end');
    if (endSeconds < startSeconds) fail();
    return { startSeconds, endSeconds, stepSeconds: parseKaraFunCue(silence.attributes.step || ''), steps: integer(silence.attributes.count, 0, 1000), box: box(child(silence, 'position')), activeColor: color(silence.attributes.activecolor), inactiveColor: color(silence.attributes.inactivecolor), activeBorderColor: color(silence.attributes.activebordercolor), inactiveBorderColor: color(silence.attributes.inactivebordercolor), borderWidth: number(silence.attributes.bordersize, 0, 0, 1000) };
  });
  const allSyllables = pages.flatMap(page => page.lines.flatMap(line => line.syllables));
  const declaredDuration = number(karaoke.attributes.duration);
  const durationSeconds = declaredDuration || (allSyllables.length ? Math.max(...allSyllables.map(item => item.endSeconds)) + 2 : 0);
  if (!durationSeconds || durationSeconds > MAX_SECONDS) fail();
  const bounds = { x: 0, y: 0, width: 640, height: 360 };
  for (const item of [...pages.flatMap(page => page.lines.map(line => line.box)), ...countIns.map(item => item.box)]) {
    if (!item) continue;
    bounds.width = Math.max(bounds.width, item.x + item.width); bounds.height = Math.max(bounds.height, item.y + item.height);
  }
  return { durationSeconds, bounds, rightToLeft: pages.some(page => page.rightToLeft), pages, countIns, tracks, files };
}
