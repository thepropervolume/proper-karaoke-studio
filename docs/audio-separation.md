# Stem separation

Open **Audio Stems → Separate a Source Track**. Studio prompts you to save new or edited projects before separation. Each run writes to a new folder inside a sibling folder named after the project, for example `Perfect.tpv.json.stems`. An earlier set of stems remains available after a retry.

You can edit or synchronize lyrics while separation is running. The transport shows the current step and an estimate when the separator reports one. Studio waits for any current playback or timing operation before adding the new stems to the project, then restores the playhead. Save the project again to keep the added stems in its mix.

Studio's default adapter runs the open-source Audio Separator command, which supports UVR model families including MDX-Net and VR Architecture. Processing stays on the host machine. In **Preferences → Audio & Lyrics**, select **Audio Separator (UVR)** and a **Stem Separation Model**. Audio Separator downloads selected weights on first use.

Example CPU installation:

    python -m pip install "audio-separator[cpu]"

Use **Advanced Tool Locations → Stem Separator Path** if Studio needs the full path to the executable. Select **Refresh Models** after changing the path or updating the tool. Studio displays the catalog reported by your separator and uses a recommended list if that version cannot list its models.

Use the [model library](models.md) to download verified upstream weights, open the local models folder, reuse weights from an existing UVR installation, and set up an ensemble or second vocal-splitting pass.

## Demucs

Select **Demucs** in Preferences to split vocals, drums, bass and other instruments with the default htdemucs model. Install Demucs in a separate Python environment with PyTorch and TorchAudio. SoundFile provides a WAV writer on Windows.

    python -m pip install demucs soundfile

Set the separator path to `demucs` or the full path to its executable. Choose another supported model from the dropdown.

    tpv-karaoke-studio stems separate "original.wav" --adapter demucs --output-dir "separated" --add

See [Demucs](https://github.com/facebookresearch/demucs), [Audio Separator](https://github.com/nomadkaraoke/python-audio-separator), and [UVR GUI](https://github.com/Anjok07/ultimatevocalremovergui) for installation and model details.

## Dango AI

Open **Preferences → Integrations → Dango AI** and save your developer **App Key** and **App Secret**. **Verify Credentials** sends a signed test message to check authentication. Choose **Dango AI (Cloud)** and a model in **Audio & Lyrics**, then save Preferences. Studio prompts before each WAV, MP3, or FLAC upload. Separation may use Dango credits. [Dango Open Platform](https://tuanziai.com/doc/) · [Vocal separation](https://tuanziai.com/doc/vocal-remover.html)

## MVSEP and Gaudio

In **Preferences → Integrations**, save an MVSEP user API key or a Gaudio Developers project API key. **Verify Credentials** makes a read-only request. Choose **MVSEP (Cloud)** or **Gaudio (Cloud)** and a model in **Audio & Lyrics**. Studio asks before sending the chosen audio to a provider, which may charge for processing. Both adapters accept WAV, FLAC, MP3 and M4A and download WAV stems to the project's stems folder. Studio never adds an MVSEP separation to the public demo page.

- **MVSEP** offers BS Roformer for vocals and instrumental, Demucs4 for four stems, and MVSEP Karaoke for lead vocals, backing vocals, and instrumental. Studio imports the independent tracks and skips any extra combined mixes. [API reference](https://mvsep.com/en/full_api) · [Account API keys](https://mvsep.com/user-api)
- **Gaudio** offers GSEP Music SHQ for vocals and accompaniment and GSEP Music HQ for vocals. The providers' documented track limits are 10 and 20 minutes respectively. Use an API key that has access to your selected model. [Project key setup](https://www.gaudiolab.com/docs/developers/guide/api_references/authentication) · [SHQ music model](https://www.gaudiolab.com/docs/developers/guide/api_references/stem-separation/gsep_music_shq_v1/job)

The **Integrations** panel also accepts custom entries for storing other service credentials. Studio encrypts credentials with the operating system's key storage and uses an unlocked keyring on Linux. Custom entries require a dedicated Studio adapter before they can make API calls.

Label the generated voices and mute the original mix before previewing or exporting the separated tracks together.
