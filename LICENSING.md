# Karaoke Studio licensing

The Proper Volume licenses its original Karaoke Studio source code, build scripts, and tests under the [Mozilla Public License 2.0](LICENSE), to the extent it owns or has authority to license that code.

> This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

The MPL grant includes the interface styles and icons adapted from Booth's `opencode-audit` branch.

Existing third-party and contributor notices retain their terms. The bundled Liberation fonts retain their [SIL Open Font License](public/lyric-fonts/LICENSE). Desktop packages include the notices for bundled JavaScript in the resources `licenses/` directory. The `saxes` 6.0.0 archive omits its notice, so Studio ships a verified copy of the [upstream license](https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE). Preserve those notices and the Electron and Chromium runtime notices.

The vendored `@thepropervolume/karaoke-core` package is licensed separately under MPL 2.0. The pinned archive includes the TypeScript corresponding to the six compiled JavaScript and declaration files. The [Core licensing notice](https://github.com/thepropervolume/proper-karaoke-core/blob/main/LICENSING.md) also covers the exact source for Core v0.1.0, which earlier Studio revisions bundled.

TPV names, logos, and branded artwork are handled under the [branding terms](TRADEMARKS.md). The software license grants no redistribution rights to user-supplied recordings, lyrics, externally installed model weights, or provider materials.

When distributing an executable built from MPL-covered code, make its corresponding covered source available to recipients and explain how to get it. Keep each release tied to its exact source revision.
