(() => {
  const titleEl = document.getElementById('pip-title');
  const videoEl = document.getElementById('pip-video');
  const frameEl = document.getElementById('pip-frame');
  const loadingEl = document.getElementById('pip-loading');
  const opacityBtn = document.getElementById('pip-opacity-btn');
  const opacityLabel = document.getElementById('pip-opacity-label');
  const sizeBtn = document.getElementById('pip-size-btn');
  const sizeLabel = document.getElementById('pip-size-label');
  const pinBtn = document.getElementById('pip-pin-btn');
  const closeBtn = document.getElementById('pip-close-btn');

  let currentOpacity = 0.95;
  const OPACITY_STEPS = [1.0, 0.85, 0.70, 0.50, 0.35];
  let opacityIndex = 0;

  const SIZES = [
    { label: 'sm', w: 380, h: 214 },
    { label: 'med', w: 520, h: 292 },
    { label: 'lg', w: 720, h: 405 },
    { label: 'huge', w: 960, h: 540 },
  ];
  let sizeIndex = 1; // med

  let isPinned = true;

  // Initialize
  if (window.pipApi) {
    window.pipApi.onInit((data) => {
      if (data.title) {
        titleEl.textContent = data.title.toLowerCase();
        document.title = `${data.title} — overlay`;
      }

      loadingEl.classList.add('hidden');

      if (data.isYouTube && data.videoId) {
        // YouTube embed
        frameEl.src = `https://www.youtube.com/embed/${data.videoId}?autoplay=1&start=${Math.floor(data.currentTime || 0)}&enablejsapi=1`;
        frameEl.classList.remove('hidden');
      } else if (data.videoUrl) {
        // Direct video
        videoEl.src = data.videoUrl;
        videoEl.currentTime = data.currentTime || 0;
        videoEl.classList.remove('hidden');
        videoEl.play().catch(() => {});
      } else if (data.pageUrl) {
        // Fallback to page embed
        frameEl.src = data.pageUrl;
        frameEl.classList.remove('hidden');
      }
    });

    window.pipApi.onStateUpdate((state) => {
      if (state.opacity != null) {
        currentOpacity = state.opacity;
        opacityLabel.textContent = `${Math.round(currentOpacity * 100)}%`;
      }
      if (state.alwaysOnTop != null) {
        isPinned = state.alwaysOnTop;
        pinBtn.classList.toggle('active', isPinned);
      }
      if (state.sizeLabel) {
        sizeLabel.textContent = state.sizeLabel;
      }
      if (state.action === 'play') {
        if (!videoEl.classList.contains('hidden')) videoEl.play();
      } else if (state.action === 'pause') {
        if (!videoEl.classList.contains('hidden')) videoEl.pause();
      } else if (state.action === 'toggle-mute') {
        if (!videoEl.classList.contains('hidden')) videoEl.muted = !videoEl.muted;
      }
    });
  }

  // Opacity cycle
  opacityBtn.addEventListener('click', () => {
    opacityIndex = (opacityIndex + 1) % OPACITY_STEPS.length;
    currentOpacity = OPACITY_STEPS[opacityIndex];
    opacityLabel.textContent = `${Math.round(currentOpacity * 100)}%`;
    window.pipApi?.setOpacity(currentOpacity);
  });

  // Size cycle
  sizeBtn.addEventListener('click', () => {
    sizeIndex = (sizeIndex + 1) % SIZES.length;
    const s = SIZES[sizeIndex];
    sizeLabel.textContent = s.label;
    window.pipApi?.setSize(s.w, s.h);
  });

  // Pin toggle
  pinBtn.addEventListener('click', () => {
    isPinned = !isPinned;
    pinBtn.classList.toggle('active', isPinned);
    window.pipApi?.togglePin();
  });

  // Close overlay
  closeBtn.addEventListener('click', () => {
    window.pipApi?.close();
  });

  // Right-click context menu anywhere
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.pipApi?.showContextMenu({
      currentOpacity,
      isPinned,
      isPaused: videoEl ? videoEl.paused : false,
      isMuted: videoEl ? videoEl.muted : false,
    });
  });
})();
