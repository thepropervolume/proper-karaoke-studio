# Studio installers

Studio preview installers are served from [the Studio download page](https://release.thepropervolume.com/studio). Each version has its own directory. The release server calculates SHA-256 checksums when publishing. Compare the checksum file in that version directory with the file you downloaded.

## Build locally

Use Node.js 24 and the native operating system for each package. Run `npm ci` and `npm test` in the Studio checkout. These commands build the corresponding x64 or arm64 packages and put them in `release/`.

| Platform | Build command | Packages |
| --- | --- | --- |
| Windows x64 | `npm run package:win -- --x64 --publish never` | NSIS setup EXE and portable ZIP |
| Linux x64 | `npm run package:linux -- --x64 --publish never` | AppImage and Debian package |
| macOS Apple Silicon | `npm run package:mac -- --arm64 --publish never` | DMG and ZIP |
| macOS Intel | `npm run package:mac -- --x64 --publish never` | DMG and ZIP |

The CI builds use no publisher signing credentials. Windows shows the preview installer as unsigned. macOS preview builds are not notarized. Python, WhisperX, FFmpeg and Audio Separator are installed separately when needed. See the [CLI guide](cli.md), [alignment setup](lyric-synchronization.md), and [audio separation guide](audio-separation.md).

## Publish

Run **Build Studio installers** from the default branch in GitHub Actions. Select **Publish all four platform builds to release.thepropervolume.com** to deploy. A `v<version>` tag also triggers publication and must match the version in `package.json`. Select **Keep a private copy in GitHub Actions** on a manual run when a temporary artifact download is needed.

The workflow needs the repository secret `STUDIO_RELEASE_SSH_KEY` and the repository variable `STUDIO_RELEASE_SSH_KNOWN_HOSTS`. The latter contains the pinned `known_hosts` entry for `apps.thepropervolume.com`. The SSH key is restricted to release staging and publication on the server. Keep the private key in the GitHub secret.

Each platform checks the package types, records SHA-256 checksums, and stages its two files by version and commit. Publication runs after all four builds stage successfully. GitHub artifacts are optional because the public downloads are served by the release server.
