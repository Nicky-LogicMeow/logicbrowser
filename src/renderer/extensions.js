(() => {
  const $ = (s) => document.querySelector(s);
  const inputEl = $('#ext-input');
  const installBtn = $('#install-btn');
  const listEl = $('#ext-list');
  const countEl = $('#ext-count');

  let extensions = [];

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function render(items) {
    countEl.textContent = `${items.length} extension${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      listEl.innerHTML = '<div class="empty muted">no extensions installed yet. install one from the web store above!</div>';
      return;
    }

    listEl.innerHTML = '';
    items.forEach((ext) => {
      const card = document.createElement('div');
      card.className = 'ext-card' + (ext.enabled ? '' : ' disabled');

      const iconHtml = ext.iconData
        ? `<img class="ext-icon" src="${ext.iconData}" alt="" />`
        : `<div class="ext-icon-fallback">${escapeHtml(ext.name ? ext.name[0] : 'E')}</div>`;

      card.innerHTML = `
        ${iconHtml}
        <div class="ext-details">
          <div class="ext-header">
            <span class="ext-name">${escapeHtml(ext.name)}</span>
            <span class="ext-version">v${escapeHtml(ext.version)}</span>
            <span class="ext-status-pill ${ext.enabled ? 'on' : 'off'}">${ext.enabled ? 'active' : 'disabled'}</span>
          </div>
          ${ext.description ? `<div class="ext-desc" title="${escapeHtml(ext.description)}">${escapeHtml(ext.description)}</div>` : ''}
          <div class="ext-id">id: ${escapeHtml(ext.id)}</div>
        </div>
        <div class="ext-actions">
          <label class="switch" title="${ext.enabled ? 'disable extension' : 'enable extension'}">
            <input type="checkbox" ${ext.enabled ? 'checked' : ''} />
            <span class="slider"></span>
          </label>
          <button class="uninstall-btn" title="uninstall extension">uninstall</button>
        </div>
      `;

      // Toggle switch
      const switchInput = card.querySelector('.switch input');
      switchInput.addEventListener('change', async () => {
        try {
          const res = await fetch(`logic://api/extensions/toggle?id=${encodeURIComponent(ext.id)}`);
          const data = await res.json();
          ext.enabled = data.enabled;
          card.classList.toggle('disabled', !ext.enabled);
          const pill = card.querySelector('.ext-status-pill');
          pill.className = `ext-status-pill ${ext.enabled ? 'on' : 'off'}`;
          pill.textContent = ext.enabled ? 'active' : 'disabled';
        } catch (err) {
          console.error(err);
          switchInput.checked = ext.enabled;
        }
      });

      // Uninstall button
      card.querySelector('.uninstall-btn').addEventListener('click', async () => {
        if (confirm(`uninstall extension "${ext.name}"?`)) {
          try {
            await fetch(`logic://api/extensions/uninstall?id=${encodeURIComponent(ext.id)}`);
            extensions = extensions.filter((e) => e.id !== ext.id);
            render(extensions);
          } catch (err) {
            console.error(err);
          }
        }
      });

      listEl.appendChild(card);
    });
  }

  installBtn.addEventListener('click', async () => {
    const val = inputEl.value.trim();
    if (!val || installBtn.disabled) return;
    installBtn.disabled = true;
    installBtn.textContent = 'installing...';

    try {
      const res = await fetch(`logic://api/extensions/install?id=${encodeURIComponent(val)}`);
      const data = await res.json();
      if (data.ok) {
        inputEl.value = '';
        await load();
      } else {
        alert(`failed to install extension: ${data.error}`);
      }
    } catch (err) {
      alert(`install error: ${err.message}`);
    } finally {
      installBtn.disabled = false;
      installBtn.textContent = '+ install';
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') installBtn.click();
  });

  async function load() {
    try {
      const res = await fetch('logic://api/extensions');
      extensions = await res.json();
      render(extensions);
    } catch {
      listEl.innerHTML = '<div class="empty muted">failed to load extensions</div>';
    }
  }

  load();
})();
