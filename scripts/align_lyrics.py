"""Locally force-align supplied lyrics to audio. This script never transcribes audio."""

import argparse
from bisect import bisect_left, bisect_right
from itertools import accumulate
import json
import math
import os
import re
import sys
import unicodedata
from pathlib import Path


SAMPLE_RATE = 16000
QWEN_MAX_SECONDS = 300
QWEN_MODEL = "Qwen/Qwen3-ForcedAligner-0.6B-hf"
QWEN_REVISION = "c07281df297b9905d24a508279258cccf987a064"
QWEN_LANGUAGES = frozenset(("zh", "en", "yue", "fr", "de", "it", "ja", "ko", "pt", "ru", "es"))


def decode_audio(source, maximum_seconds=3600):
    """Return mono, 16 kHz PCM using the FFmpeg libraries bundled with PyAV."""
    try:
        import av
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("The local audio decoder could not load. Use Studio’s managed lyric setup or install PyAV and NumPy in the external environment.") from exc

    resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
    pcm = bytearray()
    maximum_bytes = SAMPLE_RATE * 4 * maximum_seconds
    too_long = ("Qwen3 supports up to five minutes of audio. Choose another alignment engine or a shorter source."
                if maximum_seconds == QWEN_MAX_SECONDS else "Choose an audio track one hour or shorter.")
    with av.open(source, mode="r") as container:
        if not container.streams.audio:
            raise ValueError("The selected file contains no readable audio stream.")
        for frame in container.decode(audio=0):
            for block in resampler.resample(frame):
                pcm.extend(block.to_ndarray().tobytes())
            if len(pcm) > maximum_bytes:
                raise ValueError(too_long)
        for block in resampler.resample(None):
            pcm.extend(block.to_ndarray().tobytes())
    if len(pcm) > maximum_bytes:
        raise ValueError(too_long)
    return np.frombuffer(pcm, dtype=np.float32)


def align_whisperx(audio, lyrics, language, duration):
    try:
        import torch
        import whisperx
    except ImportError as exc:
        raise RuntimeError("WhisperX could not load in this environment. Try again with Studio’s managed lyric setup.") from exc

    device = "cuda" if torch.cuda.is_available() else "cpu"
    # Load only WhisperX's alignment model. Never invoke its ASR/transcription path.
    model, metadata = whisperx.load_align_model(language_code=language, device=device)
    transcript = [{"start": 0.0, "end": duration, "text": " ".join(lyrics)}]
    result = whisperx.align(transcript, model, metadata, audio, device, return_char_alignments=False)
    aligned_words = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []):
            start, end = word.get("start"), word.get("end")
            if start is None or end is None:
                continue
            aligned_words.append({"word": str(word.get("word", "")), "start": float(start), "end": float(end)})

    return aligned_words


def alignment_key(word):
    return "".join(char for char in unicodedata.normalize("NFKC", word).casefold() if char.isalnum())


def restore_qwen_words(reference, decoded, duration):
    """Map model tokens back to the exact words Studio supplied, retaining punctuation."""
    spans = []
    for item in decoded:
        key = alignment_key(item["text"])
        if not key:
            continue
        start, end = item["start_time"], item["end_time"]
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start <= end <= duration + 0.08):
            raise ValueError("Qwen3 returned invalid timestamps. Try a clearer vocal stem or choose another alignment engine.")
        spans.append((key, min(start, duration), min(end, duration)))

    keys = [alignment_key(word) for word in reference]
    if not spans or "".join(keys) != "".join(key for key, _, _ in spans):
        raise ValueError("Qwen3 could not match all of the supplied words. Check the lyrics and language or choose another alignment engine.")

    # Qwen can split CJK characters or use a different word tokenizer. Preserve its
    # endpoints at token boundaries and interpolate only when a boundary falls inside a token.
    boundaries = [0, *accumulate(len(key) for key, _, _ in spans)]

    def time_at(index, position):
        key, start, end = spans[index]
        return start + (end - start) * (position - boundaries[index]) / len(key)

    aligned = []
    offset = 0
    collapsed = 0
    for word, key in zip(reference, keys):
        if key:
            start = time_at(bisect_right(boundaries, offset) - 1, offset)
            offset += len(key)
            end = time_at(bisect_left(boundaries, offset) - 1, offset)
            if end - start < 0.01:
                collapsed += 1
        else:
            # Punctuation-only tokens have no acoustic event. Attach them to an adjacent word.
            end = aligned[-1]["end"] if aligned else spans[0][1]
            start = max(aligned[-1]["start"], end - 0.001) if aligned else end
        if end <= start:
            start = min(start, max(0, duration - 0.001))
            end = min(duration, start + 0.001)
        aligned.append({"word": word, "start": start, "end": end})
    # Qwen's 80 ms clock can collapse an occasional short word. Frequent
    # collapses indicate a bad alignment that should not replace existing timings.
    lexical_words = sum(bool(key) for key in keys)
    if collapsed >= 3 and collapsed > lexical_words / 10:
        raise ValueError(f"Qwen3 returned collapsed timings for {collapsed} of {lexical_words} words. Try an isolated lead vocal or choose another alignment engine.")
    return aligned


def qwen_model_cache():
    environment = Path(sys.prefix)
    if environment.name == "venv" and environment.parent.name == "alignment-qwen-cpu-v1":
        return environment.parent / "model-cache"
    home = Path.home()
    if sys.platform == "win32":
        data = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
    elif sys.platform == "darwin":
        data = home / "Library" / "Application Support"
    else:
        data = Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share"))
    return data / "tpv-karaoke-studio" / "alignment-qwen-cpu-v1" / "model-cache"


def align_qwen(audio, lyrics, language, duration):
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    try:
        import torch
        from transformers import AutoModelForTokenClassification, AutoProcessor
    except ImportError as exc:
        raise RuntimeError("Qwen3 could not load. Set up the Qwen3 engine in Studio’s lyric sync preferences.") from exc

    options = dict(revision=QWEN_REVISION, cache_dir=qwen_model_cache(), token=False, trust_remote_code=False)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16) if device == "cuda" else torch.float32
    try:
        processor = AutoProcessor.from_pretrained(QWEN_MODEL, **options)
        model = AutoModelForTokenClassification.from_pretrained(QWEN_MODEL, dtype=dtype, use_safetensors=True, **options).to(device)
    except OSError as exc:
        raise RuntimeError("Qwen3 could not load its local model. Connect to the internet for the first model download and retry.") from exc

    text = unicodedata.normalize("NFC", " ".join(lyrics)).replace("’", "'")
    inputs, words = processor.prepare_forced_aligner_inputs(audio=audio, transcript=text, language=language)
    inputs = inputs.to(model.device, model.dtype)
    with torch.inference_mode():
        outputs = model(**inputs)
    decoded = processor.decode_forced_alignment(
        logits=outputs.logits, input_ids=inputs["input_ids"], word_lists=words,
        timestamp_token_id=model.config.timestamp_token_id,
    )[0]
    return restore_qwen_words(" ".join(lyrics).split(), decoded, duration)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--engine", choices=("whisperx", "qwen"), default="whisperx")
    args = parser.parse_args()

    if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?", args.language):
        raise ValueError("Use a language code such as en, es, or fr.")
    qwen = args.engine == "qwen"
    language = args.language.split("-")[0] if qwen else args.language
    if qwen and language not in QWEN_LANGUAGES:
        raise ValueError("Qwen3 does not support that language. Choose another alignment engine or select a supported language.")
    if sys.version_info < (3, 11 if qwen else 10) or sys.version_info >= (3, 14):
        requirement = "Qwen3 requires Python 3.11–3.13" if qwen else "WhisperX requires Python 3.10–3.13"
        raise RuntimeError(f"This external Python is {sys.version.split()[0]}. {requirement}. Use Studio’s managed lyric setup or a compatible external environment.")
    request = json.loads(Path(args.input).read_text(encoding="utf-8"))
    lyrics = request.get("lyrics")
    if not isinstance(lyrics, list) or not lyrics or not all(isinstance(line, str) and line.strip() for line in lyrics):
        raise ValueError("Provide at least one non-empty lyric line.")

    # PyAV ships its own decoder, so alignment can read a song without a system FFmpeg command.
    audio = decode_audio(args.audio, QWEN_MAX_SECONDS if qwen else 3600)
    duration = len(audio) / SAMPLE_RATE
    if duration <= 0:
        raise ValueError("The selected audio contains no readable samples.")
    align = align_qwen if qwen else align_whisperx
    aligned_words = align(audio, lyrics, language, duration)
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
