(() => {
  const SEARCH = 'https://logicmeow.co.uk/search.cat?q=';
  const $ = (s) => document.querySelector(s);
  const q = $('#q');
  const box = $('#sugg');
  let items = [];
  let sel = -1;
  let token = 0;
  let typed = '';

  // greeting + clock
  const h = new Date().getHours();
  $('#greeting').textContent = h < 5 ? 'still up at this hour' : h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening';
  const tick = () => {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
  };
  tick();
  setInterval(tick, 10000);

  // search
  const go = (text) => {
    text = text.trim();
    if (!text) return;
    const looksLikeUrl = !/\s/.test(text) && /^([a-z]+:\/\/)?[^/?#\s]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text);
    location.href = looksLikeUrl ? (/^[a-z]+:\/\//i.test(text) ? text : 'https://' + text) : SEARCH + encodeURIComponent(text);
  };
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    go(sel >= 0 ? items[sel] : q.value);
  });

  q.addEventListener('input', async () => {
    typed = q.value;
    const t = ++token;
    if (!typed.trim()) return hide();
    await new Promise((r) => setTimeout(r, 100));
    if (t !== token) return;
    try {
      const res = await fetch('logic://api/suggest?q=' + encodeURIComponent(typed));
      const list = await res.json();
      if (t !== token) return;
      items = list.slice(0, 6);
      sel = -1;
      paint();
    } catch {
      hide();
    }
  });
  q.addEventListener('keydown', (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length + 1) % (items.length + 1);
      if (sel === items.length) sel = -1;
      q.value = sel >= 0 ? items[sel] : typed;
      paint();
    } else if (e.key === 'Escape') hide();
  });
  q.addEventListener('blur', () => setTimeout(hide, 150));

  function paint() {
    if (!items.length) return hide();
    box.innerHTML = '';
    items.forEach((s, i) => {
      const d = document.createElement('div');
      d.textContent = s;
      if (i === sel) d.className = 'sel';
      d.addEventListener('mousedown', (e) => {
        e.preventDefault();
        go(s);
      });
      box.appendChild(d);
    });
    box.classList.remove('hidden');
  }
  function hide() {
    items = [];
    sel = -1;
    box.classList.add('hidden');
  }

  // custom settings from localStorage
  function applyCustomSettings() {
    const cust = JSON.parse(localStorage.getItem('logic_newtab_cust') || '{}');
    if (cust.greeting) {
      $('#greeting').textContent = cust.greeting;
    }
    if (cust.bg) {
      document.body.style.backgroundImage = `url("${cust.bg}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
    } else {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundSize = '';
    }
    if (cust.accent) {
      document.documentElement.style.setProperty('--pink', cust.accent);
    }
    if (cust.showTiles === false) {
      $('#tiles-section').classList.add('hidden');
    } else {
      $('#tiles-section').classList.remove('hidden');
    }
  }
  applyCustomSettings();

  // Customize modal handlers
  const custModal = $('#customize-modal');
  const custBtn = $('#customize-btn');
  const custClose = $('#customize-close');
  const custSave = $('#cust-save');
  const custGreeting = $('#cust-greeting');
  const custBg = $('#cust-bg');
  const custTiles = $('#cust-show-tiles');
  const custColors = document.querySelectorAll('#cust-colors .color-circle');

  let selectedAccent = null;

  custColors.forEach((c) => {
    c.addEventListener('click', () => {
      custColors.forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      selectedAccent = c.dataset.color;
    });
  });

  custBtn?.addEventListener('click', () => {
    const cust = JSON.parse(localStorage.getItem('logic_newtab_cust') || '{}');
    custGreeting.value = cust.greeting || '';
    custBg.value = cust.bg || '';
    custTiles.checked = cust.showTiles !== false;
    custModal.classList.remove('hidden');
  });

  custClose?.addEventListener('click', () => custModal.classList.add('hidden'));

  custSave?.addEventListener('click', () => {
    const cust = JSON.parse(localStorage.getItem('logic_newtab_cust') || '{}');
    cust.greeting = custGreeting.value.trim();
    cust.bg = custBg.value.trim();
    cust.showTiles = custTiles.checked;
    if (selectedAccent) cust.accent = selectedAccent;
    localStorage.setItem('logic_newtab_cust', JSON.stringify(cust));
    applyCustomSettings();
    custModal.classList.add('hidden');
  });

  // Add shortcut modal handlers
  const scModal = $('#shortcut-modal');
  const addScBtn = $('#add-shortcut-btn');
  const scClose = $('#shortcut-close');
  const scSave = $('#sc-save');
  const scName = $('#sc-name');
  const scUrl = $('#sc-url');

  addScBtn?.addEventListener('click', () => scModal.classList.remove('hidden'));
  scClose?.addEventListener('click', () => scModal.classList.add('hidden'));
  scSave?.addEventListener('click', async () => {
    const title = scName.value.trim();
    let url = scUrl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      if (window.logic) {
        await window.logic.toggleBookmark({ title: title || url, url });
      }
      loadTiles();
      scName.value = '';
      scUrl.value = '';
      scModal.classList.add('hidden');
    } catch {}
  });

  // tiles
  const accents = ['var(--pink)', 'var(--cyan)', 'var(--green)', 'var(--yellow)', 'var(--lavender)', 'var(--mauve)', 'var(--peach)', 'var(--red)'];
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  async function loadTiles() {
    let list = [];
    try {
      list = await (await fetch('logic://api/bookmarks')).json();
    } catch {}
    const tiles = $('#tiles');
    tiles.innerHTML = '';
    list.forEach((b, i) => {
      const a = document.createElement('a');
      a.className = 'tile';
      a.href = b.url;
      a.style.setProperty('--accent', accents[i % accents.length]);
      const hn = host(b.url);
      a.innerHTML = `<div class="tile__bar"></div><div class="tile__body"><div class="tile__icon"></div><div class="tile__name"></div></div><div class="tile__host"></div>`;
      const icon = a.querySelector('.tile__icon');
      const img = new Image();
      img.src = hn.endsWith('logicmeow.co.uk') ? 'assets/favicon-32.png' : `https://icons.duckduckgo.com/ip3/${hn}.ico`;
      img.onerror = () => (icon.innerHTML = `<span class="letter">${(b.title || hn)[0] || '?'}</span>`);
      icon.appendChild(img);
      a.querySelector('.tile__name').textContent = b.title || hn;
      a.querySelector('.tile__host').textContent = hn;
      tiles.appendChild(a);
    });
  }
  loadTiles();

  // blocked counter + version
  fetch('logic://api/stats')
    .then((r) => r.json())
    .then((s) => {
      $('#blocked-pill').textContent = `${s.blocked.toLocaleString()} ads squished`;
      $('#ver').textContent = `logicbrowser v${s.version}`;
    })
    .catch(() => {});

  // online pill
  const pill = document.querySelector('.online');
  const sync = () => {
    pill.textContent = navigator.onLine ? 'online' : 'offline';
    pill.style.color = navigator.onLine ? 'var(--green)' : 'var(--red)';
  };
  addEventListener('online', sync);
  addEventListener('offline', sync);
  sync();
})();
