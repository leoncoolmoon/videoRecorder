/**
 * player.js — 完整合成播放器
 * Refactored: Consolidated preview-canvas and preview-overlay into a single overlay canvas.
 */

const Player = (() => {
  let _canvas  = null; // Points to #preview-overlay
  let _ctx     = null;

  let _rafId      = null;
  let _playing    = false;
  let _startPerfT = 0;
  let _startTime  = 0;
  let _speed      = 1;
  let _selEnd     = null;

  let _overlayOpacity = 0.3;

  const _videoEls = {};   // layerId -> HTMLVideoElement
  const _imageEls = {};   // src -> HTMLImageElement
  const _audioNodes = {}; // layerId -> { source, gainNode, vid }

  let _audioCtx     = null;
  let _masterGain   = null;

  let _chromaCanvas = null;
  let _chromaCtx    = null;

  function init(canvasEl) {
    _canvas = canvasEl || document.getElementById('preview-overlay');
    if (_canvas) _ctx = _canvas.getContext('2d');

    _chromaCanvas = document.createElement('canvas');
    _chromaCtx    = _chromaCanvas.getContext('2d', { willReadFrequently: true });

    _initResize();
    _initAudio();

    State.on('player:seek',            ({ value } = {}) => seek(typeof value === 'number' ? value : 0));
    State.on('player:setspeed',        v  => { setSpeed(v); });
    State.on('player:overlayopacity',  v  => {
      _overlayOpacity = v;
      _updatePauseOpacity();
    });
    State.on('state:change:playhead',  ({ value }) => {
      if (!_playing) {
        _render(value);
        _updatePauseOpacity();
      }
    });
    State.on('layers:change', () => {
      if (!_playing) _render(State.get('playhead'));
    });

    State.on('state:change:isPlaying',   () => _updatePauseOpacity());
    State.on('state:change:isRecording', () => _updatePauseOpacity());
    State.on('settings:change:playbackCompareMode', () => _updatePauseOpacity());

    _updatePauseOpacity();
    console.info('[Player] Initialized with consolidated overlay canvas.');
  }

  function _initResize() {
    const wrap = document.getElementById('preview-wrap');
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      _resizeCanvases();
      if (!_playing) {
        _render(State.get('playhead'));
      }
    });
    ro.observe(wrap);
    _resizeCanvases();
  }

  function _resizeCanvases() {
    const proj = State.get('project')?.meta ?? {};
    const w = proj.width  || 1920;
    const h = proj.height || 1080;

    if (_canvas) {
      if (_canvas.width !== w || _canvas.height !== h) {
        _canvas.width = w;
        _canvas.height = h;
      }
    }
  }

  function _initAudio() {
    try {
      _audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
      _masterGain = _audioCtx.createGain();
      _masterGain.connect(_audioCtx.destination);
    } catch (e) {
      console.warn('[Player] AudioContext unavailable:', e);
    }
  }

  function play(startTime, selectionEnd) {
    if (_playing) return;
    if (_audioCtx?.state === 'suspended') _audioCtx.resume();
    _playing    = true;
    _startTime  = startTime ?? State.get('playhead');
    _startPerfT = performance.now();
    _selEnd     = selectionEnd ?? null;
    _speed      = State.getSetting('previewSpeed') || 1;
    State.set('isPlaying', true);
    _updatePauseOpacity();
    _startAudioLayers(_startTime);
    _loop();
  }

  function pause() {
    if (!_playing) return;
    _playing = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _stopAudioLayers();
    State.set('isPlaying', false);
    _updatePauseOpacity();
  }

  function seek(time) {
    const wasPlaying = _playing;
    if (wasPlaying) pause();
    _startTime  = time;
    _startPerfT = performance.now();
    State.set('playhead', time);
    _render(time);
    if (wasPlaying) play(time);
  }

  function setSpeed(rate) {
    _speed = rate;
    Object.values(_videoEls).forEach(vid => {
      vid.playbackRate = rate;
    });
    for (const node of Object.values(_audioNodes)) {
      if (node.vid) node.vid.playbackRate = rate;
    }
  }

  function _updatePauseOpacity() {
    if (!_canvas) return;
    const isPlaying   = State.get('isPlaying');
    const isRecording = State.get('isRecording');
    const isCompare   = State.getSetting('playbackCompareMode');
    const isIdle      = !isPlaying && !isRecording;

    // Live feed visibility
    const live = document.getElementById('preview-live');
    if (live) {
      // Visible if recording, idle, or in comparison playback
      // Note: During normal playback (isCompare=false), we hide live to avoid bleeding
      live.style.opacity = (isRecording || isIdle || (isPlaying && isCompare)) ? 1 : 0;
    }

    // Consolidated Overlay canvas visibility and opacity
    if (isRecording) {
      // Never show overlay during recording (it might be confusing/covering the feed)
      _canvas.style.opacity = 0;
    } else if (isPlaying) {
      // If compare mode is ON, show overlay with partial opacity over the live feed
      // If compare mode is OFF, show overlay with 100% opacity
      _canvas.style.opacity = isCompare ? _overlayOpacity : 1;
    } else {
      // Idle: show overlay with current opacity setting (default 0.3) over live feed
      _canvas.style.opacity = _overlayOpacity;
    }
  }

  function _loop() {
    if (!_playing) return;
    const elapsed = (performance.now() - _startPerfT) / 1000 * _speed;
    const time    = _startTime + elapsed;
    const total   = State.get('totalDuration');

    const stopAt = (_selEnd !== null) ? _selEnd : total;
    if (stopAt > 0 && time >= stopAt) {
      State.set('playhead', stopAt);
      _render(stopAt);
      pause();
      State.emit('player:ended', {});
      return;
    }

    State.set('playhead', time);
    _render(time);
    _rafId = requestAnimationFrame(() => _loop());
  }

  function _render(time) {
    if (!_ctx || !_canvas) return;
    const w = _canvas.width, h = _canvas.height;
    _ctx.clearRect(0, 0, w, h);

    const tr = (typeof Transition !== 'undefined') ? Transition.getTransitionProgress(time) : null;

    if (tr && tr.progress > 0 && tr.progress < 1) {
      const offA = _makeOffscreen(w, h);
      const offB = _makeOffscreen(w, h);
      const layersA = _getActiveLayers(tr.editTime - 0.001);
      const layersB = _getActiveLayers(tr.editTime + 0.001);
      for (const l of layersA) _drawLayer(offA.ctx, l, tr.editTime - 0.001, w, h, true);
      for (const l of layersB) _drawLayer(offB.ctx, l, tr.editTime + 0.001, w, h, true);
      Transition.apply(_ctx, offA.ctx.getImageData(0,0,w,h), offB.ctx.getImageData(0,0,w,h), tr.progress, tr.type);
    } else {
      const layers = _getActiveLayers(time);
      for (const layer of layers) {
        _drawLayer(_ctx, layer, time, w, h, false);
      }
    }
  }

  function _makeOffscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d') };
  }

  function _getActiveLayers(time) {
    return Layers.getAll()
      .filter(l => l.timelineStart <= time && l.timelineEnd > time)
      .sort((a, b) => a.trackIndex - b.trackIndex);
  }

  function _drawLayer(ctx, layer, time, cw, ch, forExport) {
    if (layer.type === 'audio') return;
    let x = (layer.x ?? 0) * cw, y = (layer.y ?? 0) * ch;
    let lw = (layer.width ?? 1) * cw, lh = (layer.height ?? 1) * ch;

    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.blendMode && layer.blendMode !== 'normal') ctx.globalCompositeOperation = layer.blendMode;

    if (layer.type === 'image') {
      const img = _getImage(layer.src);
      if (img?.complete && img.naturalWidth > 0) {
        const { dx, dy, dw, dh } = _fitInRect(img.naturalWidth, img.naturalHeight, x, y, lw, lh);
        if (layer.chromaKey) _drawWithChromaKey(ctx, img, dx, dy, dw, dh, layer.chromaKey);
        else ctx.drawImage(img, dx, dy, dw, dh);
      }
    } else if (layer.type === 'video' || layer.type === 'recording') {
      const vid = _getVideo(layer);
      if (vid) {
        const srcTime = layer.sourceStart + (time - layer.timelineStart) * (layer.speed ?? 1);

        // Sync time if paused, scrubbing, or if we drift too much during playback
        const drift = Math.abs(vid.currentTime - srcTime);
        if (!_playing || forExport || drift > 0.2) {
          vid.currentTime = Math.max(0, srcTime);
        }

        // Ensure playing if we are in the playback loop
        if (_playing && !forExport && vid.paused && vid.readyState >= 2) {
          vid.play().catch(() => {});
        }

        if (vid.readyState >= 2) {
          const { dx, dy, dw, dh } = _fitInRect(vid.videoWidth, vid.videoHeight, x, y, lw, lh);
          if (layer.chromaKey) _drawWithChromaKey(ctx, vid, dx, dy, dw, dh, layer.chromaKey);
          else ctx.drawImage(vid, dx, dy, dw, dh);
        }
      }
    }
    ctx.restore();
  }

  function _fitInRect(srcW, srcH, tx, ty, tw, th) {
    const srcAspect = srcW / srcH, tgtAspect = tw / th;
    let dw = tw, dh = th, dx = tx, dy = ty;
    if (srcAspect > tgtAspect) { dh = tw / srcAspect; dy = ty + (th - dh) / 2; }
    else { dw = th * srcAspect; dx = tx + (tw - dw) / 2; }
    return { dx, dy, dw, dh };
  }

  function _drawWithChromaKey(ctx, source, x, y, w, h, keyHex) {
    _chromaCanvas.width = Math.round(w); _chromaCanvas.height = Math.round(h);
    _chromaCtx.drawImage(source, 0, 0, _chromaCanvas.width, _chromaCanvas.height);
    const imgData = _chromaCtx.getImageData(0, 0, _chromaCanvas.width, _chromaCanvas.height);
    const data = imgData.data, kr = parseInt(keyHex.slice(1,3), 16), kg = parseInt(keyHex.slice(3,5), 16), kb = parseInt(keyHex.slice(5,7), 16);
    for (let i = 0; i < data.length; i += 4) {
      const dist = Math.sqrt(Math.pow(data[i]-kr,2) + Math.pow(data[i+1]-kg,2) + Math.pow(data[i+2]-kb,2));
      if (dist < 80) data[i+3] = 0;
    }
    _chromaCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(_chromaCanvas, x, y, w, h);
  }

  function _getImage(src) {
    if (!src) return null;
    if (!_imageEls[src]) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { if (!_playing) _render(State.get('playhead')); };
      img.src = src; _imageEls[src] = img;
    }
    return _imageEls[src];
  }

  function _getVideo(layer) {
    if (!layer.src) return null;
    const key = layer.id || layer.src;
    if (!_videoEls[key]) {
      const vid = document.createElement('video');
      vid.src = layer.src;
      vid.muted = true;
      vid.preload = 'auto';
      vid.crossOrigin = 'anonymous';
      vid.playsInline = true;
      vid.addEventListener('seeked', () => { if (!_playing) _render(State.get('playhead')); });
      _videoEls[key] = vid;
    }
    _videoEls[key].playbackRate = (layer.speed ?? 1) * (_speed || 1);
    return _videoEls[key];
  }

  function _startAudioLayers(startTime) {
    if (!_audioCtx) return;
    _stopAudioLayers();
    const layers = Layers.getAll().filter(l => (l.type === 'audio' || l.type === 'video' || l.type === 'recording') && l.timelineStart <= startTime && l.timelineEnd > startTime);
    for (const layer of layers) {
      const vid = _getVideo(layer); if (!vid) continue;
      try {
        const src = _audioCtx.createMediaElementSource(vid), gain = _audioCtx.createGain();
        gain.gain.value = layer.type === 'audio' ? (layer.opacity ?? 1) : 1;
        src.connect(gain); gain.connect(_masterGain); vid.muted = false;
        vid.currentTime = Math.max(0, layer.sourceStart + (startTime - layer.timelineStart) * (layer.speed ?? 1));
        vid.playbackRate = _speed; vid.play().catch(() => {});
        _audioNodes[layer.id] = { source: src, gainNode: gain, vid };
      } catch (e) {
        vid.muted = false; vid.playbackRate = _speed; vid.play().catch(() => {});
      }
    }
  }

  function _stopAudioLayers() {
    Object.values(_audioNodes).forEach(n => n.vid.pause());
  }

  async function getFrame(time, layersOverride) {
    const proj = State.get('project')?.meta ?? {}, w = proj.width || 320, h = proj.height || 180;
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    const layers = (layersOverride ?? Layers.getAll()).filter(l => l.type !== 'audio' && l.timelineStart <= time && l.timelineEnd > time).sort((a, b) => a.trackIndex - b.trackIndex);
    for (const layer of layers) { await _seekLayerToTime(layer, time); _drawLayer(ctx, layer, time, w, h, true); }
    return ctx.getImageData(0, 0, w, h);
  }

  async function _seekLayerToTime(layer, time) {
    if (layer.type === 'image') {
      const img = _getImage(layer.src);
      if (img && !img.complete) await new Promise(res => { img.onload = res; setTimeout(res, 1000); });
      return;
    }
    const vid = _getVideo(layer); if (!vid) return;
    const srcT = layer.sourceStart + (time - layer.timelineStart) * (layer.speed ?? 1);
    if (Math.abs(vid.currentTime - srcT) < 0.05) return;
    await new Promise(res => {
      const onSeeked = () => { vid.removeEventListener('seeked', onSeeked); res(); };
      vid.addEventListener('seeked', onSeeked); vid.currentTime = Math.max(0, srcT);
      setTimeout(res, 800);
    });
  }

  function renderOverlay(time) { _render(time); }

  return { init, play, pause, seek, setSpeed, getFrame, renderOverlay };
})();

window.Player = Player;
