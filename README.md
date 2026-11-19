# The Proper Volume Karaoke Studio

The Proper Volume Karaoke Studio is a desktop authoring app for turning audio stems and timed lyrics into karaoke videos and reusable TPV kits.

## Prototype 0.2.0

The Studio prototype imports and mixes local stems, previews synchronized lyrics, captures line or word timing by tapping along, and exports lyrics, MP4 video, or a reusable `.tpvkit`. It runs in one editor mode; there is no separate basic/advanced workflow.

CD+G files can be preserved inside a kit, but their graphics are not yet decoded or exported. Projects cannot yet be reopened from a kit, and installers are still in progress.

## Run from source

Requires Node.js 24 or newer. FFmpeg is needed for MP4 export; a local Audio Separator install is needed for AI stem separation.

    npm install
    npm run dev

See docs/product-specification.md, docs/initial-prototype.md, docs/audio-separation.md, and docs/shared-core-plan.md.
