# Local AI lyric synchronization

Studio aligns the lyrics you provide to your audio. The displayed words and line breaks come from your project.

## Setup

Choose **Set Up Lyric Sync** in Studio or start your first **AI Sync**. Studio downloads a compatible Python 3.13 environment and WhisperX with its audio tools. The installation resides in your Studio app data and leaves the system Python and PATH alone.

The first setup needs an internet connection and several minutes for the package downloads. Your first sync in a language also downloads its acoustic model. Studio runs alignment on your computer. The managed environment uses CPU inference on Windows x64, Linux x64, and Apple silicon Mac.

Choose an alignment language in Studio Preferences. The CLI also accepts **--python** if you maintain a compatible external environment. The PyTorch versions needed for managed setup have no official Intel Mac wheels.

## Use

1. Import the song audio and add or import its lyrics.
2. Choose the audio file to align against. A clear lead vocal track generally works best.
3. Select **AI Sync** and review the resulting word cues.
4. Correct timings in the cue sheet or with its manual timing tools before exporting.

If the returned word timings cannot be matched back to your lines, Studio reports the issue and preserves your previous timing. WhisperX models were trained for speech. Review the result against the song, especially for overlapping voices or long sustained notes.

## Implementation

The adapter decodes audio through PyAV, then loads and calls the WhisperX alignment model. Studio maps the resulting timestamps to the supplied words and punctuation.

Studio uses a checksum-verified [uv release](https://github.com/astral-sh/uv/releases/tag/0.13.7) for private Python setup and pins the [WhisperX release](https://github.com/m-bain/whisperX/releases/tag/v3.7.9) used by managed alignment.
