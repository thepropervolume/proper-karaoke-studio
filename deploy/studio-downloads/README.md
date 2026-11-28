# Studio download publishing

The public [Studio downloads page](https://release.thepropervolume.com/studio/) is hosted on Linode III. The release vhost and its Booth aliases are maintained in the Booth repository. Create the following state directories on one filesystem.

| Path | Owner and access |
| --- | --- |
| /opt/tpv-studio-releases | Administrator, readable by the publisher |
| /srv/tpv-studio-releases | Administrator, mode 0755 |
| /srv/tpv-studio-releases/incoming | tpv-studio-release, mode 0700 |
| /srv/tpv-studio-releases/public | tpv-studio-release, mode 0755 |

Copy the Python 3.11+ release command into the administrator-owned directory. Give the publisher its own home directory and restrict the dedicated Studio CI key to the release command.

    restrict,command="/usr/bin/timeout 900 /usr/bin/python3 /opt/tpv-studio-releases/release-command.py" ssh-ed25519 <Studio CI public key>

The encrypted repository secret is STUDIO_RELEASE_SSH_KEY. STUDIO_RELEASE_SSH_KNOWN_HOSTS is the pinned Linode host public key in known_hosts format. These credentials are separate from the Booth publishing key.

CI streams a flat USTAR archive through stage VERSION COMMIT PLATFORM. Each batch includes the two allowlisted packages for its platform. The server locks staging and publication, validates file paths, sizes and package signatures, and rejects incomplete public versions. The publish VERSION COMMIT command generates SHA256SUMS.txt and a source commit manifest, then switches the Studio download page and latest routes. The immutable version directory preserves the exact published packages.

The initial Windows-only 0.4.0 preview was published with the administrator-only --allow-partial option. CI requires complete Windows, Linux, Apple silicon and Intel macOS batches. See the [release guide](../../docs/releases.md) for the workflow.

Run the publisher regression test on Linux with:

    python3 deploy/studio-downloads/test-release-command.py -v

Studio's page uses the shared release-site stylesheet and social-icon sprite. Install the corresponding Booth release-site assets under `/srv/tpv-downloads/public/assets/` before updating this renderer. The Studio page links to the Studio source repository and shares the TPV social navigation.
