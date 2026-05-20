/**
 * teleprompter.js — 完整提示词实现
 * Session 3: plain/lrc/json 解析、自动滚动、渐隐遮罩、canvas 叠加导出、高度拖拽
 */

const Teleprompter = (() => {
  // ── DOM refs ──────────────────────────────────────
  let _barEl        = null;   // #teleprompter-bar
  let _wrapEl       = null;   // #teleprompter-text-wrap
  let _textEl       = null;   // #teleprompter-text
  let _handleEl     = null;   // #teleprompter-drag-handle

  // ── State ─────────────────────────────────────────
  let _entries    = null;     // [{time, text}] | null  (null = plain)
  let _plainText  = '';
  let _visible    = true;
  let _currentIdx = 0;

  // ── Manual scroll tracking ────────────────────────
  let _manualScroll  = false;
  let _manualTimeout = null;

  // ════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════
  function init(containerEl) {
    _barEl    = containerEl || document.getElementById('teleprompter-bar');
    _wrapEl   = document.getElementById('teleprompter-text-wrap');
    _textEl   = document.getElementById('teleprompter-text');
    _handleEl = document.getElementById('teleprompter-drag-handle');

    _initDrop();
    _initHeightDrag();
    _initManualScroll();
    _applySettings();

    // Playhead → auto-scroll
    State.on('state:change:playhead', ({ value }) => {
      if (_entries && _visible && !_manualScroll) _scrollToTime(value);
    });

    // Collapse on pause setting
    State.on('state:change:isRecording', ({ value }) => {
      if (!value && State.getSetting('teleprompterCollapseOnPause')) {
        setVisible(false);
      } else if (value && State.getSetting('teleprompterCollapseOnPause')) {
        setVisible(true);
      }
    });

    // Re-apply settings when changed
    State.on('settings:change:teleprompterVisible',   ({ value }) => setVisible(value));
    State.on('settings:change:teleprompterFontSize',  ({ value }) => setFontSize(value));
    State.on('settings:change:teleprompterFontColor', ({ value }) => setFontColor(value));
    State.on('settings:change:teleprompterBg',        ({ value }) => setBg(value));
    State.on('settings:change:teleprompterAlign',     ({ value }) => setAlign(value));
    State.on('settings:change:teleprompterOpacity',   ({ value }) => setOpacity(value));

    console.info('[Teleprompter] Initialized.');
  }

  function _applySettings() {
    setVisible(State.getSetting('teleprompterVisible') !== false);
    setFontSize(State.getSetting('teleprompterFontSize') || 14);
    setFontColor(State.getSetting('teleprompterFontColor') || '#d4d4e8');
    setBg(State.getSetting('teleprompterBg') || '#080812');
    setAlign(State.getSetting('teleprompterAlign') || 'left');
  }

  // ════════════════════════════════════════════════
  // FILE LOADING
  // ════════════════════════════════════════════════
  function load(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const ext  = file.name.split('.').pop().toLowerCase();
      if (ext === 'lrc') {
        _parseLRC(text);
      } else if (ext === 'json') {
        _parseJSON(text);
      } else {
        _loadPlain(text);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  // ── Plain text ─────────────────────────────────
  function _loadPlain(text) {
    _plainText = text;
    _entries   = null;
    State.setProject({ teleprompter: { text, entries: null, format: 'plain' } });
    if (_textEl) {
      _textEl.innerHTML = '';
      _textEl.textContent = text;
    }
  }

  // ── LRC parser ─────────────────────────────────
  // Supports [mm:ss.xx] and [mm:ss:ff] and [hh:mm:ss.xx]
  function _parseLRC(text) {
    const lines   = text.split('\n');
    const entries = [];

    for (const line of lines) {
      // Skip metadata tags like [ti:...] [ar:...] [al:...]
      if (/^\[(?:ti|ar|al|by|offset|re|ve):/i.test(line)) continue;

      // Match one or more timestamps at start of line
      const tagRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
      const times  = [];
      let m;
      while ((m = tagRe.exec(line)) !== null) {
        const min   = parseInt(m[1]);
        const sec   = parseInt(m[2]);
        const sub   = m[3] ? parseInt(m[3].padEnd(3, '0')) : 0; // normalise to ms
        times.push(min * 60 + sec + sub / 1000);
      }

      const lyric = line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
      if (!lyric) continue;
      for (const t of times) {
        entries.push({ time: t, text: lyric });
      }
    }

    entries.sort((a, b) => a.time - b.time);
    _entries = entries;
    State.setProject({ teleprompter: { text, entries, format: 'lrc' } });
    _renderTimedText(entries);
  }

  // ── JSON parser ────────────────────────────────
  function _parseJSON(text) {
    try {
      const raw = JSON.parse(text);
      let entries;
      if (Array.isArray(raw)) {
        entries = raw;
      } else if (Array.isArray(raw.entries)) {
        entries = raw.entries;
      } else if (Array.isArray(raw.lyrics)) {
        entries = raw.lyrics;
      } else {
        _loadPlain(text); return;
      }
      // Normalise: ensure {time, text}
      entries = entries.map(e => ({
        time: typeof e.time === 'number' ? e.time
            : typeof e.start === 'number' ? e.start
            : UI.parseTime(e.time || e.start || '0'),
        text: e.text || e.lyric || e.content || '',
      })).filter(e => e.text).sort((a, b) => a.time - b.time);

      _entries = entries;
      State.setProject({ teleprompter: { text, entries, format: 'json' } });
      _renderTimedText(entries);
    } catch (_) {
      _loadPlain(text);
    }
  }

  // ── Render timed text as <span> lines ──────────
  function _renderTimedText(entries) {
    if (!_textEl) return;
    _textEl.innerHTML = entries.map((e, i) =>
      `<span class="tp-line future" data-idx="${i}" data-time="${e.time}">${_escapeHtml(e.text)}</span>`
    ).join('\n');
  }

  function _escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ════════════════════════════════════════════════
  // AUTO-SCROLL
  // ════════════════════════════════════════════════
  function _scrollToTime(time) {
    if (!_entries || !_textEl || !_wrapEl) return;

    // Find current line index
    let idx = 0;
    for (let i = 0; i < _entries.length; i++) {
      if (_entries[i].time <= time) idx = i;
      else break;
    }
    if (idx === _currentIdx) return;
    _currentIdx = idx;

    // Update classes
    const lines = _textEl.querySelectorAll('.tp-line');
    lines.forEach((el, i) => {
      el.className = 'tp-line ' + (i < idx ? 'past' : i === idx ? 'current' : 'future');
    });

    // Scroll current line into center of visible area
    const currentEl = lines[idx];
    if (currentEl) {
      const wrapH   = _wrapEl.offsetHeight;
      const lineTop = currentEl.offsetTop;
      const lineH   = currentEl.offsetHeight;
      const target  = lineTop - wrapH / 2 + lineH / 2;
      _wrapEl.scrollTo({ top: target, behavior: 'smooth' });
    }
  }

  function seek(time) {
    if (_entries) _scrollToTime(time);
  }

  // ════════════════════════════════════════════════
  // MANUAL SCROLL (plain text / user override)
  // ════════════════════════════════════════════════
  function _initManualScroll() {
    if (!_wrapEl) return;
    _wrapEl.addEventListener('wheel', () => {
      _manualScroll = true;
      clearTimeout(_manualTimeout);
      _manualTimeout = setTimeout(() => { _manualScroll = false; }, 3000);
    });
    // Touch drag
    let touchStartY = 0;
    _wrapEl.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; });
    _wrapEl.addEventListener('touchmove', e => {
      const dy = touchStartY - e.touches[0].clientY;
      _wrapEl.scrollTop += dy;
      touchStartY = e.touches[0].clientY;
      _manualScroll = true;
      clearTimeout(_manualTimeout);
      _manualTimeout = setTimeout(() => { _manualScroll = false; }, 3000);
    });
  }

  // ════════════════════════════════════════════════
  // CANVAS OVERLAY (for export)
  // ════════════════════════════════════════════════
  /**
   * renderToCanvas(ctx, canvasW, canvasH, time)
   * Called by export.js when exportWithTeleprompter is true.
   */
  function renderToCanvas(ctx, canvasW, canvasH, time) {
    const s = State.get('settings');
    if (!s.teleprompterWithExport) return;

    const text = _getCurrentText(time);
    if (!text) return;

    const fontSize   = s.teleprompterFontSize || 14;
    const fontColor  = s.teleprompterFontColor || '#ffffff';
    const bgColor    = s.teleprompterBg || 'rgba(0,0,0,0.7)';
    const align      = s.teleprompterAlign || 'left';

    // Scale font to canvas (teleprompter UI is ~300px wide, canvas may be 1920)
    const scaleFactor = canvasW / 1280;
    const scaledFont  = Math.round(fontSize * scaleFactor);
    const padding     = Math.round(16 * scaleFactor);
    const lineH       = Math.round(scaledFont * 1.6);
    const barH        = lineH + padding * 2;
    const y           = Math.round(canvasH * 0.08); // top 8% of canvas

    ctx.save();
    // Background bar
    ctx.fillStyle = bgColor.startsWith('#')
      ? _hexToRgba(bgColor, 0.82)
      : bgColor;
    ctx.fillRect(0, y, canvasW, barH);

    // Text
    ctx.fillStyle   = fontColor;
    ctx.font        = `${scaledFont}px Sora, sans-serif`;
    ctx.textBaseline = 'middle';
    if (align === 'center') {
      ctx.textAlign = 'center';
      ctx.fillText(text, canvasW / 2, y + barH / 2, canvasW - padding * 2);
    } else if (align === 'right') {
      ctx.textAlign = 'right';
      ctx.fillText(text, canvasW - padding, y + barH / 2, canvasW - padding * 2);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(text, padding, y + barH / 2, canvasW - padding * 2);
    }
    ctx.restore();
  }

  function _getCurrentText(time) {
    if (_entries) {
      let idx = 0;
      for (let i = 0; i < _entries.length; i++) {
        if (_entries[i].time <= time) idx = i;
        else break;
      }
      return _entries[idx]?.text || '';
    }
    // Plain text: return first non-empty visible line around scroll position
    return _plainText.split('\n').find(l => l.trim()) || '';
  }

  function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ════════════════════════════════════════════════
  // DISPLAY CONTROLS
  // ════════════════════════════════════════════════
  function setVisible(bool) {
    _visible = bool;
    if (_barEl) {
      _barEl.classList.toggle('collapsed', !bool);
    }
  }

  function setOpacity(v) {
    if (_barEl) _barEl.style.opacity = v;
  }

  function setFontColor(hex) {
    if (_textEl) _textEl.style.color = hex;
  }

  function setBg(hex) {
    if (_barEl) _barEl.style.background = hex;
  }

  function setFontSize(px) {
    if (_textEl) _textEl.style.fontSize = px + 'px';
  }

  function setAlign(align) {
    if (_textEl) _textEl.style.textAlign = align;
  }

  function getText() {
    return State.get('project')?.teleprompter?.text || _plainText;
  }

  // ════════════════════════════════════════════════
  // DRAG & DROP file loading
  // ════════════════════════════════════════════════
  function _initDrop() {
    if (!_barEl) return;
    _barEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      _barEl.style.outline = '2px dashed var(--accent)';
    });
    _barEl.addEventListener('dragleave', () => {
      _barEl.style.outline = '';
    });
    _barEl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      _barEl.style.outline = '';
      const file = e.dataTransfer.files[0];
      if (file) load(file);
    });
  }

  // ════════════════════════════════════════════════
  // HEIGHT DRAG (resize teleprompter bar)
  // ════════════════════════════════════════════════
  function _initHeightDrag() {
    if (!_handleEl || !_barEl) return;
    let startY, startH;

    _handleEl.addEventListener('mousedown', e => {
      e.preventDefault();
      startY = e.clientY;
      startH = _barEl.offsetHeight;
      document.body.style.cursor = 'ns-resize';

      const onMove = e2 => {
        const dy   = e2.clientY - startY;
        const newH = Math.max(0, Math.min(320, startH + dy));
        _barEl.style.height = newH + 'px';
        document.documentElement.style.setProperty('--teleprompter-h', newH + 'px');
        if (newH < 8) setVisible(false);
        else _visible = true;
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  return {
    init, load, seek, renderToCanvas,
    setVisible, setOpacity, setFontColor,
    setBg, setFontSize, setAlign, getText,
  };
})();

window.Teleprompter = Teleprompter;
