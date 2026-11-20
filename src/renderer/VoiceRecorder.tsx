import { useEffect, useRef, useState } from 'react';
import type { StudioRole } from '../domain/project';
import { maxRecordingSeconds, recordingSampleRate } from '../domain/voice-recording';
import { captureVoice } from './voice-capture';

function recordingError(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') return 'Studio could not access the microphone. Check your system microphone permissions.';
  if (cause instanceof DOMException && cause.name === 'NotFoundError') return 'No microphone was found. Connect a microphone and try again.';
  if (cause instanceof DOMException && cause.name === 'NotReadableError') return 'Studio could not open the microphone. Close other apps using it and try again.';
  return cause instanceof Error ? cause.message : String(cause);
}

type Props = {
  title: string;
  roles: readonly StudioRole[];
  onClose(): void;
  onSaved(file: string, role: StudioRole, voice: string): Promise<void>;
};

export function VoiceRecorder({ title, roles, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController>(null);
  const stopRecording = useRef<() => void>(null);
  const [role, setRole] = useState<StudioRole>('lead');
  const [voice, setVoice] = useState('');
  const [phase, setPhase] = useState<'ready' | 'requesting' | 'recording' | 'stopping' | 'review' | 'saving'>('ready');
  const [take, setTake] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      controller.current?.abort();
      element?.close();
    };
  }, []);

  useEffect(() => {
    if (!take) { setPreview(''); return; }
    const url = URL.createObjectURL(new Blob([take.slice()], { type: 'audio/wav' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [take]);

  async function start() {
    const session = new AbortController();
    controller.current = session;
    setPhase('requesting');
    setError('');
    setTake(null);
    setElapsed(0);
    try {
      const capture = await captureVoice(session.signal, setElapsed);
      stopRecording.current = capture.stop;
      setPhase('recording');
      const bytes = await capture.recording;
      if (session.signal.aborted) return;
      setTake(bytes);
      setElapsed((bytes.byteLength - 44) / (2 * recordingSampleRate));
      setPhase('review');
    } catch (cause) {
      if (session.signal.aborted) return;
      setError(recordingError(cause));
      setPhase('ready');
    } finally { stopRecording.current = null; }
  }

  async function save() {
    if (!take) return;
    setError('');
    setPhase('saving');
    try {
      const file = await window.studio.saveVoiceRecording({
        name: [title.trim() || 'Untitled', voice.trim() || role, 'take'].join(' - ').slice(0, 140),
        wav: take,
      });
      if (!file) { setPhase('review'); return; }
      await onSaved(file, role, voice.trim());
      onClose();
    } catch (cause) {
      setError(recordingError(cause));
      setPhase('review');
    }
  }

  const minSec = (seconds: number) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  const editable = phase === 'ready' || phase === 'review';
  return <dialog ref={dialog} className="settings-card voice-recorder" aria-labelledby="voice-recorder-title" onCancel={event => {
    event.preventDefault();
    if (phase !== 'saving') onClose();
  }}>
    <div className="row spaced">
      <h2 id="voice-recorder-title">Record a voice stem</h2>
      <button aria-label="Close voice recorder" disabled={phase === 'saving'} onClick={onClose}>×</button>
    </div>
    <p className="muted">Record from your default microphone. Takes start at the beginning of the project and can last up to five minutes.</p>
    <div className="stack">
      <label className="field-label">Stem role
        <select disabled={!editable} value={role} onChange={event => setRole(event.target.value as StudioRole)}>
          {roles.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="field-label">Voice or part
        <input disabled={!editable} maxLength={100} value={voice} onChange={event => setVoice(event.target.value)} placeholder="Optional label" />
      </label>
      <p className="muted" aria-live="polite">
        {phase === 'requesting' ? 'Waiting for microphone access…' : phase === 'stopping' ? 'Finishing recording…'
          : phase === 'recording' ? 'Microphone is recording.' : phase === 'saving' ? 'Saving the take…'
          : phase === 'review' ? 'Take ready to save as WAV.' : 'Ready to record.'}
      </p>
      {phase !== 'ready' && phase !== 'requesting' && <output aria-label="Duration of take">{minSec(elapsed)} / {minSec(maxRecordingSeconds)}</output>}
      {phase === 'review' && preview && <audio aria-label="Play the voice take" controls src={preview} />}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="toolbar">
        {phase === 'ready' && <button className="primary" onClick={() => void start()}>Start recording</button>}
        {phase === 'recording' && <button className="primary" onClick={() => {
          setPhase('stopping');
          stopRecording.current?.();
        }}>Stop recording</button>}
        {phase === 'review' && <>
          <button className="primary" onClick={() => void save()}>Save and add stem</button>
          <button onClick={() => { setTake(null); setElapsed(0); setError(''); setPhase('ready'); }}>Discard take</button>
        </>}
        {(phase === 'requesting' || phase === 'recording' || phase === 'stopping') && <button onClick={onClose}>Cancel recording</button>}
      </div>
    </div>
  </dialog>;
}
