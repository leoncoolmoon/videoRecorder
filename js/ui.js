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

  /** Wire up all elements with data-tip automatically (using delegation for dynamic elements) */
  function initTooltips() {
    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tip]');
      if (el) {
        setStatus(el.dataset.tip);
      }
    });
    document.addEventListener('mouseout', e => {
      const el = e.target.closest('[data-tip]');
      if (el) {
        clearStatus();
      }
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
        // Allow panels to take between 150px and 45% of window width
        const maxW = window.innerWidth * 0.45;
        const minW = 150;
        const newW = Math.max(minW, Math.min(maxW, startW + (isLeft ? dx : -dx)));

        if (panel.id === 'panel-assets') {
          document.documentElement.style.setProperty('--assets-w', newW + 'px');
        } else {
          document.documentElement.style.setProperty('--settings-w', newW + 'px');
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
    document.querySelectorAll('.panel-titlebar').forEach(bar => {
      bar.addEventListener('click', (e) => {
        const panel = bar.closest('.panel');
        if (!panel) return;

        const btn = bar.querySelector('.panel-collapse-btn');
        const isCollapsed = panel.classList.contains('collapsed');

        // If not collapsed, only allow clicking the actual button to collapse
        if (!isCollapsed && !e.target.closest('.panel-collapse-btn')) return;

        panel.classList.toggle('collapsed');
        const nowCollapsed = panel.classList.contains('collapsed');

        // Flip chevron icon
        const svg = btn?.querySelector('svg path');
        if (svg) {
          if (panel.id === 'panel-assets') {
            svg.setAttribute('d', nowCollapsed ? 'M6 4l4 4-4 4' : 'M10 4l-4 4 4 4');
          } else {
            svg.setAttribute('d', nowCollapsed ? 'M10 4l-4 4 4 4' : 'M6 4l4 4-4 4');
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

  // ── I18n ───────────────────────────────────────
  function updateStaticLabels() {
    const t = window.Settings?.t;
    if (!t) return;

    // panel-assets title
    const assetsTitle = document.querySelector('#panel-assets .panel-titlebar span');
    if (assetsTitle) assetsTitle.textContent = t('label_assets');

    // panel-settings title
    const settingsTitle = document.querySelector('#panel-settings .panel-titlebar span');
    if (settingsTitle) settingsTitle.textContent = t('label_settings');

    // teleprompter hint
    const tpText = document.getElementById('teleprompter-text');
    if (tpText && (tpText.textContent.includes('台词') || tpText.textContent.includes('script'))) {
       // Only update if it's showing the default hint
       tpText.textContent = t('label_teleprompter_hint');
    }

    // asset-dropzone
    const dropzone = document.querySelector('#asset-dropzone span:not(.hint)');
    if (dropzone) dropzone.textContent = t('label_drop_assets');
    const dropHint = document.querySelector('#asset-dropzone .hint');
    if (dropHint) dropHint.textContent = t('label_drop_hint');

    // timeline toolbar speed label
    const speedLabel = document.querySelector('label[for="tl-speed"]');
    if (speedLabel) speedLabel.textContent = t('label_timeline_speed');

    // timeline selection info
    const selInfo = document.getElementById('tl-sel-info');
    if (selInfo) {
      const lbls = selInfo.querySelectorAll('.lbl');
      if (lbls[0]) lbls[0].textContent = t('label_timeline_start');
      if (lbls[1]) lbls[1].textContent = t('label_timeline_duration');
      if (lbls[2]) lbls[2].textContent = t('label_timeline_end');
    }

    // Status bar labels
    const sbItems = document.querySelectorAll('#statusbar .sb-item');
    if (sbItems[0]) sbItems[0].querySelector('.sb-label').textContent = t('sb_playhead');
    if (sbItems[1]) sbItems[1].querySelector('.sb-label').textContent = t('sb_total');
    if (sbItems[2]) sbItems[2].querySelector('.sb-label').textContent = t('sb_fps');
    if (sbItems[3]) sbItems[3].querySelector('.sb-label').textContent = t('sb_mode');
    if (sbItems[4]) sbItems[4].querySelector('.sb-label').textContent = t('sb_status');

    // Tooltips update
    const btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.dataset.tip = t('tip_save');
    const btnExport = document.getElementById('btn-export');
    if (btnExport) btnExport.dataset.tip = t('tip_export');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
        const isFull = !!document.fullscreenElement;
        btnFullscreen.dataset.tip = isFull ? t('tip_exit_fullscreen') : t('tip_fullscreen');
    }
    const btnSettings = document.getElementById('btn-settings-toggle');
    if (btnSettings) btnSettings.dataset.tip = t('tip_settings');
    const btnCollapseAssets = document.querySelector('button[data-target="panel-assets"]');
    if (btnCollapseAssets) btnCollapseAssets.dataset.tip = t('tip_collapse_assets');
    const btnCollapseSettings = document.querySelector('button[data-target="panel-settings"]');
    if (btnCollapseSettings) btnCollapseSettings.dataset.tip = t('tip_collapse_settings');
    const btnRec = document.getElementById('btn-rec-toggle');
    if (btnRec) btnRec.dataset.tip = t('tip_rec');
    const btnStop = document.getElementById('btn-stop');
    if (btnStop) btnStop.dataset.tip = t('tip_stop');
    const btnPlay = document.getElementById('btn-play');
    if (btnPlay) btnPlay.dataset.tip = t('tip_play');
    const btnRewind = document.getElementById('btn-rewind');
    if (btnRewind) btnRewind.dataset.tip = t('tip_rewind');
    const btnModeInsert = document.getElementById('btn-mode-insert');
    if (btnModeInsert) btnModeInsert.dataset.tip = t('tip_mode_insert');
    const btnModeOverwrite = document.getElementById('btn-mode-overwrite');
    if (btnModeOverwrite) btnModeOverwrite.dataset.tip = t('tip_mode_overwrite');
    const btnAddTag = document.getElementById('btn-add-tag');
    if (btnAddTag) btnAddTag.dataset.tip = t('tip_add_tag');
    const btnZoomOut = document.getElementById('tl-btn-zoom-out');
    if (btnZoomOut) btnZoomOut.dataset.tip = t('tip_zoom_out');
    const btnZoomIn = document.getElementById('tl-btn-zoom-in');
    if (btnZoomIn) btnZoomIn.dataset.tip = t('tip_zoom_in');
    const btnDelSel = document.getElementById('tl-btn-del-sel');
    if (btnDelSel) btnDelSel.dataset.tip = t('tip_del_sel');
    const btnPlaySel = document.getElementById('tl-btn-play-sel');
    if (btnPlaySel) btnPlaySel.dataset.tip = t('tip_play_sel');
    const btnExportSel = document.getElementById('tl-btn-export-sel');
    if (btnExportSel) btnExportSel.dataset.tip = t('tip_export_sel');
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

  function applyFontSize(px) {
    document.documentElement.style.fontSize = px + 'px';
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

    // FPS & Aspect Ratio
    State.on('state:change:project', ({ value }) => {
      const el = document.getElementById('sb-fps');
      if (el) el.textContent = (value?.meta?.fps || 30) + 'fps';

      const meta = value?.meta;
      if (meta?.width && meta?.height) {
        document.documentElement.style.setProperty('--proj-aspect', `${meta.width} / ${meta.height}`);
      }
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

      const btnPlay = document.getElementById('btn-play');
      if (btnPlay) {
        btnPlay.innerHTML = value
          ? `<svg viewBox="0 0 20 20"><path d="M6 4h3v12h-3zM11 4h3v12h-3z" fill="currentColor" stroke="none"/></svg>`
          : `<svg viewBox="0 0 20 20"><path d="M6 4l10 6-10 6z" fill="currentColor" stroke="none"/></svg>`;
      }
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

  function initFullscreen() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      const isFull = !!document.fullscreenElement;
      btn.dataset.active = isFull ? 'true' : 'false';
      btn.dataset.tip = isFull ? (State.getSetting('language') === 'en' ? 'Exit Fullscreen' : '退出全屏') : (State.getSetting('language') === 'en' ? 'Fullscreen' : '全屏模式');
    });
  }

  // ── Main init ──────────────────────────────────
  function init() {
    State.init();

    // Apply saved theme and font size
    applyTheme(State.getSetting('theme'));
    applyFontSize(State.getSetting('uiFontSize') || 13);

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
    updateStaticLabels();
    initProjectName();
    initGlobalDragDrop();
    initSettingsToggle();
    initFullscreen();

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
