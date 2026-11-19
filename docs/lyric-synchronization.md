# Local AI lyric synchronization

Studio aligns lyrics that the user has already imported or typed. It does not search for lyrics, transcribe the song, or replace the supplied text.

## Setup

Install Python 3.10–3.13 and WhisperX in the environment Studio will use. Current WhisperX releases require Python 3.10 through 3.13:

```bash
python -m pip install whisperx
```

Set the Python executable (the full path if needed) and lyric language code in Studio Preferences. CUDA is used when available; CPU is the fallback. On the first alignment for a language, WhisperX downloads its acoustic alignment model. The models are language-specific.

## Use

1. Import the song audio and add or import its lyrics.
2. Choose the audio file to align against. A clear lead-vocal track generally works best; full mixes may need more manual correction.
3. Select **Sync supplied lyrics with AI** and review the resulting word cues.
4. Correct any timing by editing the cue sheet or using manual timing tools, then export.

If a word cannot be aligned or the returned text does not match the supplied words, Studio reports an error and keeps existing timings. Audio and lyrics remain local. WhisperX alignment models are speech-oriented, so sung vocal timing must be reviewed before publication.

## Implementation boundary

The Python adapter calls `load_audio`, `load_align_model`, and `align` only. It deliberately does not invoke WhisperX's `transcribe` function. The UI sends the user's existing lyric lines, while the renderer maps returned timestamps back onto the original tokens and preserves punctuation, whitespace, and line breaks.

See the [WhisperX installation and usage guide](https://github.com/m-bain/whisperX) for platform-specific dependency notes and supported alignment languages.
