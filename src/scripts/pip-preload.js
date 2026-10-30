const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pipApi', {
  close: () => ipcRenderer.invoke('pip-close'),
  setOpacity: (val) => ipcRenderer.invoke('pip-set-opacity', val),
  setSize: (w, h) => ipcRenderer.invoke('pip-set-size', { width: w, height: h }),
  togglePin: () => ipcRenderer.invoke('pip-toggle-pin'),
  showContextMenu: (opts) => ipcRenderer.invoke('pip-context-menu', opts),
  onInit: (cb) => {
    ipcRenderer.on('pip-init', (_e, data) => cb(data));
  },
  onStateUpdate: (cb) => {
    ipcRenderer.on('pip-state-update', (_e, state) => cb(state));
  },
  sendVideoAction: (action, val) => ipcRenderer.send('pip-video-action', { action, val }),
});
