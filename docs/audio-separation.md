# Stem separation

Studio's default adapter runs the open-source Audio Separator command, which supports UVR model families including MDX-Net and VR Architecture. Processing stays on the host machine. In **Preferences → Audio & Lyrics**, select **Audio Separator (UVR)** and a **Stem Separation Model**. Audio Separator downloads selected weights on first use.

Example CPU installation:

    python -m pip install "audio-separator[cpu]"

Use **Advanced Tool Locations → Stem Separator Path** if Studio needs the full path to the executable. Select **Refresh Models** after changing the path or updating the tool. Studio displays the catalog reported by your separator and uses a recommended list if that version cannot list its models.

## Demucs

Select **Demucs** in Preferences to split vocals, drums, bass and other instruments with the default htdemucs model. Install Demucs in a separate Python environment with PyTorch and TorchAudio. SoundFile provides a WAV writer on Windows.

    python -m pip install demucs soundfile

Set the separator path to `demucs` or the full path to its executable. Choose another supported model from the dropdown.

    tpv-studio stems separate "original.wav" --adapter demucs --output-dir "separated" --add

See [Demucs](https://github.com/facebookresearch/demucs), [Audio Separator](https://github.com/nomadkaraoke/python-audio-separator), and [UVR GUI](https://github.com/Anjok07/ultimatevocalremovergui) for installation and model details.

## Dango AI

Open **Preferences → Integrations → Dango AI** and save your developer **App Key** and **App Secret**. **Verify Credentials** sends a signed test message to check authentication. Choose **Dango AI (Cloud)** and a model in **Audio & Lyrics**, then save Preferences. Studio asks where to save stems and prompts before each WAV, MP3, or FLAC upload. Separation may use Dango credits. [Dango Open Platform](https://tuanziai.com/doc/) · [Vocal separation](https://tuanziai.com/doc/vocal-remover.html)

The **Integrations** panel also accepts custom entries for storing other service credentials. Studio encrypts credentials with the operating system's key storage and uses an unlocked keyring on Linux. Custom entries require a dedicated Studio adapter before they can make API calls.

Label the generated voices and mute the original mix before previewing or exporting the separated tracks together.
