// LogicBrowser — main process
// a cozy chromium (electron) browser themed after logicmeow.co.uk

const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  session,
  protocol,
  net,
  shell,
  clipboard,
  dialog,
  nativeTheme,
  desktopCapturer,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { downloadAndInstallExtension, downloadAndInstallFirefoxExtension, loadAllExtensions } = require('./extensions');

app.setName('LogicBrowser');
nativeTheme.themeSource = 'dark';

const SEARCH_URL = 'https://logicmeow.co.uk/search.cat?q=';
const SUGGEST_URL = 'https://logicmeow.co.uk/api/search/suggestions?q=';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const PARTITION = 'persist:logic';
const EXTENSIONS_DIR = () => path.join(app.getPath('userData'), 'extensions');

// Look like standard modern Google Chrome
const CHROME_VERSION = process.versions.chrome || '130.0.6723.117';
const USER_AGENT =
  `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) ` +
  `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
app.userAgentFallback = USER_AGENT;

// Enable smooth media playback, hardware codecs, and unblocked autoplay (e.g. YouTube playlists)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,AudioServiceOutOfProcess');

// ---------------------------------------------------------------------------
// tiny json store (settings, bookmarks, history)
// ---------------------------------------------------------------------------
const storePath = () => path.join(app.getPath('userData'), 'logicbrowser.json');
const defaults = {
  settings: {
    adblock: true,
    compactMode: false,
    showBookmarksBar: true,
    disabledExtensions: [],
  },
  bookmarks: [
    { title: 'logicmeow', url: 'https://logicmeow.co.uk/' },
    { title: 'search.cat', url: 'https://logicmeow.co.uk/search.cat' },
    { title: 'github', url: 'https://github.com/' },
    { title: 'youtube', url: 'https://www.youtube.com/' },
    { title: 'wikipedia', url: 'https://en.wikipedia.org/' },
    { title: 'reddit', url: 'https://www.reddit.com/' },
  ],
  history: [],
};
let store = structuredClone(defaults);
function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    store = { ...structuredClone(defaults), ...raw, settings: { ...defaults.settings, ...(raw.settings || {}) } };
  } catch {
    store = structuredClone(defaults);
  }
}
let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(storePath(), JSON.stringify(store, null, 2));
    } catch (e) {
      console.error('failed to save store', e);
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// extension helpers
// ---------------------------------------------------------------------------
function getInstalledExtensionsList() {
  const dir = EXTENSIONS_DIR();
  if (!fs.existsSync(dir)) return [];
  const disabled = store.settings.disabledExtensions || [];
  const list = [];
  for (const id of fs.readdirSync(dir)) {
    const mfPath = path.join(dir, id, 'manifest.json');
    if (!fs.existsSync(mfPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
      const popup = m.action?.default_popup || m.browser_action?.default_popup || '';
      let iconRel = m.action?.default_icon || m.icons;
      if (typeof iconRel === 'object') {
        iconRel = iconRel['32'] || iconRel['48'] || iconRel['16'] || Object.values(iconRel)[0];
      }
      let iconData = null;
      if (iconRel) {
        const iconFile = path.join(dir, id, String(iconRel).replace(/^\//, ''));
        if (fs.existsSync(iconFile)) {
          const b64 = fs.readFileSync(iconFile).toString('base64');
          iconData = `data:image/png;base64,${b64}`;
        }
      }
      list.push({
        id,
        name: m.name,
        version: m.version,
        description: m.description || '',
        popupUrl: popup ? `chrome-extension://${id}/${popup.replace(/^\//, '')}` : null,
        iconData,
        enabled: !disabled.includes(id),
      });
    } catch {}
  }
  return list;
}

async function toggleExtensionById(id) {
  store.settings.disabledExtensions = store.settings.disabledExtensions || [];
  const ses = session.fromPartition(PARTITION);
  const wasDisabled = store.settings.disabledExtensions.includes(id);
  if (wasDisabled) {
    store.settings.disabledExtensions = store.settings.disabledExtensions.filter((x) => x !== id);
    try {
      await ses.loadExtension(path.join(EXTENSIONS_DIR(), id), { allowFileAccess: true });
    } catch (e) {
      console.error('failed to re-enable extension', e);
    }
  } else {
    store.settings.disabledExtensions.push(id);
    try {
      ses.removeExtension(id);
    } catch (e) {
      console.error('failed to remove extension from session', e);
    }
  }
  saveStore();
  return wasDisabled;
}

async function uninstallExtensionById(id) {
  store.settings.disabledExtensions = (store.settings.disabledExtensions || []).filter((x) => x !== id);
  const ses = session.fromPartition(PARTITION);
  try { ses.removeExtension(id); } catch {}
  const dir = path.join(EXTENSIONS_DIR(), id);
  if (fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.error(e); }
  }
  saveStore();
  return true;
}

function isNewerVersion(remote, local) {
  const r = (remote || '').replace(/^v/, '').split('.').map(Number);
  const l = (local || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function checkForAppUpdates() {
  try {
    const res = await net.fetch('https://api.github.com/repos/Nicky-LogicMeow/logicbrowser/releases/latest', {
      headers: { 'User-Agent': 'LogicBrowser-Updater', Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) {
      if (res.status === 404) {
        return { hasUpdate: false, currentVersion: app.getVersion(), message: 'no releases published yet on github' };
      }
      return { hasUpdate: false, currentVersion: app.getVersion(), error: `http ${res.status}` };
    }
    const release = await res.json();
    const latestVersion = (release.tag_name || '').replace(/^v/, '');
    const currentVersion = app.getVersion();
    const hasUpdate = isNewerVersion(latestVersion, currentVersion);
    const platform = process.platform;
    const assets = release.assets || [];
    let downloadAsset = null;
    if (platform === 'darwin') {
      downloadAsset = assets.find((a) => a.name.endsWith('.dmg'));
    } else if (platform === 'win32') {
      downloadAsset = assets.find((a) => a.name.endsWith('.exe')) || assets.find((a) => a.name.endsWith('.zip'));
    }

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseName: release.name || release.tag_name,
      notes: release.body || '',
      releaseUrl: release.html_url,
      downloadUrl: downloadAsset ? downloadAsset.browser_download_url : release.html_url,
      assetName: downloadAsset ? downloadAsset.name : null,
    };
  } catch (err) {
    return { hasUpdate: false, currentVersion: app.getVersion(), error: err.message };
  }
}

// ---------------------------------------------------------------------------
// logic:// internal pages (newtab, history, extensions, bookmarks, error)
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: 'logic', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function registerLogicProtocol(ses) {
  if (ses.protocol.isProtocolHandled && ses.protocol.isProtocolHandled('logic')) return;
  ses.protocol.handle('logic', async (req) => {
    const url = new URL(req.url);
    const json = (data) =>
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });

    if (url.host === 'api') {
      if (url.pathname === '/bookmarks') return json(store.bookmarks);
      if (url.pathname === '/history') return json(store.history);
      if (url.pathname === '/history/delete') {
        const at = Number(url.searchParams.get('at'));
        const u = url.searchParams.get('url');
        store.history = store.history.filter((h) => (at ? h.at !== at : h.url !== u));
        saveStore();
        return json({ ok: true, history: store.history });
      }
      if (url.pathname === '/history/clear') {
        store.history = [];
        saveStore();
        return json({ ok: true });
      }
      if (url.pathname === '/extensions') {
        return json(getInstalledExtensionsList());
      }
      if (url.pathname === '/extensions/toggle') {
        const id = url.searchParams.get('id');
        if (id) {
          const nowEnabled = await toggleExtensionById(id);
          return json({ ok: true, enabled: nowEnabled });
        }
        return json({ error: 'missing id' });
      }
      if (url.pathname === '/extensions/uninstall') {
        const id = url.searchParams.get('id');
        if (id) {
          await uninstallExtensionById(id);
          return json({ ok: true });
        }
        return json({ error: 'missing id' });
      }
      if (url.pathname === '/extensions/install') {
        const q = url.searchParams.get('id') || '';
        try {
          let id = q.trim();
          const match = id.match(/\/detail\/(?:[^\/]+\/)?([a-z]{32})/i) || id.match(/^([a-z]{32})$/i);
          if (match) id = match[1];
          else throw new Error('invalid chrome extension id or web store url');
          const ext = await downloadAndInstallExtension(id, EXTENSIONS_DIR(), session.fromPartition(PARTITION));
          return json({ ok: true, extension: { id: ext.id, name: ext.name, version: ext.version } });
        } catch (e) {
          return json({ ok: false, error: e.message });
        }
      }
      if (url.pathname === '/extensions/install-firefox') {
        const u = url.searchParams.get('url') || '';
        try {
          const ext = await downloadAndInstallFirefoxExtension(u, EXTENSIONS_DIR(), session.fromPartition(PARTITION));
          return json({ ok: true, extension: { id: ext.id, name: ext.name, version: ext.version } });
        } catch (e) {
          return json({ ok: false, error: e.message });
        }
      }
      if (url.pathname === '/updates/check') {
        return json(await checkForAppUpdates());
      }
      if (url.pathname === '/suggest') return json(await fetchSuggestions(url.searchParams.get('q') || ''));
      if (url.pathname === '/stats') return json({ blocked: totalBlocked, version: app.getVersion() });
      return new Response('not found', { status: 404 });
    }

    const pages = {
      newtab: 'newtab.html',
      error: 'error.html',
      history: 'history.html',
      extensions: 'extensions.html',
      bookmarks: 'bookmarks.html',
      settings: 'settings.html',
      pip: 'pip.html',
    };
    let file = url.pathname === '/' || url.pathname === '' ? pages[url.host] : url.pathname.slice(1);
    if (!file) return new Response('not found', { status: 404 });
    const full = path.normalize(path.join(RENDERER_DIR, file));
    if (!full.startsWith(RENDERER_DIR)) return new Response('nope', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
}

// ---------------------------------------------------------------------------
// search suggestions (logicmeow with instant Google fallback)
// ---------------------------------------------------------------------------
async function fetchSuggestions(q) {
  q = (q || '').trim();
  if (!q) return [];
  const results = [];
  const seen = new Set();

  const add = (phrase) => {
    if (!phrase || typeof phrase !== 'string') return;
    const clean = phrase.trim();
    const lower = clean.toLowerCase();
    if (clean.length > 0 && !seen.has(lower)) {
      seen.add(lower);
      results.push(clean);
    }
  };

  // 1. Google Suggest (ultra fast & accurate)
  const pGoogle = (async () => {
    try {
      const gRes = await net.fetch(
        `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': USER_AGENT } }
      );
      const gData = await gRes.json();
      if (Array.isArray(gData) && Array.isArray(gData[1])) {
        for (const s of gData[1]) add(s);
      }
    } catch {}
  })();

  // 2. DuckDuckGo Autocomplete
  const pDdg = (async () => {
    try {
      const dRes = await net.fetch(
        `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`
      );
      const dData = await dRes.json();
      if (Array.isArray(dData) && Array.isArray(dData[1])) {
        for (const s of dData[1]) add(s);
      }
    } catch {}
  })();

  // 3. Logicmeow Suggest
  const pLogic = (async () => {
    try {
      const res = await net.fetch(SUGGEST_URL + encodeURIComponent(q));
      const data = await res.json();
      if (Array.isArray(data.phrases)) {
        for (const s of data.phrases) add(s);
      } else if (Array.isArray(data.suggestions)) {
        for (const item of data.suggestions) {
          add(typeof item === 'string' ? item : item.phrase || item.title || item.text);
        }
      }
    } catch {}
  })();

  await Promise.allSettled([pGoogle, pDdg, pLogic]);

  return results.slice(0, 16);
}

// ---------------------------------------------------------------------------
// ad + tracker blocking (ghostery engine, same lists as uBlock-ish)
// ---------------------------------------------------------------------------
let blocker = null;
let totalBlocked = 0;
const blockedPerTab = new Map(); // webContentsId -> count
const sessionsSeen = new Set();

async function initBlocker() {
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const cache = path.join(app.getPath('userData'), 'adblock-engine.bin');
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cache,
      read: fs.promises.readFile,
      write: fs.promises.writeFile,
    });
    blocker.on('request-blocked', (request) => {
      totalBlocked++;
      const id = request.tabId;
      if (id != null) {
        blockedPerTab.set(id, (blockedPerTab.get(id) || 0) + 1);
        mainWindow?.webContents.send('blocked', { webContentsId: id, count: blockedPerTab.get(id), total: totalBlocked });
      }
    });
    for (const ses of sessionsSeen) applyBlocker(ses);
  } catch (e) {
    console.error('[logicbrowser] adblocker failed to start:', e.message);
  }
}

const blockedSessions = new Set();

function isBypassedUrl(u) {
  // Let essential video playback streams and player telemetry pass through
  // so YouTube, Google Video, and media buffers stream smoothly without anti-adblock loops
  return /youtube\.com|googlevideo\.com|ytimg\.com|youtu\.be/i.test(u);
}

function applyBlocker(ses) {
  if (!blocker) return;
  try {
    if (store.settings.adblock) {
      if (!blockedSessions.has(ses)) {
        blockedSessions.add(ses);

        ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
          if (isBypassedUrl(details.url)) {
            return callback({ cancel: false });
          }
          blocker.onBeforeRequest(details, callback);
        });

        ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
          if (isBypassedUrl(details.url)) {
            return callback({ responseHeaders: details.responseHeaders });
          }
          blocker.onHeadersReceived(details, callback);
        });
      }
    } else if (blockedSessions.has(ses)) {
      blockedSessions.delete(ses);
      ses.webRequest.onBeforeRequest(null);
      ses.webRequest.onHeadersReceived(null);
    }
  } catch (e) {
    console.error('adblock toggle error', e.message);
  }
}

// ---------------------------------------------------------------------------
// session setup — shared by the main profile and private (incognito) tabs
// ---------------------------------------------------------------------------
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-read',
  'clipboard-sanitized-write',
  'pointerLock',
  'media',
  'mediaKeySystem',
  'camera',
  'microphone',
  'notifications',
  'geolocation',
  'midi',
  'midiSysex',
  'window-management',
  'idle-detection',
  'display-capture',
  'screen-wake-lock',
  'usb',
  'smart-card',
  'sensors',
  'storage-access',
  'top-level-storage-access',
]);

let pendingScreenshareCallback = null;

function setupSession(ses) {
  if (sessionsSeen.has(ses)) return;
  sessionsSeen.add(ses);
  ses.setUserAgent(USER_AGENT);
  registerLogicProtocol(ses);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  // Screensharing request handler (Discord, Google Meet, Teams, etc.)
  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 360, height: 200 },
          fetchWindowIcons: true,
        });
        if (!sources || !sources.length) return callback(null);

        if (mainWindow && !mainWindow.isDestroyed()) {
          pendingScreenshareCallback = callback;
          const serializable = sources.map((s) => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
            appIcon: s.appIcon ? s.appIcon.toDataURL() : '',
            isScreen: s.id.startsWith('screen:'),
          }));
          mainWindow.webContents.send('show-screenshare-picker', serializable);
          return;
        }
        callback({ video: sources[0] });
      } catch (err) {
        console.error('screenshare request error:', err);
        callback(null);
      }
    });
  }

  // Passkey / WebAuthn account and authenticator selection
  ses.on('select-webauthn-account', (_event, details, callback) => {
    try {
      const accounts = details?.accounts || [];
      if (accounts.length > 0) {
        callback(accounts[0].credentialId);
      } else {
        callback(null);
      }
    } catch {
      callback(null);
    }
  });

  ses.on('select-webauthn-authenticator', (event, callback) => {
    try {
      const auths = event?.authenticators || [];
      if (auths.includes('touchID')) {
        callback('touchID');
      } else if (auths.includes('platformPasskeys')) {
        callback('platformPasskeys');
      } else if (auths.length > 0) {
        callback(auths[0]);
      } else {
        callback(null);
      }
    } catch {
      callback(null);
    }
  });

  // Standard Chrome client hints and headers
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    const major = CHROME_VERSION.split('.')[0];
    h['User-Agent'] = USER_AGENT;
    if (h['sec-ch-ua']) {
      h['sec-ch-ua'] = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
    }
    if (h['sec-ch-ua-mobile']) h['sec-ch-ua-mobile'] = '?0';
    if (h['sec-ch-ua-platform']) {
      h['sec-ch-ua-platform'] = `"${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'}"`;
    }
    // Google sign-in strictly checks and flags DNT / GPC headers as automation bots
    const isGoogle = /accounts\.google\.com|google\.com\/signin/i.test(details.url);
    if (isGoogle) {
      delete h['DNT'];
      delete h['Sec-GPC'];
    } else {
      h['DNT'] = '1';
      h['Sec-GPC'] = '1';
    }
    cb({ requestHeaders: h });
  });

  ses.on('will-download', (_e, item) => {
    const id = Date.now() + Math.random();
    const name = item.getFilename();
    const send = (state) =>
      mainWindow?.webContents.send('download', {
        id,
        name,
        state,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        path: item.getSavePath(),
      });
    item.setSavePath(uniquePath(path.join(app.getPath('downloads'), name)));
    item.on('updated', (_e, state) => send(state));
    item.once('done', (_e, state) => send(state));
    send('started');
  });

  applyBlocker(ses);
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; ; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
}

app.on('session-created', (ses) => setupSession(ses));

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------
let mainWindow = null;
let uiReady = false;
const pendingUrls = [];

ipcMain.on('ui-ready', () => {
  uiReady = true;
  while (pendingUrls.length) send('open-url', pendingUrls.shift());
});
function openExternalUrl(url) {
  if (mainWindow && uiReady) send('open-url', url);
  else pendingUrls.push(url);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 640,
    minHeight: 420,
    title: 'LogicBrowser',
    backgroundColor: '#1e1e2e',
    icon: path.join(RENDERER_DIR, 'assets', 'icon-192.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    titleBarOverlay: isMac ? undefined : { color: '#181825', symbolColor: '#cdd6f4', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));
  mainWindow.webContents.on('did-start-loading', () => (uiReady = false));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window-fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window-fullscreen', false));
  mainWindow.on('closed', () => (mainWindow = null));

  // dev helper: LOGIC_SCREENSHOT=/path/out.png npm start  -> saves a screenshot and quits
  if (process.env.LOGIC_SCREENSHOT) {
    setTimeout(async () => {
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(process.env.LOGIC_SCREENSHOT, img.toPNG());
      app.quit();
    }, Number(process.env.LOGIC_SCREENSHOT_DELAY || 6000));
  }
}

const send = (cmd, ...args) => mainWindow?.webContents.send('command', cmd, ...args);

// ---------------------------------------------------------------------------
// webview hardening + popups + context menu
// ---------------------------------------------------------------------------
app.on('web-contents-created', (_e, contents) => {
  // lock down any <webview> the UI tries to attach
  contents.on('will-attach-webview', (_ev, webPreferences, params) => {
    webPreferences.preload = path.join(__dirname, 'scripts', 'stealth.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = false;
    webPreferences.plugins = true;
    if (params.src && !/^(https?|logic|about|data|file):/i.test(params.src)) _ev.preventDefault();
  });

  if (contents.getType() !== 'webview') {
    // allow extension popups and other internal windows to open new tabs
    contents.setWindowOpenHandler(({ url, disposition }) => {
      send('open-url', url, { background: disposition === 'background-tab' });
      return { action: 'deny' };
    });
    return;
  }

  contents.setWindowOpenHandler(({ url, disposition }) => {
    send('open-url', url, { background: disposition === 'background-tab', from: contents.id });
    return { action: 'deny' };
  });

  contents.on('context-menu', (_ev, p) => {
    const items = [];
    if (p.linkURL) {
      items.push(
        { label: 'open link in new tab', click: () => send('open-url', p.linkURL, { background: true }) },
        { label: 'open link in private tab', click: () => send('open-url', p.linkURL, { private: true }) },
        { label: 'copy link', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' }
      );
    }
    if (p.hasImageContents && p.srcURL) {
      items.push(
        { label: 'open image in new tab', click: () => send('open-url', p.srcURL, { background: true }) },
        { label: 'save image', click: () => contents.downloadURL(p.srcURL) },
        { label: 'copy image', click: () => contents.copyImageAt(p.x, p.y) },
        { label: 'copy image address', click: () => clipboard.writeText(p.srcURL) },
        { type: 'separator' }
      );
    }
    if (p.mediaType === 'video' || p.mediaType === 'audio') {
      items.push(
        { label: 'floating video overlay (pip)', click: () => send('command', 'pip') },
        { label: 'copy media address', click: () => clipboard.writeText(p.srcURL) },
        { type: 'separator' }
      );
    }
    if (p.selectionText && !p.isEditable) {
      const sel = p.selectionText.trim().slice(0, 40);
      items.push(
        { label: 'copy', role: 'copy' },
        { label: `search.cat for "${sel}${p.selectionText.length > 40 ? '…' : ''}"`, click: () => send('open-url', SEARCH_URL + encodeURIComponent(p.selectionText.trim())) },
        { type: 'separator' }
      );
    }
    if (p.isEditable) {
      for (const s of (p.dictionarySuggestions || []).slice(0, 4)) items.push({ label: s, click: () => contents.replaceMisspelling(s) });
      if (p.dictionarySuggestions?.length) items.push({ type: 'separator' });
      items.push(
        { label: 'cut', role: 'cut' },
        { label: 'copy', role: 'copy' },
        { label: 'paste', role: 'paste' },
        { label: 'select all', role: 'selectAll' },
        { type: 'separator' }
      );
    }
    items.push(
      { label: 'back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: 'forward', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
      { label: 'reload', click: () => contents.reload() },
      { type: 'separator' },
      { label: 'inspect', click: () => contents.inspectElement(p.x, p.y) }
    );
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
});

// ---------------------------------------------------------------------------
// browser data import & export helpers
// ---------------------------------------------------------------------------
function getAvailableBrowsers() {
  const home = app.getPath('home');
  const available = [];
  const candidates =
    process.platform === 'darwin'
      ? [
          { id: 'chrome', name: 'google chrome', path: path.join(home, 'Library/Application Support/Google/Chrome/Default/Bookmarks') },
          { id: 'brave', name: 'brave browser', path: path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks') },
          { id: 'edge', name: 'microsoft edge', path: path.join(home, 'Library/Application Support/Microsoft Edge/Default/Bookmarks') },
        ]
      : process.platform === 'win32'
      ? [
          { id: 'chrome', name: 'google chrome', path: path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data/Default/Bookmarks') },
          { id: 'brave', name: 'brave browser', path: path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware/Brave-Browser/User Data/Default/Bookmarks') },
          { id: 'edge', name: 'microsoft edge', path: path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/User Data/Default/Bookmarks') },
        ]
      : [
          { id: 'chrome', name: 'google chrome', path: path.join(home, '.config/google-chrome/Default/Bookmarks') },
          { id: 'brave', name: 'brave browser', path: path.join(home, '.config/BraveSoftware/Brave-Browser/Default/Bookmarks') },
          { id: 'edge', name: 'microsoft edge', path: path.join(home, '.config/microsoft-edge/Default/Bookmarks') },
        ];

  for (const c of candidates) {
    if (fs.existsSync(c.path)) {
      available.push({ id: c.id, name: c.name, path: c.path });
    }
  }
  return available;
}

function parseChromiumBookmarks(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const bookmarks = [];
    function walk(node) {
      if (!node) return;
      if (node.type === 'url' && node.url && /^https?:/i.test(node.url)) {
        bookmarks.push({ title: (node.name || node.url).trim(), url: node.url });
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child);
      }
    }
    if (raw.roots) {
      for (const k of Object.keys(raw.roots)) walk(raw.roots[k]);
    }
    return bookmarks;
  } catch (err) {
    console.error('failed to parse chromium bookmarks:', err);
    return [];
  }
}

function parseHtmlBookmarks(content) {
  const bookmarks = [];
  const regex = /<A\s+[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const url = match[1];
    const title = match[2] ? match[2].trim() : url;
    if (/^https?:/i.test(url)) {
      bookmarks.push({ title, url });
    }
  }
  return bookmarks;
}

// ---------------------------------------------------------------------------
// ipc from the browser UI
// ---------------------------------------------------------------------------
ipcMain.on('screenshare-picked', async (_e, sourceId) => {
  if (!pendingScreenshareCallback) return;
  const cb = pendingScreenshareCallback;
  pendingScreenshareCallback = null;
  if (!sourceId) {
    cb(null);
    return;
  }
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const match = sources.find((s) => s.id === sourceId) || sources[0];
    if (match) cb({ video: match });
    else cb(null);
  } catch {
    cb(null);
  }
});

ipcMain.handle('install-extension', async (_e, idOrUrl) => {
  let id = idOrUrl.trim();
  const match = id.match(/\/detail\/(?:[^\/]+\/)?([a-z]{32})/i) || id.match(/^([a-z]{32})$/i);
  if (match) id = match[1];
  else throw new Error('invalid chrome extension id or web store url');

  const ses = session.fromPartition(PARTITION);
  const ext = await downloadAndInstallExtension(id, EXTENSIONS_DIR(), ses);
  return { id: ext.id, name: ext.name, version: ext.version };
});

ipcMain.handle('install-firefox-extension', async (_e, urlOrSlug) => {
  const ses = session.fromPartition(PARTITION);
  const ext = await downloadAndInstallFirefoxExtension(urlOrSlug, EXTENSIONS_DIR(), ses);
  return { id: ext.id, name: ext.name, version: ext.version };
});

ipcMain.handle('check-for-updates', async () => checkForAppUpdates());

ipcMain.handle('list-extensions', () => getInstalledExtensionsList());
ipcMain.handle('toggle-extension', async (_e, id) => toggleExtensionById(id));
ipcMain.handle('uninstall-extension', async (_e, id) => uninstallExtensionById(id));

let popupWindow = null;
ipcMain.handle('open-extension-popup', (_e, { popupUrl, x, y }) => {
  if (popupWindow) {
    try { popupWindow.close(); } catch {}
    popupWindow = null;
  }
  if (!popupUrl) return;

  const ses = session.fromPartition(PARTITION);
  popupWindow = new BrowserWindow({
    width: 380,
    height: 560,
    x: Math.round(x - 340),
    y: Math.round(y + 10),
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#1e1e2e',
    parent: mainWindow,
    webPreferences: {
      session: ses,
      sandbox: false,
      contextIsolation: false,
    },
  });

  popupWindow.loadURL(popupUrl);
  popupWindow.webContents.setWindowOpenHandler(({ url }) => {
    send('open-url', url);
    return { action: 'deny' };
  });
  popupWindow.once('ready-to-show', () => popupWindow?.show());
  popupWindow.on('blur', () => {
    try { popupWindow?.close(); } catch {}
    popupWindow = null;
  });
});

// ---------------------------------------------------------------------------
// floating picture-in-picture overlay (transparent, resizable, right-click menu)
// ---------------------------------------------------------------------------
let pipWindow = null;
let pipOverlayData = null;

function openPipOverlay(data) {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.close();
    pipWindow = null;
  }

  pipOverlayData = data;
  const initialOpacity = 0.94;

  pipWindow = new BrowserWindow({
    width: 520,
    height: 310,
    minWidth: 280,
    minHeight: 180,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'scripts', 'pip-preload.js'),
      sandbox: false,
      contextIsolation: true,
      plugins: true,
    },
  });

  pipWindow.setAlwaysOnTop(true, 'floating');
  pipWindow.setOpacity(initialOpacity);

  pipWindow.loadURL('logic://pip/');

  pipWindow.webContents.once('did-finish-load', () => {
    pipWindow?.webContents.send('pip-init', data);
  });

  pipWindow.on('closed', () => {
    pipWindow = null;
    pipOverlayData = null;
    mainWindow?.webContents.send('pip-closed');
  });

  return { ok: true };
}

ipcMain.handle('pip-open', (_e, data) => openPipOverlay(data));
ipcMain.handle('pip-close', () => {
  try { pipWindow?.close(); } catch {}
  pipWindow = null;
  return { ok: true };
});
ipcMain.handle('pip-set-opacity', (_e, val) => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.setOpacity(Math.max(0.2, Math.min(1.0, val)));
  }
});
ipcMain.handle('pip-set-size', (_e, { width, height }) => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.setSize(width, height);
  }
});
ipcMain.handle('pip-toggle-pin', () => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    const next = !pipWindow.isAlwaysOnTop();
    pipWindow.setAlwaysOnTop(next, 'floating');
    return next;
  }
  return false;
});

ipcMain.handle('pip-context-menu', (_e, { currentOpacity = 0.94, isPinned = true, isPaused = false, isMuted = false }) => {
  if (!pipWindow || pipWindow.isDestroyed()) return;

  const menu = Menu.buildFromTemplate([
    {
      label: isPaused ? '▶  play' : '⏸  pause',
      click: () => {
        pipWindow?.webContents.send('pip-state-update', { action: isPaused ? 'play' : 'pause' });
      },
    },
    {
      label: isMuted ? '🔊  unmute' : '🔇  mute',
      click: () => {
        pipWindow?.webContents.send('pip-state-update', { action: 'toggle-mute' });
      },
    },
    { type: 'separator' },
    {
      label: '👁  transparency',
      submenu: [
        {
          label: '100% (solid)',
          type: 'radio',
          checked: currentOpacity >= 0.98,
          click: () => {
            pipWindow?.setOpacity(1.0);
            pipWindow?.webContents.send('pip-state-update', { opacity: 1.0 });
          },
        },
        {
          label: '85% (cozy)',
          type: 'radio',
          checked: currentOpacity >= 0.80 && currentOpacity < 0.90,
          click: () => {
            pipWindow?.setOpacity(0.85);
            pipWindow?.webContents.send('pip-state-update', { opacity: 0.85 });
          },
        },
        {
          label: '70% (translucent glass)',
          type: 'radio',
          checked: currentOpacity >= 0.65 && currentOpacity < 0.80,
          click: () => {
            pipWindow?.setOpacity(0.70);
            pipWindow?.webContents.send('pip-state-update', { opacity: 0.70 });
          },
        },
        {
          label: '50% (ghost)',
          type: 'radio',
          checked: currentOpacity >= 0.45 && currentOpacity < 0.65,
          click: () => {
            pipWindow?.setOpacity(0.50);
            pipWindow?.webContents.send('pip-state-update', { opacity: 0.50 });
          },
        },
        {
          label: '35% (ultra-transparent)',
          type: 'radio',
          checked: currentOpacity < 0.45,
          click: () => {
            pipWindow?.setOpacity(0.35);
            pipWindow?.webContents.send('pip-state-update', { opacity: 0.35 });
          },
        },
      ],
    },
    {
      label: '📐  resize preset',
      submenu: [
        {
          label: 'small (380 × 214)',
          click: () => {
            pipWindow?.setSize(380, 214);
            pipWindow?.webContents.send('pip-state-update', { sizeLabel: 'sm' });
          },
        },
        {
          label: 'medium (520 × 292)',
          click: () => {
            pipWindow?.setSize(520, 292);
            pipWindow?.webContents.send('pip-state-update', { sizeLabel: 'med' });
          },
        },
        {
          label: 'large (720 × 405)',
          click: () => {
            pipWindow?.setSize(720, 405);
            pipWindow?.webContents.send('pip-state-update', { sizeLabel: 'lg' });
          },
        },
        {
          label: 'huge (960 × 540)',
          click: () => {
            pipWindow?.setSize(960, 540);
            pipWindow?.webContents.send('pip-state-update', { sizeLabel: 'huge' });
          },
        },
      ],
    },
    { type: 'separator' },
    {
      label: '📌  always on top',
      type: 'checkbox',
      checked: pipWindow.isAlwaysOnTop(),
      click: (item) => {
        pipWindow?.setAlwaysOnTop(item.checked, 'floating');
        pipWindow?.webContents.send('pip-state-update', { alwaysOnTop: item.checked });
      },
    },
    {
      label: '✕  close overlay',
      click: () => {
        try { pipWindow?.close(); } catch {}
      },
    },
  ]);

  menu.popup({ window: pipWindow });
});

ipcMain.handle('tab-context-menu', (_e, { tabId, url, isMuted, isPrivate }) => {
  const menu = Menu.buildFromTemplate([
    { label: 'reload', click: () => send('command', 'reload-tab', tabId) },
    { label: 'duplicate tab', click: () => send('open-url', url, { private: isPrivate }) },
    { label: isMuted ? '🔊  unmute tab' : '🔇  mute tab', click: () => send('command', 'toggle-mute-tab', tabId) },
    { label: 'pin video to overlay (pip)', click: () => send('command', 'pip') },
    { type: 'separator' },
    { label: 'close tab', click: () => send('command', 'close-tab-by-id', tabId) },
    { label: 'close other tabs', click: () => send('command', 'close-other-tabs', tabId) },
  ]);
  menu.popup({ window: mainWindow });
});

ipcMain.handle('get-state', () => ({
  settings: store.settings,
  bookmarks: store.bookmarks,
  platform: process.platform,
  searchUrl: SEARCH_URL,
  partition: PARTITION,
  version: app.getVersion(),
  chrome: CHROME_VERSION,
  totalBlocked,
}));
ipcMain.handle('suggest', (_e, q) => fetchSuggestions(q));

ipcMain.handle('history-search', (_e, q) => {
  q = (q || '').toLowerCase();
  if (!q) return [];
  return store.history.filter((h) => h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)).slice(0, 5);
});
ipcMain.handle('history-get', (_e, q) => {
  if (!q) return store.history;
  const lower = q.toLowerCase();
  return store.history.filter((h) => h.url.toLowerCase().includes(lower) || (h.title || '').toLowerCase().includes(lower));
});
ipcMain.handle('history-delete', (_e, target) => {
  if (typeof target === 'number') {
    store.history = store.history.filter((h) => h.at !== target);
  } else if (typeof target === 'string') {
    store.history = store.history.filter((h) => h.url !== target);
  }
  saveStore();
  return store.history;
});
ipcMain.handle('history-clear', () => {
  store.history = [];
  saveStore();
  return true;
});
ipcMain.on('history-add', (_e, entry) => {
  if (!entry?.url || !/^https?:/.test(entry.url)) return;
  store.history = [{ ...entry, at: Date.now() }, ...store.history.filter((h) => h.url !== entry.url)].slice(0, 1000);
  saveStore();
});

ipcMain.handle('bookmark-toggle', (_e, { url, title }) => {
  const i = store.bookmarks.findIndex((b) => b.url === url);
  if (i >= 0) store.bookmarks.splice(i, 1);
  else store.bookmarks.push({ url, title: title || url });
  saveStore();
  return store.bookmarks;
});

ipcMain.handle('get-import-browsers', () => getAvailableBrowsers());

ipcMain.handle('import-browser', (_e, browserId) => {
  const list = getAvailableBrowsers();
  const target = list.find((b) => b.id === browserId);
  if (!target) throw new Error('browser bookmarks not found');
  const imported = parseChromiumBookmarks(target.path);
  if (!imported.length) throw new Error('no bookmarks found to import');
  let added = 0;
  for (const b of imported) {
    if (!store.bookmarks.some((existing) => existing.url === b.url)) {
      store.bookmarks.push(b);
      added++;
    }
  }
  saveStore();
  return { added, total: imported.length, browser: target.name };
});

ipcMain.handle('import-bookmarks-file', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'import bookmarks from html file',
    filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const content = fs.readFileSync(res.filePaths[0], 'utf8');
  const imported = parseHtmlBookmarks(content);
  if (!imported.length) throw new Error('no valid bookmarks found in file');
  let added = 0;
  for (const b of imported) {
    if (!store.bookmarks.some((existing) => existing.url === b.url)) {
      store.bookmarks.push(b);
      added++;
    }
  }
  saveStore();
  return { added, total: imported.length };
});

ipcMain.handle('export-bookmarks-file', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'export bookmarks to html',
    defaultPath: 'logicbrowser_bookmarks.html',
    filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const esc = (t) => String(t || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n`;
  for (const b of store.bookmarks) {
    html += `    <DT><A HREF="${esc(b.url)}">${esc(b.title || b.url)}</A>\n`;
  }
  html += `</DL><p>\n`;
  fs.writeFileSync(res.filePath, html, 'utf8');
  return res.filePath;
});

ipcMain.handle('set-setting', (_e, key, value) => {
  store.settings[key] = value;
  saveStore();
  if (key === 'adblock') for (const ses of sessionsSeen) applyBlocker(ses);
  return store.settings;
});
ipcMain.handle('clear-data', async () => {
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData();
  await ses.clearCache();
  store.history = [];
  saveStore();
  return true;
});
ipcMain.on('blocked-reset', (_e, id) => blockedPerTab.delete(id));
ipcMain.on('show-download', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('open-downloads-folder', () => shell.openPath(app.getPath('downloads')));
ipcMain.on('set-default-browser', () => {
  const ok = app.setAsDefaultProtocolClient('http') && app.setAsDefaultProtocolClient('https');
  dialog.showMessageBox(mainWindow, {
    message: ok ? 'meow! logicbrowser asked to be your default browser.' : 'could not set default browser (try the packaged app).',
  });
});

// ---------------------------------------------------------------------------
// app menu — accelerators work even when a page has focus
// ---------------------------------------------------------------------------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const c = (label, accelerator, cmd) => ({ label, accelerator, click: () => send(cmd) });
  const template = [
    ...(isMac
      ? [{
          label: 'LogicBrowser',
          submenu: [
            { role: 'about', label: 'about logicbrowser' },
            { type: 'separator' },
            c('settings…', 'Cmd+,', 'settings'),
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        c('new tab', 'CmdOrCtrl+T', 'new-tab'),
        c('new private tab', 'CmdOrCtrl+Shift+N', 'new-private-tab'),
        c('reopen closed tab', 'CmdOrCtrl+Shift+T', 'reopen-tab'),
        c('close tab', 'CmdOrCtrl+W', 'close-tab'),
        { type: 'separator' },
        c('open location', 'CmdOrCtrl+L', 'focus-address'),
        c('import bookmarks…', null, 'import-bookmarks'),
        ...(isMac ? [] : [{ type: 'separator' }, c('settings', 'Ctrl+,', 'settings'), { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        c('find in page', 'CmdOrCtrl+F', 'find'),
      ],
    },
    {
      label: 'View',
      submenu: [
        c('reload', 'CmdOrCtrl+R', 'reload'),
        c('hard reload', 'CmdOrCtrl+Shift+R', 'hard-reload'),
        { type: 'separator' },
        c('zoom in', 'CmdOrCtrl+=', 'zoom-in'),
        c('zoom out', 'CmdOrCtrl+-', 'zoom-out'),
        c('actual size', 'CmdOrCtrl+0', 'zoom-reset'),
        { type: 'separator' },
        c('toggle bookmarks bar', 'CmdOrCtrl+Shift+B', 'toggle-bookmarks-bar'),
        c('toggle compact mode', 'CmdOrCtrl+Shift+S', 'toggle-compact'),
        { role: 'togglefullscreen' },
        { type: 'separator' },
        c('developer tools', isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', 'devtools'),
        { label: 'browser ui devtools', click: () => mainWindow?.webContents.openDevTools({ mode: 'detach' }) },
      ],
    },
    {
      label: 'History',
      submenu: [
        c('show all history', isMac ? 'Cmd+Y' : 'Ctrl+H', 'open-history'),
        c('clear browsing data…', isMac ? 'Cmd+Shift+Backspace' : 'Ctrl+Shift+Delete', 'clear-data'),
        { type: 'separator' },
        c('back', 'CmdOrCtrl+[', 'back'),
        c('forward', 'CmdOrCtrl+]', 'forward'),
        c('home', 'CmdOrCtrl+Shift+H', 'home'),
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        c('bookmark this page', 'CmdOrCtrl+D', 'bookmark'),
        c('show bookmarks bar', 'CmdOrCtrl+Shift+B', 'toggle-bookmarks-bar'),
        c('import from other browsers', null, 'import-bookmarks'),
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        c('next tab', 'Ctrl+Tab', 'next-tab'),
        c('previous tab', 'Ctrl+Shift+Tab', 'prev-tab'),
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: i === 8 ? 'last tab' : `tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => send('select-tab', i),
        })),
      ],
    },
    {
      label: 'Tools',
      submenu: [
        c('extension manager', 'CmdOrCtrl+Shift+E', 'open-extensions'),
        c('history', isMac ? 'Cmd+Y' : 'Ctrl+H', 'open-history'),
        c('chrome web store', null, 'open-webstore'),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'logicmeow.co.uk', click: () => send('open-url', 'https://logicmeow.co.uk/') },
        { label: 'set as default browser', click: () => ipcMain.emit('set-default-browser') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------
app.on('open-url', (e, url) => {
  e.preventDefault();
  openExternalUrl(url);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => /^https?:\/\//.test(a));
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (url) openExternalUrl(url);
  }
});

app.whenReady().then(() => {
  loadStore();
  app.setAboutPanelOptions({
    applicationName: 'LogicBrowser',
    applicationVersion: app.getVersion(),
    version: `chromium ${CHROME_VERSION}`,
    credits: 'a small browser for big nerds. made with love by logicmeow.',
  });
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(RENDERER_DIR, 'assets', 'icon-192.png'));

  // Configure macOS Touch ID & System Keychain for WebAuthn passkeys
  if (process.platform === 'darwin' && typeof app.configureWebAuthn === 'function') {
    try {
      app.configureWebAuthn({
        touchID: {
          keychainAccessGroup: 'uk.co.logicmeow.browser',
          promptReason: 'verify your identity on $1',
        },
        platformPasskeys: true,
      });
      console.log('[webauthn] configured touchID & platformPasskeys for macOS keychain');
    } catch (err) {
      console.error('[webauthn] failed to configure WebAuthn:', err);
    }
  }

  setupSession(session.defaultSession);
  const logicSes = session.fromPartition(PARTITION);
  setupSession(logicSes);
  loadAllExtensions(EXTENSIONS_DIR(), logicSes, store.settings.disabledExtensions || []);
  buildMenu();
  createWindow();
  initBlocker();

  for (const a of process.argv.slice(1)) if (/^https?:\/\//.test(a)) openExternalUrl(a);

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
