# Shared karaoke code

## Current integration

Studio uses the lyric cue and word timing types plus LRC and SRT format adapters from [Proper Karaoke Core 0.1.0](https://github.com/thepropervolume/proper-karaoke-core/releases/tag/v0.1.0). The versioned npm tarball and its SHA-256 checksum are pinned in the Studio vendor directory. A clean npm install uses the package from this checkout without registry credentials.

Enhanced LRC imports preserve closing timestamps, and outputs include the closing marker for the last word. Studio still owns its project JSON, ASS formatting for MP4 and CD+G, waveform edits, and TPV kits.

To update Core, download the tarball and SHA256SUMS.txt from its private release. Verify the checksum, replace the previous version in vendor, and install the new tarball with npm install --save-exact. Commit the tarball, checksum, manifest, and lockfile together. Run npm ci, npm run build, and npm test from the Studio checkout.

## Move into core

- Provider-neutral stem roles, mixer, playback clock, and timeline contracts.
- Remaining timing validation shared by the two apps.
- Canvas lyric renderer and reusable preview primitives.
- Audio decoding/output utilities that are not tied to one app's permissions or IPC.

## Keep in each app

- KaraFun, Karaoke Nerds, YouTube, and other provider/session code.
- Electron main/preload bridges, local file pickers, local database, and settings UI.
- Studio authoring/editing, model selection, FFmpeg export, TPV kit workflow.
- Booth singer rotation, show management, remote queue, and display-window lifecycle.

## Next migration

Studio still uses playback and renderer modules copied from Booth commit d783e04b52da3b71ded080be206663b310e12b30. Changes needed for Studio's larger local audio and waveform are kept with Studio. Before extracting the common renderer, migrate Booth's compatible lyric format entry points to the same Core package and run its playback and import tests.
