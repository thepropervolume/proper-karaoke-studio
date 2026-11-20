import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { KaraFunPlayer as KaraokePlayer, type KaraFunPlayerEvent as KaraokePlayerEvent, type KaraFunStemSource as KaraokeStemSource } from '../shared/from-booth/display/karafun-player';
import { paintKaraFunLyrics } from '../shared/from-booth/display/karafun-lyrics';
import { finishTimedWord, newLyricLines, recordTimedWordStart, seedTimedWords, timedWordCount, toPortableKitProject, toRenderTiming, type LyricLine, type StudioProject, type StudioRole, type StudioStem } from '../domain/project';
import { parseLyricsFile, toAss, toLrc, toLyricsJson, toSrt } from '../domain/lyrics-formats';
import { formatLyricText, MAXIMUM_LYRIC_TEXT_BYTES, readLyricVersions, type LyricFormatOptions, type LyricVersion } from '../domain/lyric-format';
import { applyForcedAlignment } from '../domain/forced-alignment';
import { defaultLyricStyle, lyricFonts, normalizeLyricStyle } from '../domain/lyric-style';
import { DEFAULT_LYRIC_FORMAT_OPTIONS } from '../domain/lyric-format';
import { CdgPlayer, cdgByteLimit } from '../domain/cdg';
import { CdgPreview } from './CdgPreview';
import { WaveformTimeline } from './WaveformTimeline';
import { StudioIcon, type StudioIconName } from './StudioIcon';
import { WorkspaceSeparator, defaultInspectorWidth, inspectorMax, minInspectorWidth } from './WorkspaceSeparator';
import { VoiceRecorder } from './VoiceRecorder';
import { PreferencesDialog, preferenceError } from './PreferencesDialog';
import { LyricAppearance } from './LyricAppearance';
import { BackdropPreview } from './BackdropPreview';
import { LyricFormatFields } from './LyricFormatFields';
import { version } from '../../package.json';
import markDark from '../../assets/branding/icon-dark.svg';
import markLight from '../../assets/branding/icon-light.svg';

const roles: StudioRole[] = ['instrumental', 'lead', 'backing', 'other'];
const allAudible = { instrumental: 1, lead: 1, backing: 1, other: 1 } as const;
const seconds = (value: number) => Math.floor(value / 60) + ':' + (value % 60).toFixed(1).padStart(4, '0');
const safeName = (value: string) => value.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 100) || 'Untitled';
const basename = (value: string) => value.split(/[\\/]/).at(-1);

function separatedRole(path: string): StudioRole {
  const name = (basename(path) ?? '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  if (/\b(no vocals|instrumental|accompaniment)\b/i.test(name)) return 'instrumental';
  if (/\b(backing|background|low vocals)\b/i.test(name)) return 'backing';
  return /\b(lead|vocals?)\b/i.test(name) ? 'lead' : 'other';
}
const normalizedCueText = (value: string) => value.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean).join('\n');
const versionLabel = (version: LyricVersion, index: number) => [
  'Version ' + (index + 1), [version.artist, version.track].filter(Boolean).join(' – '), version.album,
  version.duration ? seconds(version.duration) : '',
].filter(Boolean).join(' · ');

const workspaces = [
  { id: 'audio', label: 'Audio Stems', icon: 'audio' },
  { id: 'lyrics', label: 'Lyrics', icon: 'lyrics' },
  { id: 'export', label: 'Export', icon: 'export' },
] as const;
type Workspace = typeof workspaces[number]['id'];
type Appearance = { theme: 'day' | 'night'; accent: 'blue' | 'pink' | 'purple' };
const appearanceKey = 'tpv-studio-appearance';
const panelWidthKey = 'tpv-studio-inspector-width';

function readAppearance(): Appearance {
  try {
    const saved: Partial<Appearance> = JSON.parse(window.localStorage.getItem(appearanceKey) || '{}');
    return { theme: saved.theme === 'day' ? 'day' : 'night',
      accent: saved.accent === 'pink' || saved.accent === 'purple' ? saved.accent : 'blue' };
  } catch { return { theme: 'night', accent: 'blue' }; }
}

function readInspectorWidth() {
  try {
    const stored = Number(window.localStorage.getItem(panelWidthKey));
    if (Number.isFinite(stored) && stored >= minInspectorWidth) return stored;
  } catch { /* Preferences remain usable for this session. */ }
  return defaultInspectorWidth;
}

function IconButton({ icon, label, hint = label, onClick, disabled, className = '' }: {
  icon: StudioIconName; label: string; hint?: string; onClick(): void; disabled?: boolean; className?: string;
}) {
  return <button type="button" className={'icon-button ' + className} aria-label={label} data-tip={hint}
    disabled={disabled} onClick={onClick}><StudioIcon name={icon} /></button>;
}

async function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const dispose = () => {
      audio.onloadedmetadata = null; audio.onerror = null;
      audio.removeAttribute('src'); audio.load();
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      dispose();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('Studio could not read the length of this audio file. Try exporting it as WAV or MP3.'));
    };
    audio.onerror = () => {
      dispose();
      reject(new Error('Studio could not open this audio file for preview. Check whether the file is available locally.'));
    };
    audio.src = url;
  });
}

export function App() {
  const player = useRef<KaraokePlayer | null>(null), generation = useRef('');
  const timingRef = useRef(false), captureAction = useRef<() => void>(() => undefined);
  const linesRef = useRef<LyricLine[]>([]);
  const canvas = useRef<HTMLCanvasElement | null>(null), stemRef = useRef<StudioStem[]>([]);
  const [stems, setStems] = useState<StudioStem[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>('audio');
  const [appearance, setAppearance] = useState(readAppearance);
  const [storedInspectorWidth, setInspectorWidth] = useState(readInspectorWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [lyricAppearanceOpen, setLyricAppearanceOpen] = useState(false);
  const [lyricStyle, setLyricStyle] = useState(defaultLyricStyle);
  const [fontReady, setFontReady] = useState(0);
  const [draftOpen, setDraftOpen] = useState(true);
  const inspectorMaximum = inspectorMax(viewportWidth);
  const inspectorWidth = Math.min(inspectorMaximum, storedInspectorWidth);
  const [alignmentStemId, setAlignmentStemId] = useState('');
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [title, setTitle] = useState(''), [artist, setArtist] = useState('');
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0);
  const [waveform, setWaveform] = useState<{ peaks: Float32Array; duration: number } | null>(null);
  const [playing, setPlaying] = useState(false), [volume, setVolume] = useState(0.8);
  const [lyricsDraft, setLyricsDraft] = useState(''), [nextLine, setNextLine] = useState(0), [nextWord, setNextWord] = useState(0), [captureMode, setCaptureMode] = useState<'line' | 'word'>('line'), [timing, setTiming] = useState(false);
  const [draftPending, setDraftPending] = useState(false);
  const [lyricFormatOverride, setLyricFormatOverride] = useState<LyricFormatOptions | null>(null);
  const [lyricVersions, setLyricVersions] = useState<{ name: string; items: LyricVersion[] } | null>(null);
  const lyricFileRequest = useRef(0);
  const [status, setStatus] = useState('Create a project by importing audio stems.');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<StudioSettings>({
    ffmpegPath: 'ffmpeg', separatorAdapter: 'audio-separator', separatorExecutable: 'audio-separator', separatorModel: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    lyricAlignerExecutable: '', alignmentLanguage: 'en', lyricFormat: DEFAULT_LYRIC_FORMAT_OPTIONS,
    uvrModelsPath: '', ensembleModels: [], backingModel: '',
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [busy, setBusy] = useState(false);
  const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
  const [cdgPath, setCdgPath] = useState<string | null>(null);
  const [decodedCdg, setDecodedCdg] = useState<CdgPlayer | null>(null);
  const [background, setBackground] = useState<{ url: string; path: string; motion: boolean } | null>(null);
  const [backgroundLoop, setBackgroundLoop] = useState(true);
  const [openedProject, setOpenedProject] = useState<(StudioProjectOrigin & { snapshot: string | null }) | null>(null);
  const [projectTransition, setProjectTransition] = useState(true);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryEntries, setRecoveryEntries] = useState<StudioRecoveryEntry[]>([]);
  const [recoveryError, setRecoveryError] = useState('');
  const initialProjectChecked = useRef(false);

  useEffect(() => {
    try { window.localStorage.setItem(appearanceKey, JSON.stringify(appearance)); } catch { /* Session-only appearance. */ }
  }, [appearance]);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const resizeInspector = (value: number) => {
    const next = Math.min(inspectorMaximum, Math.max(minInspectorWidth, Math.round(value)));
    setInspectorWidth(next);
    try { window.localStorage.setItem(panelWidthKey, String(next)); } catch { /* Session-only size. */ }
  };

  useEffect(() => {
    player.current = new KaraokePlayer({ onEvent(event: KaraokePlayerEvent) {
      if (event.generation !== generation.current) return;
      if (event.type === 'timeline') { setPosition(event.position); setDuration(event.duration); setPlaying(player.current?.snapshot()?.status === 'playing'); }
      if (event.type === 'ended') setPlaying(false);
      if (event.type === 'error') { setError(event.message); setPlaying(false); }
      if (event.type === 'output-error') {
        setError('Audio output is unavailable. Check your system audio output, then press Play to retry.');
        setPlaying(false);
      }
    } });
    void window.studio.getSettings().then(setSettings).catch(cause => setError(String(cause)))
      .finally(() => setSettingsLoaded(true));
    const timer = window.setInterval(() => {
      const snapshot = player.current?.snapshot();
      if (snapshot) { setPosition(snapshot.position); setDuration(snapshot.duration); setPlaying(snapshot.status === 'playing'); }
    }, 150);
    return () => {
      window.clearInterval(timer);
      void player.current?.dispose();
      for (const stem of stemRef.current) if (stem.file) URL.revokeObjectURL(stem.url);
      if (background?.url.startsWith('blob:')) URL.revokeObjectURL(background.url);
    };
  }, []);

  useEffect(() => { stemRef.current = stems; }, [stems]);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  const renderTiming = useMemo(() => toRenderTiming(lines, duration, lyricStyle), [lines, duration, lyricStyle]);
  const cdgPlayer = lines.length ? null : decodedCdg;
  const previewDuration = duration || cdgPlayer?.durationSeconds || 0;
  const livePosition = useCallback(() => player.current?.snapshot()?.position, []);
  const wordCount = useMemo(() => timedWordCount(lines), [lines]);
  const wordOffsets = useMemo(() => {
    let offset = 0;
    return lines.map(line => { const current = offset; offset += line.words.length; return current; });
  }, [lines]);
  useEffect(() => {
    let current = true;
    void document.fonts.load(`700 24px "${lyricFonts[lyricStyle.font].family}"`)
      .then(() => { if (current) setFontReady(value => value + 1); }).catch(() => {});
    return () => { current = false; };
  }, [lyricStyle.font]);
  useEffect(() => {
    const paint = () => {
      if (canvas.current) paintKaraFunLyrics(canvas.current, renderTiming, position, {
        fontFamily: '"' + lyricFonts[lyricStyle.font].family + '", sans-serif',
        primarySingerColor: lyricStyle.highlightColor, outlineColor: lyricStyle.outlineColor,
      });
    };
    paint();
    const observer = new ResizeObserver(paint);
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [renderTiming, position, lyricStyle, fontReady]);

  const loadStems = useCallback(async (next: StudioStem[], projectDuration?: number) => {
    player.current?.stop();
    setWaveform(null);
    setPlaying(false); setError('');
    setStems(next);
    const songDuration = projectDuration ?? Math.max(0, ...next.map(item => item.durationSeconds));
    setDuration(songDuration); setPosition(0);
    const inputs: KaraokeStemSource[] = next.flatMap((stem, index) =>
      stem.url ? [{ id: index + 1, role: stem.role, voice: stem.voice || stem.name, src: stem.url }] : []);
    setAlignmentStemId(current => next.some(stem => stem.id === current && stem.url)
      ? current : (next.find(stem => stem.role === 'lead' && stem.url) ?? next.find(stem => stem.url))?.id ?? '');
    if (!inputs.length) {
      generation.current = '';
      setStatus(next.length ? 'No audio stems are available for preview.' : 'Import audio stems to begin.');
      return;
    }
    const id = crypto.randomUUID();
    generation.current = id;
    setStatus('Preparing stems for preview…');
    try {
      await player.current!.load({
        generation: id, stems: inputs, durationSeconds: songDuration, volume, outputId: '',
        mix: allAudible, stemVolumes: Object.fromEntries(inputs.map(input => [input.id, next[input.id - 1].volume])),
      });
      if (generation.current !== id) return;
      const reference = inputs.find(input => input.role === 'lead') ?? inputs[0];
      setWaveform(player.current?.waveform(id, reference.id) ?? null);
      setStatus(next.length + ' stem' + (next.length === 1 ? '' : 's') + ' ready · ' + seconds(songDuration));
    } catch (cause) {
      if (generation.current !== id) return;
      setError(cause instanceof Error ? cause.message : String(cause)); setStatus('Could not prepare the audio.');
    }
  }, [volume]);

  const applyProject = useCallback(async ({ project, origin, lyricsDraft: draft }: StudioRecoveryDraft, restored = false) => {
    lyricFileRequest.current++;
    const unavailable: string[] = [];
    const register = async (path: string) => {
      try { return await window.studio.registerMedia(path); }
      catch (cause) {
        if (!restored) throw cause;
        unavailable.push(basename(path) ?? path);
        return '';
      }
    };
    // Register the new project's media before replacing the current editor state.
    const media = await Promise.all(project.stems.map(async stem => ({
      ...stem, url: await register(stem.path),
    })));
    let backdropError = '';
    const backdropPath = project.backgroundPath;
    const image = backdropPath ? await window.studio.registerBackground(backdropPath)
      .then(media => ({ path: backdropPath, ...media }))
      .catch(cause => {
        backdropError = preferenceError(cause);
        return { path: backdropPath, url: '', motion: false };
      }) : null;
    const source = project.importedCdg ?? null;
    const graphics = source ? await window.studio.readCdg(source).then(bytes => new CdgPlayer(bytes)).catch(() => {
      unavailable.push(basename(source) ?? source);
      return null;
    }) : null;
    for (const stem of stemRef.current) if (stem.file) URL.revokeObjectURL(stem.url);
    setTitle(project.title);
    setArtist(project.artist);
    setLines(project.lyrics);
    setLyricFormatOverride(null);
    setLyricVersions(null);
    setLyricStyle(normalizeLyricStyle(project.lyricStyle));
    setLyricsDraft(draft ?? project.lyrics.map(line => line.text).join('\n'));
    setDraftPending(draft !== null);
    setWorkspace(project.lyrics.length || project.importedCdg || draft ? 'lyrics' : 'audio');
    setDraftOpen(!project.lyrics.length || draft !== null);
    setNextLine(0); setNextWord(0); setTiming(false);
    setCdgPath(source);
    setDecodedCdg(graphics);
    setBackground(image);
    setBackgroundLoop(project.backgroundLoop !== false);
    await loadStems(media, project.durationSeconds || undefined);
    setOpenedProject(origin ? { ...origin, snapshot: restored ? null : JSON.stringify(project) } : null);
    setStatus(restored ? 'Recovered unsaved changes.' : 'Opened ' + basename(origin?.file ?? 'Project') + '.');
    if (unavailable.length) setError('Some source files are unavailable: ' + unavailable.join(', ') + '. Restore them to their original locations or replace them in the project.');
    else if (backdropError) setError('Backdrop preview is unavailable. ' + backdropError);
  }, [loadStems]);

  const applyOpenedProject = useCallback(({ file, project, revision }: OpenedStudioProject) =>
    applyProject({ project, origin: { file, revision }, lyricsDraft: null }), [applyProject]);

  const refreshRecovery = useCallback(async () => {
    const entries = await window.studio.listRecovery();
    setRecoveryEntries(entries);
    return entries;
  }, []);

  useEffect(() => {
    if (initialProjectChecked.current) return;
    initialProjectChecked.current = true;
    setBusy(true);
    void (async () => {
      let initial: OpenedStudioProject | null = null;
      try {
        initial = await window.studio.initialProject();
        if (initial) await applyOpenedProject(initial);
      } catch (cause) {
        initial = null;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      try {
        const entries = await window.studio.startRecovery();
        setRecoveryEntries(entries);
        if (entries.length && !initial) setRecoveryOpen(true);
      } catch (cause) { setRecoveryError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); setProjectTransition(false); }
    })();
  }, [applyOpenedProject]);

  const addLocalPaths = useCallback(async (paths: string[], roles?: Record<string, StudioRole>) => {
    const additions: StudioStem[] = [];
    for (const path of paths) {
      try {
        const url = await window.studio.registerMedia(path), durationSeconds = await mediaDuration(url);
        additions.push({ id: crypto.randomUUID(), name: basename(path) || 'Audio stem', role: roles?.[path] ?? 'other', voice: '', path, url, durationSeconds, volume: 1 });
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    if (additions.length) await loadStems([...stems, ...additions]);
  }, [loadStems, stems]);

  async function addVoiceRecording(path: string, role: StudioRole, voice: string) {
    try {
      const url = await window.studio.registerMedia(path);
      const durationSeconds = await mediaDuration(url);
      const stem = { id: crypto.randomUUID(), name: basename(path) || 'Voice take', role, voice, path, url, durationSeconds, volume: 1 };
      await loadStems([...stemRef.current, stem], Math.max(duration, durationSeconds));
    } catch (cause) {
      setError('The take was saved to ' + path + '. Import it as an audio stem to retry. ' + (cause instanceof Error ? cause.message : String(cause)));
    }
  }

  const onAudioFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const additions: StudioStem[] = [];
    for (const file of Array.from(files)) {
      try {
        const url = URL.createObjectURL(file), durationSeconds = await mediaDuration(url);
        additions.push({
          id: crypto.randomUUID(), name: file.name, role: 'other', voice: '',
          path: window.studio.getPathForFile(file), url, file, durationSeconds, volume: 1,
        });
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    if (additions.length) await loadStems([...stems, ...additions]);
  };
  const updateStem = (id: string, patch: Partial<StudioStem>) => void loadStems(stems.map(stem => stem.id === id ? { ...stem, ...patch } : stem));
  const updateStemVolume = (id: string, value: number) => {
    const next = stems.map(stem => stem.id === id ? { ...stem, volume: value } : stem);
    setStems(next);
    if (generation.current) player.current?.setStemVolumes(generation.current, Object.fromEntries(next.map((stem, index) => [index + 1, stem.volume])));
  };
  const removeStem = (id: string) => {
    const removed = stems.find(stem => stem.id === id);
    if (removed?.file) URL.revokeObjectURL(removed.url);
    void loadStems(stems.filter(stem => stem.id !== id));
  };
  const togglePlay = async () => {
    const preview = player.current;
    const snapshot = preview?.snapshot();
    if (!preview || !snapshot || snapshot.generation !== generation.current) {
      setError(current => current || 'Import a playable audio stem first.');
      return;
    }
    if (!snapshot.ready) {
      if (snapshot.status === 'loading') setStatus('Preparing stems for preview…');
      else setError(current => current || 'Studio could not prepare this audio for preview.');
      return;
    }
    const id = snapshot.generation;
    try {
      if (snapshot.status === 'playing') { preview.pause(id); return; }
      if (snapshot.outputBlocked && !await preview.recoverOutput(id, snapshot.outputRevision, '')) {
        if (id === generation.current) setError('Audio output is unavailable. Check your system audio output, then press Play to retry.');
        return;
      }
      if (id !== generation.current) return;
      setError('');
      if (snapshot.status === 'ended') await preview.seek(id, 0);
      if (id === generation.current) await preview.play(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const seek = (next: number) => { if (generation.current) void player.current?.seek(generation.current, next); setPosition(next); };
  const moveCue = (id: string, start: number) => setLines(current => current.map(line => {
    if (line.id !== id) return line;
    const earliest = Math.min(line.startSeconds, ...line.words.map(word => word.startSeconds));
    const latest = Math.max(line.endSeconds, ...line.words.map(word => word.endSeconds));
    const delta = Math.max(-earliest, Math.min(start - line.startSeconds, duration - latest));
    const shift = (time: number) => Math.max(0, Math.round((time + delta) * 1000) / 1000);
    return {
      ...line, startSeconds: shift(line.startSeconds), endSeconds: shift(line.endSeconds),
      words: line.words.map(word => ({ ...word, startSeconds: shift(word.startSeconds), endSeconds: shift(word.endSeconds) })),
    };
  }));
  const setMasterVolume = (value: number) => { setVolume(value); if (generation.current) player.current?.setVolume(generation.current, value); };

  const cueText = normalizedCueText(lines.map(line => line.text).join('\n'));
  const formatterOptions = lyricFormatOverride ?? settings.lyricFormat;
  const setLyricText = (text: string) => {
    setLyricsDraft(text);
    const normalized = normalizedCueText(text);
    setDraftPending(Boolean(normalized) && normalized !== cueText);
  };
  const formatLyrics = () => {
    setError('');
    setDraftOpen(true);
    try {
      const input = draftPending || !lines.length || normalizedCueText(lyricsDraft) === cueText ? lyricsDraft : cueText;
      const formatted = formatLyricText(input, formatterOptions);
      setLyricText(formatted);
      setStatus('Formatted ' + normalizedCueText(formatted).split('\n').length + ' lyric lines. Review the draft before building cues.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const makeLines = () => {
    if (lyricsDraft.trim() === '') return;
    if (normalizedCueText(lyricsDraft) === cueText) {
      setDraftPending(false);
      setDraftOpen(false);
      setStatus('The draft already matches the cue sheet.');
      return;
    }
    if (lines.length && !window.confirm('Replace the cue sheet with this draft? Existing timings will need to be synced again.')) return;
    setLines(newLyricLines(lyricsDraft, duration || 240)); setNextLine(0); setNextWord(0); setTiming(false);
    setDraftPending(false);
    setDraftOpen(false);
    setStatus('Lyrics added. Start playback and tap each line as it is sung.');
  };
  const beginTiming = async () => {
    if (!lines.length || !generation.current) { setError('Add lyrics and audio first.'); return; }
    setCaptureMode('line'); setNextLine(0); setTiming(true); seek(0);
    try { await player.current?.play(generation.current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const beginWordTiming = async () => {
    if (!lines.length || !generation.current) { setError('Add lyrics and audio first.'); return; }
    const prepared = seedTimedWords(lines);
    setLines(prepared); setCaptureMode('word'); setNextWord(0); setTiming(true); seek(0);
    try { await player.current?.play(generation.current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const alignLyrics = async () => {
    const source = stems.find(stem => stem.id === alignmentStemId);
    if (!source?.path) { setError('Choose an audio file with a local path for lyric synchronization.'); return; }
    if (!lines.length) { setError('Add or import the lyrics before synchronizing.'); return; }
    const lyricsAtStart = JSON.stringify(lines);
    setBusy(true); setError(''); setStatus('Preparing AI Sync…');
    const stopProgress = window.studio.onAlignmentProgress(progress => setStatus(progress.message));
    try {
      const result = await window.studio.alignLyrics({
        audioPath: source.path,
        language: settings.alignmentLanguage, lyrics: lines.map(line => line.text),
      });
      if (JSON.stringify(linesRef.current) !== lyricsAtStart) throw new Error('The lyric cues changed while synchronization was running. The new timings were discarded; run synchronization again.');
      const alignedLines = applyForcedAlignment(lines, result.words, Math.max(duration, result.duration));
      setLines(alignedLines);
      setDuration(Math.max(duration, result.duration));
      setStatus(`Synchronized ${result.words.length} supplied lyric words. Review the cues and adjust any mismatches.`);
    } catch (cause) {
      setError(preferenceError(cause));
      setStatus('Lyric synchronization did not finish. Existing lyric text and timing were kept.');
    } finally { stopProgress(); setBusy(false); }
  };
  const tapLine = () => {
    if (nextLine >= lines.length) return;
    const at = position, indexToMark = nextLine;
    setLines(current => current.map((line, index) => {
      if (index === indexToMark) return { ...line, startSeconds: at, endSeconds: Math.max(at + 0.1, line.endSeconds) };
      if (index === indexToMark - 1) return { ...line, endSeconds: Math.max(at, line.startSeconds) };
      return line;
    }));
    setNextLine(index => index + 1);
  };
  const finishTiming = () => {
    if (captureMode === 'word' && nextWord > 0) setLines(current => finishTimedWord(current, nextWord - 1, position));
    const last = Math.max(0, nextLine - 1);
    if (captureMode === 'line') setLines(current => current.map((line, index) => index === last ? { ...line, endSeconds: Math.max(position, line.startSeconds + 0.1) } : line));
    if (generation.current) player.current?.pause(generation.current);
    setPlaying(false);
    setTiming(false); setStatus('Lyric timing saved.');
  };
  const tapWord = () => {
    if (nextWord >= wordCount) return;
    setLines(current => recordTimedWordStart(current, nextWord, position));
    setNextWord(index => index + 1);
  };
  const updateLine = (id: string, patch: Partial<LyricLine>) => setLines(current => current.map(line => {
    if (line.id !== id) return line;
    const startSeconds = Number.isFinite(patch.startSeconds) ? Math.max(0, patch.startSeconds!) : line.startSeconds;
    const endSeconds = Math.max(startSeconds, Number.isFinite(patch.endSeconds) ? patch.endSeconds! : line.endSeconds);
    // Text edits invalidate word-level timing so it cannot silently describe old text.
    return { ...line, ...patch, startSeconds, endSeconds, ...(patch.text !== undefined && patch.text !== line.text ? { words: [] } : {}) };
  }));
  const updateWord = (lineId: string, wordIndex: number, field: 'startSeconds' | 'endSeconds', value: number) => {
    if (!Number.isFinite(value)) return;
    setLines(current => current.map(line => {
      if (line.id !== lineId || !line.words[wordIndex]) return line;
      const words = line.words.slice(), word = words[wordIndex];
      words[wordIndex] = field === 'startSeconds'
        ? { ...word, startSeconds: Math.max(0, value), endSeconds: Math.max(value + 0.01, word.endSeconds) }
        : { ...word, endSeconds: Math.max(word.startSeconds + 0.01, value) };
      return { ...line, words, startSeconds: Math.min(...words.map(item => item.startSeconds)), endSeconds: Math.max(...words.map(item => item.endSeconds)) };
    }));
  };
  const handleCaptureKey = useCallback((event: globalThis.KeyboardEvent) => {
    if (!timingRef.current || event.code !== 'Space') return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    event.preventDefault();
    captureAction.current();
  }, []);
  timingRef.current = timing;
  captureAction.current = captureMode === 'word' ? tapWord : tapLine;
  useEffect(() => {
    window.addEventListener('keydown', handleCaptureKey);
    return () => window.removeEventListener('keydown', handleCaptureKey);
  }, [handleCaptureKey]);
  const useLyricVersion = (version: LyricVersion, name: string) => {
    setLyricVersions(null);
    setLyricText(version.text);
    setDraftOpen(true);
    if (version.track) setTitle(current => current || version.track || '');
    if (version.artist) setArtist(current => current || version.artist || '');
    setStatus('Loaded a lyric draft from ' + name + '.');
  };
  const importLyrics = async (file: File) => {
    const request = ++lyricFileRequest.current;
    const extension = file.name.toLowerCase().split('.').at(-1);
    setLyricVersions(null);
    setError('');
    if (extension === 'cdg') {
      try {
        if (file.size > cdgByteLimit) throw new Error('Choose a CD+G file with no more than one hour of graphics.');
        const path = window.studio.getPathForFile(file);
        if (!path) throw new Error('Choose a local CD+G file.');
        const decoded = new CdgPlayer(new Uint8Array(await file.arrayBuffer()));
        if (request !== lyricFileRequest.current) return;
        setDecodedCdg(decoded);
        setCdgPath(path);
        setStatus(lines.length ? 'CD+G graphics attached. Editable cues are used for preview.' : 'CD+G graphics ready. Import the matching audio to play them together.');
      } catch (cause) { if (request === lyricFileRequest.current) setError(cause instanceof Error ? cause.message : String(cause)); }
      return;
    }
    try {
      if (!file.size || file.size > MAXIMUM_LYRIC_TEXT_BYTES) throw new Error('Choose a nonempty lyric file of up to 4 MB.');
      const contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (request !== lyricFileRequest.current) return;
      if (extension === 'json') {
        const versions = readLyricVersions(contents);
        if (versions) {
          if (versions.length === 1) useLyricVersion(versions[0], file.name);
          else {
            setLyricVersions({ name: file.name, items: versions });
            setDraftOpen(true);
            setStatus('Choose a lyric version from ' + file.name + '.');
          }
          return;
        }
      }
      if (extension === 'txt') {
        const cues = newLyricLines(contents, duration || 240);
        if (!cues.length) throw new Error('The text file contains no lyrics.');
        setLines(cues);
        setLyricsDraft(contents.replace(/\r\n?/g, '\n'));
        setDraftPending(false);
        setDraftOpen(true);
        setNextLine(0); setNextWord(0); setTiming(false);
        setStatus('Imported ' + cues.length + ' lines from ' + file.name + '.');
        return;
      }
      const imported = parseLyricsFile(file.name, contents);
      setLines(imported.lines);
      if (imported.title) setTitle(imported.title);
      if (imported.artist) setArtist(imported.artist);
      setLyricsDraft(imported.lines.map(line => line.text).join('\n'));
      setDraftPending(false);
      setDraftOpen(false);
      setStatus('Imported ' + imported.lines.length + ' lyric cues from ' + file.name + '.');
    } catch (cause) { if (request === lyricFileRequest.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const exportLyrics = async (format: 'json' | 'lrc' | 'srt') => {
    setBusy(true); setError('');
    try {
      const content = format === 'json' ? toLyricsJson(title, artist, duration, lines) : format === 'lrc' ? toLrc(title, artist, lines) : toSrt(lines);
      const file = await window.studio.saveText({ name: safeName(title), extension: format, content });
      if (file) setStatus('Saved ' + basename(file) + '.');
    } catch (cause) { setError(preferenceError(cause)); }
    finally { setBusy(false); }
  };
  const separate = async () => {
    const source = stems.find(stem => stem.path)?.path;
    if (!source) { setError('Import a local audio file before running stem separation.'); return; }
    setBusy(true); setError('');
    const cloud = !['audio-separator', 'demucs'].includes(settings.separatorAdapter);
    setStatus(cloud ? 'Preparing cloud stem separation…' : 'Separating audio with the selected local models…');
    try {
      const result = await window.studio.separate({ sourcePath: source });
      if (!result.files.length) { setStatus('Stem separation canceled.'); return; }
      await addLocalPaths(result.files, result.roles ?? Object.fromEntries(result.files.map(file => [file, separatedRole(file)])));
      setStatus('Separated audio saved to ' + result.outputDirectory + '.');
    } catch (cause) { setError(preferenceError(cause)); setStatus('Stem separation did not finish.'); }
    finally { setBusy(false); }
  };
  const chooseBackground = async () => {
    const path = await window.studio.chooseImageFile();
    if (!path) return;
    setBusy(true); setError('');
    try {
      const media = await window.studio.registerBackground(path);
      setBackground({ ...media, path });
    } catch (cause) { setError(preferenceError(cause)); }
    finally { setBusy(false); }
  };

  const currentProject = useMemo<StudioProject>(() => ({
    schema: 'com.thepropervolume.karaoke-studio', version: 1, title, artist, durationSeconds: duration,
    stems: stems.map(({ file: _file, url: _url, ...stem }) => stem), lyrics: lines, importedCdg: cdgPath, backgroundPath: background?.path ?? null,
    backgroundLoop, lyricStyle,
  }), [title, artist, duration, stems, lines, cdgPath, background?.path, backgroundLoop, lyricStyle]);
  const projectChanged = useMemo(() => openedProject ? openedProject.snapshot !== JSON.stringify(currentProject)
    : Boolean(stems.length || lines.length || background || cdgPath || title || artist || JSON.stringify(lyricStyle) !== JSON.stringify(defaultLyricStyle)),
  [openedProject, currentProject, stems.length, lines.length, background, cdgPath, title, artist, lyricStyle]);
  const pendingLyrics = draftPending ? lyricsDraft : null;

  useEffect(() => {
    if (projectTransition) return;
    let current = true;
    const draft = projectChanged || pendingLyrics !== null ? {
      project: currentProject,
      origin: openedProject ? { file: openedProject.file, revision: openedProject.revision } : null,
      lyricsDraft: pendingLyrics,
    } : null;
    void window.studio.updateRecovery(draft).then(
      () => { if (current) setRecoveryError(''); },
      cause => { if (current) setRecoveryError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => { current = false; };
  }, [currentProject, openedProject, pendingLyrics, projectChanged, projectTransition]);

  const showRecovery = async () => {
    setRecoveryOpen(true);
    try { await refreshRecovery(); }
    catch (cause) { setRecoveryError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const restoreRecovery = async (entry: StudioRecoveryEntry) => {
    if ((projectChanged || draftPending) && !window.confirm('Replace the current unsaved changes with this recovery draft?')) return;
    setBusy(true); setProjectTransition(true); setError('');
    try {
      const draft = await window.studio.loadRecovery(entry.id);
      if (!draft) throw new Error('This recovery draft is no longer available.');
      await applyProject(draft, true);
      // Keep the original draft until its replacement has reached disk.
      await window.studio.updateRecovery(draft);
      await window.studio.discardRecovery(entry.id);
      await refreshRecovery();
      setRecoveryOpen(false);
    } catch (cause) { setRecoveryError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setProjectTransition(false); }
  };
  const discardRecovery = async (entry: StudioRecoveryEntry) => {
    if (!window.confirm('Permanently discard this recovery draft?')) return;
    setBusy(true);
    try {
      await window.studio.discardRecovery(entry.id);
      const remaining = await refreshRecovery();
      if (!remaining.length) setRecoveryOpen(false);
    } catch (cause) { setRecoveryError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const openProject = async () => {
    if ((projectChanged || draftPending) && !window.confirm('Open another project and discard unsaved changes?')) return;
    setBusy(true); setProjectTransition(true); setError('');
    try {
      const opened = await window.studio.openProject();
      if (opened) await applyOpenedProject(opened);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setProjectTransition(false); }
  };
  const saveProject = async (saveAs = false) => {
    if (draftPending) { setError('Build cues from the new lyric text before saving the project.'); return; }
    setBusy(true); setError('');
    try {
      const saved = await window.studio.saveProject(currentProject, saveAs ? undefined : openedProject ?? undefined);
      if (!saved) return;
      setOpenedProject({ file: saved.file, revision: saved.revision, snapshot: JSON.stringify(saved.project) });
      setStatus('Saved ' + basename(saved.file) + '.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const exportKit = async () => {
    setBusy(true); setError('');
    try {
      const kitProject = toPortableKitProject(currentProject);
      const saved = await window.studio.exportKit({
        name: safeName(title), manifest: JSON.stringify(kitProject, null, 2),
        lyrics: { 'lyrics.json': toLyricsJson(title, artist, duration, lines), 'lyrics.enhanced.lrc': toLrc(title, artist, lines), 'lyrics.srt': toSrt(lines) },
        stems: stems.map(stem => ({ path: stem.path, name: stem.name, role: stem.role, voice: stem.voice, volume: stem.volume })),
        cdgPath, backgroundPath: background?.path,
      });
      if (saved) setStatus('Exported TPV kit: ' + saved.split(/[\\/]/).at(-1) + '.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const exportVideo = async () => {
    if (!stems.length) { setError('Import at least one audio stem to export a video.'); return; }
    setBusy(true); setError(''); setStatus('Rendering MP4 with FFmpeg…');
    try {
      const saved = await window.studio.exportVideo({
        name: safeName(title), duration, artist, title, ffmpegPath: settings.ffmpegPath,
        backgroundPath: background?.path, backgroundLoop, backgroundColor: lyricStyle.backgroundColor,
        cdgPath: lines.length ? null : cdgPath,
        stems: stems.map(stem => ({ path: stem.path, name: stem.name, role: stem.role, voice: stem.voice, volume: stem.volume })),
        ass: toAss(title, artist, duration, lines, 'video', lyricStyle),
      });
      if (saved) setStatus('Rendered video: ' + saved.split(/[\\/]/).at(-1) + '.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('Video export failed.'); }
    finally { setBusy(false); }
  };
  const exportCdg = async (original = false) => {
    if (original && !cdgPath) return;
    setBusy(true); setError('');
    try {
      const name = safeName(title);
      const exportDuration = duration || lines.reduce((end, line) => Math.max(end, line.endSeconds), 0);
      const saved = await window.studio.exportCdg(original && cdgPath ? { name, cdgPath }
        : { name, duration: exportDuration, ass: toAss(title, artist, exportDuration, lines, 'cdg', lyricStyle),
          backgroundColor: lyricStyle.backgroundColor, ffmpegPath: settings.ffmpegPath });
      if (saved) setStatus('Exported CD+G graphics: ' + basename(saved) + '.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const editorInert = projectTransition || recoveryOpen || voiceRecorderOpen || settingsOpen || appearanceOpen || lyricAppearanceOpen;
  const menuEnabled = !editorInert && !busy && !timing;
  const hasStems = stems.length > 0, hasLyrics = lines.length > 0, hasCdg = Boolean(cdgPath), canStyle = !cdgPlayer;
  const menuAction = useRef<(action: StudioMenuAction) => void>(() => {});
  menuAction.current = action => {
    if (!menuEnabled) return;
    switch (action) {
      case 'open': void openProject(); break;
      case 'save': void saveProject(); break;
      case 'save-as': void saveProject(true); break;
      case 'preferences': setSettingsOpen(true); break;
      case 'appearance': setAppearanceOpen(true); break;
      case 'lyrics-style': if (canStyle) setLyricAppearanceOpen(true); break;
      case 'theme-day': setAppearance(current => ({ ...current, theme: 'day' })); break;
      case 'theme-night': setAppearance(current => ({ ...current, theme: 'night' })); break;
      case 'accent-blue': setAppearance(current => ({ ...current, accent: 'blue' })); break;
      case 'accent-pink': setAppearance(current => ({ ...current, accent: 'pink' })); break;
      case 'accent-purple': setAppearance(current => ({ ...current, accent: 'purple' })); break;
      case 'export-mp4': if (hasStems) void exportVideo(); break;
      case 'export-kit': if (hasStems) void exportKit(); break;
      case 'export-cdg': if (hasLyrics) void exportCdg(); break;
      case 'export-cdg-original': if (hasCdg) void exportCdg(true); break;
      case 'export-lrc': if (hasLyrics) void exportLyrics('lrc'); break;
      case 'export-srt': if (hasLyrics) void exportLyrics('srt'); break;
      case 'export-json': if (hasLyrics) void exportLyrics('json'); break;
    }
  };
  useEffect(() => window.studio.onMenuAction(action => menuAction.current(action)), []);
  useEffect(() => {
    void window.studio.updateMenu({ editing: menuEnabled, stems: hasStems, lyrics: hasLyrics, cdg: hasCdg, styling: canStyle,
      theme: appearance.theme, accent: appearance.accent }).catch(() => { /* Toolbar actions remain available. */ });
  }, [menuEnabled, hasStems, hasLyrics, hasCdg, canStyle, appearance.theme, appearance.accent]);
  const shortcutActions = useRef({ open: () => {}, save: (_as: boolean) => {}, play: () => {}, preferences: () => {}, enabled: false });
  shortcutActions.current = {
    open: () => { void openProject(); },
    save: as => { void saveProject(as); },
    play: () => { void togglePlay(); },
    preferences: () => setSettingsOpen(true),
    enabled: menuEnabled,
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const actions = shortcutActions.current;
      if (!actions.enabled || event.defaultPrevented || event.repeat) return;
      if (event.key === ',' && (event.ctrlKey || event.metaKey || event.altKey)) {
        event.preventDefault(); actions.preferences(); return;
      }
      if (event.altKey) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'o') { event.preventDefault(); actions.open(); }
        if (key === 's') { event.preventDefault(); actions.save(event.shiftKey); }
        return;
      }
      if (event.code === 'Space' && !(event.target as HTMLElement | null)?.closest('input, textarea, select, button, a, summary, [contenteditable]')) {
        event.preventDefault(); actions.play();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const canStartTiming = Boolean(lines.length && player.current?.snapshot()?.ready && !busy && !timing);
  const activeCue = lines.findIndex(line => position >= line.startSeconds && position < line.endSeconds);
  const projectTitle = title.trim() || 'Untitled Project';
  const fileName = openedProject ? basename(openedProject.file) : undefined;
  const projectActionsDisabled = busy || timing;

  return <div className="app-shell" data-theme={appearance.theme} data-accent={appearance.accent}
    style={{ '--inspector-width': inspectorWidth + 'px' } as CSSProperties}>
    <header className="topbar" inert={editorInert}>
      <div className="studio-brand">
        <img src={appearance.theme === 'day' ? markLight : markDark} alt="" />
        <span><strong>TPV</strong><small>Karaoke Studio</small></span>
      </div>
      <div className="topbar-identity">
        <strong title={fileName || projectTitle}>{projectTitle}</strong>
        <span className="version-pill" aria-label="Application version">v{version}</span>
      </div>
      <div className="topbar-status" role="status">
        <span className={'status-dot' + (playing ? ' live' : '')} aria-hidden="true" />
        <span>{playing ? 'Playing' : busy ? 'Working…' : projectChanged || draftPending ? 'Unsaved changes' : fileName ? 'Saved' : 'Ready'}</span>
      </div>
      <div className="topbar-actions">
        <IconButton icon="folder" label="Open Project" hint="Open Project (Ctrl/⌘+O)" disabled={projectActionsDisabled} onClick={() => void openProject()} />
        <IconButton icon="save" label="Save Project" hint="Save Project (Ctrl/⌘+S)" disabled={projectActionsDisabled} onClick={() => void saveProject()} />
        {openedProject && <IconButton icon="copy" label="Save As" hint="Save As (Ctrl/⌘+Shift+S)" disabled={projectActionsDisabled} onClick={() => void saveProject(true)} />}
        <span className="toolbar-divider" aria-hidden="true" />
        <IconButton icon="palette" label="Appearance" className="accent-button" onClick={() => setAppearanceOpen(true)} />
        <IconButton icon="settings" label="Preferences" hint="Preferences (Ctrl/⌘/Alt+,)" onClick={() => setSettingsOpen(true)} />
      </div>
    </header>

    <main className="studio-workspace" inert={editorInert}>
      <nav className="sidebar" aria-label="Workspace">
        <div className="eyebrow">Workspace</div>
        {workspaces.map(item => <button type="button" key={item.id} className={'nav-item' + (workspace === item.id ? ' active' : '')}
          aria-current={workspace === item.id ? 'page' : undefined} aria-controls="editor-panel" onClick={() => setWorkspace(item.id)}>
          <StudioIcon name={item.icon} /><span>{item.label}</span>
        </button>)}
        <div className="sidebar-project">
          <div className="eyebrow">Project</div>
          <button type="button" className="nav-item" disabled={projectActionsDisabled} onClick={() => void showRecovery()}>
            <StudioIcon name="history" /><span>Recovery</span>
            {recoveryEntries.length > 0 && <span className="nav-count">{recoveryEntries.length}</span>}
          </button>
        </div>
      </nav>

      <section className="panel preview-panel" aria-labelledby="preview-title">
        <div className="page-heading">
          <div><div className="eyebrow">Project</div><h1 id="preview-title">Singer Preview</h1></div>
          <div className="toolbar">
            <IconButton icon="palette" label="Lyric Appearance" disabled={!canStyle || busy} onClick={() => setLyricAppearanceOpen(true)} />
            {background?.motion && <label className="row backdrop-loop" data-tip="Repeat the muted backdrop for the length of the song.">
              <input type="checkbox" checked={backgroundLoop} onChange={event => setBackgroundLoop(event.target.checked)} /> Loop
            </label>}
            {background && <button type="button" className="quiet" disabled={busy} onClick={() => { setBackground(null); setBackgroundLoop(true); }}
              data-tip="Use the project’s background color.">Remove Background</button>}
            <IconButton icon="image" label="Choose Background" hint="Choose a background image, GIF, or muted MP4" disabled={!canStyle || busy} onClick={() => void chooseBackground()} />
          </div>
        </div>
        <div className="project-fields">
          <label className="field-label">Song Title<input aria-label="Song title" placeholder="Untitled song" value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label className="field-label">Artist<input aria-label="Artist" placeholder="Artist name" value={artist} onChange={event => setArtist(event.target.value)} /></label>
        </div>
        <div className="preview-well">
          <div className="preview-stage" style={{ backgroundColor: lyricStyle.backgroundColor }} aria-label="Karaoke lyrics preview">
            {cdgPlayer ? <CdgPreview player={cdgPlayer} seconds={position} playing={playing} livePosition={livePosition} /> : <>
              {background?.url && <BackdropPreview key={background.url} url={background.url} motion={background.motion}
                looping={backgroundLoop} position={position} playing={playing} onError={setError} />}
              <canvas ref={canvas} />
              {!lines.length && !background?.url && <div className="preview-empty">
                <StudioIcon name="display" />
                <strong>Preview is ready</strong>
                <span>Import lyrics to see them here.</span>
                <button type="button" onClick={() => { setWorkspace('lyrics'); setDraftOpen(true); }}>Add Lyrics</button>
              </div>}
            </>}
          </div>
        </div>
      </section>

      <WorkspaceSeparator width={inspectorWidth} maximum={inspectorMaximum} resize={resizeInspector} />

      <aside className="panel inspector" id="editor-panel" aria-label={workspaces.find(item => item.id === workspace)?.label}>
        {workspace === 'audio' && <>
          <div className="page-heading">
            <div><div className="eyebrow">Project Audio</div><h2>Audio Stems</h2></div>
            {stems.length > 0 && <span className="summary-pill">{stems.length} {stems.length === 1 ? 'stem' : 'stems'}</span>}
          </div>
          <div className="toolbar inspector-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void window.studio.chooseAudioFiles().then(addLocalPaths).catch(cause => setError(String(cause)))}>
              <StudioIcon name="file" /> Import Audio
            </button>
            <button type="button" disabled={busy || timing || stems.length >= 12} onClick={() => {
              if (generation.current) player.current?.pause(generation.current);
              setPlaying(false);
              setVoiceRecorderOpen(true);
            }}><StudioIcon name="microphone" /> Record Stem</button>
          </div>
          <div className={'dropzone' + (stems.length ? ' compact' : '')} onDragOver={event => event.preventDefault()} onDrop={event => {
            event.preventDefault();
            if (!busy) void onAudioFiles(event.dataTransfer.files);
          }}>
            {!stems.length && <StudioIcon name="audio" />}
            <strong>Drop audio files here</strong>
            {!stems.length && <span className="muted">Import a song or its separate audio tracks.</span>}
          </div>
          <div className="stack">
            {stems.map(stem => <article className="stem-card" key={stem.id}>
              <div className="row spaced stem-title">
                <StudioIcon name="audio" />
                <span className="filename grow" title={stem.name}>{stem.name}</span>
                <IconButton icon="close" label={'Remove ' + stem.name} hint="Remove stem" className="small-button" onClick={() => removeStem(stem.id)} />
              </div>
              <div className="stem-fields">
                <select aria-label={stem.name + ' role'} value={stem.role} onChange={event => updateStem(stem.id, { role: event.target.value as StudioRole })}>
                  {roles.map(role => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
                </select>
                <input aria-label={stem.name + ' voice label'} placeholder="Voice or part" value={stem.voice} onChange={event => updateStem(stem.id, { voice: event.target.value })} />
              </div>
              <label className="row stem-volume muted"><span>Volume</span>
                <input aria-label={stem.name + ' volume'} className="grow" type="range" min="0" max="1" step="0.01" value={stem.volume} onChange={event => updateStemVolume(stem.id, Number(event.target.value))} />
                <output>{Math.round(stem.volume * 100)}%</output>
              </label>
            </article>)}
          </div>
          <div className="inspector-section">
            <button type="button" disabled={!stems.length || busy} data-tip="Use the separator and models selected in Preferences." onClick={() => void separate()}>Separate a Source Track…</button>
            <p className="muted">Model and separator are set in Preferences.</p>
          </div>
        </>}

        {workspace === 'lyrics' && <>
          <div className="page-heading">
            <div><div className="eyebrow">Lyric Editor</div><h2>Cue Sheet</h2></div>
            <span className="summary-pill">{lines.length} {lines.length === 1 ? 'cue' : 'cues'}</span>
          </div>
          <div className="toolbar inspector-actions">
            <label className="button-like"><StudioIcon name="file" /> Import Lyrics
              <input className="file-input" aria-label="Import Lyrics" type="file" accept=".txt,.json,.lrc,.elrc,.srt,.cdg" disabled={busy || timing} onChange={event => {
                const file = event.target.files?.[0];
                if (file) void importLyrics(file);
                event.currentTarget.value = '';
              }} />
            </label>
            <button type="button" title="Reflow the lyric draft using the line lengths below. Existing cues keep their timing."
              disabled={(!lyricsDraft.trim() && !cueText) || busy || timing || !!lyricVersions}
              onClick={formatLyrics}>Format Lyrics</button>
            {cdgPath && <button type="button" disabled={busy} onClick={() => { setCdgPath(null); setDecodedCdg(null); setStatus('CD+G graphics removed.'); }}>Remove CD+G</button>}
          </div>
          <details className="workspace-details" open={draftOpen} onToggle={event => setDraftOpen(event.currentTarget.open)}>
            <summary>Lyrics Text {draftPending && <span className="summary-pill">Draft</span>}</summary>
            <div className="stack detail-content">
              {lyricVersions && <div className="row">
                <label className="field-label grow">Lyric Version
                  <select title="Choose the recording that matches your audio." value="" onChange={event => {
                    useLyricVersion(lyricVersions.items[Number(event.target.value)], lyricVersions.name);
                  }}>
                    <option value="" disabled>Choose a recording</option>
                    {lyricVersions.items.map((version, index) => <option key={index} value={index}>{versionLabel(version, index)}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => setLyricVersions(null)}>Cancel</button>
              </div>}
              <textarea rows={5} className="small-input" aria-label="Lyrics text" placeholder="Paste lyrics or import a text file" value={lyricsDraft}
                onChange={event => setLyricText(event.target.value)} />
              <LyricFormatFields value={formatterOptions} onChange={setLyricFormatOverride} disabled={busy || timing} />
              <div className="toolbar">
                <button type="button" title="Build new cues from the draft. This replaces any existing cues."
                  disabled={!lyricsDraft.trim() || timing || busy || !!lyricVersions} data-tip="Turn the current lyric draft into editable timing cues." onClick={makeLines}>Build Cues</button>
                {lyricFormatOverride && <button type="button" title="Restore the current session’s formatting preferences."
                  disabled={busy || timing} onClick={() => setLyricFormatOverride(null)}>Use Preferences</button>}
              </div>
            </div>
          </details>
          <div className="timing-tools">
            <label className="field-label">Audio for Sync
              <select value={alignmentStemId} onChange={event => setAlignmentStemId(event.target.value)} disabled={!stems.length || busy}>
                {!stems.length && <option value="">Import audio first</option>}
                {stems.filter(stem => stem.path).map(stem => <option key={stem.id} value={stem.id}>{stem.name}{stem.role === 'lead' && !/\blead vocal\b/i.test(stem.name) ? ' · lead' : ''}</option>)}
              </select>
            </label>
            <div className="toolbar">
              <button type="button" className="primary" aria-label="Sync lyrics with AI" title="Align your supplied lyrics to the selected audio"
                disabled={!lines.length || !alignmentStemId || busy || timing} data-tip="Align the supplied lyrics to the selected audio on this computer." onClick={() => void alignLyrics()}>AI Sync</button>
              <button type="button" title="Tap line starts with Space during playback" disabled={!canStartTiming} onClick={() => void beginTiming()}>Time Lines</button>
              <button type="button" title="Tap word starts with Space during playback" disabled={!canStartTiming} onClick={() => void beginWordTiming()}>Time Words</button>
            </div>
          </div>
          {lines.length > 0 ? <div className="cue-sheet">
            <div className="cue-columns muted" aria-hidden="true"><span>Cue</span><span>Lyrics</span><span>Start / End</span></div>
            {lines.map((line, index) => <article className={'cue-block' + ((timing && captureMode === 'line' ? index === nextLine : index === activeCue) ? ' active' : '')} key={line.id}>
              <button type="button" className="cue-number" onClick={() => seek(line.startSeconds)} aria-label={'Seek to cue ' + (index + 1)}>
                {String(index + 1).padStart(2, '0')}
              </button>
              <input className="cue-text" aria-label={'Lyric line ' + (index + 1)} value={line.text} onChange={event => updateLine(line.id, { text: event.target.value })} />
              <div className="cue-times">
                <input aria-label={'Line ' + (index + 1) + ' start'} type="number" min="0" step="0.01" value={line.startSeconds} onChange={event => updateLine(line.id, { startSeconds: Number(event.target.value) })} />
                <input aria-label={'Line ' + (index + 1) + ' end'} type="number" min="0" step="0.01" value={line.endSeconds} onChange={event => updateLine(line.id, { endSeconds: Number(event.target.value) })} />
              </div>
              {line.words.length > 0 && <details className="word-cues">
                <summary>Word timings · {line.words.length}</summary>
                {line.words.map((word, wordIndex) => <div className={'word-cue' + (timing && captureMode === 'word' && wordOffsets[index] + wordIndex === nextWord ? ' active' : '')} key={wordIndex}>
                  <span className="word-label" title={word.text}>{word.text.trim() || ' '}</span>
                  <input aria-label={'Line ' + (index + 1) + ' word ' + (wordIndex + 1) + ' start'} type="number" min="0" step="0.01" value={word.startSeconds} onChange={event => updateWord(line.id, wordIndex, 'startSeconds', Number(event.target.value))} />
                  <input aria-label={'Line ' + (index + 1) + ' word ' + (wordIndex + 1) + ' end'} type="number" min="0" step="0.01" value={word.endSeconds} onChange={event => updateWord(line.id, wordIndex, 'endSeconds', Number(event.target.value))} />
                </div>)}
              </details>}
            </article>)}
          </div> : <p className="empty-row">Import lyrics or build cues from text.</p>}
        </>}

        {workspace === 'export' && <>
          <div className="page-heading"><div><div className="eyebrow">Project Output</div><h2>Export</h2></div></div>
          <div className="stack">
            <button type="button" className="export-action primary" disabled={busy || !stems.length} onClick={() => void exportVideo()}>
              <StudioIcon name="display" /><span><strong>Karaoke Video</strong><small>MP4 with mixed audio and lyrics</small></span>
            </button>
            <button type="button" className="export-action" disabled={busy || !stems.length} onClick={() => void exportKit()}>
              <StudioIcon name="folder" /><span><strong>TPV Kit</strong><small>Portable project with stems and lyric cues</small></span>
            </button>
          </div>
          <div className="inspector-section">
            <h3>Lyric Files</h3>
            <div className="toolbar">
              <button type="button" disabled={!lines.length || busy} onClick={() => void exportLyrics('json')}>JSON</button>
              <button type="button" disabled={!lines.length || busy} onClick={() => void exportLyrics('lrc')}>Enhanced LRC</button>
              <button type="button" disabled={!lines.length || busy} onClick={() => void exportLyrics('srt')}>SRT</button>
            </div>
          </div>
          {(lines.length > 0 || cdgPath) && <div className="inspector-section">
            <h3>CD+G Graphics</h3>
            <div className="toolbar">
              {lines.length > 0 && <button type="button" disabled={busy} onClick={() => void exportCdg()}>Export CD+G</button>}
              {cdgPath && <button type="button" disabled={busy} onClick={() => void exportCdg(true)}>Export Original CD+G</button>}
            </div>
          </div>}
        </>}
      </aside>

      <section className="transport" aria-label="Playback and timeline">
        {waveform && <WaveformTimeline overview={waveform} duration={previewDuration} position={position} lines={lines}
          disabled={busy || timing} seek={seek} moveCue={moveCue} appearance={appearance.theme + ':' + appearance.accent} />}
        {timing && <div className="capture-bar row">
          <span className="status-dot live" aria-hidden="true" />
          <span className="grow">Capturing {captureMode} timing</span>
          <button type="button" className="primary" onClick={captureMode === 'word' ? tapWord : tapLine}>
            {captureMode === 'word' ? 'Tap Word · ' + Math.min(nextWord + 1, wordCount) + '/' + wordCount : 'Tap Line · ' + Math.min(nextLine + 1, lines.length) + '/' + lines.length}
          </button>
          <button type="button" onClick={finishTiming}>Finish Timing</button>
        </div>}
        <div className="transport-strip">
          <div className="transport-track">
            <div className="eyebrow">Playback</div>
            <strong title={projectTitle}>{projectTitle}</strong>
            <span className="muted">{artist || (stems.length ? stems.length + ' audio ' + (stems.length === 1 ? 'stem' : 'stems') : 'No audio loaded')}</span>
          </div>
          <div className="scrub row">
            <span>{seconds(position)}</span>
            <input aria-label="Playback position" className="grow" type="range" min={0} max={previewDuration || 1} step="0.05" value={Math.min(position, previewDuration || 1)}
              disabled={!previewDuration} onChange={event => seek(Number(event.target.value))} />
            <span>{seconds(previewDuration)}</span>
          </div>
          <div className="transport-actions">
            <IconButton icon="previous" label="Jump to Start" disabled={!previewDuration} onClick={() => seek(0)} />
            <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} hint={(playing ? 'Pause' : 'Play') + ' (Space)'}
              className="primary play-button" disabled={!stems.some(stem => stem.url)} onClick={() => void togglePlay()} />
            <label className="transport-volume"><StudioIcon name="volume" />
              <input aria-label="Mix volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setMasterVolume(Number(event.target.value))} />
            </label>
          </div>
        </div>
        <div className="transport-status">
          <span className="status" role="status">{busy ? status || 'Working…' : status}</span>
          {error && <p className="error" role="alert">{error}</p>}
          {recoveryError && !recoveryOpen && <span className="error" role="alert">Recovery unavailable: {recoveryError}</span>}
        </div>
      </section>
    </main>

    {appearanceOpen && <div className="settings" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAppearanceOpen(false); }}>
      <section className="settings-card appearance-card" role="dialog" aria-modal="true" aria-labelledby="appearance-title" onKeyDown={event => {
        if (event.key === 'Escape') setAppearanceOpen(false);
      }}>
        <div className="row spaced"><h2 id="appearance-title">Appearance</h2><button autoFocus type="button" onClick={() => setAppearanceOpen(false)}>Close</button></div>
        <div className="appearance-fields">
          <label className="field-label">Theme<select value={appearance.theme} onChange={event => setAppearance({ ...appearance, theme: event.target.value as Appearance['theme'] })}>
            <option value="night">Night</option><option value="day">Day</option>
          </select></label>
          <label className="field-label">Accent Color<select value={appearance.accent} onChange={event => setAppearance({ ...appearance, accent: event.target.value as Appearance['accent'] })}>
            <option value="blue">Blue</option><option value="pink">Pink</option><option value="purple">Purple</option>
          </select></label>
        </div>
      </section>
    </div>}
    {lyricAppearanceOpen && <LyricAppearance value={lyricStyle} change={setLyricStyle} close={() => setLyricAppearanceOpen(false)} />}
    {voiceRecorderOpen && <VoiceRecorder title={title} roles={roles} onSaved={addVoiceRecording} onClose={() => setVoiceRecorderOpen(false)} />}
    {recoveryOpen && <div className="settings" role="presentation">
      <section className="settings-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title" onKeyDown={event => {
        if (event.key === 'Escape' && !busy) setRecoveryOpen(false);
      }}>
        <div className="row spaced">
          <h2 id="recovery-title">Project Recovery</h2>
          <button autoFocus disabled={busy} onClick={() => setRecoveryOpen(false)}>Close</button>
        </div>
        {recoveryEntries.length ? <div className="stack">
          {recoveryEntries.map(entry => <div className="row spaced" key={entry.id}>
            <div>
              <strong>{entry.title || 'Untitled project'}</strong>{entry.artist && ' · ' + entry.artist}
              <div className="muted">{entry.sourceFile ? basename(entry.sourceFile) : 'New project'} · {new Date(entry.savedAt).toLocaleString()}</div>
            </div>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => void restoreRecovery(entry)}>Restore</button>
              <button disabled={busy} onClick={() => void discardRecovery(entry)}>Discard</button>
            </div>
          </div>)}
        </div> : <p>No recovery drafts found.</p>}
        {recoveryError && <p className="error" role="alert">{recoveryError}</p>}
      </section>
    </div>}
    {/* The dialog takes a draft snapshot when it opens, so wait for saved settings on startup. */}
    {settingsOpen && settingsLoaded && <PreferencesDialog settings={settings} close={() => setSettingsOpen(false)} onSave={(value, scope) => {
      setSettings(value); setSettingsOpen(false); setStatus(scope === 'session' ? 'Preferences applied for this session.' : 'Default preferences saved.');
    }} />}
  </div>;
}
