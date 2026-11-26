#!/usr/bin/env bash
# Fetches the bundled engines (FFmpeg, Pandoc, ImageMagick installer, portable
# Python + GeoPandas) into resources/, so `npm run dist:win` produces a fully
# self-contained installer. Safe to re-run; skips anything already present.
#
# Requires: bash, curl, unzip/tar, python3 + pip (for the GeoPandas wheel step).
# Optional: set GITHUB_TOKEN to avoid GitHub API rate limits.

set -euo pipefail
cd "$(dirname "$0")/.."

AUTH=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then AUTH=(-H "Authorization: token $GITHUB_TOKEN"); fi

mkdir -p resources/bin resources/python tmp_fetch
cd tmp_fetch

gh_latest_asset() {
  # $1 = owner/repo, $2 = tag ("latest" for the "Latest release" alias), $3 = grep pattern for the asset filename
  local repo="$1" tag="$2" pattern="$3"
  curl -s -L "${AUTH[@]}" "https://github.com/$repo/releases/expanded_assets/$tag" \
    | grep -oE "href=\"/$repo/releases/download/[^\"]*\"" \
    | grep -E "$pattern" | head -1 | sed -E 's/href="(.*)"/\1/'
}

# ---------- FFmpeg (compact static Windows build, ~79MB vs ~158MB for the full BtbN build) ----------
if [[ ! -f ../resources/bin/ffmpeg.exe ]]; then
  echo "==> Fetching FFmpeg..."
  tag=$(curl -s -L "${AUTH[@]}" "https://github.com/eugeneware/ffmpeg-static/releases/latest" \
    | grep -oE '/releases/tag/[^"&]*' | grep -v '\*' | head -1 | sed 's#.*/##')
  curl -s -L -o ffmpeg.gz "https://github.com/eugeneware/ffmpeg-static/releases/download/$tag/ffmpeg-win32-x64.gz"
  gunzip -f ffmpeg.gz
  mv ffmpeg ../resources/bin/ffmpeg.exe
fi

# ---------- Pandoc ----------
if [[ ! -f ../resources/bin/pandoc.exe ]]; then
  echo "==> Fetching Pandoc..."
  tag=$(curl -s -L "${AUTH[@]}" "https://github.com/jgm/pandoc/releases/latest" \
    | grep -oE '/jgm/pandoc/releases/tag/[^"]*' | head -1 | sed 's#.*/##')
  path=$(gh_latest_asset "jgm/pandoc" "$tag" 'windows-x86_64\.zip"$')
  curl -s -L -o pandoc.zip "https://github.com$path"
  unzip -o -j pandoc.zip "*/pandoc.exe" -d ../resources/bin/
fi

# ---------- ImageMagick (static installer, auto-installed silently on first launch) ----------
if [[ ! -f ../resources/bin/imagemagick-setup.exe ]]; then
  echo "==> Fetching ImageMagick..."
  tag=$(curl -s -L "${AUTH[@]}" "https://github.com/ImageMagick/ImageMagick/releases/latest" \
    | grep -oE '/releases/tag/[0-9][^"]*' | head -1 | sed 's#.*/##')
  path=$(gh_latest_asset "ImageMagick/ImageMagick" "$tag" 'Q16-x64-static\.exe"$')
  curl -s -L -o "../resources/bin/imagemagick-setup.exe" "https://github.com$path"
fi

# ---------- Portable Python + GeoPandas ----------
if [[ ! -f ../resources/python/win/python.exe ]]; then
  echo "==> Fetching portable Python..."
  tag=$(curl -s -L "${AUTH[@]}" "https://github.com/astral-sh/python-build-standalone/releases/latest" \
    | grep -oE '/releases/tag/[0-9]+' | head -1 | sed 's#.*/##')
  path=$(gh_latest_asset "astral-sh/python-build-standalone" "$tag" \
    'cpython-3\.12\.[0-9]+\+[0-9]+-x86_64-pc-windows-msvc-install_only_stripped\.tar\.gz"$')
  curl -s -L -o python-win.tar.gz "https://github.com$path"
  mkdir -p pyroot && tar xzf python-win.tar.gz -C pyroot

  echo "==> Downloading GeoPandas + dependency wheels from PyPI..."
  mkdir -p wheels site-packages
  pip download --no-deps --only-binary=:all: --platform win_amd64 \
    --python-version 3.12 --implementation cp --abi cp312 -d wheels \
    geopandas pandas numpy pyogrio shapely pyproj packaging \
    python-dateutil pytz six certifi click click-plugins cligj attrs

  pip install --no-index --find-links=wheels --target=site-packages --no-deps \
    --platform win_amd64 --python-version 3.12 --implementation cp --abi cp312 --only-binary=:all: \
    geopandas pandas numpy pyogrio shapely pyproj packaging \
    python-dateutil pytz six certifi click click-plugins cligj attrs

  cp -r site-packages/* pyroot/python/Lib/site-packages/
  rm -rf pyroot/python/tcl pyroot/python/include pyroot/python/libs pyroot/python/Scripts
  PYLIB=pyroot/python/Lib
  rm -rf $PYLIB/test $PYLIB/idlelib $PYLIB/tkinter $PYLIB/turtledemo $PYLIB/turtle.py \
         $PYLIB/lib2to3 $PYLIB/ensurepip $PYLIB/site-packages/pip $PYLIB/site-packages/setuptools \
         $PYLIB/site-packages/pkg_resources $PYLIB/site-packages/_distutils_hack
  rm -f pyroot/python/DLLs/_tkinter.pyd pyroot/python/DLLs/tcl*.dll pyroot/python/DLLs/tk*.dll
  SP=$PYLIB/site-packages
  rm -rf $SP/numpy/f2py $SP/numpy/_core/tests $SP/numpy/*/tests $SP/pandas/tests \
         $SP/shapely/tests $SP/pyproj/tests $SP/geopandas/tests $SP/geopandas/tools/tests
  find pyroot/python -name "*.pth" -path "*distutils*" -delete 2>/dev/null || true
  find pyroot/python -name "*.pdb" -delete 2>/dev/null || true
  find pyroot/python -name "*.lib" -delete 2>/dev/null || true
  find pyroot/python -name "*.h" -path "*numpy*" -delete 2>/dev/null || true
  find pyroot/python -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
  find pyroot/python/Lib/site-packages -type d -iname "tests" -exec rm -rf {} + 2>/dev/null || true
  rm -rf ../resources/python/win
  mv pyroot/python ../resources/python/win
fi

cd ..
rm -rf tmp_fetch
echo "==> All bundled resources are ready."
du -sh resources/bin resources/python 2>/dev/null || true
