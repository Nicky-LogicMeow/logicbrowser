(() => {
  const $ = (s) => document.querySelector(s);
  const qInput = $('#q');
  const clearBtn = $('#clear-btn');
  const listEl = $('#history-list');
  const countEl = $('#history-count');

  let allHistory = [];

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
  }

  function hostOf(u) {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function render(items) {
    countEl.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      listEl.innerHTML = '<div class="empty muted">no browsing history found</div>';
      return;
    }

    listEl.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const host = hostOf(item.url);
      const fav = host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : '';
      row.innerHTML = `
        <span class="time">${formatTime(item.at)}</span>
        ${fav ? `<img class="fav" src="${fav}" onerror="this.outerHTML='<span class=\\'fav-fallback\\'>◷</span>'" alt="" />` : '<span class="fav-fallback">◷</span>'}
        <div class="details">
          <a class="title" href="${escapeHtml(item.url)}" title="${escapeHtml(item.title || item.url)}">${escapeHtml(item.title || item.url)}</a>
          <span class="url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
        </div>
        <button class="del-btn" title="remove from history">×</button>
      `;

      row.querySelector('.del-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await fetch(`logic://api/history/delete?at=${item.at}&url=${encodeURIComponent(item.url)}`);
          allHistory = allHistory.filter((h) => h !== item);
          applyFilter();
        } catch (err) {
          console.error(err);
        }
      });

      listEl.appendChild(row);
    });
  }

  function applyFilter() {
    const q = qInput.value.trim().toLowerCase();
    if (!q) {
      render(allHistory);
      return;
    }
    const filtered = allHistory.filter((h) => (h.title || '').toLowerCase().includes(q) || (h.url || '').toLowerCase().includes(q));
    render(filtered);
  }

  qInput.addEventListener('input', applyFilter);

  clearBtn.addEventListener('click', async () => {
    if (confirm('are you sure you want to clear your entire browsing history?')) {
      try {
        await fetch('logic://api/history/clear');
        allHistory = [];
        render([]);
      } catch (err) {
        console.error(err);
      }
    }
  });

  async function load() {
    try {
      const res = await fetch('logic://api/history');
      allHistory = await res.json();
      applyFilter();
    } catch {
      listEl.innerHTML = '<div class="empty muted">failed to load history</div>';
    }
  }

  load();
})();
