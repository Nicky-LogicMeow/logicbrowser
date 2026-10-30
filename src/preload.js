const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logic', {
  getState: () => ipcRenderer.invoke('get-state'),
  suggest: (q) => ipcRenderer.invoke('suggest', q),
  historySearch: (q) => ipcRenderer.invoke('history-search', q),
  historyGet: (q) => ipcRenderer.invoke('history-get', q),
  historyDelete: (target) => ipcRenderer.invoke('history-delete', target),
  historyClear: () => ipcRenderer.invoke('history-clear'),
  historyAdd: (entry) => ipcRenderer.send('history-add', entry),
  toggleBookmark: (b) => ipcRenderer.invoke('bookmark-toggle', b),
  setSetting: (k, v) => ipcRenderer.invoke('set-setting', k, v),
  clearData: () => ipcRenderer.invoke('clear-data'),
  resetBlocked: (id) => ipcRenderer.send('blocked-reset', id),
  showDownload: (p) => ipcRenderer.send('show-download', p),
  openDownloadsFolder: () => ipcRenderer.send('open-downloads-folder'),
  setDefaultBrowser: () => ipcRenderer.send('set-default-browser'),
  installExtension: (idOrUrl) => ipcRenderer.invoke('install-extension', idOrUrl),
  installFirefoxExtension: (urlOrSlug) => ipcRenderer.invoke('install-firefox-extension', urlOrSlug),
  listExtensions: () => ipcRenderer.invoke('list-extensions'),
  toggleExtension: (id) => ipcRenderer.invoke('toggle-extension', id),
  uninstallExtension: (id) => ipcRenderer.invoke('uninstall-extension', id),
  openExtensionPopup: (args) => ipcRenderer.invoke('open-extension-popup', args),
  getImportBrowsers: () => ipcRenderer.invoke('get-import-browsers'),
  importBrowser: (id) => ipcRenderer.invoke('import-browser', id),
  importBookmarksFile: () => ipcRenderer.invoke('import-bookmarks-file'),
  exportBookmarksFile: () => ipcRenderer.invoke('export-bookmarks-file'),
  selectScreenshareSource: (id) => ipcRenderer.send('screenshare-picked', id),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openPip: (data) => ipcRenderer.invoke('pip-open', data),
  closePip: () => ipcRenderer.invoke('pip-close'),
  platform: process.platform,
  ready: () => ipcRenderer.send('ui-ready'),
  on: (channel, fn) => {
    const allowed = ['command', 'blocked', 'download', 'window-fullscreen', 'show-screenshare-picker', 'pip-closed'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
