const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

let mainWindow;
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.webp', '.gif']);

// ---------- bundled-engine resolution ----------
// Convertidor ships FFmpeg, Pandoc and a full portable Python+GeoPandas stack for Windows
// as extraResources, so those three need zero setup on the user's machine. ImageMagick ships
// as its official silent installer and is auto-installed to a per-user folder on first run.

const TOOLS_DIR = path.join(app.getPath('userData'), 'engine-cache');
const resourcesBase = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources');

function bundledBinPath(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return path.join(resourcesBase, 'bin', exe);
}

function bundledPythonPath() {
  return path.join(resourcesBase, 'python', 'win', 'python.exe');
}

function ffmpegPath() {
  const bundled = bundledBinPath('ffmpeg');
  if (process.platform === 'win32' && fs.existsSync(bundled)) return bundled;
  return 'ffmpeg'; // dev / non-Windows fallback: rely on PATH
}

function pandocPath() {
  const bundled = bundledBinPath('pandoc');
  if (process.platform === 'win32' && fs.existsSync(bundled)) return bundled;
  return 'pandoc';
}

function pythonPath() {
  const bundled = bundledPythonPath();
  if (process.platform === 'win32' && fs.existsSync(bundled)) return bundled;
  return null; // caller falls back to a system python it already detected
}

function imagemagickInstallDir() { return path.join(TOOLS_DIR, 'imagemagick'); }

function findLocalMagick() {
  const dir = imagemagickInstallDir();
  const candidate = path.join(dir, 'magick.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

let imagemagickStatus = 'idle'; // idle | installing | ready | on-path | unavailable
let imagemagickSetupPromise = null;
function ensureImageMagick() {
  if (imagemagickSetupPromise) return imagemagickSetupPromise;
  imagemagickSetupPromise = (async () => {
    const local = findLocalMagick();
    if (local) { imagemagickStatus = 'ready'; return local; }
    const onPath = await findTool(['magick', 'convert']);
    if (onPath) { imagemagickStatus = 'on-path'; return onPath.path; }
    if (process.platform !== 'win32') { imagemagickStatus = 'unavailable'; return null; }
    const installer = bundledBinPath('imagemagick-setup');
    if (!fs.existsSync(installer)) { imagemagickStatus = 'unavailable'; return null; }
    fs.mkdirSync(imagemagickInstallDir(), { recursive: true });
    imagemagickStatus = 'installing';
    sendProgress('tool-setup', { tool: 'imagemagick', status: 'installing' });
    await new Promise((resolve) => {
      execFile(installer, [
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-',
        `/DIR=${imagemagickInstallDir()}`,
      ], { timeout: 5 * 60 * 1000 }, () => resolve());
    });
    const installed = findLocalMagick();
    imagemagickStatus = installed ? 'ready' : 'failed';
    sendProgress('tool-setup', { tool: 'imagemagick', status: imagemagickStatus });
    return installed;
  })();
  return imagemagickSetupPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  ensureImageMagick(); // fire-and-forget: usually finishes before the user needs it
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- helpers ----------

function naturalCompare(a, b) {
  const ax = [], bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, d, s) => ax.push([d ? parseInt(d, 10) : Infinity, s || '']));
  b.replace(/(\d+)|(\D+)/g, (_, d, s) => bx.push([d ? parseInt(d, 10) : Infinity, s || '']));
  while (ax.length && bx.length) {
    const an = ax.shift(), bn = bx.shift();
    const nc = an[0] - bn[0];
    if (nc) return nc;
    const sc = an[1].localeCompare(bn[1]);
    if (sc) return sc;
  }
  return ax.length - bx.length;
}

function which(cmd) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, [cmd], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      resolve(stdout.split(/\r?\n/)[0].trim());
    });
  });
}

async function findTool(candidates) {
  for (const c of candidates) {
    const p = await which(c);
    if (p) return { name: c, path: p };
  }
  return null;
}

function collectImagesRecursive(rootPaths) {
  const results = [];
  const stack = [...rootPaths];
  while (stack.length) {
    const p = stack.pop();
    let stat;
    try { stat = fs.statSync(p); } catch { continue; }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) stack.push(path.join(p, entry));
    } else if (IMAGE_EXTS.has(path.extname(p).toLowerCase())) {
      results.push(p);
    }
  }
  results.sort(naturalCompare);
  return results;
}

function sendProgress(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ---------- tool detection ----------

ipcMain.handle('check-tools', async () => {
  const bundledFfmpeg = process.platform === 'win32' && fs.existsSync(bundledBinPath('ffmpeg'));
  const bundledPandoc = process.platform === 'win32' && fs.existsSync(bundledBinPath('pandoc'));
  const bundledPython = pythonPath();

  const [ffmpegOnPath, pandocOnPath, systemPython] = await Promise.all([
    bundledFfmpeg ? null : findTool(['ffmpeg']),
    bundledPandoc ? null : findTool(['pandoc']),
    bundledPython ? null : findTool(['python', 'python3']),
  ]);

  const localMagick = findLocalMagick();
  const magickOnPath = localMagick ? null : await findTool(['magick', 'convert']);

  let geopandasOk = false;
  let pythonCmd = null;
  if (bundledPython) {
    geopandasOk = true; // baked into the bundle at build time; always present alongside it
    pythonCmd = bundledPython;
  } else if (systemPython) {
    pythonCmd = systemPython.path;
    geopandasOk = await new Promise((resolve) => {
      execFile(systemPython.path, ['-c', 'import geopandas'], (err) => resolve(!err));
    });
  }

  return {
    ffmpeg: bundledFfmpeg || !!ffmpegOnPath,
    magick: !!(localMagick || magickOnPath),
    magickCmd: localMagick || magickOnPath?.path,
    magickInstalling: imagemagickStatus === 'installing',
    pandoc: bundledPandoc || !!pandocOnPath,
    python: !!pythonCmd,
    pythonCmd,
    geopandas: geopandasOk,
    bundled: { ffmpeg: bundledFfmpeg, pandoc: bundledPandoc, python: !!bundledPython },
  };
});

// ---------- file pickers ----------

ipcMain.handle('pick-files', async (e, { filters, multi = true } = {}) => {
  const props = ['openFile'];
  if (multi) props.push('multiSelections');
  const res = await dialog.showOpenDialog(mainWindow, { properties: props, filters: filters || [] });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('pick-images-or-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff', 'webp', 'gif'] }],
  });
  if (res.canceled || !res.filePaths.length) return { files: [] };
  const files = collectImagesRecursive(res.filePaths);
  return { files };
});

ipcMain.handle('pick-save-path', async (e, { defaultName, filters }) => {
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName, filters: filters || [] });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('reveal-file', async (e, filePath) => {
  shell.showItemInFolder(filePath);
});

// ---------- duration probing (via ffmpeg -i, no ffprobe needed) ----------

function getDurationSeconds(filePath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ['-i', filePath], (err, stdout, stderr) => {
      const text = (stderr || '') + (stdout || '');
      const m = /Duration:\s*(\d+):(\d\d):(\d\d\.\d+)/.exec(text);
      if (!m) return resolve(null);
      resolve(parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]));
    });
  });
}

ipcMain.handle('probe-media', async (e, filePath) => {
  const duration = await getDurationSeconds(filePath);
  return duration ? { format: { duration } } : null;
});

// ---------- generic ffmpeg progress runner ----------

function runFfmpeg(args, { jobId, totalSeconds }) {
  return new Promise((resolve, reject) => {
    const full = ['-y', ...args, '-progress', 'pipe:1', '-nostats'];
    const proc = spawn(ffmpegPath(), full);
    let stderrBuf = '';
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const outMs = /out_time_ms=(\d+)/.exec(text);
      const progressDone = /progress=end/.test(text);
      if (outMs && totalSeconds) {
        const seconds = parseInt(outMs[1], 10) / 1000000;
        const pct = Math.min(100, (seconds / totalSeconds) * 100);
        sendProgress('job-progress', { jobId, pct });
      }
      if (progressDone) sendProgress('job-progress', { jobId, pct: 100 });
    });
    proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrBuf.slice(-2000) || `ffmpeg exited with code ${code}`));
    });
    ipcMain.once(`cancel-${jobId}`, () => proc.kill());
  });
}

// ---------- Video / Audio conversion (ffmpeg) ----------

ipcMain.handle('ffmpeg-convert', async (e, { jobId, input, output, videoCodec, audioCodec, crf, audioBitrate, extraArgs }) => {
  const totalSeconds = await getDurationSeconds(input);

  const args = ['-i', input];
  if (videoCodec) args.push('-c:v', videoCodec);
  if (crf !== undefined && crf !== null && videoCodec !== 'copy') args.push('-crf', String(crf));
  if (audioCodec) args.push('-c:a', audioCodec);
  if (audioBitrate) args.push('-b:a', `${audioBitrate}k`);
  if (videoCodec && videoCodec !== 'copy' && videoCodec.includes('264')) args.push('-pix_fmt', 'yuv420p');
  if (extraArgs) args.push(...extraArgs);
  args.push(output);

  try {
    await runFfmpeg(args, { jobId, totalSeconds });
    const stat = fs.statSync(output);
    return { success: true, output, sizeBytes: stat.size };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---------- Images -> Video (ffmpeg concat demuxer) ----------

ipcMain.handle('images-to-video', async (e, opts) => {
  const { jobId, files, fps, durationSeconds, mode, width, height, quality, format, output } = opts;
  if (!files || !files.length) return { success: false, error: 'No images provided.' };

  const count = files.length;
  const perImageDuration = mode === 'duration' ? durationSeconds / count : 1 / fps;
  const effectiveFps = mode === 'duration' ? count / durationSeconds : fps;
  const totalSeconds = mode === 'duration' ? durationSeconds : count / fps;

  const listPath = path.join(os.tmpdir(), `convertidor-list-${jobId}.txt`);
  const esc = (p) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
  let listContent = '';
  for (const f of files) {
    listContent += `file '${esc(f)}'\nduration ${perImageDuration}\n`;
  }
  listContent += `file '${esc(files[files.length - 1])}'\n`; // ffmpeg concat quirk: repeat last frame
  fs.writeFileSync(listPath, listContent);

  const qualityCrf = { draft: 30, balanced: 23, high: 17 }[quality] || 23;
  const scaleFilter = width && height
    ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,`
    : '';

  const args = ['-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', `${scaleFilter}fps=${effectiveFps}`,
    '-pix_fmt', 'yuv420p'];

  if (format === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', String(qualityCrf), '-b:v', '0');
  } else if (format === 'gif') {
    args.splice(args.indexOf('-pix_fmt'), 2); // gif doesn't need yuv420p
  } else {
    args.push('-c:v', 'libx264', '-crf', String(qualityCrf), '-movflags', '+faststart');
  }

  args.push(output);

  try {
    await runFfmpeg(args, { jobId, totalSeconds });
    fs.unlinkSync(listPath);
    const stat = fs.statSync(output);
    return { success: true, output, sizeBytes: stat.size, durationSeconds: totalSeconds, effectiveFps };
  } catch (err) {
    try { fs.unlinkSync(listPath); } catch {}
    return { success: false, error: err.message };
  }
});

// ---------- Images (ImageMagick) ----------

ipcMain.handle('image-convert-batch', async (e, { jobId, files, outputDir, format, resizePct, resizeW, resizeH, jpegQuality }) => {
  const cmd = (await ensureImageMagick()) || 'magick';
  let done = 0;
  const results = [];
  for (const file of files) {
    const base = path.basename(file, path.extname(file));
    const outPath = path.join(outputDir, `${base}.${format}`);
    const args = [];
    if (path.basename(cmd).toLowerCase().startsWith('magick')) args.push('convert');
    args.push(file);
    if (resizePct) args.push('-resize', `${resizePct}%`);
    else if (resizeW && resizeH) args.push('-resize', `${resizeW}x${resizeH}`);
    if (format === 'jpg' || format === 'jpeg') args.push('-quality', String(jpegQuality || 90));
    args.push(outPath);

    await new Promise((resolve) => {
      execFile(cmd, args, (err) => {
        done++;
        sendProgress('job-progress', { jobId, pct: (done / files.length) * 100 });
        results.push({ file, outPath, ok: !err, error: err?.message });
        resolve();
      });
    });
  }
  return { success: true, results };
});

// ---------- Documents (Pandoc) ----------

ipcMain.handle('pandoc-convert', async (e, { jobId, input, output, extraArgs }) => {
  return new Promise((resolve) => {
    const args = [input, '-o', output, ...(extraArgs || [])];
    execFile(pandocPath(), args, (err, stdout, stderr) => {
      sendProgress('job-progress', { jobId, pct: 100 });
      if (err) resolve({ success: false, error: stderr || err.message });
      else {
        const stat = fs.statSync(output);
        resolve({ success: true, output, sizeBytes: stat.size });
      }
    });
  });
});

// ---------- Geospatial (GeoPandas via python helper script) ----------

ipcMain.handle('geo-convert', async (e, { jobId, input, output, targetCrs, pythonCmd }) => {
  const script = path.join(resourcesBase, 'scripts', 'geo_convert.py');
  const python = pythonPath() || pythonCmd || 'python3';
  return new Promise((resolve) => {
    const args = [script, input, output];
    if (targetCrs) args.push('--crs', targetCrs);
    execFile(python, args, (err, stdout, stderr) => {
      sendProgress('job-progress', { jobId, pct: 100 });
      if (err) resolve({ success: false, error: stderr || err.message });
      else {
        const stat = fs.statSync(output);
        resolve({ success: true, output, sizeBytes: stat.size, log: stdout });
      }
    });
  });
});

ipcMain.handle('cancel-job', async (e, jobId) => {
  ipcMain.emit(`cancel-${jobId}`);
});
