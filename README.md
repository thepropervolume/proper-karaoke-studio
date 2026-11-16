# The Proper Volume Karaoke Studio

The Proper Volume Karaoke Studio is a desktop authoring app for turning audio stems and timed lyrics into karaoke videos and reusable TPV kits.

## Prototype 0.1.0

The first prototype imports and individually mixes local audio stems, previews them with the Karaoke Booth renderer, records lyric line timing, imports/exports TPV JSON, Enhanced LRC, and SRT, renders MP4 through FFmpeg, and packages a .tpvkit.

CD+G files can be preserved inside a kit, but their graphics are not yet decoded or exported. Word-by-word manual timing and distributable installers are still in progress.

## Run from source

Requires Node.js 24 or newer. FFmpeg is needed for MP4 export; a local Audio Separator install is needed for AI stem separation.

    npm install
    npm run dev

See docs/product-specification.md, docs/initial-prototype.md, docs/audio-separation.md, and docs/shared-core-plan.md.
