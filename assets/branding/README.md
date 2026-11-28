# Studio branding assets

Studio uses The Proper Volume's text-free Bouncing Ball icon selected on November 20, 2026. The editor SVGs and full-size dark PNG were copied from the selected `TPV-Studio-Bouncing-Ball-Selected.zip` bundle.

- The dark and light SVGs match the editor themes.
- The startup screen uses transparent versions of the same artwork. The splash SVGs remove the icon's background rectangle so the mark sits directly on the Day or Night surface.
- The dark artwork is the native app icon. Windows uses the ICO for the application, setup, uninstaller, and window. macOS uses the ICNS for the app bundle. AppImage and Debian packages use the Linux PNG sizes.
- Vite bundles the light SVG favicon. Windows and Linux windows load their brand icon from the installed resources. Development builds load the same source assets.

The platform assets reuse the approved PNGs at the sizes supplied in the bundle. Other sizes were resampled from the matching 1024 px master. Update the desktop icon formats and theme SVGs together when changing the artwork.
