# The Proper Volume Karaoke Studio — Product Specification

## Purpose

The Proper Volume Karaoke Studio is a desktop authoring tool for creating karaoke tracks from audio stems and timed lyrics. It previews the result with the same lyric renderer used in The Proper Volume Karaoke Booth, then exports a video or a portable TPV kit.

## Prototype 0.3.0

### Implemented

- Import multiple local audio files and label each as instrumental, lead, backing, or other; voice names are editable.
- Preview synchronized stems with independent stem gain and master volume.
- Paste lyrics and capture line or word starts during playback with the timing button or Spacebar; cue and word start/end times are directly editable.
- Force-align supplied lyrics to a selected local audio track with WhisperX. The alignment path does not run speech recognition, generate lyrics, or change supplied text; exact lyric words and line breaks are retained while timings are added.
- Import and export the Studio lyrics JSON schema, Enhanced LRC word timestamps, and SRT line cues.
- Render an MP4 with mixed audio, karaoke highlighting, and an optional still-image background through a configured local FFmpeg executable.
- Export a ZIP-based TPV kit containing relative-path project metadata, lyrics, audio stems, and an optional original CD+G file.
- Configure a local Audio Separator executable and UVR-compatible model name. Audio Separator downloads model weights on first use.

### Not yet implemented

- Open/reopen a TPV kit as an editable project, project autosave and recovery.
- Read CD+G graphics into a preview or editable lyric text, and generate CD+G output.
- Import arbitrary JSON schemas; JSON lyric import currently expects the Studio schema.
- Multiple separation providers, remote services, waveform editing, per-voice recording tools, and installer signing.

## Audio separation design

The first separation adapter runs the locally installed audio-separator command. Its configurable executable/model allow different UVR-compatible models and hardware-specific local environments. No account credential, song, or stem is uploaded by Studio. Python, model weights, and accelerator libraries are not bundled with the prototype.

## Project and kit format

A TPV kit is a ZIP archive containing manifest.json, lyrics/lyrics.json, lyrics/lyrics.enhanced.lrc, lyrics/lyrics.srt, and a stems/ directory. When present, an original CD+G source is kept under source/. Paths in the manifest are relative to the kit. Kit schema version 1 is private to Studio until its format is reviewed and published.

## File-format support

| Format | Import | Export | Prototype behavior |
| --- | --- | --- | --- |
| TPV Studio JSON | Yes | Yes | Versioned Studio lyric/project schema |
| Enhanced LRC | Yes | Yes | Preserves imported word timestamps; manual taps currently time lines |
| SRT | Yes | Yes | Line-level cue times |
| CD+G | Source asset only | No | Can be kept in a kit; graphic decoding/export is pending |

## Shared-code boundary

Studio currently pins a copy of the Booth's Web Audio player and canvas lyric renderer. Shared, provider-neutral audio, timing, and rendering code should move into a versioned proper-karaoke-core package when its API stabilizes. Each app should keep its own Electron shell, service integration, file workflow, user interface, and packaging.

## AI lyric synchronization

The user supplies and edits lyric text first. Studio sends that text and a chosen local audio file to a small Python adapter, which calls WhisperX's forced-alignment API directly. It does not call WhisperX transcription or use an ASR model to find lyrics. Alignment runs locally; the selected language model is downloaded by WhisperX on first use. The app retains the original lyric strings and line breaks, attaches aligned word timestamps, and leaves the prior timing untouched if alignment fails or the returned words do not match the supplied text.

WhisperX's acoustic alignment models are designed for speech rather than singing. For the most useful first pass, select a clear lead-vocal source; manually review and correct the result in the cue sheet. Install the optional dependency with `python -m pip install whisperx` using Python 3.10–3.13. The Python executable and language code are configurable in Preferences. GPU acceleration is used when CUDA is available; otherwise alignment runs on CPU.

This feature requires a separate local WhisperX install and downloads language-specific alignment weights on first use.
