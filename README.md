# Convertidor

A desktop file-conversion app (in the spirit of Moonvert) built with **Electron**, wrapping:

Note: 100% made with ai, I did not make any part of this code, feel free to do whatever you want with it.

- **FFmpeg** — video/audio conversion, and the "thousands of images → video" tool
- **ImageMagick** — batch image conversion/resizing
- **Pandoc** — document conversion (docx, pdf, html, md, epub, odt, txt, rtf)
- **GeoPandas** (via a bundled Python script) — geospatial format conversion + reprojection

It does **not** bundle these engines' binaries — it calls them on your system PATH. That keeps
the installer small and avoids licensing/bundling headaches, but it means each engine must be
installed once on the machine that runs Convertidor (see below). The app's sidebar shows a live
green/red status dot for each engine so you always know what's available.

## 1. Install prerequisites (once, on the machine running the app)

**Windows (using [Chocolatey](https://chocolatey.org/), run PowerShell as Administrator):**
```powershell
choco install ffmpeg imagemagick pandoc python -y
pip install geopandas
```
Or install manually:
- FFmpeg: https://www.gyan.dev/ffmpeg/builds/ (add the `bin` folder to your PATH)
- ImageMagick: https://imagemagick.org/script/download.php#windows (check "Add to PATH" and
  "Install legacy utilities" during setup)
- Pandoc: https://pandoc.org/installing.html (Windows installer adds itself to PATH)
- Python 3 + GeoPandas: https://www.python.org/downloads/, then `pip install geopandas`

**macOS:**
```bash
brew install ffmpeg imagemagick pandoc python
pip3 install geopandas
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install ffmpeg imagemagick pandoc python3-pip
pip3 install geopandas
```

## 2. Run the app in development

```bash
npm install
npm start
```

## 3. Build a Windows installer

This project ships with `electron-builder` pre-configured for Windows (NSIS installer +
portable .exe), targeting x64.

**Easiest path — build on a Windows machine:**
```powershell
npm install
npm run dist:win
```
The installer and portable `.exe` will be written to `release/`.

**Building the Windows target from macOS/Linux** is also possible with `electron-builder`
(it uses Wine under the hood), but requires Wine to be installed on the build machine:
```bash
# macOS
brew install --cask wine-stable
# Debian/Ubuntu
sudo apt install wine
npm install
npm run dist:win
```

## How the "Images → Video" estimate works

- **Duration**: `frame count ÷ fps` (or, in fixed-length mode, fps is derived from your target
  duration and the image count).
- **Size**: estimated from an approximate bits-per-pixel-per-frame factor for the chosen
  quality preset (draft/balanced/high) and codec, multiplied by resolution, effective fps and
  duration. It's a heuristic — real encoded size depends on how visually complex your images
  are — but it's normally within a reasonable ballpark for photos/renders.
- Rendering itself uses FFmpeg's `concat` demuxer (not the `-framerate` image sequence mode),
  so your images do **not** need to be sequentially numbered — any file names work, and folders
  are scanned recursively and naturally sorted (`frame2.png` before `frame10.png`).

## Releasing on GitHub

The bundled engines (~900MB) must never be committed to git — `.gitignore` already
excludes `resources/bin/` and `resources/python/`. Instead:

- `build-tools/fetch-resources.sh` downloads them fresh at build time (FFmpeg, Pandoc,
  ImageMagick's installer, and a portable Python + GeoPandas stack), the same way the
  first build was produced.
- `.github/workflows/release.yml` runs that script on a free GitHub-hosted **Windows**
  runner and attaches the resulting installer to a GitHub Release automatically —
  every time you push a tag like `v1.0.1`, no Wine or manual building required.

See the step-by-step walkthrough in the chat where this was set up for the exact git
commands to push the repo and cut a release.

## Project structure

```
main.js            Electron main process: dialogs, tool detection, job runners
preload.js          Secure IPC bridge exposed to the renderer as window.api
src/index.html       UI layout (sidebar + panels)
src/styles.css       Styling
src/renderer.js      UI logic, including the size/duration estimator
scripts/geo_convert.py   GeoPandas conversion helper invoked via subprocess
```

## Notes / possible follow-ups

- PDF output from Pandoc needs a LaTeX engine (e.g. install `MiKTeX` on Windows, or pass
  `--pdf-engine=wkhtmltopdf` after installing that instead).
- To ship a custom app icon, replace `build/icon.ico` (256×256 recommended) before running
  `npm run dist:win`.
- The app currently shells out to system-installed engines; if you'd rather have a fully
  self-contained installer with the binaries embedded, FFmpeg/ImageMagick static builds can be
  dropped into `extraResources` and `main.js` pointed at their bundled paths instead of relying
  on PATH lookup.
