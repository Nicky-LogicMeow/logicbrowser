// LogicBrowser — browser ui (tabs, omnibox, panels)
/* global logic */
(async () => {
  const $ = (s) => document.querySelector(s);
  const state = await logic.getState();
  const isMac = state.platform === 'darwin';
  const SEARCH = state.searchUrl;
  const NEWTAB = 'logic://newtab/';

  document.body.classList.add(isMac ? 'platform-darwin' : 'platform-other');
  if (!isMac) document.querySelectorAll('kbd').forEach((k) => (k.textContent = k.textContent.replace('⌘', 'ctrl+').replace('⇧', 'shift+').replace('⌥', 'alt+')));
  $('#status-engine').textContent = `chromium ${state.chrome.split('.')[0]}`;
  $('#about-line').textContent = `logicbrowser v${state.version} · chromium ${state.chrome} · made by logicmeow`;

  let settings = state.settings;
  let bookmarks = state.bookmarks;
  let totalBlocked = state.totalBlocked || 0;

  const tabs = [];
  let active = null;
  let nextId = 1;
  const closedStack = [];

  const el = {
    tabs: $('#tabs'),
    views: $('#views'),
    address: $('#address'),
    siteInfo: $('#site-info'),
    back: $('#back'),
    forward: $('#forward'),
    reload: $('#reload'),
    star: $('#star'),
    shield: $('#shield'),
    shieldCount: $('#shield-count'),
    progress: $('#progress'),
    status: $('#status-text'),
    sugg: $('#suggestions'),
  };

  // ------------------------------------------------------------------ helpers
  function toUrl(input) {
    const s = input.trim();
    if (!s) return null;
    if (/^(https?|logic|about|file|data|view-source):/i.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s)) return 'https://' + s;
    return SEARCH + encodeURIComponent(s);
  }
  const isUrlish = (s) => !toUrl(s)?.startsWith(SEARCH);

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function displayUrl(tab) {
    const u = tab.url || '';
    if (u.startsWith(NEWTAB) || u === 'about:blank') return '';
    if (u.startsWith('logic://error')) return tab.failedUrl || '';
    return u;
  }

  function hostOf(u) {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  }

  function setStatus(t) {
    el.status.textContent = t || (active?.loading ? `loading ${hostOf(active.url)}…` : 'ready. meow.');
  }

  // ------------------------------------------------------------------ tabs
  function createTab(url = NEWTAB, opts = {}) {
    const id = nextId++;
    const isPrivate = !!opts.private;
    const tab = {
      id,
      url,
      title: isPrivate ? 'private tab' : 'new tab',
      favicon: null,
      loading: false,
      private: isPrivate,
      blocked: 0,
      wcId: null,
      zoom: 0,
      failedUrl: null,
    };

    // tab element
    const t = document.createElement('div');
    t.className = 'tab' + (isPrivate ? ' private' : '');
    t.innerHTML = `<span class="fav"></span><span class="title"></span>${isPrivate ? '<span class="badge">prv</span>' : ''}<button class="close" title="close tab" tabindex="-1">×</button>`;

    setupTabEvents(t, tab);
    tab.el = t;

    // webview
    const wv = document.createElement('webview');
    wv.setAttribute('partition', isPrivate ? `private-${id}-${Date.now()}` : state.partition);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('plugins', '');
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=no');
    wv.setAttribute('src', url);
    tab.wv = wv;
    wireWebview(tab);

    const idx = opts.index ?? (active && opts.fromActive ? tabs.indexOf(active) + 1 : tabs.length);
    tabs.splice(idx, 0, tab);
    el.tabs.insertBefore(t, el.tabs.children[idx] || null);
    el.views.appendChild(wv);

    renderTab(tab);
    if (!opts.background) selectTab(tab);
    layoutTabs();
    return tab;
  }

  function wireWebview(tab) {
    const wv = tab.wv;
    wv.addEventListener('dom-ready', () => {
      if (!tab.wcId) tab.wcId = wv.getWebContentsId();
      if (tab.zoom) wv.setZoomLevel(tab.zoom);
    });
    wv.addEventListener('did-start-loading', () => {
      tab.loading = true;
      renderTab(tab);
      if (tab === active) updateToolbar();
    });
    wv.addEventListener('did-stop-loading', () => {
      tab.loading = false;
      renderTab(tab);
      if (tab === active) updateToolbar();
    });
    wv.addEventListener('did-start-navigation', (e) => {
      if (e.isMainFrame && !e.isInPlace && !e.isSameDocument) {
        tab.blocked = 0;
        if (tab.wcId) logic.resetBlocked(tab.wcId);
        if (tab === active) updateShield();
      }
    });
    const onNav = (e) => {
      if (e.isMainFrame === false) return;
      tab.url = e.url;
      if (!e.url.startsWith('logic://error')) tab.failedUrl = null;
      if (tab === active) updateToolbar();
      renderTab(tab);
      if (!tab.private && /^https?:/.test(e.url)) {
        logic.historyAdd({ url: e.url, title: tab.title || e.url });
      }
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('page-title-updated', (e) => {
      tab.title = e.title;
      renderTab(tab);
      if (!tab.private && /^https?:/.test(tab.url)) {
        logic.historyAdd({ url: tab.url, title: tab.title });
      }
      if (tab === active) document.title = `${tab.title} — logicbrowser`;
    });
    wv.addEventListener('ipc-message', async (e) => {
      if (e.channel === 'install-extension-from-page') {
        const id = e.args[0];
        try {
          const ext = await logic.installExtension(id);
          toast('extensions.exe', `installed: ${ext.name} v${ext.version}!`);
          renderExtensions();
        } catch (err) {
          toast('error.exe', `install failed: ${err.message}`);
        }
      } else if (e.channel === 'install-firefox-addon-from-page') {
        const url = e.args[0];
        try {
          const ext = await logic.installFirefoxExtension(url);
          toast('extensions.exe', `installed firefox addon: ${ext.name} v${ext.version}!`);
          renderExtensions();
        } catch (err) {
          toast('error.exe', `install failed: ${err.message}`);
        }
      }
    });
    wv.addEventListener('page-favicon-updated', (e) => {
      tab.favicon = e.favicons[0] || null;
      renderTab(tab);
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3 || e.validatedURL?.startsWith('logic://')) return;
      tab.failedUrl = e.validatedURL;
      const q = new URLSearchParams({ code: e.errorCode, desc: e.errorDescription || '', url: e.validatedURL || '' });
      wv.loadURL(`logic://error/?${q}`);
    });
    wv.addEventListener('update-target-url', (e) => {
      if (tab === active) setStatus(e.url ? e.url : '');
    });
    wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('html-fullscreen'));
    wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('html-fullscreen'));
    wv.addEventListener('found-in-page', (e) => {
      const r = e.result;
      if (r.finalUpdate) $('#find-count').textContent = `${r.activeMatchOrdinal || 0}/${r.matches || 0}`;
    });
    wv.addEventListener('close', () => closeTab(tab));
  }

  function renderTab(tab) {
    const fav = tab.el.querySelector('.fav');
    if (tab.loading) {
      if (!fav.querySelector('.spin')) fav.innerHTML = '<i class="spin"></i>';
    } else {
      const src = tab.favicon || (tab.url.startsWith('logic:') ? 'assets/favicon-32.png' : null);
      if (src) {
        const img = fav.querySelector('img');
        if (!img || img.getAttribute('src') !== src) {
          fav.innerHTML = '';
          const i = document.createElement('img');
          i.src = src;
          i.onerror = () => (fav.innerHTML = '<span class="c-cyan">◆</span>');
          fav.appendChild(i);
        }
      } else fav.innerHTML = '<span class="c-cyan">◆</span>';
    }
    tab.el.querySelector('.title').textContent = tab.title || tab.url;
    tab.el.title = `${tab.title}\n${displayUrl(tab)}`;
    tab.el.classList.toggle('active', tab === active);
  }

  function layoutTabs() {
    for (const t of tabs) {
      t.el.classList.toggle('narrow', t.el.offsetWidth < 90);
    }
  }
  window.addEventListener('resize', layoutTabs);

  function selectTab(tab) {
    if (!tab) return;
    active = tab;
    for (const t of tabs) {
      t.wv.classList.toggle('active', t === tab);
      t.el.classList.toggle('active', t === tab);
    }
    document.body.classList.toggle('private-active', tab.private);
    document.title = `${tab.title} — logicbrowser`;
    tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateToolbar();
    hideSuggestions();
    if (!displayUrl(tab)) {
      setTimeout(() => el.address.focus(), 0);
    } else {
      setTimeout(() => {
        try { tab.wv.focus(); } catch {}
      }, 50);
    }
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    if (!tab.private && displayUrl(tab)) closedStack.push({ url: tab.url, index: i });
    tabs.splice(i, 1);
    try { tab.el.remove(); } catch {}
    try { tab.wv.remove(); } catch {}
    if (!tabs.length) return createTab();
    if (tab === active) {
      const nextTab = tabs[Math.min(i, tabs.length - 1)];
      if (nextTab) selectTab(nextTab);
    }
    layoutTabs();
  }

  // tab pointer & drag-to-reorder handling
  function setupTabEvents(t, tab) {
    let isDown = false;
    let startX = 0;
    let isDragging = false;

    t.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.close')) return;
      if (e.button !== 0) return;

      isDown = true;
      isDragging = false;
      startX = e.clientX;

      // Select the tab immediately on press!
      selectTab(tab);

      const onPointerMove = (moveEv) => {
        if (!isDown) return;
        const dx = moveEv.clientX - startX;

        if (!isDragging && Math.abs(dx) > 6) {
          isDragging = true;
          t.classList.add('dragging');
        }

        if (isDragging) {
          const targetEl = document.elementFromPoint(moveEv.clientX, moveEv.clientY)?.closest('.tab');
          if (targetEl && targetEl !== t) {
            const targetTab = tabs.find((item) => item.el === targetEl);
            if (targetTab) {
              const fromIdx = tabs.indexOf(tab);
              const toIdx = tabs.indexOf(targetTab);
              if (fromIdx !== -1 && toIdx !== -1) {
                tabs.splice(fromIdx, 1);
                tabs.splice(toIdx, 0, tab);
                if (fromIdx < toIdx) {
                  targetEl.after(t);
                } else {
                  targetEl.before(t);
                }
              }
            }
          }
        }
      };

      const onPointerUp = () => {
        isDown = false;
        if (isDragging) {
          isDragging = false;
          t.classList.remove('dragging');
          layoutTabs();
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });

    // Middle-click to close
    t.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        closeTab(tab);
      }
    });

    // Close button
    const closeBtn = t.querySelector('.close');
    closeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTab(tab);
    });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // ------------------------------------------------------------------ toolbar
  function updateToolbar() {
    const tab = active;
    if (!tab) return;
    if (document.activeElement !== el.address) el.address.value = displayUrl(tab);
    let canBack = false;
    let canFwd = false;
    try {
      canBack = tab.wv.canGoBack();
      canFwd = tab.wv.canGoForward();
    } catch {}
    el.back.disabled = !canBack;
    el.forward.disabled = !canFwd;
    el.reload.querySelector('.i-reload').style.display = tab.loading ? 'none' : '';
    el.reload.querySelector('.i-stop').style.display = tab.loading ? '' : 'none';
    el.reload.title = tab.loading ? 'stop' : 'reload (⌘R)';

    // site info
    const u = tab.url || '';
    let info = '<span class="prompt">&gt;</span>';
    if (u.startsWith('https:')) info += '<span class="secure" title="secure connection">https</span>';
    else if (u.startsWith('http:')) info += '<span class="insecure" title="not secure!">http!</span>';
    else if (u.startsWith('logic:') && !u.startsWith('logic://error')) info += '<span class="internal">logic</span>';
    if (tab.private) info += '<span class="pill" style="color:var(--mauve)">private</span>';
    el.siteInfo.innerHTML = info;

    el.star.classList.toggle('on', bookmarks.some((b) => b.url === u));
    el.star.style.display = /^https?:/.test(u) ? '' : 'none';

    // chrome web store extension install button
    const extMatch = u.match(/chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-z]{32})/i);
    const installBtn = $('#install-ext-btn');
    if (extMatch) {
      installBtn.classList.remove('hidden');
      installBtn.dataset.extId = extMatch[1];
    } else {
      installBtn.classList.add('hidden');
    }

    el.progress.classList.toggle('loading', tab.loading);
    if (!tab.loading) {
      el.progress.classList.add('done');
      setTimeout(() => el.progress.classList.remove('done'), 400);
    } else el.progress.classList.remove('done');

    $('#zoom-level').textContent = `${Math.round(Math.pow(1.2, tab.zoom) * 100)}%`;
    updateShield();
    setStatus();
  }

  function updateShield() {
    el.shieldCount.textContent = settings.adblock ? (active?.blocked || 0) : 'off';
    el.shield.classList.toggle('off', !settings.adblock);
    $('#sp-count').textContent = active?.blocked || 0;
    $('#sp-total').textContent = totalBlocked.toLocaleString();
  }

  function navigate(input, tab = active) {
    const url = toUrl(input);
    if (!url) return;
    tab.url = url;
    tab.wv.loadURL(url).catch(() => {});
    el.address.blur();
    tab.wv.focus();
    hideSuggestions();
  }

  el.back.onclick = () => active.wv.canGoBack() && active.wv.goBack();
  el.forward.onclick = () => active.wv.canGoForward() && active.wv.goForward();
  el.reload.onclick = () => (active.loading ? active.wv.stop() : active.wv.reload());
  $('#home').onclick = () => navigate(NEWTAB);

  async function togglePictureInPicture() {
    if (!active?.wv) return;
    try {
      const res = await active.wv.executeJavaScript(`
        (() => {
          const videos = Array.from(document.querySelectorAll('video'));
          if (!videos.length) return { ok: false, error: 'no video found on this page' };
          const v = videos.find(vid => !vid.paused && vid.currentTime > 0) || videos[0];
          if (document.pictureInPictureElement) {
            document.exitPictureInPicture();
            return { ok: true, state: 'exited' };
          } else if (typeof v.requestPictureInPicture === 'function') {
            v.requestPictureInPicture();
            return { ok: true, state: 'entered' };
          }
          return { ok: false, error: 'picture-in-picture is not supported on this video' };
        })()
      `);
      if (!res.ok) {
        toast('pip.exe', res.error || 'no video found');
      } else {
        toast('pip.exe', res.state === 'entered' ? 'floating video overlay enabled' : 'floating video overlay closed');
      }
    } catch (e) {
      toast('pip.exe', 'could not trigger video overlay');
    }
  }
  $('#pip-btn')?.addEventListener('click', togglePictureInPicture);

  let lastNewTabTime = 0;
  function handleNewTab(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const now = Date.now();
    if (now - lastNewTabTime < 80) return;
    lastNewTabTime = now;
    createTab();
  }

  const newTabBtn = $('#new-tab');
  newTabBtn.addEventListener('mousedown', (e) => {
    if (e.button === 0) handleNewTab(e);
  });
  newTabBtn.addEventListener('click', handleNewTab);

  // Double-click empty space in the tabstrip to open a new tab
  el.tabs.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.tab')) {
      handleNewTab(e);
    }
  });
  el.star.onclick = async () => {
    bookmarks = await logic.toggleBookmark({ url: active.url, title: active.title });
    updateToolbar();
    renderBookmarks();
    renderBookmarksBar();
    toast('bookmarks.exe', el.star.classList.contains('on') ? `saved ★ ${active.title}` : 'bookmark removed');
  };

  const installBtn = $('#install-ext-btn');
  installBtn.onclick = async () => {
    const id = installBtn.dataset.extId;
    if (!id || installBtn.classList.contains('busy')) return;
    installBtn.classList.add('busy');
    installBtn.textContent = 'installing...';
    try {
      const ext = await logic.installExtension(id);
      toast('extensions.exe', `installed: ${ext.name} v${ext.version}!`);
      installBtn.textContent = 'installed ✓';
      renderExtensions();
    } catch (e) {
      toast('error.exe', `failed: ${e.message}`);
      installBtn.textContent = '+ add extension';
    } finally {
      installBtn.classList.remove('busy');
    }
  };

  // ------------------------------------------------------------------ omnibox + suggestions
  let suggItems = [];
  let suggSel = -1;
  let suggToken = 0;
  let typed = '';

  el.address.addEventListener('focus', () => setTimeout(() => el.address.select(), 0));
  el.address.addEventListener('blur', () => setTimeout(() => {
    hideSuggestions();
    if (active && document.activeElement !== el.address) el.address.value = displayUrl(active);
  }, 150));
  el.address.addEventListener('input', () => {
    typed = el.address.value;
    refreshSuggestions(typed);
  });
  el.address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = suggItems[suggSel];
      navigate(item ? item.go : el.address.value);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggItems.length) return;
      e.preventDefault();
      suggSel = (suggSel + (e.key === 'ArrowDown' ? 1 : -1) + suggItems.length + 1) % (suggItems.length + 1);
      if (suggSel === suggItems.length) suggSel = -1;
      el.address.value = suggSel >= 0 ? suggItems[suggSel].fill : typed;
      paintSuggestions();
    } else if (e.key === 'Escape') {
      hideSuggestions();
      el.address.value = displayUrl(active);
      el.address.select();
      if (!el.address.value) return;
      active.wv.focus();
    }
  });

  async function refreshSuggestions(q) {
    const token = ++suggToken;
    if (!q.trim()) return hideSuggestions();
    const first = isUrlish(q)
      ? { ic: '→', main: toUrl(q), tag: 'go', go: q, fill: q }
      : { ic: '⌕', main: q, sub: '— search.cat', tag: 'search', go: q, fill: q };
    suggItems = [first];
    suggSel = 0;
    paintSuggestions();

    const [hist, remote] = await Promise.all([
      logic.historySearch(q),
      new Promise((r) => setTimeout(r, 90)).then(() => (token === suggToken ? logic.suggest(q) : [])),
    ]);
    if (token !== suggToken) return;
    const bm = bookmarks
      .filter((b) => (b.url + b.title).toLowerCase().includes(q.toLowerCase()))
      .slice(0, 3)
      .map((b) => ({ ic: '★', main: b.title, sub: b.url, tag: 'bookmark', go: b.url, fill: b.url }));
    const hs = hist
      .filter((h) => !bm.some((b) => b.go === h.url))
      .slice(0, 4)
      .map((h) => ({ ic: '◷', main: h.title || h.url, sub: h.url, tag: 'history', go: h.url, fill: h.url }));
    const rs = remote
      .filter((s) => s.toLowerCase() !== q.toLowerCase())
      .slice(0, 5)
      .map((s) => ({ ic: '⌕', main: s, tag: 'search.cat', go: SEARCH + encodeURIComponent(s), fill: s }));
    suggItems = [first, ...bm, ...hs, ...rs];
    paintSuggestions();
  }

  function paintSuggestions() {
    if (!suggItems.length || document.activeElement !== el.address) return hideSuggestions();
    el.sugg.innerHTML = '';
    suggItems.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'sugg' + (i === suggSel ? ' sel' : '');
      const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      row.innerHTML = `<span class="ic">${s.ic}</span><span class="main">${esc(s.main)}</span>${s.sub ? `<span class="sub">${esc(s.sub)}</span>` : ''}<span class="tag">${s.tag}</span>`;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        navigate(s.go);
      });
      el.sugg.appendChild(row);
    });
    el.sugg.classList.remove('hidden');
  }
  function hideSuggestions() {
    suggItems = [];
    suggSel = -1;
    el.sugg.classList.add('hidden');
  }

  // ------------------------------------------------------------------ panels
  const panels = {
    shield: $('#shield-panel'),
    menu: $('#menu'),
    downloads: $('#downloads-panel'),
  };
  function togglePanel(name, force) {
    for (const [k, p] of Object.entries(panels)) {
      if (!p) continue;
      const show = k === name ? (force ?? p.classList.contains('hidden')) : false;
      p.classList.toggle('hidden', !show);
    }
  }
  el.shield.onclick = (e) => {
    e.stopPropagation();
    updateShield();
    togglePanel('shield');
  };
  $('#downloads-btn').onclick = (e) => {
    e.stopPropagation();
    togglePanel('downloads');
  };
  $('#menu-btn').onclick = (e) => {
    e.stopPropagation();
    renderBookmarks();
    renderExtensions();
    togglePanel('menu');
  };
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.panel, #shield, #menu-btn, #downloads-btn')) togglePanel(null);
  });
  window.addEventListener('blur', () => togglePanel(null)); // clicking into a webview blurs the ui window

  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cmd]');
    if (!b) return;
    runCommand(b.dataset.cmd);
    if (!b.closest('.zoom-row')) togglePanel(null);
  });

  function renderBookmarks() {
    const box = $('#menu-bookmarks');
    box.innerHTML = '';
    if (!bookmarks.length) box.innerHTML = '<div class="tiny muted" style="padding:2px 6px">nothing yet — hit ★</div>';
    for (const b of bookmarks) {
      const btn = document.createElement('button');
      btn.innerHTML = `<img src="https://icons.duckduckgo.com/ip3/${hostOf(b.url)}.ico" onerror="this.style.visibility='hidden'"><span></span>`;
      btn.querySelector('span').textContent = b.title;
      btn.title = b.url;
      btn.onclick = () => {
        navigate(b.url);
        togglePanel(null);
      };
      box.appendChild(btn);
    }
  }

  const bookmarksBar = $('#bookmarks-bar');
  const bookmarksBarItems = $('#bookmarks-bar-items');
  const importBtn = $('#import-btn');

  function renderBookmarksBar() {
    if (!bookmarksBarItems) return;
    bookmarksBarItems.innerHTML = '';
    const showBar = settings.showBookmarksBar !== false;
    bookmarksBar?.classList.toggle('hidden', !showBar);

    for (const b of bookmarks) {
      const item = document.createElement('div');
      item.className = 'bm-item';
      item.title = `${b.title}\n${b.url}`;
      const domain = hostOf(b.url);
      const favSrc = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      item.innerHTML = `
        <img src="${favSrc}" onerror="this.outerHTML='<span class=\\'bm-fallback\\'>★</span>'" alt="" />
        <span>${escapeHtml(b.title || domain)}</span>
      `;

      item.addEventListener('click', (e) => {
        if (e.button === 0) {
          if (e.metaKey || e.ctrlKey) {
            createTab(b.url, { background: true });
          } else {
            navigate(b.url);
          }
        }
      });
      item.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          createTab(b.url, { background: true });
        }
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`remove bookmark "${b.title}"?`)) {
          logic.toggleBookmark({ url: b.url, title: b.title }).then((updated) => {
            bookmarks = updated;
            renderBookmarks();
            renderBookmarksBar();
            updateToolbar();
            toast('bookmarks.exe', 'bookmark removed');
          });
        }
      });
      bookmarksBarItems.appendChild(item);
    }
  }

  async function renderExtensions() {
    const box = $('#menu-extensions');
    const pinned = $('#pinned-extensions');
    if (pinned) pinned.innerHTML = '';
    try {
      const exts = await logic.listExtensions();
      if (box) {
        if (!exts.length) {
          box.textContent = 'no extensions loaded';
        } else {
          box.innerHTML = '';
          for (const ext of exts) {
            const item = document.createElement('div');
            item.style.padding = '3px 0';
            item.innerHTML = `<span style="color:var(--text)">${ext.name}</span> <span class="c-cyan">v${ext.version}</span>`;
            box.appendChild(item);
          }
        }
      }

      // render pinned buttons on toolbar
      if (pinned) {
        for (const ext of exts) {
          if (!ext.popupUrl && !ext.iconData) continue;
          const btn = document.createElement('button');
          btn.className = 'ext-btn';
          btn.title = ext.name;
          if (ext.iconData) {
            btn.innerHTML = `<img src="${ext.iconData}" alt="" />`;
          } else {
            btn.innerHTML = `<span style="font-family:var(--font-pixel);font-size:9px;color:var(--pink)">${ext.name[0]}</span>`;
          }
          btn.onclick = (e) => {
            const rect = btn.getBoundingClientRect();
            logic.openExtensionPopup({
              popupUrl: ext.popupUrl,
              x: rect.right,
              y: rect.bottom,
            });
          };
          pinned.appendChild(btn);
        }
      }
    } catch {
      if (box) box.textContent = 'none';
    }
  }

  const syncSettingsUI = () => {
    $('#set-adblock').checked = settings.adblock;
    $('#sp-adblock').checked = settings.adblock;
    $('#set-compact').checked = settings.compactMode;
    const bmCheck = $('#set-bookmarks-bar');
    if (bmCheck) bmCheck.checked = settings.showBookmarksBar !== false;
    document.body.classList.toggle('compact', settings.compactMode);
    renderBookmarksBar();
    updateShield();
  };
  const setSetting = async (k, v) => {
    settings = await logic.setSetting(k, v);
    syncSettingsUI();
  };
  $('#set-adblock').onchange = (e) => setSetting('adblock', e.target.checked).then(() => active.wv.reload());
  $('#sp-adblock').onchange = (e) => setSetting('adblock', e.target.checked).then(() => active.wv.reload());
  $('#set-compact').onchange = (e) => setSetting('compactMode', e.target.checked);
  const bmCheck = $('#set-bookmarks-bar');
  if (bmCheck) bmCheck.onchange = (e) => setSetting('showBookmarksBar', e.target.checked);
  syncSettingsUI();

  // ------------------------------------------------------------------ find in page
  const findbar = $('#findbar');
  const findInput = $('#find-input');
  function openFind() {
    findbar.classList.remove('hidden');
    findInput.focus();
    findInput.select();
  }
  function closeFind() {
    findbar.classList.add('hidden');
    active?.wv.stopFindInPage('clearSelection');
    $('#find-count').textContent = '0/0';
    active?.wv.focus();
  }
  findInput.addEventListener('input', () => {
    if (findInput.value) active.wv.findInPage(findInput.value);
    else {
      active.wv.stopFindInPage('clearSelection');
      $('#find-count').textContent = '0/0';
    }
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && findInput.value) active.wv.findInPage(findInput.value, { forward: !e.shiftKey, findNext: true });
    if (e.key === 'Escape') closeFind();
  });
  $('#find-next').onclick = () => findInput.value && active.wv.findInPage(findInput.value, { findNext: true });
  $('#find-prev').onclick = () => findInput.value && active.wv.findInPage(findInput.value, { forward: false, findNext: true });
  $('#find-close').onclick = closeFind;

  // ------------------------------------------------------------------ toasts / downloads
  function toast(title, html, ms = 2600) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<div class="window__bar"><span class="dots"><i></i><i></i><i></i></span><span>${title}</span></div><div class="window__body"></div>`;
    const body = t.querySelector('.window__body');
    if (typeof html === 'string') body.textContent = html;
    else body.appendChild(html);
    $('#toasts').appendChild(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }

  const downloads = new Map();
  const downloadHistory = [];

  function renderDownloadsList() {
    const list = $('#downloads-list');
    if (!list) return;
    if (!downloadHistory.length) {
      list.innerHTML = '<div class="empty-downloads muted tiny">no downloads yet</div>';
      return;
    }
    list.innerHTML = '';
    for (const d of downloadHistory) {
      const item = document.createElement('div');
      item.className = 'download-item';
      item.innerHTML = `
        <div class="info">
          <div class="name" title="${d.name}">${d.name}</div>
          <div class="tiny muted">${d.state === 'completed' ? 'completed' : d.state} · ${(d.received / (1024 * 1024)).toFixed(1)} MB</div>
        </div>
        ${d.path ? '<button class="tiny-btn show-btn">show</button>' : ''}
      `;
      if (d.path) {
        item.querySelector('.show-btn').onclick = () => logic.showDownload(d.path);
      }
      list.appendChild(item);
    }
  }

  $('#clear-downloads').onclick = () => {
    downloadHistory.length = 0;
    renderDownloadsList();
  };

  logic.on('download', (d) => {
    let entry = downloads.get(d.id);
    let histEntry = downloadHistory.find((h) => h.id === d.id);
    if (!histEntry) {
      histEntry = { id: d.id, name: d.name, path: d.path, state: d.state, received: d.received };
      downloadHistory.unshift(histEntry);
    } else {
      histEntry.state = d.state;
      histEntry.path = d.path;
      histEntry.received = d.received;
    }
    renderDownloadsList();

    if (!entry) {
      const body = document.createElement('div');
      body.innerHTML = '<div class="name"></div><div class="bar"><i></i></div><div class="tiny muted info"></div>';
      body.querySelector('.name').textContent = d.name;
      entry = { body, toast: toast('download.exe', body, 0) };
      downloads.set(d.id, entry);
    }
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
    entry.body.querySelector('.bar i').style.width = (d.state === 'completed' ? 100 : pct) + '%';
    const info = entry.body.querySelector('.info');
    if (d.state === 'completed') {
      info.innerHTML = 'done! <button>show in folder</button>';
      info.querySelector('button').onclick = () => logic.showDownload(d.path);
      setTimeout(() => entry.toast.remove(), 8000);
    } else if (d.state === 'cancelled' || d.state === 'interrupted') {
      info.textContent = `download ${d.state} :(`;
      setTimeout(() => entry.toast.remove(), 5000);
    } else {
      info.textContent = d.total ? `${pct}% · ${(d.received / 1048576).toFixed(1)} / ${(d.total / 1048576).toFixed(1)} mb` : `${(d.received / 1048576).toFixed(1)} mb`;
    }
  });

  // ------------------------------------------------------------------ adblock counter
  logic.on('blocked', ({ webContentsId, count, total }) => {
    totalBlocked = total;
    const tab = tabs.find((t) => t.wcId === webContentsId);
    if (tab) tab.blocked = count;
    if (tab === active) {
      updateShield();
      el.shield.classList.remove('bump');
      void el.shield.offsetWidth;
      el.shield.classList.add('bump');
    }
  });

  // ------------------------------------------------------------------ fullscreen + online
  logic.on('window-fullscreen', (on) => {
    document.body.classList.toggle('window-fullscreen', on);
    if (!on) document.body.classList.remove('html-fullscreen');
  });
  const onlinePill = $('.window-label .online');
  const syncOnline = () => {
    onlinePill.textContent = navigator.onLine ? 'online' : 'offline';
    onlinePill.classList.toggle('off', !navigator.onLine);
  };
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();

  // ------------------------------------------------------------------ commands (menu accelerators)
  function zoom(delta) {
    if (!active) return;
    active.zoom = delta === 0 ? 0 : Math.max(-4, Math.min(5, active.zoom + delta));
    active.wv.setZoomLevel(active.zoom);
    $('#zoom-level').textContent = `${Math.round(Math.pow(1.2, active.zoom) * 100)}%`;
  }

  async function runCommand(cmd, ...args) {
    switch (cmd) {
      case 'new-tab': return createTab();
      case 'new-private-tab': return createTab(NEWTAB, { private: true });
      case 'close-tab': return active && closeTab(active);
      case 'reopen-tab': {
        const c = closedStack.pop();
        if (c) createTab(c.url, { index: Math.min(c.index, tabs.length) });
        return;
      }
      case 'focus-address':
        el.address.focus();
        el.address.select();
        return;
      case 'reload': return active?.wv.reload();
      case 'hard-reload': return active?.wv.reloadIgnoringCache();
      case 'back': return active?.wv.canGoBack() && active.wv.goBack();
      case 'forward': return active?.wv.canGoForward() && active.wv.goForward();
      case 'home': return navigate(NEWTAB);
      case 'find': return openFind();
      case 'zoom-in': return zoom(0.5);
      case 'zoom-out': return zoom(-0.5);
      case 'zoom-reset': return zoom(0);
      case 'devtools': return active?.wv.isDevToolsOpened() ? active.wv.closeDevTools() : active?.wv.openDevTools();
      case 'bookmark': return el.star.style.display !== 'none' && el.star.click();
      case 'settings':
        renderBookmarks();
        return togglePanel('menu', true);
      case 'toggle-compact': return setSetting('compactMode', !settings.compactMode);
      case 'toggle-bookmarks-bar': return setSetting('showBookmarksBar', settings.showBookmarksBar === false);
      case 'open-settings': return createTab('logic://settings/');
      case 'open-history': return createTab('logic://history/');
      case 'open-extensions': return createTab('logic://extensions/');
      case 'open-firefox-store': return navigate('https://addons.mozilla.org/en-US/firefox/');
      case 'pip': return togglePictureInPicture();
      case 'import-bookmarks': return openImportModal();
      case 'export-bookmarks': {
        const file = await logic.exportBookmarksFile();
        if (file) toast('bookmarks.exe', 'exported bookmarks html file!');
        return;
      }
      case 'next-tab': return selectTab(tabs[(tabs.indexOf(active) + 1) % tabs.length]);
      case 'prev-tab': return selectTab(tabs[(tabs.indexOf(active) - 1 + tabs.length) % tabs.length]);
      case 'select-tab': return selectTab(args[0] === 8 ? tabs[tabs.length - 1] : tabs[args[0]]);
      case 'default-browser': return logic.setDefaultBrowser();
      case 'open-webstore': return navigate('https://chromewebstore.google.com/category/extensions');
      case 'clear-data':
        if (confirm('clear cookies, cache, site data and history? (bookmarks stay)')) {
          await logic.clearData();
          toast('cleanup.exe', 'all clean. fresh as a cat bath.');
        }
        return;
      case 'open-url': {
        const [url, opts = {}] = args;
        const from = tabs.find((t) => t.wcId === opts.from);
        return createTab(url, {
          background: !!opts.background,
          private: opts.private ?? from?.private ?? false,
          fromActive: true,
        });
      }
    }
  }
  logic.on('command', runCommand);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !findbar.classList.contains('hidden')) closeFind();
    if (e.key === 'Escape') togglePanel(null);
  });

  // ------------------------------------------------------------------ screenshare picker modal
  const ssModal = $('#screenshare-modal');
  const ssGrid = $('#screenshare-grid');
  const ssTabScreens = $('#ss-tab-screens');
  const ssTabWindows = $('#ss-tab-windows');
  const ssShareBtn = $('#screenshare-share');
  const ssCancelBtn = $('#screenshare-cancel');
  const ssCloseBtn = $('#screenshare-close');

  let currentSources = [];
  let selectedSourceId = null;
  let activeTabType = 'screens';

  function renderScreenshareGrid() {
    if (!ssGrid) return;
    ssGrid.innerHTML = '';
    const filtered = currentSources.filter((s) => (activeTabType === 'screens' ? s.isScreen : !s.isScreen));

    if (!filtered.length) {
      ssGrid.innerHTML = `<div class="muted tiny" style="grid-column: 1 / -1; padding: 24px; text-align: center;">no ${activeTabType} available to share</div>`;
      return;
    }

    filtered.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'screenshare-card' + (s.id === selectedSourceId ? ' selected' : '');
      card.innerHTML = `
        <img class="screenshare-thumb" src="${s.thumbnail || ''}" alt="" />
        <div class="screenshare-info">
          ${s.appIcon ? `<img class="screenshare-icon" src="${s.appIcon}" alt="" />` : ''}
          <span class="screenshare-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        selectedSourceId = s.id;
        document.querySelectorAll('.screenshare-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        if (ssShareBtn) ssShareBtn.disabled = false;
      });
      card.addEventListener('dblclick', () => {
        selectedSourceId = s.id;
        confirmScreenshare();
      });
      ssGrid.appendChild(card);
    });
  }

  function confirmScreenshare() {
    if (selectedSourceId) {
      logic.selectScreenshareSource(selectedSourceId);
      ssModal?.classList.add('hidden');
    }
  }

  function cancelScreenshare() {
    logic.selectScreenshareSource(null);
    ssModal?.classList.add('hidden');
  }

  ssTabScreens?.addEventListener('click', () => {
    activeTabType = 'screens';
    ssTabScreens.classList.add('active');
    ssTabWindows.classList.remove('active');
    renderScreenshareGrid();
  });
  ssTabWindows?.addEventListener('click', () => {
    activeTabType = 'windows';
    ssTabWindows.classList.add('active');
    ssTabScreens.classList.remove('active');
    renderScreenshareGrid();
  });

  ssShareBtn?.addEventListener('click', confirmScreenshare);
  ssCancelBtn?.addEventListener('click', cancelScreenshare);
  ssCloseBtn?.addEventListener('click', cancelScreenshare);

  logic.on('show-screenshare-picker', (sources) => {
    currentSources = sources || [];
    selectedSourceId = currentSources[0]?.id || null;
    activeTabType = 'screens';
    ssTabScreens?.classList.add('active');
    ssTabWindows?.classList.remove('active');
    if (ssShareBtn) ssShareBtn.disabled = !selectedSourceId;
    renderScreenshareGrid();
    ssModal?.classList.remove('hidden');
  });

  // ------------------------------------------------------------------ import browser data modal
  const importModal = $('#import-modal');
  const importCloseBtn = $('#import-close');
  const importBrowserList = $('#import-browser-list');
  const importFileBtn = $('#import-file-btn');

  async function openImportModal() {
    if (!importModal) return;
    importBrowserList.innerHTML = '<div class="muted tiny">detecting browsers...</div>';
    importModal.classList.remove('hidden');

    try {
      const browsers = await logic.getImportBrowsers();
      importBrowserList.innerHTML = '';
      if (!browsers.length) {
        importBrowserList.innerHTML = '<div class="muted tiny" style="padding: 6px 0">no installed browsers detected automatically. you can import an html bookmarks file below!</div>';
      } else {
        browsers.forEach((b) => {
          const item = document.createElement('div');
          item.className = 'import-browser-item';
          item.innerHTML = `
            <span class="name">${escapeHtml(b.name)}</span>
            <span class="action">import bookmarks →</span>
          `;
          item.onclick = async () => {
            item.querySelector('.action').textContent = 'importing...';
            try {
              const res = await logic.importBrowser(b.id);
              const curState = await logic.getState();
              bookmarks = curState.bookmarks;
              renderBookmarks();
              renderBookmarksBar();
              toast('import.exe', `imported ${res.added} bookmarks from ${b.name}!`);
              importModal.classList.add('hidden');
            } catch (err) {
              toast('error.exe', `import failed: ${err.message}`);
              item.querySelector('.action').textContent = 'failed';
            }
          };
          importBrowserList.appendChild(item);
        });
      }
    } catch (e) {
      importBrowserList.innerHTML = `<div class="muted tiny">${e.message}</div>`;
    }
  }

  importCloseBtn?.addEventListener('click', () => importModal.classList.add('hidden'));
  importBtn?.addEventListener('click', openImportModal);
  importFileBtn?.addEventListener('click', async () => {
    try {
      const res = await logic.importBookmarksFile();
      if (res) {
        const curState = await logic.getState();
        bookmarks = curState.bookmarks;
        renderBookmarks();
        renderBookmarksBar();
        toast('import.exe', `imported ${res.added} bookmarks from file!`);
        importModal.classList.add('hidden');
      }
    } catch (err) {
      toast('error.exe', `import failed: ${err.message}`);
    }
  });

  // ------------------------------------------------------------------ go!
  renderBookmarksBar();
  renderExtensions();
  createTab(NEWTAB);
  logic.ready();
})();
