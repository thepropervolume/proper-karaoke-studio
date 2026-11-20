# Karaoke Studio CLI

The Studio CLI can create and edit projects, download lyrics, align supplied lyrics to audio, separate stems, and export deliverables. Use Node.js 24 or newer.

From the source checkout, run `npm run build` once and then use `npm run cli --` or `node dist-electron/cli.cjs`. Run `npm link` after building to make `tpv-studio` available through npm's bin directory. Desktop packages include a standalone `studio-cli.cjs` in the application resources directory. Run it with `node` and the same arguments. Use `--help` to list the commands. Add it to any command to view its arguments.

## Projects

Each command uses `studio.tpv.json` in the current directory unless you supply `--project <file>`. The file contains track metadata, cue and word timings, media paths, per-stem gain and roles, and the optional backdrop. Select **Open Project** in Studio to edit it visually. You can also run `tpv-studio project open --project <file>` to launch the editor. If Studio is installed separately, pass `--app <desktop-executable>`.

The project references the original media files. Use a TPV kit to package the stems and lyrics. Desktop saves and CLI edits check whether someone else changed the project since it was read. If a save reports a newer revision, reopen the project or use **Save As** to keep a separate copy.

    tpv-studio project init --title "Song Title" --artist "Artist Name"
    tpv-studio stems add "Original Song.mp3" --role lead
    tpv-studio project backdrop "Cover.png"
    tpv-studio lyrics import "Lyrics.txt"
    tpv-studio lyrics align
    tpv-studio lyrics line 1 --start 00:05.250 --end 9
    tpv-studio lyrics word 1 2 --start 6.1 --end 6.6
    tpv-studio export lyrics lrc --output "Song.enhanced.lrc"
    tpv-studio export video --output "Song.mp4"
    tpv-studio export kit --output "Song.tpvkit"

Stem and line selectors accept IDs or one-based indexes. Word selectors use one-based indexes within a line. Numeric times are in seconds and manual cue inputs also accept `mm:ss.mmm`. FFmpeg measures imported audio unless you give `--duration`. Stem separation can optionally add its results to the project with `--add`. See the [lyric alignment guide](lyric-synchronization.md) and [stem separation guide](audio-separation.md) for their local runtime requirements.

## Download lyrics with ktools

By default Studio checks `~/Dropbox/Audio/Karaoke/Tools/ktools` and, on macOS, `~/Library/CloudStorage/Dropbox/Audio/Karaoke/Tools/ktools`. Set `TPV_KTOOLS_HOME` or pass `--ktools-home <directory>` for another location. Set `TPV_KTOOLS_PYTHON` or `--python <executable>` if the tool uses a separate Python environment. Source credentials used by ktools are configured through ktools.

Download using explicit song details or the current project's artist, title and duration.

    tpv-studio lyrics download --artist "Artist Name" --title "Song Title" --source lrclib --output-dir "./lyrics"
    tpv-studio lyrics download --project "./studio.tpv.json" --source lrclib --import --use plain

Supply `--album` or `--duration` to help distinguish versions. ktools chooses the best candidate and returns the generated file paths, its manifest, and any version warnings. Downloads use your selected ktools provider and send song lookup metadata. Review warnings before using provider timestamps. Automatic import prefers verified synchronized lyrics when available and otherwise uses plain text. Choose `--use synced` to use provider timing explicitly. Choose `--use plain` to align the supplied text to your own recording. An import replaces the project's current cues.

## Scripts and settings

Commands return structured JSON. Use `--json` for compact output and JSON errors on stderr. Exit code `0` means success, `2` means a command or option syntax error, and `1` means the operation failed. Exports preserve existing files unless you pass `--force`.

    tpv-studio settings show
    tpv-studio settings set lyricAlignerExecutable "C:\Tools\StudioPython\Scripts\python.exe"
    tpv-studio settings set alignmentLanguage en

`settings show` displays the file used by the CLI. Its default profile is separate from the desktop editor. To use a specific settings file, pass `--settings <file>`. Command-specific options override the stored tool settings for a single run.
