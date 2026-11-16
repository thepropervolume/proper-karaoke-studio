# Shared karaoke code

## Recommendation

Create a separate private repository named thepropervolume/proper-karaoke-core before the second app grows beyond its prototype. Publish tagged, versioned releases and have the Booth and Studio pin the same core package version. Avoid a live filesystem link between the two repositories and avoid a Git submodule for runtime code.

## Move into core

- Provider-neutral stem roles, mixer, playback clock, and timeline contracts.
- Lyric cue and word timing types, format adapters, and validation.
- Canvas lyric renderer and reusable preview primitives.
- Audio decoding/output utilities that are not tied to one app's permissions or IPC.

## Keep in each app

- KaraFun, Karaoke Nerds, YouTube, and other provider/session code.
- Electron main/preload bridges, local file pickers, local database, and settings UI.
- Studio authoring/editing, model selection, FFmpeg export, TPV kit workflow.
- Booth singer rotation, show management, remote queue, and display-window lifecycle.

## Current transition

Studio copied the renderer modules from Booth commit d783e04b52da3b71ded080be206663b310e12b30 into src/shared/from-booth/. The exact source revision is recorded alongside them. Changes needed for Studio's larger local audio are kept as a small documented delta. Once the core repository exists, move the cleaned provider-neutral API there and update both apps through normal versioned dependency updates.
