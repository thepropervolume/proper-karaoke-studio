# Studio installers

Studio preview installers are served from [the Studio download page](https://release.thepropervolume.com/studio). Each version has its own directory. The release server calculates SHA-256 checksums when publishing. Compare the checksum file in that version directory with the file you downloaded.

## Install a preview

- On Windows x64, run the setup EXE or extract the portable ZIP and open Studio from the extracted folder.
- On Linux x64, install the Debian package on a compatible system or make the AppImage executable and launch it.
- On macOS, choose Apple silicon for an M-series Mac or Intel for an Intel Mac. Open the DMG and move the app into Applications. Studio previews are currently unsigned for distribution.

The Windows installer registers `tpv-karaoke-studio` on PATH for the selected installation scope. Open a new terminal after setup. The Debian package adds the command under `/usr/bin`. Portable and drag-and-drop builds can run the CLI from the application folder. See the [CLI guide](cli.md).

Keep project media beside your editable project or back it up in a TPV kit before switching machines. On supported platforms, Studio sets up its AI Sync runtime on demand. Local stem separation and video export use separately installed tools.

## Build locally

Use Node.js 24 and the native operating system for each package. Use the same clean Git commit for every platform. Set the release version in `package.json` and `package-lock.json` before building. Linux packaging needs `dpkg` and `fakeroot`.

Run `npm ci` and `npm test` in the Studio checkout, then build the platform's packages in `release/`.

| Platform | Build command | Packages |
| --- | --- | --- |
| Windows x64 | `npm run package:win -- --x64 --publish never` | NSIS setup EXE and portable ZIP |
| Linux x64 | `npm run package:linux -- --x64 --publish never` | AppImage and Debian package |
| macOS Apple Silicon | `npm run package:mac -- --arm64 --publish never` | DMG and ZIP |
| macOS Intel | `npm run package:mac -- --x64 --publish never` | DMG and ZIP |

Run `./scripts/windows/test-installer.ps1` in a clean, elevated Windows VM after the build to check the CLI installation and PATH restoration. Windows and macOS previews ship unsigned.

## Publish

Prepare each native build using its platform identifier. The command validates the two packages, gives them their public filenames, and writes checksums in `release/staged/<platform>/`.

    node scripts/upload-studio-release.mjs prepare linux-x64 release

For release-service SSH, set `STUDIO_RELEASE_SSH_KEY` and the pinned `apps.thepropervolume.com` host entry in `STUDIO_RELEASE_SSH_KNOWN_HOSTS`. From a machine that already has verified server-admin SSH access, set `STUDIO_RELEASE_SERVER_ADMIN=1` to invoke the same publisher as the release-service account.

Stage each built platform from the matching release checkout. The server groups the platform pairs by version and source commit. If the local checkout has advanced since packaging, set `STUDIO_RELEASE_COMMIT` to the commit used for the builds.

    node scripts/upload-studio-release.mjs stage linux-x64

Publish a full release once all four platform pairs are staged. To publish the built pairs when another platform is pending, use `publish-available`. The download page keeps the most recent earlier downloads for missing platforms and labels them with their version. Published version directories are immutable.

    node scripts/upload-studio-release.mjs publish
    node scripts/upload-studio-release.mjs publish-available

Publication verifies the manifest's version, source commit, and package sizes. Repeat the check with `verify` for a full release or `verify-available` for a partial release. The server uses [deploy/studio-release.py](../deploy/studio-release.py) at `/opt/tpv-studio-releases/release-command.py`.
