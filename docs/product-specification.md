# The Proper Volume Karaoke Studio — Product Specification

## Purpose

The Proper Volume Karaoke Studio is a desktop authoring tool for creating karaoke tracks from audio stems and timed lyrics. It previews the result with the same lyric renderer used in The Proper Volume Karaoke Booth, then exports a video or a portable TPV kit.

## Prototype 0.11.8

### Implemented

- Import multiple local audio files and label each as instrumental, lead, backing, or other; voice names are editable.
- Preview synchronized stems with independent stem gain and master volume.
- Capture line or word starts at the playhead, with undo, redo, and session cancellation. Set individual timing fields from the context menu or split a line into an editable word draft.
- Scrub, pan, and zoom at the pointer in a resizable waveform. Move a cue to the playhead while retaining word offsets. Transport can skip back 5 seconds or ahead 10 seconds.
- Work in a Booth-style workspace with Studio's Bouncing Ball icon, Day and Night appearance, selectable accents, a large singer preview, a resizable editor, and fixed playback controls. [Workspace guide](workspace.md)
- Save a bundled or custom lyric font, font size, leading, casing, colors, and two to six rows. Four rows are the default. Finished lines hold until halfway through the next sung line when the row is available. The preview and authored MP4 and CD+G exports share lyric and bar timing.
- Format imported or pasted lyrics with adjustable minimum, target, and maximum line lengths. The formatter leaves timed cues available until the user rebuilds them. [Formatting guide](workspace.md)
- Force-align supplied lyrics to a selected audio track with WhisperX or Qwen locally, or with Vultr or AudioShake after upload approval. Studio retains supplied words and line breaks, limits Qwen timestamps to the selected audio, and handles missing WhisperX tokenizer data without a shared-directory download. [Lyric Sync](lyric-synchronization.md)
- Import and export the Studio lyrics JSON schema, Enhanced LRC word timestamps, and SRT line cues. Studio uses Karaoke Core for LRC, SRT, and the common timing types.
- Map external timed lyric JSON through explicit JSON Pointer paths and time units in the [CLI](json-lyric-import.md).
- Render an MP4 with mixed audio, karaoke highlighting, and optional still, GIF, or muted MP4 backgrounds. Animated backgrounds support looping; the preview and rendered action follow the song timeline.
- Import and preview original CD+G graphics with local audio, render them to MP4, and author new CD+G graphics from timed cues. [CD+G workflow](cdg.md)
- Export a ZIP-based TPV kit containing relative-path project metadata, lyrics, audio stems, and optional backdrop media and original CD+G graphics.
- Reopen a TPV kit from **Open Project** or the CLI. Studio creates an editable project with its own adjacent media folder and preserves its cue and stem settings.
- Download verified model weights or reuse local Ultimate Vocal Remover models. Audio Separator ensembles can combine models and split the result into lead, backing, and instrumental tracks. [Model library](models.md)
- Manage encrypted credentials for Dango AI, MVSEP, and GAUDIO. Review and approve each cloud stem-separation request. Custom entries store credentials for other services.
- Apply Preferences for this session or save them as defaults. Reset individual fields to the saved defaults. Assign keyboard shortcuts and open the JSON preferences and keybindings files from Studio.
- Open bundled documentation and keyboard-shortcut preferences from Help. Check for desktop updates from Help using Karaoke Core's signed release feed. Studio shows a startup notice when an automatic check finds a new version. Preferences can download and verify updates, prepare installation at normal quit, or turn off automatic checks. Studio finishes its project-recovery write before handing off a prepared installer. [Update behavior](releases.md#update-studio)
- Provide application search terms in Windows Start shortcut, macOS Spotlight, and Linux desktop launcher metadata. [Desktop search](releases.md#find-studio-in-desktop-search)
- Record a microphone take, audition the take, and save it as a labeled local WAV stem from the [desktop editor](voice-recording.md).
- Open and save editable Studio projects in one shared file format for the desktop editor and CLI.
- Keep local snapshots of unsaved desktop edits and pending lyric text. [Project recovery](project-recovery.md) restores these snapshots after reopening Studio.
- Operate projects, stems, lyric download and timing, backdrop, preferences and exports from the [CLI](cli.md). Lyric downloads use the existing TPV ktools installation and report its version warnings.
- Format lyrics and separate stems without a project. Align supplied lyrics into a new project, a timed lyric file, or JSON on stdout. The Windows installer adds the bundled `tpv-karaoke-studio` executable to the appropriate PATH.
- Build preview installers for Windows, Linux and macOS and publish them directly to the [Studio release server](releases.md).

### Not yet implemented

- Convert CD+G graphics into editable text cues. The source format stores colored pixels.
- A graphical JSON mapping editor, punch-in and overdub recording, and optional remote inference.
- Validate alignment on complete songs and physical microphone recording on supported platforms.
- Signed Windows packages, notarized macOS installers, and installation and upgrade checks on physical devices.
- Adopt the common timing types in Booth and move the remaining provider-neutral playback and rendering interfaces into Karaoke Core.

## Audio separation design

Studio runs the configured Audio Separator or Demucs executable, or an approved Dango AI, MVSEP, or GAUDIO cloud job. A local second pass can split lead and backing vocals. Studio checks pinned upstream checksums when downloading its recommended models. [Stem separation guide](audio-separation.md)

## Project and kit format

A TPV kit is a ZIP archive containing manifest.json, lyrics/lyrics.json, lyrics/lyrics.enhanced.lrc, lyrics/lyrics.srt, and a stems/ directory. Optional CD+G graphics, backdrop media, and the selected custom lyric font live under source/, background/, and fonts/. Paths in the manifest are relative to the kit. Kit schema version 1 is private to Studio until its format is reviewed and published.

## File-format support

| Format | Import | Export | Prototype behavior |
| --- | --- | --- | --- |
| TPV Studio JSON | Yes | Yes | Versioned Studio lyric/project schema |
| Enhanced LRC | Yes | Yes | Preserves imported word timestamps and exports edited word timings |
| SRT | Yes | Yes | Line-level cue times |
| CD+G | Yes | Yes | Graphics preview, MP4 rendering, original copy, and authoring from timed cues |

## Shared-code boundary

Studio uses Karaoke Core 0.1.2 for provider-neutral timing, LRC/SRT interchange, and verified desktop updates. Studio currently pins a copy of Booth's Web Audio player and canvas lyric renderer. The shared package can absorb provider-neutral audio and rendering interfaces once both apps can consume them. Application shells, providers, project files, and packaging belong in the respective apps.

## AI lyric synchronization

The user supplies and edits lyric text first. The selected engine receives the song audio and the supplied lyrics for forced alignment. The app attaches word timestamps and keeps the prior timing whenever alignment fails or the returned words do not match the supplied text.

Choose an engine and supported language in Preferences. Studio and the CLI use separate private runtimes for WhisperX and Qwen. Vultr and AudioShake use encrypted credentials in the desktop app or environment variables in the CLI. The desktop app requests approval before uploading the selected audio and supplied lyrics. [AI Sync guide](lyric-synchronization.md)

The Windows smoke test ran the actual CPU model against a generated voice recording with a 1.5-second lead-in and placed all nine supplied words. Full-song timing quality across vocal styles and languages still needs review.
