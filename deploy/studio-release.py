#!/usr/bin/env python3
"""Stage verified Studio builds and publish platform pairs under the release vhost."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
from html import escape
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile
import time


PLATFORMS = {
    "windows-x64": ("windows-x64-setup.exe", "windows-x64.zip"),
    "linux-x64": ("linux-x64.AppImage", "linux-x64.deb"),
    "macos-arm64": ("macos-arm64.dmg", "macos-arm64.zip"),
    "macos-x64": ("macos-x64.dmg", "macos-x64.zip"),
}
LABELS = {
    "windows-x64-setup.exe": "Windows x64 installer",
    "windows-x64.zip": "Windows x64 portable ZIP",
    "linux-x64.AppImage": "Linux x64 AppImage",
    "linux-x64.deb": "Linux x64 Debian package",
    "macos-arm64.dmg": "macOS Apple silicon DMG",
    "macos-arm64.zip": "macOS Apple silicon ZIP",
    "macos-x64.dmg": "macOS Intel DMG",
    "macos-x64.zip": "macOS Intel ZIP",
}
PREFIX = "tpv-karaoke-studio"
LIMIT = 450 * 1024 * 1024
ROOT = Path("/srv/tpv-studio-releases")


def version_key(version):
    return tuple(map(int, version.split(".")))


def filenames(version, platform):
    return {f"{PREFIX}-{version}-{suffix}": suffix for suffix in PLATFORMS[platform]}


def write_atomic(destination, value):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(value)
            handle.flush()
            os.fchmod(handle.fileno(), 0o644)
            os.fsync(handle.fileno())
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)


@contextmanager
def lock(root):
    with (root / "incoming" / ".publish.lock").open("a") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def digest(file):
    with file.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify_format(file):
    with file.open("rb") as handle:
        magic = handle.read(8)
        if file.suffix == ".dmg":
            handle.seek(-512, os.SEEK_END)
            magic = handle.read(4)
    expected = {
        ".exe": b"MZ", ".zip": b"PK\x03\x04", ".AppImage": b"\x7fELF",
        ".dmg": b"koly", ".deb": b"!<arch>\n",
    }
    if not magic.startswith(expected[file.suffix]):
        raise ValueError(f"Invalid package signature for {file.name}.")


def prune_staging(root):
    incoming = root / "incoming"
    cutoff = time.time() - 7 * 24 * 3600
    for entry in incoming.iterdir():
        if entry.is_dir() and not entry.is_symlink() and entry.stat().st_mtime < cutoff:
            shutil.rmtree(entry)


def stage(root, version, commit, platform, stream):
    names = filenames(version, platform)
    if shutil.disk_usage(root).free < 5 * 1024**3 + len(names) * LIMIT:
        raise ValueError("Insufficient release disk space.")
    batch_root = root / "incoming" / f"v{version}-{commit}"
    batch_root.mkdir(mode=0o700, exist_ok=True)
    os.utime(batch_root, None)
    with tempfile.TemporaryDirectory(dir=batch_root, prefix=".upload-") as scratch:
        pending = Path(scratch)
        seen = set()
        with tarfile.open(fileobj=stream, mode="r|") as archive:
            for member in archive:
                if (not member.isfile() or member.name not in names or member.name in seen
                        or not 1024 <= member.size <= LIMIT):
                    raise ValueError("Invalid or unexpected Studio release archive entry.")
                source = archive.extractfile(member)
                with source, (pending / member.name).open("wb") as destination:
                    shutil.copyfileobj(source, destination, length=1024 * 1024)
                verify_format(pending / member.name)
                seen.add(member.name)
        if seen != set(names):
            raise ValueError("The Studio release archive is missing a package.")
        finished = batch_root / platform
        if finished.is_dir():
            if all(digest(finished / name) == digest(pending / name) for name in names):
                return
            # A rebuilt platform can differ before publication. Swap its complete pair.
            retired = batch_root / f".previous-{platform}"
            if retired.exists():
                shutil.rmtree(retired)
            finished.rename(retired)
            try:
                pending.rename(finished)
            except OSError:
                retired.rename(finished)
                raise
            shutil.rmtree(retired)
        else:
            pending.rename(finished)


def page(manifest, *, index=False, versions=(), older_assets=()):
    version = manifest["version"]
    relative = f"v{version}/" if index else ""
    source = manifest["sourceCommit"]
    files = "\n".join(
        f'<li><a href="{relative}{asset["name"]}" download>{escape(asset["label"])}</a>'
        f' <small>{asset["bytes"] / 1024**2:.1f} MiB</small></li>'
        for asset in manifest["assets"]
    )
    history = "".join(f'<li><a href="v{entry}/">Version {entry}</a></li>' for entry in versions if entry != version)
    available = {asset["platform"] for asset in manifest["assets"]}
    platform_labels = {"windows-x64": "Windows", "linux-x64": "Linux", "macos-arm64": "Apple silicon Mac", "macos-x64": "Intel Mac"}
    partial = "<p>Version " + version + " is available for " + ", ".join(
        name for platform, name in platform_labels.items() if platform in available) + ".</p>" if manifest["partial"] else ""
    older = "".join(
        f'<li><a href="v{escape(release)}/{escape(asset["name"])}" download>{escape(asset["label"])}</a>'
        f' <small>Version {escape(release)}</small></li>'
        for release, asset in older_assets
    )
    footer = ('<a href="/booth/">Karaoke Booth downloads</a>' if index else '<a href="../">Latest Studio release</a>')
    return f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Karaoke Studio {version} Downloads</title>
<style>
  :root {{ color-scheme: light dark; font-family: system-ui, sans-serif; }}
  body {{ max-width: 46rem; padding: 2rem 1.25rem; margin: 5vh auto; line-height: 1.6; }}
  li {{ margin-block: .6rem; }}
</style>
<h1>The Proper Volume Karaoke Studio</h1>
<h2>Version {version} · Development preview</h2>
<p>Download Studio to author karaoke tracks, sync lyrics, and export videos or TPV kits.</p>
<p>These development builds are unsigned.</p>
{partial}
<ul>{files}</ul>
<p><a href="{relative}SHA256SUMS.txt" download>SHA-256 checksums</a> · <a href="{relative}release-manifest.json">Release manifest</a></p>
<p><a href="https://github.com/thepropervolume/proper-karaoke-studio/tree/{escape(source)}">Corresponding source code</a></p>
{f'<h2>Latest builds for other platforms</h2><ul>{older}</ul>' if older else ''}
{f'<h2>Earlier releases</h2><ul>{history}</ul>' if history else ''}
<p>{footer} · <a href="/">All downloads</a></p>
</html>
"""


def publish(root, version, commit, allow_partial=False):
    public = root / "public"
    destination = public / f"v{version}"
    if destination.exists():
        existing = json.loads((destination / "release-manifest.json").read_text(encoding="utf-8"))
        if (existing["sourceCommit"] != commit or (existing["partial"] and not allow_partial)):
            raise ValueError("That version already exists. Increment the version before publishing different packages.")
    else:
        batch_root = root / "incoming" / f"v{version}-{commit}"
        complete = [platform for platform in PLATFORMS if (batch_root / platform).is_dir()]
        if complete != list(PLATFORMS) and not (allow_partial and complete):
            raise ValueError("The Studio release is missing required platform batches.")
        with tempfile.TemporaryDirectory(dir=root / "incoming", prefix=".publication-") as scratch:
            pending = Path(scratch)
            pending.chmod(0o755)
            assets = []
            for platform in complete:
                for name, suffix in filenames(version, platform).items():
                    source = batch_root / platform / name
                    verify_format(source)
                    output = pending / name
                    os.link(source, output)
                    output.chmod(0o644)
                    assets.append({
                        "name": name, "platform": platform, "label": LABELS[suffix],
                        "bytes": output.stat().st_size, "sha256": digest(output),
                        "alias": f"{PREFIX}-{suffix}",
                    })
            manifest = {
                "version": version, "sourceCommit": commit, "partial": len(complete) != len(PLATFORMS),
                "publishedAt": datetime.now(timezone.utc).isoformat(), "assets": assets,
            }
            write_atomic(pending / "release-manifest.json", json.dumps(manifest, indent=2) + "\n")
            write_atomic(pending / "SHA256SUMS.txt", "".join(f'{asset["sha256"]}  {asset["name"]}\n' for asset in assets))
            write_atomic(pending / "index.html", page(manifest))
            pending.rename(destination)
    versions = sorted(
        (entry.name[1:] for entry in public.glob("v*") if re.fullmatch(r"v\d+\.\d+\.\d+", entry.name)
         and (entry / "release-manifest.json").is_file()), key=version_key, reverse=True,
    )
    latest = versions[0]
    manifest = json.loads((public / f"v{latest}" / "release-manifest.json").read_text(encoding="utf-8"))
    aliases = {asset["alias"]: f'/v{latest}/{asset["name"]}' for asset in manifest["assets"]}
    older_assets = []
    # Keep each missing platform's most recent version available under its
    # existing alias. The newest manifest and checksum file describe one version.
    if manifest["partial"]:
        for earlier in versions[1:]:
            history = json.loads((public / f"v{earlier}" / "release-manifest.json").read_text(encoding="utf-8"))
            for asset in history["assets"]:
                if asset["alias"] not in aliases:
                    aliases[asset["alias"]] = f'/v{earlier}/{asset["name"]}'
                    older_assets.append((earlier, asset))
    aliases.update({name: f"/v{latest}/{name}" for name in ("SHA256SUMS.txt", "release-manifest.json")})
    write_atomic(public / ".latest.map", "".join(f"{name} {file}\n" for name, file in aliases.items()))
    write_atomic(public / "index.html", page(manifest, index=True, versions=versions, older_assets=older_assets))
    shutil.rmtree(root / "incoming" / f"v{version}-{commit}", ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("command", nargs="*")
    args = parser.parse_args()
    requested = os.environ.get("SSH_ORIGINAL_COMMAND")
    if requested is not None:
        if args.command or args.allow_partial or args.root != ROOT:
            raise ValueError("Unexpected arguments on restricted publisher.")
        command = requested.split()
    else:
        command = args.command
    if len(command) not in (3, 4):
        raise ValueError("Use stage VERSION COMMIT PLATFORM, publish VERSION COMMIT, or publish-available VERSION COMMIT.")
    action, version, commit = command[:3]
    if not re.fullmatch(r"(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}", version) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Invalid Studio version or source commit.")
    with lock(args.root):
        prune_staging(args.root)
        if action == "stage" and len(command) == 4 and command[3] in PLATFORMS:
            stage(args.root, version, commit, command[3], sys.stdin.buffer)
        elif action in ("publish", "publish-available") and len(command) == 3:
            publish(args.root, version, commit, args.allow_partial or action == "publish-available")
        else:
            raise ValueError("Unsupported Studio release command.")
    print(f"{action} accepted for Studio {version}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
