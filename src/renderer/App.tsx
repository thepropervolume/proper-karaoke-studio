import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KaraFunPlayer as KaraokePlayer, type KaraFunPlayerEvent as KaraokePlayerEvent, type KaraFunStemSource as KaraokeStemSource } from '../shared/from-booth/display/karafun-player';
import { paintKaraFunLyrics } from '../shared/from-booth/display/karafun-lyrics';
import { finishTimedWord, newLyricLines, recordTimedWordStart, seedTimedWords, timedWordCount, toPortableKitProject, toRenderTiming, type LyricLine, type StudioProject, type StudioRole, type StudioStem } from '../domain/project';
import { parseLyricsFile, toAss, toLrc, toLyricsJson, toSrt } from '../domain/lyrics-formats';
import { applyForcedAlignment } from '../domain/forced-alignment';

const roles: StudioRole[] = ['instrumental', 'lead', 'backing', 'other'];
const allAudible = { instrumental: 1, lead: 1, backing: 1, other: 1 } as const;
const seconds = (value: number) => Math.floor(value / 60) + ':' + (value % 60).toFixed(1).padStart(4, '0');
const safeName = (value: string) => value.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 100) || 'Untitled';

async function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { const value = audio.duration; audio.removeAttribute('src'); resolve(Number.isFinite(value) ? value : 0); };
    audio.onerror = () => reject(new Error('This audio file could not be opened for preview.'));
    audio.src = url;
  });
}

export function App() {
  const player = useRef<KaraokePlayer | null>(null), generation = useRef('');
  const timingRef = useRef(false), captureAction = useRef<() => void>(() => undefined);
  const linesRef = useRef<LyricLine[]>([]);
  const canvas = useRef<HTMLCanvasElement | null>(null), stemRef = useRef<StudioStem[]>([]);
  const [stems, setStems] = useState<StudioStem[]>([]);
  const [alignmentStemId, setAlignmentStemId] = useState('');
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [title, setTitle] = useState(''), [artist, setArtist] = useState('');
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false), [volume, setVolume] = useState(0.8);
  const [lyricsDraft, setLyricsDraft] = useState(''), [nextLine, setNextLine] = useState(0), [nextWord, setNextWord] = useState(0), [captureMode, setCaptureMode] = useState<'line' | 'word'>('line'), [timing, setTiming] = useState(false);
  const [status, setStatus] = useState('Create a project by importing audio stems.');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<StudioSettings>({
    ffmpegPath: 'ffmpeg', separatorExecutable: 'audio-separator', separatorModel: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    lyricAlignerExecutable: 'python', alignmentLanguage: 'en',
  });
  const [settingsOpen, setSettingsOpen] = useState(false), [busy, setBusy] = useState(false);
  const [cdgPath, setCdgPath] = useState<string | null>(null);
  const [background, setBackground] = useState<{ url: string; path: string } | null>(null);

  useEffect(() => {
    player.current = new KaraokePlayer({ onEvent(event: KaraokePlayerEvent) {
      if (event.type === 'timeline') { setPosition(event.position); setDuration(event.duration); setPlaying(player.current?.snapshot()?.status === 'playing'); }
      if (event.type === 'ended') setPlaying(false);
      if (event.type === 'error') { setError(event.message); setPlaying(false); }
    } });
    void window.studio.getSettings().then(setSettings).catch(cause => setError(String(cause)));
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
  const renderTiming = useMemo(() => toRenderTiming(lines, duration), [lines, duration]);
  const wordCount = useMemo(() => timedWordCount(lines), [lines]);
  const wordOffsets = useMemo(() => {
    let offset = 0;
    return lines.map(line => { const current = offset; offset += line.words.length; return current; });
  }, [lines]);
  useEffect(() => {
    const paint = () => {
      if (canvas.current) paintKaraFunLyrics(canvas.current, renderTiming, position, {
        fontFamily: 'Arial, sans-serif', primarySingerColor: '#d5167a', inactiveColor: '#fff',
      });
    };
    paint();
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, [renderTiming, position]);

  const loadStems = useCallback(async (next: StudioStem[]) => {
    player.current?.stop();
    setPlaying(false); setError('');
    if (!next.length) { generation.current = ''; setStems([]); setDuration(0); setStatus('Import audio stems to begin.'); return; }
    const id = crypto.randomUUID();
    generation.current = id;
    setStems(next);
    setAlignmentStemId(current => next.some(stem => stem.id === current) ? current : (next.find(stem => stem.role === 'lead') || next[0]).id);
    const songDuration = Math.max(...next.map(item => item.durationSeconds));
    setDuration(songDuration); setPosition(0);
    const inputs: KaraokeStemSource[] = next.map((stem, index) => ({ id: index + 1, role: stem.role, voice: stem.voice || stem.name, src: stem.url }));
    setStatus('Preparing stems for preview…');
    try {
      await player.current!.load({
        generation: id, stems: inputs, durationSeconds: songDuration, volume, outputId: '',
        mix: allAudible, stemVolumes: Object.fromEntries(next.map((stem, index) => [index + 1, stem.volume])),
      });
      setStatus(next.length + ' stem' + (next.length === 1 ? '' : 's') + ' ready · ' + seconds(songDuration));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('Could not prepare the audio.'); }
  }, [volume]);

  const addLocalPaths = useCallback(async (paths: string[]) => {
    const additions: StudioStem[] = [];
    for (const path of paths) {
      try {
        const url = await window.studio.registerMedia(path), durationSeconds = await mediaDuration(url);
        additions.push({ id: crypto.randomUUID(), name: path.split(/[\\/]/).at(-1) || 'Audio stem', role: 'other', voice: '', path, url, durationSeconds, volume: 1 });
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    if (additions.length) await loadStems([...stems, ...additions]);
  }, [loadStems, stems]);

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
    setError('');
    if (!generation.current) { setError('Import an audio stem before starting playback.'); return; }
    try {
      if (playing) player.current?.pause(generation.current);
      else await player.current?.play(generation.current);
      setPlaying(!playing);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const seek = (next: number) => { if (generation.current) void player.current?.seek(generation.current, next); setPosition(next); };
  const setMasterVolume = (value: number) => { setVolume(value); if (generation.current) player.current?.setVolume(generation.current, value); };

  const makeLines = () => {
    setLines(newLyricLines(lyricsDraft, duration || 240)); setNextLine(0); setTiming(false);
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
    setBusy(true); setError(''); setStatus('Aligning the supplied lyrics to audio locally. The first run downloads the alignment model…');
    try {
      const result = await window.studio.alignLyrics({
        audioPath: source.path, executable: settings.lyricAlignerExecutable,
        language: settings.alignmentLanguage, lyrics: lines.map(line => line.text),
      });
      if (JSON.stringify(linesRef.current) !== lyricsAtStart) throw new Error('The lyric cues changed while synchronization was running. The new timings were discarded; run synchronization again.');
      const alignedLines = applyForcedAlignment(lines, result.words, Math.max(duration, result.duration));
      setLines(alignedLines);
      setDuration(Math.max(duration, result.duration));
      setStatus(`Synchronized ${result.words.length} supplied lyric words. Review the cues and adjust any mismatches.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('Lyric synchronization did not finish. Existing lyric text and timing were kept.');
    } finally { setBusy(false); }
  };
  const tapLine = () => {
    if (nextLine >= lines.length) return;
    const at = position, indexToMark = nextLine;
    setLines(current => current.map((line, index) => {
      if (index === indexToMark) return { ...line, startSeconds: at, endSeconds: Math.max(at + 0.1, line.endSeconds) };
      if (index === indexToMark - 1) return { ...line, endSeconds: at };
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
    // Text edits invalidate word-level timing so it cannot silently describe old text.
    return { ...line, ...patch, ...(patch.text !== undefined && patch.text !== line.text ? { words: [] } : {}) };
  }));
  const updateWord = (lineId: string, wordIndex: number, field: 'startSeconds' | 'endSeconds', value: number) => {
    if (!Number.isFinite(value)) return;
    setLines(current => current.map(line => {
      if (line.id !== lineId || !line.words[wordIndex]) return line;
      const words = line.words.slice(), word = words[wordIndex];
      words[wordIndex] = field === 'startSeconds'
        ? { ...word, startSeconds: Math.max(0, value), endSeconds: Math.max(value + 0.01, word.endSeconds) }
        : { ...word, endSeconds: Math.max(word.startSeconds + 0.01, value) };
      return { ...line, words, startSeconds: words[0].startSeconds, endSeconds: words.at(-1)!.endSeconds };
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
  const importLyrics = async (file: File) => {
    if (file.name.toLowerCase().endsWith('.cdg')) {
      setCdgPath(window.studio.getPathForFile(file));
      setStatus('CD+G source saved with this project. Graphic lyrics are not yet editable as text cues.');
      return;
    }
    try {
      const imported = parseLyricsFile(file.name, await file.text());
      setLines(imported.lines);
      if (imported.title) setTitle(imported.title);
      if (imported.artist) setArtist(imported.artist);
      setLyricsDraft(imported.lines.map(line => line.text).join('\n'));
      setStatus('Imported ' + imported.lines.length + ' lyric cues from ' + file.name + '.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const exportLyrics = async (format: 'json' | 'lrc' | 'srt') => {
    const content = format === 'json' ? toLyricsJson(title, artist, duration, lines) : format === 'lrc' ? toLrc(title, artist, lines) : toSrt(lines);
    const file = await window.studio.saveText({ name: safeName(title), extension: format === 'lrc' ? 'lrc' : format, content });
    if (file) setStatus('Saved ' + file.split(/[\\/]/).at(-1) + '.');
  };
  const saveSettings = async () => {
    try { setSettings(await window.studio.saveSettings(settings)); setSettingsOpen(false); setStatus('Preferences saved.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const separate = async () => {
    const source = stems.find(stem => stem.path)?.path;
    if (!source) { setError('Import a local audio file before running stem separation.'); return; }
    setBusy(true); setError(''); setStatus('Separating audio with the selected local model…');
    try {
      const result = await window.studio.separate({ sourcePath: source, executable: settings.separatorExecutable, model: settings.separatorModel });
      await addLocalPaths(result.files);
      setStatus('Separated audio saved to ' + result.outputDirectory + '.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('Stem separation did not finish.'); }
    finally { setBusy(false); }
  };
  const chooseBackground = async () => {
    const path = await window.studio.chooseImageFile();
    if (!path) return;
    try {
      const url = await window.studio.registerMedia(path);
      setBackground(current => { if (current?.url.startsWith('blob:')) URL.revokeObjectURL(current.url); return { url, path }; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const currentProject: StudioProject = {
    schema: 'com.thepropervolume.karaoke-studio', version: 1, title, artist, durationSeconds: duration,
    stems: stems.map(({ file: _file, url: _url, ...stem }) => stem), lyrics: lines, importedCdg: cdgPath,
  };
  const exportKit = async () => {
    setBusy(true); setError('');
    try {
      const kitProject = toPortableKitProject(currentProject);
      const saved = await window.studio.exportKit({
        name: safeName(title), manifest: JSON.stringify(kitProject, null, 2),
        lyrics: { 'lyrics.json': toLyricsJson(title, artist, duration, lines), 'lyrics.enhanced.lrc': toLrc(title, artist, lines), 'lyrics.srt': toSrt(lines) },
        stems: stems.map(stem => ({ path: stem.path, name: stem.name, role: stem.role, voice: stem.voice, volume: stem.volume })),
        cdgPath,
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
        backgroundPath: background?.path,
        stems: stems.map(stem => ({ path: stem.path, name: stem.name, role: stem.role, voice: stem.voice, volume: stem.volume })),
        ass: toAss(title, artist, duration, lines),
      });
      if (saved) setStatus('Rendered video: ' + saved.split(/[\\/]/).at(-1) + '.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('Video export failed.'); }
    finally { setBusy(false); }
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">TPV</div><div className="brand-title">The Proper Volume Karaoke Studio</div>
      <input className="project-name" aria-label="Song title" placeholder="Song title" value={title} onChange={event => setTitle(event.target.value)} />
      <input className="project-name" aria-label="Artist" placeholder="Artist" value={artist} onChange={event => setArtist(event.target.value)} />
      <button onClick={() => setSettingsOpen(true)} aria-label="Open preferences">⚙ Preferences</button>
    </header>
    <main className="main-grid">
      <section className="panel">
        <div className="section-title">Audio Stems</div><h2>Build your mix</h2>
        <p className="muted">Add audio tracks and label each voice so the mix and kit stay organized.</p>
        <div className="toolbar">
          <label className="button-like"><input className="hidden-input" type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.ogg" multiple onChange={event => { void onAudioFiles(event.target.files); event.currentTarget.value = ''; }} />＋ Import Stems</label>
          <button onClick={() => void window.studio.chooseAudioFiles().then(addLocalPaths)}>Browse</button>
        </div>
        <div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void onAudioFiles(event.dataTransfer.files); }}>Drop audio files here</div>
        <div className="stack" style={{ marginTop: 12 }}>
          {stems.map(stem => <article className="stem-card" key={stem.id}>
            <div className="row spaced"><span className="filename" title={stem.name}>{stem.name}</span><button onClick={() => removeStem(stem.id)} aria-label={'Remove ' + stem.name}>×</button></div>
            <div className="row">
              <select aria-label={stem.name + ' role'} value={stem.role} onChange={event => updateStem(stem.id, { role: event.target.value as StudioRole })}>
                {roles.map(role => <option key={role} value={role}>{role}</option>)}
              </select>
              <input className="small-input" aria-label={stem.name + ' voice label'} placeholder="Voice / part (optional)" value={stem.voice} onChange={event => updateStem(stem.id, { voice: event.target.value })} />
            </div>
            <label className="row muted">Stem volume<input aria-label={stem.name + ' volume'} type="range" min="0" max="1" step="0.01" value={stem.volume} onChange={event => updateStemVolume(stem.id, Number(event.target.value))} /></label>
          </article>)}
        </div>
        <button style={{ marginTop: 12 }} disabled={!stems.length || busy} onClick={() => void separate()}>Separate a source track…</button>
        <p className="muted">Uses the configured local UVR-compatible model. No audio is uploaded.</p>
        <div className="section-title" style={{ marginTop: 26 }}>Lyrics</div>
        <div className="toolbar">
          <label className="button-like"><input className="hidden-input" type="file" accept=".json,.lrc,.elrc,.srt,.cdg" onChange={event => { const file = event.target.files?.[0]; if (file) void importLyrics(file); event.currentTarget.value = ''; }} />＋ Import Lyrics</label>
          <button onClick={makeLines}>Build from text</button>
        </div>
        <textarea rows={5} className="small-input" placeholder="Paste lyrics, one line per cue" value={lyricsDraft} onChange={event => setLyricsDraft(event.target.value)} />
        <div className="toolbar">
          <button className="accent" disabled={!lines.length || !generation.current || busy} onClick={() => void beginTiming()}>Start line timing</button>
          <button disabled={!lines.length || !generation.current || busy} onClick={() => void beginWordTiming()}>Start word timing</button>
          <button className="primary" disabled={!lines.length || !stems.some(stem => stem.path) || busy} onClick={() => void alignLyrics()}>Sync supplied lyrics with AI</button>
          {timing && <button className="primary" onClick={captureMode === 'word' ? tapWord : tapLine}>{captureMode === 'word' ? `Tap next word · ${Math.min(nextWord + 1, wordCount)}/${wordCount}` : `Tap next line · ${Math.min(nextLine + 1, lines.length)}/${lines.length}`}</button>}
          {timing && <button onClick={finishTiming}>Finish timing</button>}
        </div>
        <label className="field-label">Audio for synchronization
          <select value={alignmentStemId} onChange={event => setAlignmentStemId(event.target.value)} disabled={!stems.length}>
            {stems.filter(stem => stem.path).map(stem => <option key={stem.id} value={stem.id}>{stem.name}{stem.role === 'lead' ? ' · lead vocal' : ''}</option>)}
          </select>
        </label>
        <p className="muted">Aligns the lyrics you supplied to this audio. It does not identify, transcribe, or change lyrics. Best results usually come from a clear vocal track.</p>
        <p className="muted">Start playback, then tap the next line or word as it is sung. Spacebar also records a timing while this editor is active.</p>
      </section>

      <section className="panel preview-panel">
        <div className="row spaced">
          <div><div className="section-title">Singer Preview</div><h2>{title || 'Untitled Song'}</h2></div>
          <button onClick={() => void chooseBackground()}>Choose Background</button>
        </div>
        <div className="preview-stage" aria-label="Karaoke lyrics preview">
          {background && <img src={background.url} alt="Selected karaoke background" />}
          <div className="preview-brand">The Proper Volume Karaoke Studio</div>
          <canvas ref={canvas} />
          {!lines.some(line => position >= line.startSeconds && position < line.endSeconds) && <div className="preview-empty">Timed lyrics preview here</div>}
        </div>
        <div className="preview-timeline">
          <div className="row"><span>{seconds(position)}</span><input aria-label="Playback position" className="grow" type="range" min={0} max={Math.max(duration, 1)} step="0.05" value={Math.min(position, duration || 1)} onChange={event => seek(Number(event.target.value))} /><span>{seconds(duration)}</span></div>
          <div className="row spaced">
            <div className="toolbar"><button onClick={() => seek(0)}>⏮ Start</button><button className="primary" onClick={() => void togglePlay()} disabled={!stems.length}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button>
              <label className="row muted">Mix volume <input type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setMasterVolume(Number(event.target.value))} /></label>
            </div>
            <span className="muted">{stems.length} stems · {lines.length} cues</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Cue Sheet</div><h2>Manual timing</h2>
        <p className="muted">Adjust cue text and start/end points directly, or tap them during playback.</p>
        <div className="lyrics-list">
          {lines.map((line, index) => <div className={'lyric-row ' + (timing && captureMode === 'line' && index === nextLine ? 'active' : '')} key={line.id}>
            <span className="time">{seconds(line.startSeconds)}</span>
            <input aria-label={'Lyric line ' + (index + 1)} value={line.text} onChange={event => updateLine(line.id, { text: event.target.value })} />
          </div>)}
          {!lines.length && <p className="muted">Import an LRC, SRT or JSON file, or paste lyrics in the left panel.</p>}
        </div>
        {lines.length > 0 && <div className="stack">
          {lines.map((line, index) => <div className="cue-block" key={line.id + '-times'}>
            <div className="row">
              <span className="time">{String(index + 1).padStart(2, '0')}</span>
              <input aria-label={'Line ' + (index + 1) + ' start'} type="number" min="0" step="0.01" value={line.startSeconds} onChange={event => updateLine(line.id, { startSeconds: Number(event.target.value) })} />
              <input aria-label={'Line ' + (index + 1) + ' end'} type="number" min="0" step="0.01" value={line.endSeconds} onChange={event => updateLine(line.id, { endSeconds: Number(event.target.value) })} />
            </div>
            {line.words.length > 0 && <details className="word-cues">
              <summary>Word timings · {line.words.length}</summary>
              {line.words.map((word, wordIndex) => <div className={'row word-cue ' + (timing && captureMode === 'word' && wordOffsets[index] + wordIndex === nextWord ? 'active' : '')} key={wordIndex}>
                <span className="word-label" title={word.text}>{word.text.trim() || ' '}</span>
                <input aria-label={'Line ' + (index + 1) + ' word ' + (wordIndex + 1) + ' start'} type="number" min="0" step="0.01" value={word.startSeconds} onChange={event => updateWord(line.id, wordIndex, 'startSeconds', Number(event.target.value))} />
                <input aria-label={'Line ' + (index + 1) + ' word ' + (wordIndex + 1) + ' end'} type="number" min="0" step="0.01" value={word.endSeconds} onChange={event => updateWord(line.id, wordIndex, 'endSeconds', Number(event.target.value))} />
              </div>)}
            </details>}
          </div>)}
        </div>}
        <div className="section-title" style={{ marginTop: 24 }}>Export</div>
        <div className="export-card stack">
          <div className="toolbar"><button onClick={() => void exportLyrics('json')} disabled={!lines.length}>JSON</button><button onClick={() => void exportLyrics('lrc')} disabled={!lines.length}>Enhanced LRC</button><button onClick={() => void exportLyrics('srt')} disabled={!lines.length}>SRT</button></div>
          <button className="primary" disabled={busy || !stems.length} onClick={() => void exportVideo()}>Render Karaoke Video (.mp4)</button>
          <button className="accent" disabled={busy || !stems.length} onClick={() => void exportKit()}>Export TPV Kit (.tpvkit)</button>
          <span className="muted">Video export uses FFmpeg. A TPV kit includes audio stems and lyrics.</span>
          {cdgPath && <span className="muted">CD+G source will be included in the kit.</span>}
        </div>
        <div className="section-title" style={{ marginTop: 24 }}>Project Status</div>
        <p className="status">{busy ? 'Working…' : status}</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
    <footer className="footer"><span>Prototype 0.3.0 · Processing stays on this computer</span><span>TPV Kit · timed lyrics · local stems</span></footer>
    {settingsOpen && <div className="settings" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section className="settings-card" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
        <div className="row spaced"><h2 id="preferences-title">Studio Preferences</h2><button onClick={() => setSettingsOpen(false)}>Close</button></div>
        <p className="muted">Choose the local tools used to render video, separate stems, and align supplied lyrics.</p>
        <div className="stack">
          <label className="field-label">FFmpeg executable<input value={settings.ffmpegPath} onChange={event => setSettings({ ...settings, ffmpegPath: event.target.value })} /></label>
          <label className="field-label">Stem separation executable<input value={settings.separatorExecutable} onChange={event => setSettings({ ...settings, separatorExecutable: event.target.value })} /></label>
          <label className="field-label">UVR / Audio Separator model<input value={settings.separatorModel} onChange={event => setSettings({ ...settings, separatorModel: event.target.value })} /></label>
          <label className="field-label">Lyric alignment Python executable<input value={settings.lyricAlignerExecutable} onChange={event => setSettings({ ...settings, lyricAlignerExecutable: event.target.value })} /><span className="muted">Use Python 3.10–3.13; a full path is supported.</span></label>
          <label className="field-label">Lyric language code (for example, en)<input value={settings.alignmentLanguage} onChange={event => setSettings({ ...settings, alignmentLanguage: event.target.value })} /></label>
          <p className="muted">Default: Audio Separator with a UVR MDX model. Install it locally; Audio Separator downloads its selected model on first use.</p>
          <p className="muted">AI lyric synchronization uses local WhisperX forced alignment. Install in the selected Python 3.10–3.13 environment with <code>python -m pip install whisperx</code>; the first run downloads its language model. Audio and lyric text stay on this computer.</p>
        </div>
        <div className="row spaced"><div className="toolbar"><a href="https://github.com/nomadkaraoke/python-audio-separator" target="_blank" rel="noreferrer">Audio Separator setup</a><a href="https://github.com/m-bain/whisperX" target="_blank" rel="noreferrer">WhisperX setup</a></div><button className="primary" onClick={() => void saveSettings()}>Save Preferences</button></div>
      </section>
    </div>}
  </div>;
}
