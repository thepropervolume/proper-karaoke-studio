# Studio models

Open **Preferences → Download Models** to see the model library and open the Studio models folder. Studio checks the usual Ultimate Vocal Remover installation locations. Select a detected folder or choose the installation or models directory yourself. Studio verifies and copies supported files into its own cache when they are needed. The UVR folder stays read-only.

Use **Download Models** to choose a family and download a public model. Studio downloads directly from the project maintainers and verifies SHA-256 before saving a file. The recommended library includes MDX-Net, VR Architecture, MDX23C and Demucs. [Audio Separator model releases](https://github.com/nomadkaraoke/python-audio-separator/releases/tag/model-configs) · [Model checksums](https://github.com/nomadkaraoke/python-audio-separator/blob/main/audio_separator/model-checksums.json) · [UVR model releases](https://github.com/TRvlvr/model_repo/releases/tag/all_public_uvr_models)

## Combine models and separate backing vocals

1. Select **Audio Separator (UVR)**, then choose a first-pass model that separates full vocals from the instrumental mix.
2. Add up to three models to average their output with the primary model. Use models that produce vocals and instrumentals.
3. Select a **Backing Vocal Model** to run a second model on the separated vocals. Studio creates separate instrumental, lead-vocal and backing-vocal WAV files.

Studio uses the installed Audio Separator executable for processing. The download library can download files before you install the processing tool. Ensembles need a version that supports `--extra_models`. [Audio Separator usage](https://github.com/nomadkaraoke/python-audio-separator)
