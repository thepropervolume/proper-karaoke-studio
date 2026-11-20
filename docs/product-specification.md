# The Proper Volume Karaoke Studio — Product Specification

## Purpose

The Proper Volume Karaoke Studio is a desktop authoring tool for creating karaoke tracks from audio stems and timed lyrics. It previews the result with the same lyric renderer used in The Proper Volume Karaoke Booth, then exports a video or a portable TPV kit.

## Prototype 0.6.1

### Implemented

- Import multiple local audio files and label each as instrumental, lead, backing, or other; voice names are editable.
- Preview synchronized stems with independent stem gain and master volume.
- Paste lyrics and capture line or word starts during playback with the timing button or Spacebar; cue and word start/end times are directly editable.
- Scrub through a zoomable waveform and move a selected lyric cue to the playhead while retaining its word timing offsets.
- Force-align supplied lyrics to a selected local audio track with WhisperX. The alignment path does not run speech recognition, generate lyrics, or change supplied text; exact lyric words and line breaks are retained while timings are added.
- Import and export the Studio lyrics JSON schema, Enhanced LRC word timestamps, and SRT line cues. Studio uses Karaoke Core for LRC, SRT, and the common timing types.
- Map external timed lyric JSON through explicit JSON Pointer paths and time units in the [CLI](json-lyric-import.md).
- Render an MP4 with mixed audio, karaoke highlighting, and an optional still-image background through a configured local FFmpeg executable.
- Import and preview original CD+G graphics with local audio, render them to MP4, and author new CD+G graphics from timed cues. [CD+G workflow](cdg.md)
- Export a ZIP-based TPV kit containing relative-path project metadata, lyrics, audio stems, and an optional original CD+G file.
- Reopen a TPV kit from **Open Project** or the CLI. Studio creates an editable project with its own adjacent media folder and preserves its cue and stem settings.
- Choose Audio Separator with a UVR model or Demucs with a supported model. Both run locally.
- Record a microphone take, audition the take, and save it as a labeled local WAV stem from the [desktop editor](voice-recording.md).
- Open and save editable Studio projects in one shared file format for the desktop editor and CLI.
- Keep local snapshots of unsaved desktop edits and pending lyric text. [Project recovery](project-recovery.md) restores these snapshots after reopening Studio.
- Operate projects, stems, lyric download and timing, backdrop, preferences and exports from the [CLI](cli.md). Lyric downloads use the existing TPV ktools installation and report its version warnings.
- Build and publish preview installers for Windows, Linux and macOS through the [Studio release workflow](releases.md).

### Not yet implemented

- Convert CD+G graphics into editable text cues. The source format stores colored pixels.
- A graphical JSON mapping editor, punch-in and overdub recording, and optional remote inference.
- Validate alignment on complete songs and physical microphone recording on supported platforms.
- Signed Windows packages, notarized macOS installers, and installation and upgrade checks on physical devices.
- Adopt the common timing types in Booth and move the remaining provider-neutral playback and rendering interfaces into Karaoke Core.

## Audio separation design

Studio runs the selected local separator executable with its configured model. Audio Separator supports UVR models. Demucs defaults to htdemucs for vocals, bass, drums and other instruments. The packages leave Python, model weights and accelerator libraries to the selected local tool.

## Project and kit format

A TPV kit is a ZIP archive containing manifest.json, lyrics/lyrics.json, lyrics/lyrics.enhanced.lrc, lyrics/lyrics.srt, and a stems/ directory. When present, an original CD+G source is kept under source/. Paths in the manifest are relative to the kit. Kit schema version 1 is private to Studio until its format is reviewed and published.

## File-format support

| Format | Import | Export | Prototype behavior |
| --- | --- | --- | --- |
| TPV Studio JSON | Yes | Yes | Versioned Studio lyric/project schema |
| Enhanced LRC | Yes | Yes | Preserves imported word timestamps and exports edited word timings |
| SRT | Yes | Yes | Line-level cue times |
| CD+G | Yes | Yes | Graphics preview, MP4 rendering, original copy, and authoring from timed cues |

## Shared-code boundary

Studio uses Karaoke Core 0.1.0 for provider-neutral timing and LRC/SRT interchange. Studio currently pins a copy of Booth's Web Audio player and canvas lyric renderer. The shared package can absorb provider-neutral audio and rendering interfaces once both apps can consume them. Application shells, providers, project files, and packaging belong in the respective apps.

## AI lyric synchronization

The user supplies and edits lyric text first. Studio sends that text and a chosen local audio file to a small Python adapter, which calls WhisperX's forced-alignment API directly. It does not call WhisperX transcription or use an ASR model to find lyrics. Alignment runs locally; the selected language model is downloaded by WhisperX on first use. The app retains the original lyric strings and line breaks, attaches aligned word timestamps, and leaves the prior timing untouched if alignment fails or the returned words do not match the supplied text.

WhisperX's acoustic alignment models are designed for speech rather than singing. For the most useful first pass, select a clear lead-vocal source; manually review and correct the result in the cue sheet. Install the optional dependency with `python -m pip install whisperx` using Python 3.10–3.13. The Python executable and language code are configurable in Preferences. GPU acceleration is used when CUDA is available; otherwise alignment runs on CPU.

This feature requires a separate local WhisperX install and downloads language-specific alignment weights on first use.

The Windows smoke test ran the actual CPU model against a generated voice recording with a 1.5-second lead-in and placed all nine supplied words. Full-song timing quality across vocal styles and languages still needs review.
