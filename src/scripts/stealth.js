// Mask automation & Electron properties so Google accounts sign-in passes cleanly
(() => {
  try {
    // Delete navigator.webdriver if present
    if ('webdriver' in navigator) {
      delete Object.getPrototypeOf(navigator).webdriver;
    }

    // Mock chrome runtime object
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        connect: function () {},
        sendMessage: function () {},
      };
    }
    if (!window.chrome.extension) {
      window.chrome.extension = {
        isAllowedFileSchemeAccess: function (cb) {
          if (cb) cb(false);
          return Promise.resolve(false);
        },
      };
    } else if (!window.chrome.extension.isAllowedFileSchemeAccess) {
      window.chrome.extension.isAllowedFileSchemeAccess = function (cb) {
        if (cb) cb(false);
        return Promise.resolve(false);
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function () {
        return {
          requestTime: Date.now() / 1000,
          startLoadTime: Date.now() / 1000,
          commitLoadTime: Date.now() / 1000,
          finishDocumentLoadTime: Date.now() / 1000,
          firstPaintTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function () {
        return {
          startE: Date.now(),
          onloadT: Date.now(),
          pageT: 100,
          tran: 15,
        };
      };
    }

    // Chrome Web Store & Firefox Add-on Store direct installation
    try {
      const { ipcRenderer } = require('electron');

      function patchStores() {
        const host = location.hostname;

        // Chrome Web Store
        if (host.includes('chromewebstore.google.com')) {
          const extMatch = location.pathname.match(/\/detail\/(?:[^\/]+\/)?([a-z]{32})/i);
          const extId = extMatch ? extMatch[1] : null;

          const buttons = document.querySelectorAll('button, [role="button"], span');
          for (const el of buttons) {
            const txt = (el.textContent || '').trim();
            if (/^add to chrome$/i.test(txt) || /^add to brave$/i.test(txt)) {
              const btn = el.closest('button, [role="button"]') || el;
              btn.textContent = 'Add to LogicBrowser';
              btn.style.backgroundColor = '#f5c2e7';
              btn.style.color = '#11111b';
              btn.style.fontWeight = 'bold';
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (extId) {
                  btn.textContent = 'Installing to LogicBrowser...';
                  ipcRenderer.sendToHost('install-extension-from-page', extId);
                }
              };
            }
          }
        }

        // Firefox Add-ons (addons.mozilla.org)
        if (host.includes('addons.mozilla.org')) {
          const xpiLink = document.querySelector('a.InstallButtonWrapper-download-button, a[href*=".xpi"]');
          const buttons = document.querySelectorAll('button, a.Button, .AMOPrompt-get-started, span');
          for (const el of buttons) {
            const txt = (el.textContent || '').trim();
            if (/add to firefox/i.test(txt) || /get the theme/i.test(txt)) {
              const btn = el.closest('button, a, [role="button"]') || el;
              btn.textContent = 'Add to LogicBrowser';
              btn.style.backgroundColor = '#f5c2e7';
              btn.style.color = '#11111b';
              btn.style.fontWeight = 'bold';
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = xpiLink ? xpiLink.href : location.href;
                btn.textContent = 'Installing to LogicBrowser...';
                ipcRenderer.sendToHost('install-firefox-addon-from-page', url);
              };
            }
          }
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          patchStores();
          const obs = new MutationObserver(patchStores);
          obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        });
      } else {
        patchStores();
        const obs = new MutationObserver(patchStores);
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
    } catch (err) {}
  } catch (e) {}
})();
