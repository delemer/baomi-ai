# Third-Party Notices

This distribution bundles the following third-party components. Their licenses are reproduced or
referenced below. Nothing here changes the license of ClipForge itself, which is
**AGPL-3.0-only** (see `LICENSE`).

---

## 1. FFmpeg and FFprobe — GPL-3.0

This product includes FFmpeg and FFprobe binaries.

- **FFmpeg** — licensed under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.
  Source code: <https://ffmpeg.org/download.html>
  The specific static builds shipped here are produced by the `ffmpeg-static` project:
  <https://github.com/eugeneware/ffmpeg-static> (builds obtained from <https://www.gyan.dev/ffmpeg/builds/>,
  <https://johnvansickle.com/ffmpeg/> and <https://evermeet.cx/ffmpeg/>).
- **FFprobe** — distributed via `@ffprobe-installer` (Windows x64 package declares **GPL-3.0**).
  Source code: <https://ffmpeg.org/download.html>; builds from <https://www.gyan.dev/ffmpeg/builds/>.

### Written offer

For at least three years from the date you received this software, the distributor will provide,
on request and at no charge beyond the cost of physically performing the distribution, the
complete corresponding source code for the FFmpeg/FFprobe binaries shipped with it.

Requests: open an issue on the source repository listed in `README.md`, or use the contact
address published there.

> Note on redistribution: if you redistribute this application (with or without modification),
> you must satisfy the GPL for these binaries yourself — keep this notice, and keep a working
> source-availability path for FFmpeg/FFprobe.

---

## 2. Bundled fonts — SIL Open Font License 1.1

- **Noto Sans CJK SC (subset)** — shipped as `public/fonts/subtitle.otf`.
  License text: `public/fonts/OFL.txt`.
  The OFL permits bundling and redistribution with software; the font files themselves may not be
  sold on their own.
- **Geist** (UI font, via the `geist` npm package) — SIL OFL 1.1.

---

## 3. Electron and Chromium

- **Electron** — MIT License. <https://github.com/electron/electron/blob/main/LICENSE>
- **Chromium** — BSD-style licenses plus additional third-party licenses. The full list ships with
  the Electron framework; see <https://www.chromium.org/credits/> and the
  `LICENSES.chromium.html` file inside the installed Electron distribution.

---

## 4. libvips (via sharp) — Apache-2.0 AND LGPL-3.0-or-later

- **sharp** / **libvips** — Apache-2.0, with the prebuilt platform binaries licensed
  **Apache-2.0 AND LGPL-3.0-or-later**.
  The LGPL requires that the library remain replaceable; the library is loaded dynamically and is
  not statically modified here.
  Sources: <https://github.com/lovell/sharp>, <https://github.com/libvips/libvips>

---

## 5. Other runtime dependencies

All remaining runtime dependencies are distributed under permissive licenses (MIT / ISC /
BSD-2-Clause / BSD-3-Clause / Apache-2.0), including but not limited to:

| Package | License |
| --- | --- |
| next | MIT |
| react, react-dom | MIT |
| better-sqlite3 | MIT |
| drizzle-orm | Apache-2.0 |
| openai (SDK) | Apache-2.0 |
| zustand | MIT |
| lucide-react | ISC |
| qrcode | MIT |
| motion | MIT |
| fluent-ffmpeg | MIT |
| @modelcontextprotocol/sdk | MIT |
| @huggingface/transformers | Apache-2.0 |
| onnxruntime-node | MIT |

Full license texts for each package are available in the corresponding package on
<https://www.npmjs.com/> and in the source repository's `pnpm-lock.yaml` (which pins exact
versions).

---

## 6. Runtime-downloaded model weights

The local speech-recognition feature downloads Whisper ONNX weights at first use from
`onnx-community/*` on Hugging Face (<https://huggingface.co/onnx-community>). Those weights are
**not** part of this distribution; their licenses are governed by their own model cards.

---

## 7. Media produced by third-party services

Stock imagery/video, music and sound effects retrieved through Openverse, Wikimedia Commons,
Pexels, Pixabay, Coverr, Jamendo, Freesound, NASA and the Internet Archive remain under their
respective licenses. The application provides an exportable attribution/credits sheet
(`credits`) — keep it when publishing, as several CC licenses require attribution.

---

## 8. Not included

**Remotion is not bundled.** It is an optional, developer-only tool (`remotion/`, excluded from
the build and from dependencies). Remotion is *not* open source: it requires a paid company
license in various cases, including building automated video-generation products. Do not add it
to a distributed build without reviewing <https://www.remotion.dev/docs/license>.
