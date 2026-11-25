# AI lyric synchronization

Studio aligns the lyrics you provide to your audio. Choose an **AI Sync Engine** under **Preferences → Audio & Lyrics → Lyric Synchronization** and save it for the session or as the default.

## Local engines

- **WhisperX** is the default. It downloads the acoustic model for the selected language on first use. If its optional sentence tokenizer is missing or inaccessible, Studio uses the supplied transcript as a single span for alignment and retains your lyric lines. Shared NLTK data directories require no permission changes.
- **Qwen3 ForcedAligner** is an alternative with downloadable weights and support for 11 languages. It accepts recordings up to five minutes. Choose **Install Qwen** or start **AI Sync** to set up its private environment. The first sync downloads the public model, which is approximately 1.8 GB and requires no Hugging Face token. Studio restricts timing predictions to the recording. If too many word durations collapse to near zero, try an isolated lead vocal or choose another engine.

Local engines process your files on your computer. Studio installs managed CPU environments on Windows x64, Linux x64, and Apple silicon. The CLI supports `--python` for a compatible external environment. The local runtimes and model downloads live in app data, separate from your system Python.

## Cloud engines

1. **Vultr Aligner 1.** Open **Compute → Serverless Inference** in the [Vultr console](https://console.vultr.com/inference/). Create an inference subscription if you need one. Open the subscription, go to **Overview**, and copy its **API Key**. See [Vultr’s key instructions](https://docs.vultr.com/products/compute/serverless-inference/management/connection).
2. **AudioShake.** Open **Settings → API Keys** in the [AudioShake dashboard](https://dashboard.audioshake.ai/) and create a key. AudioShake detects the language automatically. See the [AudioShake quickstart](https://developer.audioshake.ai/quickstart).
3. In Studio, open **Preferences → Integrations**. Use **Add Credentials**, then **Verify Credentials**, on the service’s row. Verification checks the key without uploading a song or submitting an alignment.

Studio asks before sending the selected audio and supplied lyrics. Alignment can incur a charge. If a WAV file exceeds Vultr’s upload limit, or the source is neither WAV nor MP3, Studio uses FFmpeg to prepare a temporary MP3. Your source file stays intact.

## Sync a song

1. Import the song audio and supply the lyric text. For local engines, a clean lead vocal is a good starting point.
2. Choose the **Audio for Sync** and select **AI Sync**.
3. Review the resulting cues. Studio reports the line numbers that Vultr marks uncertain.

Studio preserves your words, line breaks, and slash-delimited timing cues. When the provider cannot return a complete set of timings that matches your lyrics, Studio keeps the previous timings. See the [CLI guide](cli.md) for scripting.

The managed runtime uses a checksum-verified [uv release](https://github.com/astral-sh/uv/releases/tag/0.13.7) and pinned [WhisperX](https://github.com/m-bain/whisperX/releases/tag/v3.7.9) and [Qwen](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf) versions.
