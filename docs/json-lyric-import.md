# Import timed lyric JSON into Studio

Studio's CLI can read a timed lyric JSON file from another application when you identify the cue and timing fields in a mapping file.

    tpv-studio lyrics import external-lyrics.json --mapping lyric-fields.json

For example, suppose the source file looks like this.

    {
      "song": { "name": "Example Song" },
      "segments": [
        {
          "caption": "Start singing",
          "startMs": 2100,
          "endMs": 4500,
          "tokens": [
            { "word": "Start", "offsetMs": 0, "lengthMs": 450 },
            { "word": "singing", "offsetMs": 700, "lengthMs": 900 }
          ]
        }
      ]
    }

Use this `lyric-fields.json` file to import it.

    {
      "cues": "/segments",
      "title": "/song/name",
      "timeUnit": "milliseconds",
      "line": {
        "text": "/caption",
        "start": "/startMs",
        "end": "/endMs",
        "words": "/tokens"
      },
      "word": {
        "text": "/word",
        "start": "/offsetMs",
        "duration": "/lengthMs",
        "relativeTo": "line"
      }
    }

The mapping uses JSON Pointers. For example, `/song/name` reads the name inside the song object and `/time/0` reads the first item in the time array. Use the empty string for a top-level cue array. Write `~1` for a literal slash in a field name or `~0` for a tilde.

- `cues`, `title`, and `artist` read from the source document. Title and artist are optional.
- The pointers inside `line` read from each cue. Supply `text`, `start`, and one of `end` or `duration`. Timestamps must be nonnegative JSON numbers. Set `timeUnit` to `seconds` or `milliseconds`.
- For word highlighting, set both `line.words` and `word`. Word fields follow the same rules as line fields. Word timings use the song timeline by default. Set `word.relativeTo` to `line` for offsets measured from the cue start. Word text must cover the line text, and its times must fit inside the cue.

A successful import replaces the project's current cues. Save a project copy first to keep both versions. Files already using the Studio lyrics JSON schema can be imported without a mapping.
