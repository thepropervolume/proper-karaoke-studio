# The Proper Volume Karaoke Studio

The Proper Volume Karaoke Studio is a desktop authoring app for turning audio stems and timed lyrics into karaoke videos and reusable TPV kits.

## Prototype 0.4.0

Studio imports and mixes local stems, previews lyrics, synchronizes supplied lyrics to audio, and exports MP4 videos, lyric files, and TPV kits. The desktop editor and CLI share editable project files. The CLI can download lyrics through the TPV karaoke tools in your Dropbox folder.

Use a `.tpv.json` file to reopen a project. Exported kits can carry an original CD+G file for playback elsewhere.

## Run from source

Requires Node.js 24 or newer. FFmpeg is needed for audio probing and MP4 export. Audio Separator and WhisperX enable local stem separation and lyric synchronization.

    npm install
    npm run build
    npm run dev
    npm run cli -- --help

See the [CLI guide](docs/cli.md), [product specification](docs/product-specification.md), and [lyric synchronization setup](docs/lyric-synchronization.md).
