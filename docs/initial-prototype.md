# Prototype scope

Version 0.3.0 imports local stems, previews them through the Karaoke Booth Web Audio renderer, force-aligns user-supplied lyrics locally with WhisperX, captures line or word-level timing manually, and exports an MP4 or TPV kit. Studio uses one editor mode rather than separate basic and advanced modes. AI alignment never discovers or transcribes lyric text; it only assigns timestamps to the supplied words.

## Available

- Import multiple WAV, MP3, FLAC, M4A, AAC, OGG/Opus, AIFF, and WMA files; set role and voice label.
- Paste lyrics and tap each line or word during playback to capture its start time. Spacebar is a timing shortcut while the editor is active.
- Import/export TPV lyrics JSON, Enhanced LRC, and SRT.
- Render MP4 with a mixed stem soundtrack, optional still background, and burned-in captions via FFmpeg.
- Package project data, audio stems, lyrics, and an optional original CD+G source into a TPV kit.
- Configure local FFmpeg and Audio Separator executable/model.
- Adjust every imported stem's gain independently in the live preview and final mix.

## Limits to address

- CD+G is preserved as an original kit asset but is not decoded into editable lyrics or exported as CD+G.
- Imported Enhanced LRC word cues are retained and can be retimed in the word timing editor.
- Separation runs an installed local Audio Separator CLI. Python, GPU runtimes, and model weights are not bundled.
- MP4 export requires FFmpeg with H.264 (libx264), AAC, and subtitles/libass support.
- Project autosave, waveform editing, additional service adapters, signing, and installers are future work.
