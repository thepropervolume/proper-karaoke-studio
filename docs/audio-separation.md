# Local stem separation

Studio's default adapter runs the open-source audio-separator command, which supports UVR model families including MDX-Net and VR Architecture. Processing stays on the host machine. Configure the executable and model in Studio Preferences; Audio Separator downloads the selected model into its local cache on first use.

Example CPU installation:

    python -m pip install "audio-separator[cpu]"

Set the executable to audio-separator or its full path. A typical model name is UVR-MDX-NET-Inst_HQ_3.onnx; available names depend on the installed version and hardware backend.

Studio does not bundle Python, inference runtimes, or model files. Audio Separator is MIT-licensed, but review individual model licenses and attribution before redistribution. See the [Audio Separator project](https://github.com/nomadkaraoke/python-audio-separator) and [UVR GUI project](https://github.com/Anjok07/ultimatevocalremovergui).
