# The Proper Volume Karaoke Studio

The Proper Volume Karaoke Studio is a desktop authoring app for turning audio stems and timed lyrics into karaoke videos and reusable TPV kits.

## Studio 0.9.0

Studio imports and mixes local stems, previews and styles lyrics, synchronizes supplied lyrics to audio, and exports MP4 videos, lyric files, and TPV kits. The desktop editor and CLI share editable project files. The `tpv-karaoke-studio` CLI can also format lyrics, separate stems, and align lyrics without an existing project.

Get the latest published preview from [Studio downloads](https://release.thepropervolume.com/studio/).

Open a project or TPV kit, place lyric cues on a waveform, separate stems with UVR, Demucs, or Dango AI, and record labeled vocal takes. Studio previews imported CD+G graphics and can author new CD+G graphics from timed lyrics.

The [Studio workspace](docs/workspace.md) follows Booth’s visual style, with a dedicated preview, a resizable editor, and an always visible playback bar.

## Run from source

Requires Node.js 24 or newer. FFmpeg is needed for CLI audio probing and MP4 export. Studio installs its own compatible environment for AI Sync. Local stem separation uses your Audio Separator or Demucs installation.

    npm install
    npm run build
    npm run dev
    npm run cli -- --help

See the [CLI guide](docs/cli.md), [product specification](docs/product-specification.md), and [lyric synchronization setup](docs/lyric-synchronization.md).

## License

The Proper Volume’s original Studio software is licensed under [MPL 2.0](LICENSE). See [licensing scope](LICENSING.md) and the separate [branding terms](TRADEMARKS.md).
