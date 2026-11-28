"""Exercise platform fallbacks in an isolated release directory."""

from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


spec = spec_from_file_location("studio_release", Path(__file__).with_name("studio-release.py"))
release = module_from_spec(spec)
spec.loader.exec_module(release)


class PublishAvailableTest(unittest.TestCase):
    def add_packages(self, root, version, commit, platforms):
        magic = {".exe": b"MZ", ".zip": b"PK\x03\x04", ".AppImage": b"\x7fELF", ".deb": b"!<arch>\n"}
        for platform in platforms:
            directory = root / "incoming" / f"v{version}-{commit}" / platform
            directory.mkdir(parents=True)
            for name in release.filenames(version, platform):
                suffix = Path(name).suffix
                data = b"x" * 1024 + b"koly" + b"\0" * 508 if suffix == ".dmg" else magic[suffix] + b"x" * 1024
                (directory / name).write_bytes(data)

    def test_partial_manifest_keeps_latest_macos_downloads(self):
        old, current = "a" * 40, "b" * 40
        with TemporaryDirectory() as scratch:
            root = Path(scratch)
            public = root / "public"
            public.mkdir()
            self.add_packages(root, "0.8.0", old, release.PLATFORMS)
            release.publish(root, "0.8.0", old)
            self.add_packages(root, "0.9.0", current, ("windows-x64", "linux-x64"))
            with self.assertRaisesRegex(ValueError, "missing required platform"):
                release.publish(root, "0.9.0", current)
            release.publish(root, "0.9.0", current, allow_partial=True)
            manifest = json.loads((public / "v0.9.0/release-manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(manifest["partial"])
            self.assertEqual(len(manifest["assets"]), 4)
            aliases = (public / ".latest.map").read_text(encoding="utf-8")
            self.assertIn("tpv-karaoke-studio-macos-arm64.dmg /v0.8.0/", aliases)
            self.assertIn("tpv-karaoke-studio-linux-x64.deb /v0.9.0/", aliases)
            self.assertIn("release-manifest.json /v0.9.0/release-manifest.json", aliases)
            page = (public / "index.html").read_text(encoding="utf-8")
            self.assertIn("Version 0.9.0 is available for Windows, Linux.", page)
            self.assertIn("Latest builds for other platforms", page)
            self.assertIn("v0.8.0/tpv-karaoke-studio-0.8.0-macos-x64.dmg", page)
            self.assertIn('<h2>Windows</h2><ul class="files">', page)
            self.assertIn('<h2>Linux</h2><ul class="files">', page)
            self.assertIn('href="v0.9.0/SHA256SUMS.txt"', page)
            self.assertIn('href="v0.8.0/">Version 0.8.0', page)
            self.assertEqual(release.index_page(public), page)
            self.assertEqual((public / ".latest.map").read_text(encoding="utf-8"), aliases)

            version_page = (public / "v0.9.0/index.html").read_text(encoding="utf-8")
            self.assertIn('href="/assets/releases.css"', version_page)
            self.assertIn('src="/assets/karaoke-studio.png"', version_page)
            self.assertIn('href="tpv-karaoke-studio-0.9.0-windows-x64-setup.exe"', version_page)
            self.assertIn('href="release-manifest.json"', version_page)
            self.assertIn(f'/tree/{current}"', version_page)
            self.assertIn('href="../">Latest Studio release', version_page)
            for rendered_page in (page, version_page):
                self.assertIn('href="https://github.com/thepropervolume/proper-karaoke-studio">Karaoke Studio on GitHub', rendered_page)
                self.assertIn('aria-label="The Proper Volume social accounts"', rendered_page)
                self.assertIn('aria-label="YouTube"', rendered_page)
                self.assertIn('/assets/social-icons.svg#youtube', rendered_page)
                self.assertEqual(rendered_page.count('/assets/social-icons.svg#'), 8)
            with self.assertRaisesRegex(ValueError, "already exists"):
                release.publish(root, "0.9.0", "c" * 40, allow_partial=True)


if __name__ == "__main__":
    unittest.main()
