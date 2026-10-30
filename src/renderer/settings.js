(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // Tabs navigation
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      $$('.pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = $(`#pane-${btn.dataset.tab}`);
      if (pane) pane.classList.add('active');
    });
  });

  // State
  let state = {};

  async function init() {
    try {
      if (window.logic) {
        state = await window.logic.getState();
      } else {
        const res = await fetch('logic://api/stats');
        const stats = await res.json();
        state = { settings: {}, version: stats.version };
      }
    } catch {}

    const settings = state.settings || {};

    // General
    const searchSelect = $('#set-search-engine');
    if (searchSelect && settings.searchEngine) searchSelect.value = settings.searchEngine;
    searchSelect?.addEventListener('change', async (e) => {
      await saveSetting('searchEngine', e.target.value);
    });

    const bmCheck = $('#set-bm-bar');
    if (bmCheck) bmCheck.checked = settings.showBookmarksBar !== false;
    bmCheck?.addEventListener('change', async (e) => {
      await saveSetting('showBookmarksBar', e.target.checked);
    });

    const compactCheck = $('#set-compact-mode');
    if (compactCheck) compactCheck.checked = !!settings.compactMode;
    compactCheck?.addEventListener('change', async (e) => {
      await saveSetting('compactMode', e.target.checked);
    });

    $('#btn-make-default')?.addEventListener('click', () => {
      if (window.logic) window.logic.setDefaultBrowser();
    });

    // Appearance
    const colorCircles = $$('.color-circle');
    const curAccent = settings.accentColor || '#f5c2e7';
    colorCircles.forEach((c) => {
      c.classList.toggle('active', c.dataset.color === curAccent);
      c.addEventListener('click', async () => {
        colorCircles.forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
        document.documentElement.style.setProperty('--pink', c.dataset.color);
        await saveSetting('accentColor', c.dataset.color);
      });
    });

    const pipCheck = $('#set-show-pip');
    if (pipCheck) pipCheck.checked = settings.showPip !== false;
    pipCheck?.addEventListener('change', async (e) => {
      await saveSetting('showPip', e.target.checked);
    });

    // Privacy
    const adblockCheck = $('#set-adblock-toggle');
    if (adblockCheck) adblockCheck.checked = settings.adblock !== false;
    adblockCheck?.addEventListener('change', async (e) => {
      await saveSetting('adblock', e.target.checked);
    });

    $('#btn-clear-all')?.addEventListener('click', async () => {
      if (confirm('clear all cookies, cache, local storage and browsing history?')) {
        if (window.logic) {
          await window.logic.clearData();
          alert('all browsing data cleared successfully!');
        } else {
          await fetch('logic://api/history/clear');
          alert('history cleared!');
        }
      }
    });

    // New Tab Settings
    const greetingInput = $('#set-newtab-greeting');
    if (greetingInput) greetingInput.value = settings.newtabGreeting || '';
    greetingInput?.addEventListener('change', async (e) => {
      await saveSetting('newtabGreeting', e.target.value);
    });

    const bgInput = $('#set-newtab-bg');
    if (bgInput) bgInput.value = settings.newtabBg || '';
    bgInput?.addEventListener('change', async (e) => {
      await saveSetting('newtabBg', e.target.value);
    });

    const tilesCheck = $('#set-show-tiles');
    if (tilesCheck) tilesCheck.checked = settings.showTiles !== false;
    tilesCheck?.addEventListener('change', async (e) => {
      await saveSetting('showTiles', e.target.checked);
    });

    // Updates
    const verTag = $('#ver-tag');
    if (verTag) verTag.textContent = state.version || '0.1.0';

    const checkBtn = $('#btn-check-updates');
    const statusText = $('#update-status');
    const updateBanner = $('#update-banner');
    const updateDesc = $('#update-banner-desc');
    const downloadBtn = $('#btn-download-update');

    let updateData = null;

    checkBtn?.addEventListener('click', async () => {
      checkBtn.disabled = true;
      statusText.textContent = 'checking github releases...';
      try {
        let res;
        if (window.logic && typeof window.logic.checkForUpdates === 'function') {
          res = await window.logic.checkForUpdates();
        } else {
          const fetchRes = await fetch('logic://api/updates/check');
          res = await fetchRes.json();
        }

        if (res.hasUpdate) {
          statusText.textContent = `new version ${res.latestVersion} available!`;
          updateBanner.classList.remove('hidden');
          updateDesc.textContent = res.releaseName ? `${res.releaseName}: ${res.notes || ''}` : `version ${res.latestVersion} is ready to download.`;
          updateData = res;
        } else {
          statusText.textContent = res.message ? res.message : `up to date (v${res.currentVersion || '0.1.0'})!`;
          updateBanner.classList.add('hidden');
        }
      } catch (err) {
        statusText.textContent = `error checking updates: ${err.message}`;
      } finally {
        checkBtn.disabled = false;
      }
    });

    downloadBtn?.addEventListener('click', () => {
      if (updateData?.downloadUrl) {
        window.open(updateData.downloadUrl);
      }
    });
  }

  async function saveSetting(key, val) {
    if (window.logic) {
      await window.logic.setSetting(key, val);
    }
  }

  init();
})();
