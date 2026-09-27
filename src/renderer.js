// ---------- navigation ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.panel).classList.add('active');
  });
});

// ---------- tool status ----------
async function refreshToolStatus() {
  const status = await window.api.checkTools();
  const setRow = (id, ok, label) => {
    const row = document.getElementById(id);
    row.querySelector('.dot').className = 'dot ' + (ok ? 'ok' : 'bad');
    row.title = ok ? `${label} detected` : `${label} not found on PATH`;
  };
  setRow('row-ffmpeg', status.ffmpeg, 'FFmpeg');
  setRow('row-magick', status.magick, 'ImageMagick');
  setRow('row-pandoc', status.pandoc, 'Pandoc');
  setRow('row-geopandas', status.python && status.geopandas, 'GeoPandas');
  return status;
}
let toolStatus = {};
refreshToolStatus().then((s) => (toolStatus = s));

function jobId() { return Math.random().toString(36).slice(2); }
function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes / 1024, i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}
function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function wireProgress(jobId, wrapId, fillId, labelId) {
  document.getElementById(wrapId).style.display = 'flex';
  return window.api.onProgress(({ jobId: id, pct }) => {
    if (id !== jobId) return;
    document.getElementById(fillId).style.width = `${pct.toFixed(1)}%`;
    document.getElementById(labelId).textContent = `${pct.toFixed(0)}%`;
  });
}

// =====================================================================
// IMAGES -> VIDEO
// =====================================================================
let seqFiles = [];

document.getElementById('seq-pick-btn').addEventListener('click', async () => {
  const { files } = await window.api.pickImagesOrFolder();
  if (files.length) {
    seqFiles = files;
    document.getElementById('seq-count').textContent = `${files.length.toLocaleString()} images selected`;
    document.getElementById('seq-run-btn').disabled = false;
    updateEstimate();
  }
});

const seqDropzone = document.getElementById('seq-dropzone');
['dragenter', 'dragover'].forEach((ev) => seqDropzone.addEventListener(ev, (e) => { e.preventDefault(); seqDropzone.classList.add('drag-over'); }));
['dragleave', 'drop'].forEach((ev) => seqDropzone.addEventListener(ev, (e) => { e.preventDefault(); seqDropzone.classList.remove('drag-over'); }));
seqDropzone.addEventListener('drop', (e) => {
  // Electron renderer drag/drop gives File objects with a .path property.
  const paths = Array.from(e.dataTransfer.files).map((f) => f.path).filter(Boolean);
  if (!paths.length) return;
  // Re-use the same recursive collection logic via main process isn't directly callable here,
  // so for dropped folders we just filter by extension on the top-level paths given.
  const imgExt = /\.(jpe?g|png|bmp|tiff?|webp|gif)$/i;
  seqFiles = paths.filter((p) => imgExt.test(p));
  if (seqFiles.length) {
    document.getElementById('seq-count').textContent = `${seqFiles.length.toLocaleString()} images selected (drag & drop — use "Choose" for folders with subfolders)`;
    document.getElementById('seq-run-btn').disabled = false;
    updateEstimate();
  }
});

document.getElementById('seq-resolution').addEventListener('change', (e) => {
  document.getElementById('seq-custom-res').style.display = e.target.value === 'custom' ? 'flex' : 'none';
  updateEstimate();
});
['seq-fps', 'seq-duration', 'seq-format', 'seq-quality', 'seq-w', 'seq-h'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateEstimate);
});
document.querySelectorAll('input[name="seq-mode"]').forEach((r) => r.addEventListener('change', updateEstimate));

function getSeqResolution() {
  const sel = document.getElementById('seq-resolution').value;
  if (sel === 'original') return { width: null, height: null };
  if (sel === 'custom') {
    return {
      width: parseInt(document.getElementById('seq-w').value, 10) || 1920,
      height: parseInt(document.getElementById('seq-h').value, 10) || 1080,
    };
  }
  const [w, h] = sel.split('x').map(Number);
  return { width: w, height: h };
}

// Rough bits-per-pixel-per-frame factors by quality preset, tuned for H.264-ish output.
const BPP_FACTOR = { draft: 0.035, balanced: 0.07, high: 0.14 };

function updateEstimate() {
  const count = seqFiles.length;
  if (!count) return;
  const mode = document.querySelector('input[name="seq-mode"]:checked').value;
  const fps = parseFloat(document.getElementById('seq-fps').value) || 30;
  const duration = parseFloat(document.getElementById('seq-duration').value) || 0;
  const { width, height } = getSeqResolution();
  const w = width || 1920, h = height || 1080;
  const quality = document.getElementById('seq-quality').value;
  const format = document.getElementById('seq-format').value;

  const totalSeconds = mode === 'fps' ? count / fps : duration;
  const effectiveFps = mode === 'fps' ? fps : count / duration;

  document.getElementById('est-frames').textContent = count.toLocaleString();
  document.getElementById('est-duration').textContent = fmtDuration(totalSeconds);
  document.getElementById('est-fps').textContent = effectiveFps.toFixed(2);

  let sizeBytes;
  if (format === 'gif') {
    // GIFs are palette-based and much larger per pixel; rough heuristic.
    sizeBytes = w * h * effectiveFps * totalSeconds * 0.02;
  } else {
    const bpp = BPP_FACTOR[quality] * (format === 'webm' ? 0.75 : 1); // VP9 ~25% smaller than H.264 at similar visual quality
    const bitrateBps = w * h * effectiveFps * bpp;
    sizeBytes = (bitrateBps * totalSeconds) / 8;
  }
  document.getElementById('est-size').textContent = fmtBytes(sizeBytes);
}

document.getElementById('seq-run-btn').addEventListener('click', async () => {
  if (!seqFiles.length) return;
  const defaultName = `sequence-video.${document.getElementById('seq-format').value}`;
  const outPath = await window.api.pickSavePath({ defaultName });
  if (!outPath) return;

  const mode = document.querySelector('input[name="seq-mode"]:checked').value;
  const fps = parseFloat(document.getElementById('seq-fps').value) || 30;
  const duration = parseFloat(document.getElementById('seq-duration').value) || 0;
  const { width, height } = getSeqResolution();
  const quality = document.getElementById('seq-quality').value;
  const format = document.getElementById('seq-format').value;

  const id = jobId();
  const off = wireProgress(id, 'seq-progress-wrap', 'seq-progress-fill', 'seq-progress-label');
  document.getElementById('seq-run-btn').disabled = true;
  document.getElementById('seq-result').innerHTML = '';

  const res = await window.api.imagesToVideo({
    jobId: id, files: seqFiles, fps, durationSeconds: duration, mode,
    width, height, quality, format, output: outPath,
  });

  off();
  document.getElementById('seq-run-btn').disabled = false;
  const resultEl = document.getElementById('seq-result');
  if (res.success) {
    resultEl.innerHTML = `<span class="ok">✓ Rendered ${fmtDuration(res.durationSeconds)} video, ${fmtBytes(res.sizeBytes)}</span>
      <button class="path-btn" id="seq-reveal">Show in folder</button>`;
    document.getElementById('seq-reveal').addEventListener('click', () => window.api.revealFile(res.output));
  } else {
    resultEl.innerHTML = `<span class="err">✗ ${res.error}</span>`;
  }
});

// =====================================================================
// VIDEO / AUDIO
// =====================================================================
let videoFile = null;
document.getElementById('video-pick-btn').addEventListener('click', async () => {
  const files = await window.api.pickFiles({ multi: false });
  if (files.length) {
    videoFile = files[0];
    document.getElementById('video-filename').textContent = videoFile.split(/[\\/]/).pop();
    document.getElementById('video-run-btn').disabled = false;
  }
});
document.getElementById('video-crf').addEventListener('input', (e) => {
  document.getElementById('video-crf-val').textContent = e.target.value;
});
document.getElementById('video-run-btn').addEventListener('click', async () => {
  if (!videoFile) return;
  const format = document.getElementById('video-format').value;
  const outPath = await window.api.pickSavePath({ defaultName: `output.${format}` });
  if (!outPath) return;

  const audioOnly = ['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(format);
  const codecMap = { mp4: 'libx264', mkv: 'libx264', mov: 'libx264', avi: 'mpeg4', webm: 'libvpx-vp9', gif: null };
  const acodecMap = { mp3: 'libmp3lame', aac: 'aac', ogg: 'libvorbis', flac: 'flac', wav: 'pcm_s16le' };

  const id = jobId();
  const off = wireProgress(id, 'video-progress-wrap', 'video-progress-fill', 'video-progress-label');
  document.getElementById('video-run-btn').disabled = true;
  document.getElementById('video-result').innerHTML = '';

  const res = await window.api.ffmpegConvert({
    jobId: id, input: videoFile, output: outPath,
    videoCodec: audioOnly ? null : codecMap[format],
    audioCodec: audioOnly ? acodecMap[format] : 'aac',
    crf: audioOnly ? null : parseInt(document.getElementById('video-crf').value, 10),
    audioBitrate: audioOnly ? parseInt(document.getElementById('video-abr').value, 10) : parseInt(document.getElementById('video-abr').value, 10),
  });

  off();
  document.getElementById('video-run-btn').disabled = false;
  const resultEl = document.getElementById('video-result');
  if (res.success) {
    resultEl.innerHTML = `<span class="ok">✓ Done — ${fmtBytes(res.sizeBytes)}</span> <button class="path-btn" id="video-reveal">Show in folder</button>`;
    document.getElementById('video-reveal').addEventListener('click', () => window.api.revealFile(res.output));
  } else {
    resultEl.innerHTML = `<span class="err">✗ ${res.error}</span>`;
  }
});

// =====================================================================
// IMAGES
// =====================================================================
let imgFiles = [];
document.getElementById('img-pick-btn').addEventListener('click', async () => {
  const files = await window.api.pickFiles({
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp', 'gif'] }],
  });
  if (files.length) {
    imgFiles = files;
    document.getElementById('img-count').textContent = `${files.length} images selected`;
    document.getElementById('img-run-btn').disabled = false;
  }
});
document.getElementById('img-quality').addEventListener('input', (e) => {
  document.getElementById('img-quality-val').textContent = e.target.value;
});
document.getElementById('img-run-btn').addEventListener('click', async () => {
  if (!imgFiles.length) return;
  const outDir = await window.api.pickFolder();
  if (!outDir) return;
  const id = jobId();
  const off = wireProgress(id, 'img-progress-wrap', 'img-progress-fill', 'img-progress-label');
  document.getElementById('img-run-btn').disabled = true;
  document.getElementById('img-result').innerHTML = '';

  const res = await window.api.imageConvertBatch({
    jobId: id, files: imgFiles, outputDir: outDir,
    format: document.getElementById('img-format').value,
    resizePct: parseInt(document.getElementById('img-resize-pct').value, 10) || null,
    jpegQuality: parseInt(document.getElementById('img-quality').value, 10),
    magickCmd: toolStatus.magickCmd,
  });

  off();
  document.getElementById('img-run-btn').disabled = false;
  const resultEl = document.getElementById('img-result');
  const okCount = res.results.filter((r) => r.ok).length;
  resultEl.innerHTML = `<span class="ok">✓ Converted ${okCount}/${res.results.length}</span> <button class="path-btn" id="img-reveal">Open folder</button>`;
  document.getElementById('img-reveal').addEventListener('click', () => window.api.revealFile(res.results[0]?.outPath || outDir));
});

// =====================================================================
// DOCUMENTS
// =====================================================================
let docFile = null;
document.getElementById('doc-pick-btn').addEventListener('click', async () => {
  const files = await window.api.pickFiles({ multi: false });
  if (files.length) {
    docFile = files[0];
    document.getElementById('doc-filename').textContent = docFile.split(/[\\/]/).pop();
    document.getElementById('doc-run-btn').disabled = false;
  }
});
document.getElementById('doc-run-btn').addEventListener('click', async () => {
  if (!docFile) return;
  const format = document.getElementById('doc-format').value;
  const outPath = await window.api.pickSavePath({ defaultName: `output.${format}` });
  if (!outPath) return;
  const id = jobId();
  const off = wireProgress(id, 'doc-progress-wrap', 'doc-progress-fill', 'doc-progress-label');
  document.getElementById('doc-run-btn').disabled = true;
  document.getElementById('doc-result').innerHTML = '';

  const res = await window.api.pandocConvert({ jobId: id, input: docFile, output: outPath });

  off();
  document.getElementById('doc-run-btn').disabled = false;
  const resultEl = document.getElementById('doc-result');
  if (res.success) {
    resultEl.innerHTML = `<span class="ok">✓ Done — ${fmtBytes(res.sizeBytes)}</span> <button class="path-btn" id="doc-reveal">Show in folder</button>`;
    document.getElementById('doc-reveal').addEventListener('click', () => window.api.revealFile(res.output));
  } else {
    resultEl.innerHTML = `<span class="err">✗ ${res.error}</span>`;
  }
});

// =====================================================================
// GEOSPATIAL
// =====================================================================
let geoFile = null;
document.getElementById('geo-pick-btn').addEventListener('click', async () => {
  const files = await window.api.pickFiles({ multi: false });
  if (files.length) {
    geoFile = files[0];
    document.getElementById('geo-filename').textContent = geoFile.split(/[\\/]/).pop();
    document.getElementById('geo-run-btn').disabled = false;
  }
});
document.getElementById('geo-run-btn').addEventListener('click', async () => {
  if (!geoFile) return;
  const format = document.getElementById('geo-format').value;
  const outPath = await window.api.pickSavePath({ defaultName: `output.${format}` });
  if (!outPath) return;
  const id = jobId();
  const off = wireProgress(id, 'geo-progress-wrap', 'geo-progress-fill', 'geo-progress-label');
  document.getElementById('geo-run-btn').disabled = true;
  document.getElementById('geo-result').innerHTML = '';

  const res = await window.api.geoConvert({
    jobId: id, input: geoFile, output: outPath,
    targetCrs: document.getElementById('geo-crs').value || null,
    pythonCmd: toolStatus.pythonCmd,
  });

  off();
  document.getElementById('geo-run-btn').disabled = false;
  const resultEl = document.getElementById('geo-result');
  if (res.success) {
    resultEl.innerHTML = `<span class="ok">✓ Done — ${fmtBytes(res.sizeBytes)}</span> <button class="path-btn" id="geo-reveal">Show in folder</button>`;
    document.getElementById('geo-reveal').addEventListener('click', () => window.api.revealFile(res.output));
  } else {
    resultEl.innerHTML = `<span class="err">✗ ${res.error}</span>`;
  }
});
