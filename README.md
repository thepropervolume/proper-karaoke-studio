# The Proper Volume Karaoke Studio

The Proper Volume Karaoke Studio is a desktop authoring app for turning audio stems and timed lyrics into karaoke videos and reusable TPV kits.

## Prototype 0.3.0

The Studio prototype imports and mixes local stems, previews lyrics, synchronizes user-provided lyrics to audio with local AI forced alignment, supports manual line or word timing, and exports lyrics, MP4 video, or a reusable `.tpvkit`. It runs in one editor mode; there is no separate basic/advanced workflow.

CD+G files can be preserved inside a kit, but their graphics are not yet decoded or exported. Projects cannot yet be reopened from a kit, and installers are still in progress.

## Run from source

Requires Node.js 24 or newer. FFmpeg is needed for MP4 export; Audio Separator is needed for AI stem separation; WhisperX is needed for AI lyric synchronization. Audio, lyrics, and model inference stay on the host computer.

    npm install
    npm run dev

See docs/product-specification.md, docs/initial-prototype.md, docs/audio-separation.md, and docs/shared-core-plan.md.
