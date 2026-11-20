# Local stem separation

Studio's default adapter runs the open-source audio-separator command, which supports UVR model families including MDX-Net and VR Architecture. Processing stays on the host machine. Configure the executable and model in Studio Preferences; Audio Separator downloads the selected model into its local cache on first use.

Example CPU installation:

    python -m pip install "audio-separator[cpu]"

Set the executable to audio-separator or its full path. A typical model name is UVR-MDX-NET-Inst_HQ_3.onnx; available names depend on the installed version and hardware backend.

## Demucs

Select **Demucs** in Preferences to split vocals, drums, bass and other instruments with the default htdemucs model. Install Demucs in a separate Python environment with PyTorch and TorchAudio. SoundFile provides a WAV writer on Windows.

    python -m pip install demucs soundfile

Set the executable to demucs or the full path to the executable in that environment. Specify another supported Demucs model in the same settings field.

    tpv-studio stems separate "original.wav" --adapter demucs --output-dir "separated" --add

Label the generated voices and mute the original mix before previewing or exporting the separated tracks together. Studio uses local executables, and the chosen model can download weights on its first run. See [Demucs](https://github.com/facebookresearch/demucs), [Audio Separator](https://github.com/nomadkaraoke/python-audio-separator), and [UVR GUI](https://github.com/Anjok07/ultimatevocalremovergui) for their installation and model details.
