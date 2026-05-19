/**
 * ui.js — Shell, status bar, tooltips, panel resizing, theme, time utils
 */

const UI = (() => {

  // ── Time formatting ────────────────────────────
  /**
   * formatTime(sec) → '00:01:23.06'  (HH:MM:SS.frame)
   * Uses fps from project settings.
   */
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const fps = State.get('project')?.meta?.fps || 30;
    const totalFrames = Math.round(sec * fps);
    const frames = totalFrames % fps;
    const totalSec = Math.floor(totalFrames / fps);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    return (
      String(h).padStart(2, '0') + ':' +
      String(m).padStart(2, '0') + ':' +
      String(s).padStart(2, '0') + '.' +
      String(frames).padStart(2, '0')
    );
  }

  /**
   * parseTime(str) → seconds (float)
   * Accepts '00:01:23.06', '1:23', '83.5'
   */
  function parseTime(str) {
    if (!str) return 0;
    str = String(str).trim();
    // Plain number
    if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    const fps = State.get('project')?.meta?.fps || 30;
    // HH:MM:SS.ff or MM:SS.ff or SS.ff
    const parts = str.split(':');
    let h = 0, m = 0, s = 0, f = 0;
    if (parts.length === 3) { h = +parts[0]; m = +parts[1]; s = parseFloat(parts[2]); }
    else if (parts.length === 2) { m = +parts[0]; s = parseFloat(parts[1]); }
    else { s = parseFloat(parts[0]); }
    // Handle .ff suffix as frames
    const frameMatch = str.match(/\.(\d{2})$/);
    if (frameMatch) {
      const frameDigits = parseInt(frameMatch[1]);
      const sNoFrame = Math.floor(s);
      return h * 3600 + m * 60 + sNoFrame + frameDigits / fps;
    }
    return h * 3600 + m * 60 + s;
  }

  // ── Status bar ─────────────────────────────────
  let _tipTimeout = null;

  function setStatus(msg) {
    const el = document.getElementById('sb-tip');
    if (!el) return;
    el.textContent = msg;
  }

  function clearStatus() {
    setStatus('');
  }

  /** Register hover→status tooltip for element */
  function onButtonHover(el, msg) {
    el.addEventListener('mouseenter', () => setStatus(msg));
    el.addEventListener('mouseleave', () => clearStatus());
    // Also support data-tip attribute
    if (el.dataset.tip && !msg) {
      el.addEventListener('mouseenter', () => setStatus(el.dataset.tip));
    }
  }

  /** Wire up all elements with data-tip automatically */
  function initTooltips() {
    document.querySelectorAll('[data-tip]').forEach(el => {
      el.addEventListener('mouseenter', () => setStatus(el.dataset.tip));
      el.addEventListener('mouseleave', () => clearStatus());
    });
  }

  // ── Panel resizing ─────────────────────────────
  function initPanelResize() {
    document.querySelectorAll('.resize-handle').forEach(handle => {
      let startX, startW, panel, isLeft;

      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        startX = e.clientX;
        isLeft = !!handle.dataset.left;
        const panelId = isLeft ? handle.dataset.left : handle.dataset.right;
        panel = document.getElementById(panelId);
        if (!panel) return;
        startW = panel.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.pointerEvents = 'none';
        handle.style.pointerEvents = 'all';
      });

      document.addEventListener('mousemove', e => {
        if (!handle.classList.contains('dragging')) return;
        const dx = e.clientX - startX;
        const newW = Math.max(100, Math.min(400, startW + (isLeft ? dx : -dx)));
        panel.style.width = newW + 'px';
        if (panel.id === 'panel-assets') {
          document.documentElement.style.setProperty('--asset-panel-w', newW + 'px');
        } else {
          document.documentElement.style.setProperty('--settings-panel-w', newW + 'px');
        }
      });

      document.addEventListener('mouseup', () => {
        if (!handle.classList.contains('dragging')) return;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.pointerEvents = '';
        handle.style.pointerEvents = '';
        panel = null;
      });
    });
  }

  // ── Panel collapse ─────────────────────────────
  function initPanelCollapse() {
    document.querySelectorAll('.panel-collapse-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const panel = document.getElementById(targetId);
        if (!panel) return;
        panel.classList.toggle('collapsed');
        // Flip chevron
        const svg = btn.querySelector('svg path');
        if (svg) {
          const isCollapsed = panel.classList.contains('collapsed');
          if (targetId === 'panel-assets') {
            svg.setAttribute('d', isCollapsed ? 'M6 4l4 4-4 4' : 'M10 4l-4 4 4 4');
          } else {
            svg.setAttribute('d', isCollapsed ? 'M10 4l-4 4 4 4' : 'M6 4l4 4-4 4');
          }
        }
      });
    });
  }

  // ── Asset thumbnail zoom ───────────────────────
  function initAssetZoom() {
    const slider = document.getElementById('asset-zoom');
    if (!slider) return;
    slider.addEventListener('input', () => {
      const size = slider.value + 'px';
      document.documentElement.style.setProperty('--asset-thumb-size', size);
    });
  }

  // ── Theme ──────────────────────────────────────
  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }

  // ── Status bar live updates ────────────────────
  function initStatusBar() {
    // Playhead time
    State.on('state:change:playhead', ({ value }) => {
      const el = document.getElementById('sb-playhead');
      if (el) el.textContent = formatTime(value);
      const hudEl = document.getElementById('hud-cursor-time');
      if (hudEl) hudEl.textContent = '▶ ' + formatTime(value);
    });

    // Total duration
    State.on('state:change:totalDuration', ({ value }) => {
      const el = document.getElementById('sb-duration');
      if (el) el.textContent = formatTime(value);
      const hudEl = document.getElementById('hud-total-time');
      if (hudEl) hudEl.textContent = formatTime(value);
    });

    // FPS
    State.on('state:change:project', ({ value }) => {
      const el = document.getElementById('sb-fps');
      if (el) el.textContent = (value?.meta?.fps || 30) + 'fps';
    });

    // Mode
    State.on('state:change:mode', ({ value }) => {
      const el = document.getElementById('sb-mode');
      if (el) el.textContent = value === 'insert' ? '插入' : '覆盖';
    });

    // Recording/playback state
    State.on('state:change:isRecording', ({ value }) => {
      const el = document.getElementById('sb-state');
      if (el) el.textContent = value ? '录制中' : '就绪';
      document.body.classList.toggle('is-recording', value);
      const badge = document.getElementById('rec-badge');
      if (badge) badge.style.display = value ? 'flex' : 'none';
    });

    State.on('state:change:isPlaying', ({ value }) => {
      const el = document.getElementById('sb-state');
      if (el && !State.get('isRecording')) {
        el.textContent = value ? '播放中' : '就绪';
      }
      document.body.classList.toggle('is-playing', value);
    });

    // Selection
    State.on('state:change:selection', ({ value }) => {
      const infoBar = document.getElementById('tl-sel-info');
      const hudSel  = document.getElementById('hud-selection');
      if (value) {
        const dur = value.endTime - value.startTime;
        if (infoBar) {
          infoBar.style.display = 'flex';
          document.getElementById('tl-sel-start-val').textContent = formatTime(value.startTime);
          document.getElementById('tl-sel-dur-val').textContent   = formatTime(dur);
          document.getElementById('tl-sel-end-val').textContent   = formatTime(value.endTime);
        }
        if (hudSel) {
          hudSel.style.display = 'flex';
          document.getElementById('hud-sel-start').textContent = formatTime(value.startTime);
          document.getElementById('hud-sel-dur').textContent   = formatTime(dur);
        }
      } else {
        if (infoBar) infoBar.style.display = 'none';
        if (hudSel)  hudSel.style.display  = 'none';
      }
    });
  }

  // ── Toolbar button wiring ──────────────────────
  function initTopbarButtons() {
    // Mode toggle
    const btnInsert    = document.getElementById('btn-mode-insert');
    const btnOverwrite = document.getElementById('btn-mode-overwrite');

    function setMode(mode) {
      State.set('mode', mode);
      btnInsert.dataset.active    = mode === 'insert'    ? 'true' : 'false';
      btnOverwrite.dataset.active = mode === 'overwrite' ? 'true' : 'false';
    }

    btnInsert?.addEventListener('click',    () => setMode('insert'));
    btnOverwrite?.addEventListener('click', () => setMode('overwrite'));

    // Timeline speed slider
    const speedSlider = document.getElementById('tl-speed');
    const speedVal    = document.getElementById('tl-speed-val');
    speedSlider?.addEventListener('input', () => {
      const v = parseFloat(speedSlider.value);
      if (speedVal) speedVal.textContent = v + '×';
      State.setSetting('previewSpeed', v);
      State.emit('player:setspeed', v);
    });

    // Timeline zoom slider
    const zoomSlider = document.getElementById('tl-zoom');
    zoomSlider?.addEventListener('input', () => {
      State.set('zoomLevel', parseInt(zoomSlider.value));
      State.emit('timeline:zoom', parseInt(zoomSlider.value));
    });

    const zoomIn  = document.getElementById('tl-btn-zoom-in');
    const zoomOut = document.getElementById('tl-btn-zoom-out');
    zoomIn?.addEventListener('click', () => {
      const next = Math.min(800, State.get('zoomLevel') + 20);
      if (zoomSlider) zoomSlider.value = next;
      State.set('zoomLevel', next);
      State.emit('timeline:zoom', next);
    });
    zoomOut?.addEventListener('click', () => {
      const next = Math.max(10, State.get('zoomLevel') - 20);
      if (zoomSlider) zoomSlider.value = next;
      State.set('zoomLevel', next);
      State.emit('timeline:zoom', next);
    });

    // Overlay opacity slider
    const overlaySlider = document.getElementById('overlay-opacity');
    overlaySlider?.addEventListener('input', () => {
      const v = parseInt(overlaySlider.value) / 100;
      State.setSetting('overlayOpacity', v);
      State.emit('player:overlayopacity', v);
    });
  }

  // ── Project name editable ──────────────────────
  function initProjectName() {
    const el = document.getElementById('project-name');
    if (!el) return;
    el.addEventListener('blur', () => {
      State.setProject({ meta: { name: el.textContent.trim() || '未命名项目' } });
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
    // Reflect state changes
    State.on('state:change:project', ({ value }) => {
      if (document.activeElement !== el) {
        el.textContent = value?.meta?.name || '未命名项目';
      }
    });
  }

  // ── Drag-over app highlight ────────────────────
  function initGlobalDragDrop() {
    let dragCount = 0;
    document.addEventListener('dragenter', e => {
      e.preventDefault();
      dragCount++;
      document.body.classList.add('drag-over-app');
    });
    document.addEventListener('dragleave', () => {
      dragCount--;
      if (dragCount <= 0) { dragCount = 0; document.body.classList.remove('drag-over-app'); }
    });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault();
      dragCount = 0;
      document.body.classList.remove('drag-over-app');
    });
  }

  // ── Settings button wiring ─────────────────────
  function initSettingsToggle() {
    const btn   = document.getElementById('btn-settings-toggle');
    const panel = document.getElementById('panel-settings');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      btn.dataset.active = panel.classList.contains('collapsed') ? 'false' : 'true';
    });
  }

  // ── Main init ──────────────────────────────────
  function init() {
    State.init();

    // Apply saved theme
    applyTheme(State.getSetting('theme'));

    // Listen for theme changes
    State.on('settings:change:theme', ({ value }) => applyTheme(value));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (State.getSetting('theme') === 'system') applyTheme('system');
    });

    initStatusBar();
    initTooltips();
    initPanelResize();
    initPanelCollapse();
    initAssetZoom();
    initTopbarButtons();
    initProjectName();
    initGlobalDragDrop();
    initSettingsToggle();

    console.info('[UI] Initialized.');
  }

  return {
    init,
    formatTime,
    parseTime,
    setStatus,
    clearStatus,
    onButtonHover,
    applyTheme,
  };
})();

window.UI = UI;
