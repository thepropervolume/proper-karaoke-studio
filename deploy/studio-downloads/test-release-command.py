import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("publisher", Path(__file__).with_name("release-command.py"))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
VERSION = "0.5.0"
COMMIT = "a" * 40
FIXTURES = {
    ".exe": b"MZ", ".zip": b"PK\x03\x04", ".AppImage": b"\x7fELF",
    ".deb": b"!<arch>\n", ".dmg": b"unused",
}


def batch(platform, extra=None):
    stream = io.BytesIO()
    files = {}
    for name in publisher.filenames(VERSION, platform):
        extension = Path(name).suffix
        data = FIXTURES[extension].ljust(2048, b"\0")
        if extension == ".dmg":
            data = data[:1536] + b"koly".ljust(512, b"\0")
        files[name] = data
    if extra:
        files[extra] = b"unexpected".ljust(2048, b"\0")
    with tarfile.open(fileobj=stream, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    stream.seek(0)
    return stream


class ReleaseTest(unittest.TestCase):
    def test_requires_all_platforms_and_keeps_published_files_immutable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "incoming").mkdir()
            public = root / "public"
            public.mkdir()
            publisher.stage(root, VERSION, COMMIT, "windows-x64", batch("windows-x64"))
            with self.assertRaisesRegex(ValueError, "missing required platform"):
                publisher.publish(root, VERSION, COMMIT)
            self.assertFalse((public / f"v{VERSION}").exists())
            for platform in publisher.PLATFORMS:
                publisher.stage(root, VERSION, COMMIT, platform, batch(platform))
            publisher.publish(root, VERSION, COMMIT)
            destination = public / f"v{VERSION}"
            manifest = json.loads((destination / "release-manifest.json").read_text())
            self.assertEqual(len(manifest["assets"]), 8)
            for asset in manifest["assets"]:
                self.assertEqual(hashlib.sha256((destination / asset["name"]).read_bytes()).hexdigest(), asset["sha256"])
            self.assertIn(f"/v{VERSION}/SHA256SUMS.txt", (public / ".latest.map").read_text())
            self.assertIn("Apple silicon", (public / "index.html").read_text())
            page = (public / "index.html").read_text()
            self.assertIn('https://github.com/thepropervolume/proper-karaoke-studio', page)
            self.assertIn('aria-label="YouTube"', page)
            self.assertIn('/assets/social-icons.svg#youtube', page)
            with self.assertRaisesRegex(ValueError, "already exists"):
                publisher.publish(root, VERSION, "b" * 40)

    def test_rejects_unexpected_paths_without_completing_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "incoming").mkdir()
            with self.assertRaisesRegex(ValueError, "unexpected"):
                publisher.stage(root, VERSION, COMMIT, "windows-x64", batch("windows-x64", "../unexpected.zip"))
            self.assertFalse((root / "incoming" / f"v{VERSION}-{COMMIT}" / "windows-x64").exists())


if __name__ == "__main__":
    unittest.main()
