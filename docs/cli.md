# Karaoke Studio CLI

The Studio CLI can create and edit projects, download lyrics, align supplied lyrics to audio, separate stems, and export deliverables.

### Run the CLI

After running the Windows setup EXE, open a new terminal and run `tpv-karaoke-studio --help`. The installer adds the command to the matching user or system PATH. The Debian package installs the command under `/usr/bin`. Both launchers use the runtime included with Studio. For the Windows portable ZIP, run `cli\tpv-karaoke-studio.exe` from the extracted folder.

From a source checkout with Node.js 24 or newer, run `npm run build` once, then use `npm run cli --` or `node dist-electron/cli.cjs`. Use `npm link` after building to register the command through npm. Desktop packages also include `studio-cli.cjs` in their application resources folder for use with Node.js 24 or newer. Add `--help` to any command to view its arguments.

## Work without a project

    tpv-karaoke-studio lyrics format --lyrics "Perfect.raw.txt" --output "Perfect.txt"
    tpv-karaoke-studio audio models --adapter demucs
    tpv-karaoke-studio audio process --adapter demucs --model htdemucs --model-options "two-stems=vocals,shifts=0" --audio "Perfect.wav" --output "./stems"
    tpv-karaoke-studio lyrics align --audio "Perfect.wav" --lyrics "Perfect.txt" --project "Perfect.tpv.json"

Formatting preserves lyric words and stanza breaks while wrapping lines. The defaults are 10 minimum, 19 target, and 26 maximum characters per line. Change them with `--min-length`, `--target-length`, and `--max-length`. The formatter keeps an indivisible word intact even when it exceeds the maximum. It reads TXT, LRC, Enhanced LRC, SRT, Studio lyric JSON, and JSON lyric search results. Use `--candidate 2` to pick the second usable version from a search result with multiple versions. Timed inputs produce a separate plain-text file so the original timing stays available. Plain-text files support using the same input and output filename.

Audio processing creates a unique output subfolder. Use `audio models` to see available models and supported options for the chosen separator.

With `--lyrics`, alignment can create the named project after it succeeds. For a timed lyric file, use `--output timed.lrc`, `timed.srt`, or `timed.json`. Omit both destinations for timed JSON on stdout. With an existing project, alignment updates the cue timings and checks for concurrent edits.

## Projects

Project commands use `studio.tpv.json` in the current directory unless you supply `--project <file>`. The file contains track metadata, cue and word timings, media paths, per-stem gain and roles, and visual settings. Select **Open Project** in Studio to edit it visually. You can also run `tpv-karaoke-studio project open --project <file>` to launch the editor. If Studio is installed separately, pass `--app <desktop-executable>`.

The project references the original media files. Use a TPV kit to package the stems and lyrics. Desktop saves and CLI edits check whether someone else changed the project since it was read. If a save reports a newer revision, reopen the project or use **Save As** to keep a separate copy.

    tpv-karaoke-studio project init --title "Song Title" --artist "Artist Name"
    tpv-karaoke-studio stems add "Original Song.mp3" --role lead
    tpv-karaoke-studio project backdrop "Cover.png"
    tpv-karaoke-studio project backdrop "Stage Loop.mp4" --no-loop
    tpv-karaoke-studio lyrics import "Lyrics.txt"
    tpv-karaoke-studio lyrics align
    tpv-karaoke-studio lyrics line 1 --start 00:05.250 --end 9
    tpv-karaoke-studio lyrics word 1 2 --start 6.1 --end 6.6
    tpv-karaoke-studio export lyrics lrc --output "Song.enhanced.lrc"
    tpv-karaoke-studio export lyrics cdg --output "Song.cdg"
    tpv-karaoke-studio export video --output "Song.mp4"
    tpv-karaoke-studio export kit --output "Song.tpvkit"

Reopen a portable kit into a new editable project. Studio extracts its media into a sibling folder and references those copies in the new project.

    tpv-karaoke-studio project import-kit "Song.tpvkit" --project "Restored Song.tpv.json"

Stem and line selectors accept IDs or one-based indexes. Word selectors use one-based indexes within a line. Numeric times are in seconds and manual cue inputs also accept `mm:ss.mmm`. FFmpeg measures imported audio unless you give `--duration`. Stem separation can optionally add its results to the project with `--add`. See the [lyric alignment guide](lyric-synchronization.md) and [stem separation guide](audio-separation.md) for their local runtime requirements.

In plain-text lyrics and `lyrics line --text`, use `per/fect` to create two independently timed parts of `perfect`. Use `\/` for a visible slash. `lyrics word` addresses each timed part by its one-based index.

Import a CD+G source with `lyrics import <file.cdg>`. Add its matching audio with `stems add` and use `export video` to render the graphics with audio. With editable lyric cues, `export lyrics cdg` draws a new graphics track. Add `--original` to copy the attached source byte for byte. The [CD+G guide](cdg.md) describes supported exports and playback.

To import a timed lyric JSON file from another application, supply a [field mapping](json-lyric-import.md) with `lyrics import <file.json> --mapping <mapping.json>`. Studio lyrics JSON exports can be imported directly.

## Set up lyric sync

The desktop app and CLI share the managed local runtimes. `lyrics align` uses the saved `alignmentEngine` setting by default. Pass `--engine` to override it for one run. Local setup starts on demand, or set it up in advance:

    tpv-karaoke-studio lyrics setup
    tpv-karaoke-studio lyrics setup --status
    tpv-karaoke-studio lyrics setup --engine qwen
    tpv-karaoke-studio lyrics languages
    tpv-karaoke-studio lyrics languages --engine qwen

For cloud synchronization, set `VULTR_INFERENCE_API_KEY` or `AUDIOSHAKE_API_KEY` in the environment. `--approve-cloud` authorizes the CLI to upload the selected audio and lyrics and incur processing charges.

    tpv-karaoke-studio lyrics align --engine vultr --approve-cloud --project "Perfect.tpv.json"
    tpv-karaoke-studio lyrics align --engine audioshake --approve-cloud --audio "Perfect.wav" --lyrics "Perfect.txt" --output "Perfect.enhanced.lrc"

Use `--language en` to select a language for one run. AudioShake detects it automatically. WhisperX downloads its acoustic model the first time you use a language. Qwen downloads one model for its supported languages. Pass `--python <executable>` to use a compatible external environment with either local engine. The `lyricAlignerExecutable` setting selects the external interpreter for WhisperX. Managed CPU runtimes support Windows x64, Linux x64, and Apple silicon Mac.

## List separation models and use cloud separation

    tpv-karaoke-studio stems models --adapter audio-separator
    tpv-karaoke-studio stems models --adapter dango
    tpv-karaoke-studio stems separate "Original Song.wav" --adapter dango --output-dir "./stems" --approve-cloud
    tpv-karaoke-studio audio models --adapter mvsep
    tpv-karaoke-studio audio process --adapter mvsep --model 49 --audio "Original Song.wav" --output "./stems" --approve-cloud
    tpv-karaoke-studio audio models --adapter gaudio
    tpv-karaoke-studio audio process --adapter gaudio --audio "Original Song.wav" --output "./stems" --approve-cloud

Supply `DANGO_APP_KEY` and `DANGO_APP_SECRET` for Dango, `MVSEP_API_KEY` for MVSEP, or `GAUDIO_API_KEY` for Gaudio through the environment. `--approve-cloud` authorizes uploading the named file and any provider charges for that job. The desktop editor manages its credentials separately.

## Download lyrics with ktools

By default Studio checks `~/Dropbox/Audio/Karaoke/Tools/ktools` and, on macOS, `~/Library/CloudStorage/Dropbox/Audio/Karaoke/Tools/ktools`. Set `TPV_KTOOLS_HOME` or pass `--ktools-home <directory>` for another location. Set `TPV_KTOOLS_PYTHON` or `--python <executable>` if the tool uses a separate Python environment. Source credentials used by ktools are configured through ktools.

Download using explicit song details or the current project's artist, title and duration.

    tpv-karaoke-studio lyrics download --artist "Artist Name" --title "Song Title" --source lrclib --output-dir "./lyrics"
    tpv-karaoke-studio lyrics download --project "./studio.tpv.json" --source lrclib --import --use plain

Supply `--album` or `--duration` to help distinguish versions. ktools chooses the best candidate and returns the generated file paths, its manifest, and any version warnings. Downloads use your selected ktools provider and send song lookup metadata. Review warnings before using provider timestamps. Automatic import prefers verified synchronized lyrics when available and otherwise uses plain text. Choose `--use synced` to use provider timing explicitly. Choose `--use plain` to align the supplied text to your own recording. An import replaces the project's current cues.

## Scripts and settings

Commands return structured JSON. Use `--json` for compact output and JSON errors on stderr. Exit code `0` means success, `2` means a command or option syntax error, and `1` means the operation failed. Exports preserve existing files unless you pass `--force`.

    tpv-karaoke-studio settings show
    tpv-karaoke-studio settings set alignmentLanguage en

`settings show` displays the file used by the CLI. Its default profile is separate from the desktop editor. To use a specific settings file, pass `--settings <file>`. Command-specific options override the stored tool settings for a single run.
