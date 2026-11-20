# The Proper Volume Karaoke Studio

The Proper Volume Karaoke Studio is a desktop authoring app for turning audio stems and timed lyrics into karaoke videos and reusable TPV kits.

## Studio 0.6.0

Studio imports and mixes local stems, previews lyrics, synchronizes supplied lyrics to audio, and exports MP4 videos, lyric files, and TPV kits. The desktop editor and CLI share editable project files. The CLI can download lyrics through the TPV karaoke tools in your Dropbox folder.

Get the latest published preview from [Studio downloads](https://release.thepropervolume.com/studio/).

Open a project or TPV kit, place lyric cues on a waveform, separate stems with UVR or Demucs, and record labeled vocal takes. Studio previews imported CD+G graphics and can author new CD+G graphics from timed lyrics.

## Run from source

Requires Node.js 24 or newer. FFmpeg is needed for audio probing and MP4 export. Audio Separator and WhisperX enable local stem separation and lyric synchronization.

    npm install
    npm run build
    npm run dev
    npm run cli -- --help

See the [CLI guide](docs/cli.md), [product specification](docs/product-specification.md), and [lyric synchronization setup](docs/lyric-synchronization.md).
