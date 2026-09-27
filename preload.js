const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkTools: () => ipcRenderer.invoke('check-tools'),
  pickFiles: (opts) => ipcRenderer.invoke('pick-files', opts),
  pickImagesOrFolder: () => ipcRenderer.invoke('pick-images-or-folder'),
  pickSavePath: (opts) => ipcRenderer.invoke('pick-save-path', opts),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  revealFile: (p) => ipcRenderer.invoke('reveal-file', p),
  probeMedia: (p) => ipcRenderer.invoke('probe-media', p),

  ffmpegConvert: (opts) => ipcRenderer.invoke('ffmpeg-convert', opts),
  imagesToVideo: (opts) => ipcRenderer.invoke('images-to-video', opts),
  imageConvertBatch: (opts) => ipcRenderer.invoke('image-convert-batch', opts),
  pandocConvert: (opts) => ipcRenderer.invoke('pandoc-convert', opts),
  geoConvert: (opts) => ipcRenderer.invoke('geo-convert', opts),
  cancelJob: (jobId) => ipcRenderer.invoke('cancel-job', jobId),

  onProgress: (cb) => {
    const listener = (e, payload) => cb(payload);
    ipcRenderer.on('job-progress', listener);
    return () => ipcRenderer.removeListener('job-progress', listener);
  },
});
