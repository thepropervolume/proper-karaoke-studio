# CD+G graphics

Studio reads local CD+G graphics and previews their original colors. Choose **Import Lyrics** and select a `.cdg` file. Add its matching song file under **Import Stems** to play them together. You can scrub through the graphics before adding audio.

When a project contains editable lyric cues, the preview and MP4 export use the cues. To use the CD+G graphics while keeping your editable cues, open a separate project. CD+G import attaches a graphics layer. Import a TXT, Enhanced LRC, SRT, or Studio JSON file to edit lyric text and timing.

## Export

- **Export CD+G** renders your timed text as white and magenta karaoke graphics on black. FFmpeg with libass draws the lyrics. Studio packages the resulting tiles into a `.cdg` for software MP3+G players. Give the matching audio file the same basename for paired playback.
- **Export Original CD+G** copies the attached graphics exactly. TPV kits also retain this source.
- **Render Karaoke Video** creates a 1920×1080 H.264/AAC MP4 with the CD+G graphics and audio mix. In a CD+G project, the export preserves the source’s solid background and pads the graphics to fit the canvas. This path needs FFmpeg with the CD Graphics decoder, H.264, and AAC.

On Windows, an older Studio release can report a locked `.tpv-export-*` folder after saving the `.cdg`. Check the chosen destination for the finished file. Starting with Studio 0.11.2, a temporary-folder cleanup failure leaves the saved export available and reports success.

CD+G carries 300 graphics packets per second. Complex page changes can take several frames to draw. The one-hour graphics exports target software players. Physical CD mastering requires error correction data beyond this export. See [the CD+G format overview](https://jbum.com/cdg_revealed.html) and [FFmpeg’s CD Graphics decoder](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/cdgraphics.c).
