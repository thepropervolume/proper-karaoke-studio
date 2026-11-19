"""Locally force-align supplied lyrics to audio. This script never transcribes audio."""

import argparse
import json
import re
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--language", required=True)
    args = parser.parse_args()

    if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?", args.language):
        raise ValueError("Use a language code such as en, es, or fr.")
    if sys.version_info < (3, 10) or sys.version_info >= (3, 14):
        raise RuntimeError(f"WhisperX requires Python 3.10–3.13; the configured interpreter is {sys.version.split()[0]}. Set its full path in Studio Preferences.")
    request = json.loads(Path(args.input).read_text(encoding="utf-8"))
    lyrics = request.get("lyrics")
    if not isinstance(lyrics, list) or not lyrics or not all(isinstance(line, str) and line.strip() for line in lyrics):
        raise ValueError("Provide at least one non-empty lyric line.")

    try:
        import torch
        import whisperx
    except ImportError as exc:
        raise RuntimeError("WhisperX is not installed. Install it locally with: python -m pip install whisperx") from exc

    device = "cuda" if torch.cuda.is_available() else "cpu"
    audio = whisperx.load_audio(args.audio)
    duration = len(audio) / 16000
    if duration <= 0:
        raise ValueError("The selected audio contains no readable samples.")

    # Load only WhisperX's alignment model. Never invoke its ASR/transcription path.
    model, metadata = whisperx.load_align_model(language_code=args.language, device=device)
    transcript = [{"start": 0.0, "end": duration, "text": " ".join(lyrics)}]
    result = whisperx.align(transcript, model, metadata, audio, device, return_char_alignments=False)
    aligned_words = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []):
            start, end = word.get("start"), word.get("end")
            if start is None or end is None:
                continue
            aligned_words.append({"word": str(word.get("word", "")), "start": float(start), "end": float(end)})

    if not aligned_words:
        raise RuntimeError("No lyric words could be aligned. Try a clearer vocal source and verify the supplied lyrics.")
    Path(args.output).write_text(json.dumps({"duration": duration, "words": aligned_words}, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Lyric alignment failed: {error}", file=sys.stderr)
        raise SystemExit(1)
