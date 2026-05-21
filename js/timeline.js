/**
 * timeline.js — 完整时间轴实现
 * Session 2: 多轨道、clip拖拽/缩放、素材拖入、缩略图懒加载、波形、右键菜单
 */

const Timeline = (() => {
  // ── DOM refs ─────────────────────────────────────
  let _scrollWrap  = null;
  let _inner       = null;
  let _rulerMarks  = null;
  let _tracks      = null;
  let _labelsCol   = null;
  let _playheadEl  = null;
  let _selectionEl = null;

  const ROW_H    = 52;   // px, video/image row height (matches CSS)
  const AUDIO_H  = 36;   // px, audio row height
  const MIN_ZOOM = 10;
  const MAX_ZOOM = 800;

  // ── Thumbnail cache ───────────────────────────────
  const _thumbCache   = {};   // ${layerId}_${timecode} → dataURL
  let   _thumbObserver = null;

  // ── Context menu ─────────────────────────────────
  let _ctxMenu = null;

  // ── Drag state ────────────────────────────────────
  const _drag = {
    active: false, didDrag: false,
    type: null,       // 'move' | 'resize-left' | 'resize-right'
    layerId: null,
    startX: 0, startY: 0,
    origStart: 0, origEnd: 0, origTrack: 0,
    selAnchor: 0,
  };

  // ════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════
  function init(containerEl) {
    _scrollWrap  = containerEl || document.getElementById('timeline-scroll-wrap');
    _inner       = document.getElementById('timeline-inner');
    _rulerMarks  = document.getElementById('tl-ruler-marks');
    _tracks      = document.getElementById('tl-tracks');
    _labelsCol   = document.getElementById('tl-tracks-labels');
    _playheadEl  = document.getElementById('tl-playhead');
    _selectionEl = document.getElementById('tl-selection');

    _initThumbObserver();
    _initScrollbar();
    _initPlayheadDrag();
    _initTrackAreaEvents();
    _initWheelZoom();
    document.addEventListener('click',       () => _removeCtxMenu());
    document.addEventListener('contextmenu', () => _removeCtxMenu(), true);

    State.on('layers:change',           () => render());
    State.on('tags:change',             () => _renderTags());
    State.on('state:change:playhead',   ({ value }) => _updatePlayhead(value));
    State.on('state:change:selection',  ({ value }) => _updateSelection(value));
    State.on('state:change:zoomLevel',  () => render());
    State.on('project:loaded',          () => render());
    State.on('project:new',             () => render());

    console.info('[Timeline] Initialized.');
  }

  // ════════════════════════════════════════════════
  // FULL RENDER
  // ════════════════════════════════════════════════
  function render() {
    if (!_inner) return;
    const zoom     = State.get('zoomLevel');
    const duration = Math.max(State.get('totalDuration') || 0, 30);
    const totalPx  = Math.round(duration * zoom) + 400;

    _inner.style.width = totalPx + 'px';

    _renderRuler(zoom, duration);
    _renderAllTracks(zoom);
    _renderTags();
    _updatePlayhead(State.get('playhead'));
    _updateSelection(State.get('selection'));
    _syncScrollbar();
  }

  // ── Ruler ─────────────────────────────────────
  function _renderRuler(zoom, duration) {
    if (!_rulerMarks) return;
    _rulerMarks.innerHTML = '';
    const interval = _pickInterval(zoom);
    const count    = Math.ceil(duration / interval) + 2;

    for (let i = 0; i <= count; i++) {
      const t     = i * interval;
      const px    = t * zoom;
      const major = (i % 5 === 0);
      const mark  = document.createElement('div');
      mark.className = 'tl-ruler-mark' + (major ? ' major' : '');
      mark.style.left = px + 'px';
      const line  = document.createElement('div');
      line.className = 'tl-ruler-mark-line';
      const lbl   = document.createElement('div');
      lbl.className = 'tl-ruler-mark-label';
      if (major) lbl.textContent = UI.formatTime(t);
      mark.appendChild(line);
      mark.appendChild(lbl);
      _rulerMarks.appendChild(mark);
    }
  }

  function _pickInterval(zoom) {
    const minPx = 55;
    const candidates = [0.5,1,2,5,10,15,30,60,120,300,600];
    return candidates.find(c => c * zoom >= minPx) ?? 600;
  }

  // ── All track rows ─────────────────────────────
  function _renderAllTracks(zoom) {
    if (!_tracks || !_labelsCol) return;
    _tracks.innerHTML = '';
    _labelsCol.innerHTML = '';

    const layers  = Layers.getAll();
    const usedIdx = [...new Set(layers.map(l => l.trackIndex))].sort((a,b)=>a-b);
    if (!usedIdx.includes(0)) usedIdx.unshift(0);
    const maxIdx = usedIdx.length ? usedIdx[usedIdx.length-1] : -1;
    usedIdx.push(maxIdx + 1);

    for (const idx of usedIdx) {
      const rowLayers = layers.filter(l => l.trackIndex === idx);
      const isAudio   = rowLayers.length > 0 && rowLayers.every(l => l.type === 'audio');

      const { row, label } = _makeRow(idx, rowLayers, isAudio, zoom);
      _tracks.appendChild(row);
      _labelsCol.appendChild(label);
    }

    requestAnimationFrame(() => _observeThumbs());
  }

  function _makeRow(trackIndex, rowLayers, isAudio, zoom) {
    const h = (isAudio ? AUDIO_H : ROW_H);

    const row = document.createElement('div');
    row.className = 'tl-row' + (isAudio ? ' audio-row' : '');
    row.dataset.trackIndex = trackIndex;
    row.style.height = h + 'px';

    const label = document.createElement('div');
    label.className = 'tl-row-label' + (isAudio ? ' audio-row-label' : '');
    const t = Settings.t;
    if (isAudio) {
      label.innerHTML = `<svg viewBox="0 0 16 16"><path d="M8 2v12M5 4v8M11 4v8M2 6v4M14 6v4"/></svg><span>${t('label_audio')}</span>`;
    } else {
      label.innerHTML = `<svg viewBox="0 0 16 16"><rect x="1" y="3" width="10" height="10" rx="1"/><path d="M11 6l4-2v8l-4-2"/></svg><span>${t('label_track')} ${trackIndex}</span>`;
    }

    row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('drop-active'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-active'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drop-active');
      const layerId = e.dataTransfer.getData('text/plain');
      if (!layerId) return;
      const layer = Layers.getById(layerId);
      if (!layer) return;
      const dropTime = _clientXToTime(e.clientX);
      const dur      = layer.timelineEnd - layer.timelineStart;
      Layers.update(layerId, {
        trackIndex,
        timelineStart: Math.max(0, dropTime),
        timelineEnd:   Math.max(0, dropTime) + dur,
      });
    });

    for (const layer of rowLayers) {
      row.appendChild(_makeClip(layer, zoom, isAudio));
    }
    return { row, label };
  }

  // ── Single clip element ─────────────────────────
  function _makeClip(layer, zoom, isAudio) {
    const leftPx  = layer.timelineStart * zoom;
    const widthPx = Math.max(4, (layer.timelineEnd - layer.timelineStart) * zoom);

    const typeClass = {
      video: 'tl-clip-video', audio: 'tl-clip-audio',
      image: 'tl-clip-image', recording: 'tl-clip-rec'
    };
    const clip = document.createElement('div');
    clip.className = 'tl-clip ' + (typeClass[layer.type] || 'tl-clip-video');
    clip.dataset.layerId = layer.id;
    clip.style.left  = leftPx + 'px';
    clip.style.width = widthPx + 'px';

    const lbl = document.createElement('div');
    lbl.className = 'tl-clip-label';
    lbl.textContent = layer.name;
    clip.appendChild(lbl);

    if (isAudio) {
      const waveWrap = document.createElement('div');
      waveWrap.style.cssText = 'position:absolute;inset:0;top:14px;overflow:hidden';
      waveWrap.innerHTML = _makeWaveSVG(widthPx, AUDIO_H - 14);
      clip.appendChild(waveWrap);
    } else {
      const thumbRow = document.createElement('div');
      thumbRow.className = 'tl-clip-thumbs';
      const count = Math.max(1, Math.floor(widthPx / 40));
      for (let i = 0; i < count; i++) {
        const t     = layer.timelineStart + (i / count) * (layer.timelineEnd - layer.timelineStart);
        const thumb = document.createElement('div');
        thumb.className   = 'tl-clip-thumb';
        thumb.dataset.layerId   = layer.id;
        thumb.dataset.thumbTime = t.toFixed(3);
        thumbRow.appendChild(thumb);
      }
      clip.appendChild(thumbRow);
    }

    const hL = document.createElement('div');
    hL.className = 'tl-clip-handle left';
    const hR = document.createElement('div');
    hR.className = 'tl-clip-handle right';
    clip.appendChild(hL);
    clip.appendChild(hR);

    clip.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _startClipDrag(e, layer, 'move');
    });
    hL.addEventListener('mousedown', e => {
      e.stopPropagation();
      _startClipDrag(e, layer, 'resize-left');
    });
    hR.addEventListener('mousedown', e => {
      e.stopPropagation();
      _startClipDrag(e, layer, 'resize-right');
    });
    clip.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _showClipMenu(e, layer);
    });
    clip.addEventListener('click', e => {
      if (_drag.didDrag) return;
      State.set('playhead', layer.timelineStart);
      State.emit('player:seek', layer.timelineStart);
    });

    return clip;
  }

  function _makeWaveSVG(width, height) {
    const mid  = height / 2;
    let d = `M0,${mid}`;
    const steps = Math.max(4, Math.floor(width / 3));
    for (let i = 1; i <= steps; i++) {
      const x   = (i / steps) * width;
      const amp = mid * 0.75 * Math.abs(Math.sin(i * 2.1 + width * 0.013));
      d += ` L${x.toFixed(1)},${(mid - amp).toFixed(1)} L${x.toFixed(1)},${(mid + amp).toFixed(1)}`;
    }
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
      width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path d="${d}" stroke="rgba(52,211,153,0.65)" stroke-width="1.2" fill="none"/>
    </svg>`;
  }

  function _renderTags() {
    if (!_inner) return;
    _inner.querySelectorAll('.tl-tag').forEach(el => el.remove());

    const zoom = State.get('zoomLevel');
    for (const tag of Tags.getAll()) {
      const el = document.createElement('div');
      el.className    = 'tl-tag';
      el.dataset.tagId = tag.id;
      el.style.left       = (tag.time * zoom) + 'px';
      el.style.background = tag.color || 'var(--tag-color)';
      el.style.setProperty('--tag-c', tag.color || 'var(--tag-color)');

      const lbl = document.createElement('div');
      lbl.className   = 'tl-tag-label';
      lbl.textContent = tag.label;
      el.appendChild(lbl);

      _initTagDrag(el, tag, zoom);

      el.addEventListener('click', e => {
        e.stopPropagation();
        Tags.jumpToTag(tag.id);
        if (e.shiftKey) {
          State.getSetting('tagSelectionMode') === 'tag-to-tag'
            ? Tags.selectToNext(tag.id)
            : Tags.selectToCursor(tag.id);
        }
      });
      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        const v = prompt('标签名称', tag.label);
        if (v !== null) Tags.update(tag.id, { label: v || tag.label });
      });
      el.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        _showTagMenu(e, tag);
      });

      _inner.appendChild(el);
    }
  }

  function _initTagDrag(el, tag, zoom) {
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const startX    = e.clientX;
      const origTime  = tag.time;
      let moved = false;
      const onMove = e2 => {
        const dt = (e2.clientX - startX) / zoom;
        moved = true;
        Tags.update(tag.id, { time: Math.max(0, origTime + dt) });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  function _updatePlayhead(time) {
    if (!_playheadEl) return;
    const px = time * State.get('zoomLevel');
    _playheadEl.style.transform = `translateX(${px}px)`;
    _autoScroll(px);
  }

  function _updateSelection(sel) {
    if (!_selectionEl) return;
    if (!sel) { _selectionEl.style.display = 'none'; return; }
    const zoom  = State.get('zoomLevel');
    const left  = sel.startTime * zoom;
    const width = Math.max(2, (sel.endTime - sel.startTime) * zoom);
    _selectionEl.style.display = 'block';
    _selectionEl.style.left    = left + 'px';
    _selectionEl.style.width   = width + 'px';
  }

  function _autoScroll(px) {
    if (!_scrollWrap) return;
    const sw    = _scrollWrap.scrollLeft;
    const ww    = _scrollWrap.offsetWidth;
    const local = px - sw;
    if (State.get('isPlaying') && (local < 80 || local > ww - 60)) {
      _scrollWrap.scrollLeft = px - ww * 0.3;
    }
  }

  function _startClipDrag(e, layer, type) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    Object.assign(_drag, {
      active: true, didDrag: false, type,
      layerId:    layer.id,
      startX:     e.clientX,
      startY:     e.clientY,
      origStart:  layer.timelineStart,
      origEnd:    layer.timelineEnd,
      origTrack:  layer.trackIndex,
    });

    document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize';

    const zoom   = State.get('zoomLevel');
    const onMove = e2 => _onClipDragMove(e2, zoom);
    const onUp   = ()  => {
      _drag.active = false;
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      render();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  function _onClipDragMove(e, zoom) {
    if (!_drag.active) return;
    const dx = e.clientX - _drag.startX;
    const dt = dx / zoom;
    if (Math.abs(dx) > 2) _drag.didDrag = true;

    if (_drag.type === 'move') {
      const dur      = _drag.origEnd - _drag.origStart;
      const newStart = Math.max(0, _drag.origStart + dt);
      const newTrack = _getTrackFromY(e.clientY);
      Layers.update(_drag.layerId, {
        timelineStart: newStart,
        timelineEnd:   newStart + dur,
        trackIndex:    newTrack,
      });
      const clipEl = _tracks?.querySelector(`[data-layer-id="${_drag.layerId}"]`);
      if (clipEl) {
        clipEl.style.left = (newStart * zoom) + 'px';
      }
    } else if (_drag.type === 'resize-left') {
      const newStart = Math.max(0, Math.min(_drag.origEnd - 0.05, _drag.origStart + dt));
      Layers.update(_drag.layerId, { timelineStart: newStart });
      const clipEl = _tracks?.querySelector(`[data-layer-id="${_drag.layerId}"]`);
      if (clipEl) {
        const w = Math.max(4, (_drag.origEnd - newStart) * zoom);
        clipEl.style.left  = (newStart * zoom) + 'px';
        clipEl.style.width = w + 'px';
      }
    } else if (_drag.type === 'resize-right') {
      const newEnd = Math.max(_drag.origStart + 0.05, _drag.origEnd + dt);
      Layers.update(_drag.layerId, { timelineEnd: newEnd });
      const clipEl = _tracks?.querySelector(`[data-layer-id="${_drag.layerId}"]`);
      if (clipEl) {
        clipEl.style.width = Math.max(4, (newEnd - _drag.origStart) * zoom) + 'px';
      }
    }
    _updatePlayhead(State.get('playhead'));
    _updateSelection(State.get('selection'));
  }

  function _getTrackFromY(clientY) {
    if (!_tracks) return 0;
    for (const row of _tracks.querySelectorAll('.tl-row')) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        return parseInt(row.dataset.trackIndex) || 0;
      }
    }
    const all = Layers.getAll();
    return all.length ? Math.max(...all.map(l => l.trackIndex)) + 1 : 0;
  }

  function _initPlayheadDrag() {
    const head = document.getElementById('tl-playhead-head');
    if (!head) return;
    head.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = head.getBoundingClientRect();
      const offset = e.clientX - (rect.left + rect.width / 2);

      document.body.style.cursor = 'ew-resize';
      const onMove = e2 => {
        const t = _clientXToTime(e2.clientX - offset);
        if (t !== null) {
          State.set('playhead', t);
          State.emit('player:seek', t);
        }
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

  function _initTrackAreaEvents() {
    if (!_tracks) return;
    _inner.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.tl-clip') || e.target.closest('.tl-tag')) return;
      const t = _clientXToTime(e.clientX);
      if (t === null) return;

      if (e.shiftKey) {
        const cur = State.get('playhead');
        const start = Math.min(cur, t);
        const end   = Math.max(cur, t);
        State.set('selection', { startTime: start, endTime: end, anchorTagId: null });
        return;
      }

      Tags.clearSelection();
      State.set('playhead', t);
      State.emit('player:seek', t);
      _drag.selAnchor = t;

      const onMove = e2 => {
        const t2 = _clientXToTime(e2.clientX);
        if (t2 === null) return;
        const start = Math.min(_drag.selAnchor, t2);
        const end   = Math.max(_drag.selAnchor, t2);
        if (end - start > 0.05) {
          State.set('selection', { startTime: start, endTime: end, anchorTagId: null });
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  function _initWheelZoom() {
    const wrap = document.getElementById('timeline-wrap');
    if (!wrap) return;
    wrap.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const next   = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, State.get('zoomLevel') * factor)));
      State.set('zoomLevel', next);
      const slider = document.getElementById('tl-zoom');
      if (slider) slider.value = next;
    }, { passive: false });
  }

  function _initThumbObserver() {
    _thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        if (el.dataset.loaded) continue;
        el.dataset.loaded = '1';
        _thumbObserver.unobserve(el);
        _loadThumb(el, el.dataset.layerId, parseFloat(el.dataset.thumbTime || '0'));
      }
    }, { root: _scrollWrap, rootMargin: '0px 300px' });
  }

  function _observeThumbs() {
    _tracks?.querySelectorAll('.tl-clip-thumb:not([data-loaded])').forEach(el => {
      _thumbObserver?.observe(el);
    });
  }

  async function _loadThumb(el, layerId, time) {
    const key = `${layerId}_${time.toFixed(2)}`;
    if (_thumbCache[key]) { _applyThumb(el, _thumbCache[key]); return; }
    try {
      const url = await Layers.getThumbnail(layerId, time);
      if (url) { _thumbCache[key] = url; _applyThumb(el, url); }
    } catch (_) {}
  }

  function _applyThumb(el, dataUrl) {
    const img = document.createElement('img');
    img.src   = dataUrl;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:2px';
    el.appendChild(img);
  }

  function _initScrollbar() {
    const thumb = document.getElementById('tl-scrollbar-thumb');
    const track = document.getElementById('tl-scrollbar-track');
    if (!thumb || !track || !_scrollWrap) return;

    _scrollWrap.addEventListener('scroll', _syncScrollbar);

    let drag = false, sx, sl;
    thumb.addEventListener('mousedown', e => {
      drag = true; sx = e.clientX; sl = thumb.offsetLeft;
      document.body.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      const tw = track.offsetWidth;
      const iw = _inner?.offsetWidth || tw;
      _scrollWrap.scrollLeft = (sl + e.clientX - sx) * (iw / tw);
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = false;
      document.body.style.cursor = '';
    });
  }

  function _syncScrollbar() {
    const thumb = document.getElementById('tl-scrollbar-thumb');
    const track = document.getElementById('tl-scrollbar-track');
    if (!thumb || !track || !_scrollWrap || !_inner) return;
    const iw = _inner.offsetWidth  || 1;
    const ww = _scrollWrap.offsetWidth || 1;
    const tw = track.offsetWidth;
    const r  = Math.min(1, ww / iw);
    thumb.style.width = Math.max(20, tw * r) + 'px';
    thumb.style.left  = (tw * (_scrollWrap.scrollLeft / iw)) + 'px';
  }

  function _removeCtxMenu() { _ctxMenu?.remove(); _ctxMenu = null; }

  function _showClipMenu(e, layer) {
    _removeCtxMenu();
    _ctxMenu = _buildMenu(e.clientX, e.clientY, [
      { label: '重命名', fn: () => {
          const v = prompt('层名称', layer.name);
          if (v !== null) Layers.update(layer.id, { name: v || layer.name });
      }},
      { label: '在此切割', fn: () => Layers.split(layer.id, State.get('playhead')) },
      { label: '复制层', fn: () => {
          const copy = Layers.create({ ...layer, name: layer.name + ' 副本',
            timelineStart: layer.timelineEnd, timelineEnd: layer.timelineEnd + (layer.timelineEnd - layer.timelineStart) });
          Layers.add(copy);
      }},
      null, // separator
      { label: '删除此层', fn: () => Layers.remove(layer.id), danger: true },
    ]);
    document.body.appendChild(_ctxMenu);
  }

  function _showTagMenu(e, tag) {
    _removeCtxMenu();
    _ctxMenu = _buildMenu(e.clientX, e.clientY, [
      { label: '重命名', fn: () => {
          const v = prompt('标签名称', tag.label);
          if (v !== null) Tags.update(tag.id, { label: v || tag.label });
      }},
      { label: '选到下一个标签', fn: () => Tags.selectToNext(tag.id) },
      { label: '选到光标位置',   fn: () => Tags.selectToCursor(tag.id) },
      null,
      { label: '删除标签', fn: () => Tags.remove(tag.id), danger: true },
    ]);
    document.body.appendChild(_ctxMenu);
  }

  function _buildMenu(x, y, items) {
    const menu = document.createElement('div');
    menu.style.cssText = [
      `position:fixed;left:${x}px;top:${y}px`,
      'background:var(--bg-panel)',
      'border:1px solid var(--border-hi)',
      'border-radius:6px;padding:4px',
      'z-index:9999;min-width:155px',
      'box-shadow:var(--shadow-float)',
      'font-size:12px;font-family:var(--font-ui)',
    ].join(';');

    for (const item of items) {
      if (!item) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border-dim);margin:3px 0';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.textContent = item.label;
      row.style.cssText = [
        'padding:6px 10px;border-radius:4px;cursor:pointer;transition:background 100ms',
        `color:${item.danger ? 'var(--rec-color)' : 'var(--text-primary)'}`,
      ].join(';');
      row.addEventListener('mouseenter', () => row.style.background = 'var(--bg-hover)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => { item.fn(); _removeCtxMenu(); });
      menu.appendChild(row);
    }

    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right  > window.innerWidth)  menu.style.left = (x - r.width)  + 'px';
      if (r.bottom > window.innerHeight) menu.style.top  = (y - r.height) + 'px';
    });
    return menu;
  }

  // ════════════════════════════════════════════════
  // PUBLIC UTILS
  // ════════════════════════════════════════════════
  function _clientXToTime(clientX) {
    if (!_inner) return null;
    const rect   = _inner.getBoundingClientRect();
    const zoom   = State.get('zoomLevel');
    const time   = (clientX - rect.left + scroll) / zoom;
    return Math.max(0, time);
  }

  function setZoom(pxPerSec) {
    State.set('zoomLevel', Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pxPerSec)));
  }

  function scrollTo(time) {
    if (!_scrollWrap) return;
    _scrollWrap.scrollLeft = time * State.get('zoomLevel') - _scrollWrap.offsetWidth * 0.3;
  }

  function pixelToTime(px) { return Math.max(0, px / State.get('zoomLevel')); }
  function timeToPixel(t)  { return t * State.get('zoomLevel'); }

  return { init, render, setZoom, scrollTo, pixelToTime, timeToPixel };
})();

window.Timeline = Timeline;
