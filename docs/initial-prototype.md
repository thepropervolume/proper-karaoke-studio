# Prototype scope

Version 0.4.0 imports and previews local stems, aligns supplied lyrics with WhisperX, captures line or word timing manually, and exports an MP4 or TPV kit. Studio has one editor and shares editable projects with the [CLI](cli.md). The CLI can download lyrics through the user's local TPV ktools installation.

## Available

- Import multiple WAV, MP3, FLAC, M4A, AAC, OGG/Opus, AIFF, and WMA files; set role and voice label.
- Paste lyrics and tap each line or word during playback to capture its start time. Spacebar is a timing shortcut while the editor is active.
- Import/export TPV lyrics JSON, Enhanced LRC, and SRT.
- Render MP4 with a mixed stem soundtrack, optional still background, and burned-in captions via FFmpeg.
- Package project data, audio stems, lyrics, and an optional original CD+G source into a TPV kit.
- Configure local FFmpeg and Audio Separator executable/model.
- Adjust every imported stem's gain independently in the live preview and final mix.
- Open and save editable project files in the desktop app, or automate edits and exports from the CLI.

## Limits to address

- CD+G is preserved as an original kit asset but is not decoded into editable lyrics or exported as CD+G.
- Imported Enhanced LRC word cues are retained and can be retimed in the word timing editor.
- Separation runs an installed local Audio Separator CLI. Python, GPU runtimes, and model weights are not bundled.
- MP4 export requires FFmpeg with H.264 (libx264), AAC, and subtitles/libass support.
- Project autosave, waveform editing, additional service adapters, signing, and installers are future work.
