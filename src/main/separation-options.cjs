const format = ['wav', 'flac', 'mp3'];
const twoStems = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'];
const overlap = { min: 0, max: 0.999 };
const positive = { min: 1, max: 65536, integer: true };
const optionsByAdapter = {
  'audio-separator': {
    format, mdx_segment_size: positive, mdx_overlap: overlap, mdx_batch_size: positive,
    mdx_hop_length: positive, mdx_enable_denoise: true, vr_batch_size: positive,
    vr_window_size: positive, vr_aggression: { min: -100, max: 100, integer: true },
    vr_enable_tta: true, vr_enable_post_process: true, vr_high_end_process: true,
    mdxc_segment_size: positive, mdxc_batch_size: positive, mdxc_overlap: positive,
    mdxc_override_model_segment_size: true, demucs_segment_size: positive,
    demucs_overlap: overlap, demucs_shifts: { min: 0, max: 100, integer: true },
  },
  demucs: {
    format, 'two-stems': twoStems, segment: positive, overlap,
    shifts: { min: 0, max: 100, integer: true }, jobs: { min: 0, max: 256, integer: true },
  },
  dango: {
    format: ['mp3', 'flac'], modelType: ['default', 'conserve', 'aggressive'], separateBackingVocals: true,
  },
  mvsep: {},
  gaudio: {},
};

function parseModelOptions(source) {
  if (source === undefined) return {};
  const result = Object.create(null);
  if (typeof source !== 'string' || !source.trim() || source.length > 4096) throw new Error('Use --model-options with a comma-separated list of key=value pairs.');
  for (const entry of source.split(',')) {
    const pair = /^\s*([a-z][a-z_\d-]*)\s*=\s*([^=,]+?)\s*$/i.exec(entry);
    if (!pair) throw new Error('Use --model-options with a comma-separated list of key=value pairs.');
    const [, key, value] = pair;
    if (Object.hasOwn(result, key)) throw new Error('Model option ' + key + ' is specified more than once.');
    result[key] = value;
  }
  return result;
}

function listModelOptions(adapter) {
  if (!Object.hasOwn(optionsByAdapter, adapter)) throw new Error('Choose a supported stem separator.');
  return Object.keys(optionsByAdapter[adapter]);
}

function validatedModelOptions(adapter, requested = {}) {
  const validKeys = listModelOptions(adapter);
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new Error('Invalid model options.');
  const definitions = optionsByAdapter[adapter];
  return Object.fromEntries(Object.entries(requested).map(([key, value]) => {
    if (!Object.hasOwn(definitions, key)) {
      throw new Error('Unsupported model option "' + key + '" for ' + adapter + '. Available options: ' + validKeys.join(', ') + '.');
    }
    const rule = definitions[key];
    if (Array.isArray(rule)) {
      if (!rule.includes(value)) throw new Error('Choose ' + rule.join(', ') + ' for ' + key + '.');
      return [key, value];
    }
    if (rule === true) {
      if (value === true || value === 'true') return [key, true];
      if (value === false || value === 'false') return [key, false];
      throw new Error(key + ' must be true or false.');
    }
    const number = typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : value;
    if (!Number.isFinite(number) || number < rule.min || number > rule.max || (rule.integer && !Number.isInteger(number))) {
      throw new Error(key + ' must be ' + (rule.integer ? 'a whole number' : 'a number') + ' between ' + rule.min + ' and ' + rule.max + '.');
    }
    return [key, number];
  }));
}

function localSeparatorArgs(adapter, options) {
  const args = [];
  for (const [key, value] of Object.entries(validatedModelOptions(adapter, options))) {
    if (key === 'format') {
      if (adapter === 'audio-separator') args.push('--output_format', value.toUpperCase());
      else if (value !== 'wav') args.push('--' + value);
    } else if (typeof value === 'boolean') {
      if (value) args.push('--' + key);
    } else {
      args.push('--' + key, String(value));
    }
  }
  return args;
}

module.exports = { parseModelOptions, validatedModelOptions, localSeparatorArgs, listModelOptions };
