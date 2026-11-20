# Studio branding assets

Studio uses The Proper Volume's text-free Microphone Play mark, also used by Karaoke Booth. The dark and light SVG masters and generated platform icons are byte-for-byte copies of the assets in the [Booth branding source](https://github.com/thepropervolume/proper-karaoke-booth/tree/6a36f50/assets/branding).

- The dark and light masters match the editor themes. Studio supplies its own wordmark in the editor.
- Windows uses the ICO for the application, setup, uninstaller, and window. macOS uses the matching ICNS for the app bundle. AppImage and Debian packages use the Linux PNG sizes.
- Vite bundles the light SVG favicon. Windows and Linux windows load their brand icon from the installed resources. Development builds load the same source assets.

To update the mark, regenerate the platform assets in Booth and copy the matching files here together.
