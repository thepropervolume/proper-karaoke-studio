import type { LyricLine, TimedWord } from './project';

type Path = string[];
type Timing = { text: Path; start: Path; end?: Path; duration?: Path };
type Unit = 'seconds' | 'milliseconds';

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(name + ' must be an object.');
  }
  return value as Record<string, unknown>;
}

function pointer(value: unknown, name: string): Path {
  if (typeof value !== 'string' || (value !== '' && !value.startsWith('/')) || /~(?![01])/u.test(value)) {
    throw new Error(name + ' must be a JSON Pointer.');
  }
  if (!value) return [];
  return value.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function optionalPointer(value: unknown, name: string): Path | undefined {
  return value === undefined ? undefined : pointer(value, name);
}

function readPath(source: unknown, path: Path): unknown {
  let value: unknown = source;
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be non-empty text.');
  return value;
}

function mappingTiming(source: Record<string, unknown>, label: string): Timing {
  const end = optionalPointer(source.end, label + '.end');
  const duration = optionalPointer(source.duration, label + '.duration');
  if (Boolean(end) === Boolean(duration)) {
    throw new Error(label + ' needs exactly one of end or duration.');
  }
  return {
    text: pointer(source.text, label + '.text'),
    start: pointer(source.start, label + '.start'),
    end,
    duration,
  };
}

function number(value: unknown, unit: Unit, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(label + ' must be a finite, nonnegative number.');
  }
  return unit === 'milliseconds' ? value / 1000 : value;
}

function timed(source: unknown, mapping: Timing, unit: Unit, label: string, offset = 0): TimedWord {
  const startSeconds = offset + number(readPath(source, mapping.start), unit, label + ' start');
  const endSeconds = mapping.end
    ? offset + number(readPath(source, mapping.end), unit, label + ' end')
    : startSeconds + number(readPath(source, mapping.duration!), unit, label + ' duration');
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds < startSeconds) {
    throw new Error(label + ' has an invalid time range.');
  }
  return { text: text(readPath(source, mapping.text), label + ' text'), startSeconds, endSeconds };
}

// The renderer concatenates word strings exactly. Preserve the source line's
// whitespace between tokens even when the source stores its words separately.
function preserveWordSpacing(line: TimedWord, words: TimedWord[], label: string): TimedWord[] {
  if (!words.length || words.map(word => word.text).join('') === line.text) return words;
  let cursor = 0;
  const result = words.map(word => {
    const token = word.text.trim();
    const start = line.text.indexOf(token, cursor);
    if (start < 0 || line.text.slice(cursor, start).trim()) {
      throw new Error(label + ' word text does not match its line text.');
    }
    const end = start + token.length;
    const slice = line.text.slice(cursor, end);
    cursor = end;
    return { ...word, text: slice };
  });
  const trailing = line.text.slice(cursor);
  if (trailing.trim()) throw new Error(label + ' word text does not match its line text.');
  result[result.length - 1].text += trailing;
  return result;
}

/** Decode a previously unknown JSON format using explicitly supplied field pointers. */
export function mapJsonLyrics(source: unknown, inputMapping: unknown): { title?: string; artist?: string; lines: LyricLine[] } {
  const mapping = object(inputMapping, 'Mapping');
  if (mapping.timeUnit !== 'seconds' && mapping.timeUnit !== 'milliseconds') {
    throw new Error('Mapping timeUnit must be seconds or milliseconds.');
  }
  const unit = mapping.timeUnit;
  const lineFields = object(mapping.line, 'Mapping line');
  const lineMapping = mappingTiming(lineFields, 'Mapping line');
  const wordsPath = optionalPointer(lineFields.words, 'Mapping line.words');
  const wordFields = mapping.word === undefined ? undefined : object(mapping.word, 'Mapping word');
  if (Boolean(wordsPath) !== Boolean(wordFields)) {
    throw new Error('Set both Mapping line.words and Mapping word for word timings.');
  }
  const wordMapping = wordFields && mappingTiming(wordFields, 'Mapping word');
  if (wordFields?.relativeTo !== undefined && wordFields.relativeTo !== 'timeline' && wordFields.relativeTo !== 'line') {
    throw new Error('Mapping word.relativeTo must be timeline or line.');
  }
  const metadata = (key: 'title' | 'artist') => {
    const path = optionalPointer(mapping[key], 'Mapping ' + key);
    return path ? text(readPath(source, path), 'Song ' + key) : undefined;
  };
  const title = metadata('title'), artist = metadata('artist');
  const cues = readPath(source, pointer(mapping.cues, 'Mapping cues'));
  if (!Array.isArray(cues) || !cues.length) throw new Error('Mapping cues must point to a non-empty array of lyric cues.');
  if (cues.length > 10000) throw new Error('A mapped lyrics file can contain at most 10,000 cues.');
  const lines = cues.map((sourceLine, index) => {
    const label = 'Cue ' + (index + 1);
    const line = timed(sourceLine, lineMapping, unit, label);
    let words: TimedWord[] = [];
    if (wordsPath && wordMapping) {
      const entries = readPath(sourceLine, wordsPath);
      if (!Array.isArray(entries) || entries.length > 1000) {
        throw new Error(label + ' words must be an array with at most 1,000 entries.');
      }
      const offset = wordFields?.relativeTo === 'line' ? line.startSeconds : 0;
      words = entries.map((entry, wordIndex) => {
        const wordLabel = label + ', word ' + (wordIndex + 1);
        const word = timed(entry, wordMapping, unit, wordLabel, offset);
        if (word.startSeconds < line.startSeconds - 1e-9 || word.endSeconds > line.endSeconds + 1e-9) {
          throw new Error(wordLabel + ' timing is outside its cue.');
        }
        return word;
      });
      words = preserveWordSpacing(line, words, label);
    }
    return { id: crypto.randomUUID(), ...line, words };
  });
  return { title, artist, lines };
}
