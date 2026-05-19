/**
 * player.js — 完整合成播放器
 * Session 2: Canvas 逐层合成、音频 AudioContext、ChromaKey、Overlay 像素对齐
 */

const Player = (() => {
  // ── Canvas / context ──────────────────────────────
  let _canvas  = null;   // #preview-canvas  — composite output
  let _overlay = null;   // #preview-overlay — cursor position ghost
  let _ctx     = null;
  let _octx    = null;

  // ── Playback state ────────────────────────────────
  let _rafId      = null;
  let _playing    = false;
  let _startPerfT = 0;     // performance.now() at play start
  let _startTime  = 0;     // playhead position at play start (seconds)
  let _speed      = 1;
  let _selEnd     = null;  // if playing selection, stop here

  // ── Overlay ───────────────────────────────────────
  let _overlayOpacity = 0.3;
  let _overlayTime    = 0;

  // ── Media element caches ─────────────────────────
  const _videoEls = {};   // src → <video>
  const _imageEls = {};   // src → <img>
  const _audioNodes = {}; // layerId → { source, gainNode }

  // ── AudioContext ──────────────────────────────────
  let _audioCtx     = null;
  let _masterGain   = null;

  // ── Chroma key offscreen ──────────────────────────
  let _chromaCanvas = null;
  let _chromaCtx    = null;

  // ════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════
  function init(canvasEl) {
    _canvas  = canvasEl || document.getElementById('preview-canvas');
    _overlay = document.getElementById('preview-overlay');
    if (_canvas)  _ctx  = _canvas.getContext('2d');
    if (_overlay) _octx = _overlay.getContext('2d');

    _chromaCanvas = document.createElement('canvas');
    _chromaCtx    = _chromaCanvas.getContext('2d', { willReadFrequently: true });

    _initResize();
    _initAudio();

    // State subscriptions
    State.on('player:seek',            ({ value } = {}) => seek(typeof value === 'number' ? value : 0));
    State.on('player:setspeed',        v  => { _speed = v; });
    State.on('player:overlayopacity',  v  => { _overlayOpacity = v; _renderOverlay(_overlayTime); });
    State.on('state:change:playhead',  ({ value }) => {
      if (!_playing) { _overlayTime = value; _renderOverlay(value); }
    });
    State.on('layers:change', () => {
      if (!_playing) _renderFrame(State.get('playhead'));
    });

    console.info('[Player] Initialized.');
  }

  function _initResize() {
    const wrap = document.getElementById('preview-wrap');
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      _resizeCanvases();
      if (!_playing) _renderFrame(State.get('playhead'));
    });
    ro.observe(wrap);
    _resizeCanvases();
  }

  function _resizeCanvases() {
    const wrap = document.getElementById('preview-wrap');
    if (!wrap) return;
    const w = wrap.offsetWidth || 640;
    const h = wrap.offsetHeight || 360;
    for (const c of [_canvas, _overlay]) {
      if (!c) continue;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
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

  // ════════════════════════════════════════════════
  // PLAYBACK CONTROL
  // ════════════════════════════════════════════════
  function play(startTime, selectionEnd) {
    if (_playing) return;
    if (_audioCtx?.state === 'suspended') _audioCtx.resume();
    _playing    = true;
    _startTime  = startTime ?? State.get('playhead');
    _startPerfT = performance.now();
    _selEnd     = selectionEnd ?? null;
    _speed      = State.getSetting('previewSpeed') || 1;
    State.set('isPlaying', true);
    _startAudioLayers(_startTime);
    _loop();
  }

  function pause() {
    if (!_playing) return;
    _playing = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _stopAudioLayers();
    State.set('isPlaying', false);
  }

  function seek(time) {
    const wasPlaying = _playing;
    if (wasPlaying) pause();
    _startTime  = time;
    _startPerfT = performance.now();
    State.set('playhead', time);
    _overlayTime = time;
    _renderFrame(time);
    _renderOverlay(time);
    if (wasPlaying) play(time);
  }

  function setSpeed(rate) { _speed = rate; }

  function _loop() {
    if (!_playing) return;
    const elapsed = (performance.now() - _startPerfT) / 1000 * _speed;
    const time    = _startTime + elapsed;
    const total   = State.get('totalDuration');

    // Stop at selection end or total duration
    const stopAt = (_selEnd !== null) ? _selEnd : total;
    if (stopAt > 0 && time >= stopAt) {
      State.set('playhead', stopAt);
      _renderFrame(stopAt);
      pause();
      State.emit('player:ended', {});
      return;
    }

    State.set('playhead', time);
    _renderFrame(time);
    _rafId = requestAnimationFrame(() => _loop());
  }

  // ════════════════════════════════════════════════
  // FRAME RENDERING
  // ════════════════════════════════════════════════
  function _renderFrame(time) {
    if (!_ctx || !_canvas) return;
    const w = _canvas.width, h = _canvas.height;
    _ctx.clearRect(0, 0, w, h);

    // Check if we're inside a transition zone
    const tr = (typeof Transition !== 'undefined') ? Transition.getTransitionProgress(time) : null;

    if (tr && tr.progress > 0 && tr.progress < 1) {
      // Render frame at edit point boundary on offscreen canvases, then blend
      const offA = _makeOffscreen(w, h);
      const offB = _makeOffscreen(w, h);

      const layersA = _getActiveLayers(tr.editTime - 0.001);
      const layersB = _getActiveLayers(tr.editTime + 0.001);

      for (const l of layersA) _drawLayer(offA.ctx, l, tr.editTime - 0.001, w, h, false);
      for (const l of layersB) _drawLayer(offB.ctx, l, tr.editTime + 0.001, w, h, false);

      const imgA = offA.ctx.getImageData(0, 0, w, h);
      const imgB = offB.ctx.getImageData(0, 0, w, h);
      Transition.apply(_ctx, imgA, imgB, tr.progress, tr.type);
    } else {
      const layers = _getActiveLayers(time);
      for (const layer of layers) {
        _drawLayer(_ctx, layer, time, w, h, false);
      }
    }
  }

  function _makeOffscreen(w, h) {
    const c   = document.createElement('canvas');
    c.width   = w; c.height = h;
    const ctx = c.getContext('2d');
    return { canvas: c, ctx };
  }

  function _renderOverlay(time) {
    if (!_octx || !_overlay) return;
    const w = _overlay.width, h = _overlay.height;
    _octx.clearRect(0, 0, w, h);
    _octx.save();
    _octx.globalAlpha = _overlayOpacity;

    const layers = _getActiveLayers(time);
    for (const layer of layers) {
      _drawLayer(_octx, layer, time, w, h, false);
    }
    _octx.restore();
  }

  function _getActiveLayers(time) {
    return Layers.getAll()
      .filter(l => l.timelineStart <= time && l.timelineEnd > time)
      .sort((a, b) => a.trackIndex - b.trackIndex);
  }

  // ── Draw one layer onto a context ────────────────
  function _drawLayer(ctx, layer, time, cw, ch, forExport) {
    if (layer.type === 'audio') return; // audio handled separately

    const x  = layer.x      * cw;
    const y  = layer.y      * ch;
    const lw = layer.width  * cw;
    const lh = layer.height * ch;

    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.blendMode && layer.blendMode !== 'normal') {
      ctx.globalCompositeOperation = layer.blendMode;
    }

    if (layer.type === 'image') {
      const img = _getImage(layer.src);
      if (img?.complete && img.naturalWidth > 0) {
        if (layer.chromaKey) {
          _drawWithChromaKey(ctx, img, x, y, lw, lh, layer.chromaKey);
        } else {
          ctx.drawImage(img, x, y, lw, lh);
        }
      }
    } else if (layer.type === 'video' || layer.type === 'recording') {
      const vid = _getVideo(layer);
      if (vid) {
        const srcTime = layer.sourceStart + (time - layer.timelineStart) * (layer.speed ?? 1);
        // Sync video currentTime when not playing or when seeking
        if (!_playing || forExport) {
          if (Math.abs(vid.currentTime - srcTime) > 0.08) {
            vid.currentTime = Math.max(0, srcTime);
          }
        }
        if (vid.readyState >= 2) {
          if (layer.chromaKey) {
            _drawWithChromaKey(ctx, vid, x, y, lw, lh, layer.chromaKey);
          } else {
            ctx.drawImage(vid, x, y, lw, lh);
          }
        }
      }
    }

    ctx.restore();
  }

  // ── ChromaKey (simple color-range keying) ────────
  function _drawWithChromaKey(ctx, source, x, y, w, h, keyHex) {
    // Draw source to offscreen
    _chromaCanvas.width  = Math.round(w);
    _chromaCanvas.height = Math.round(h);
    _chromaCtx.drawImage(source, 0, 0, _chromaCanvas.width, _chromaCanvas.height);

    const imgData = _chromaCtx.getImageData(0, 0, _chromaCanvas.width, _chromaCanvas.height);
    const data    = imgData.data;
    const kr = parseInt(keyHex.slice(1,3), 16);
    const kg = parseInt(keyHex.slice(3,5), 16);
    const kb = parseInt(keyHex.slice(5,7), 16);
    const threshold = 80; // colour distance threshold

    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i]   - kr;
      const dg = data[i+1] - kg;
      const db = data[i+2] - kb;
      const dist = Math.sqrt(dr*dr + dg*dg + db*db);
      if (dist < threshold) {
        data[i+3] = 0; // transparent
      }
    }
    _chromaCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(_chromaCanvas, x, y, w, h);
  }

  // ── Media element factories ──────────────────────
  function _getImage(src) {
    if (!src) return null;
    if (!_imageEls[src]) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!_playing) _renderFrame(State.get('playhead'));
      };
      img.src = src;
      _imageEls[src] = img;
    }
    return _imageEls[src];
  }

  function _getVideo(layer) {
    if (!layer.src) return null;
    if (!_videoEls[layer.src]) {
      const vid = document.createElement('video');
      vid.src          = layer.src;
      vid.muted        = true;  // audio routed via AudioContext
      vid.preload      = 'auto';
      vid.crossOrigin  = 'anonymous';
      vid.playbackRate = layer.speed ?? 1;
      vid.addEventListener('seeked', () => {
        if (!_playing) _renderFrame(State.get('playhead'));
      });
      _videoEls[layer.src] = vid;
    }
    // Update playback rate in case changed
    _videoEls[layer.src].playbackRate = layer.speed ?? 1;
    return _videoEls[layer.src];
  }

  // ════════════════════════════════════════════════
  // AUDIO ROUTING via AudioContext
  // ════════════════════════════════════════════════
  function _startAudioLayers(startTime) {
    if (!_audioCtx) return;
    _stopAudioLayers();
    const layers = Layers.getAll()
      .filter(l => (l.type === 'audio' || l.type === 'video' || l.type === 'recording')
                && l.timelineStart <= startTime && l.timelineEnd > startTime);

    for (const layer of layers) {
      if (!layer.src) continue;
      const vid = _getVideo(layer);
      if (!vid) continue;
      try {
        const src   = _audioCtx.createMediaElementSource(vid);
        const gain  = _audioCtx.createGain();
        gain.gain.value = layer.type === 'audio' ? (layer.opacity ?? 1) : 1;
        src.connect(gain);
        gain.connect(_masterGain);
        vid.muted   = false;
        const srcT  = layer.sourceStart + (startTime - layer.timelineStart) * (layer.speed ?? 1);
        vid.currentTime = Math.max(0, srcT);
        vid.play().catch(() => {});
        _audioNodes[layer.id] = { source: src, gainNode: gain, vid };
      } catch (e) {
        // MediaElementSource already created — just play
        vid.muted = false;
        vid.play().catch(() => {});
      }
    }
  }

  function _stopAudioLayers() {
    for (const { vid } of Object.values(_audioNodes)) {
      vid.pause();
    }
    // Don't disconnect — MediaElementSource can only be created once per element
  }

  // ════════════════════════════════════════════════
  // getFrame — for thumbnails and export
  // ════════════════════════════════════════════════
  async function getFrame(time, layersOverride) {
    const proj = State.get('project')?.meta ?? {};
    const w    = proj.width  || 320;
    const h    = proj.height || 180;

    const off  = document.createElement('canvas');
    off.width  = w;
    off.height = h;
    const ctx  = off.getContext('2d');

    const layers = (layersOverride ?? Layers.getAll())
      .filter(l => l.type !== 'audio' && l.timelineStart <= time && l.timelineEnd > time)
      .sort((a, b) => a.trackIndex - b.trackIndex);

    for (const layer of layers) {
      await _seekLayerToTime(layer, time);
      _drawLayer(ctx, layer, time, w, h, true);
    }

    return ctx.getImageData(0, 0, w, h);
  }

  async function _seekLayerToTime(layer, time) {
    if (layer.type === 'image') {
      const img = _getImage(layer.src);
      if (img && !img.complete) {
        await new Promise(res => { img.onload = res; setTimeout(res, 1000); });
      }
      return;
    }
    const vid = _getVideo(layer);
    if (!vid) return;
    const srcTime = layer.sourceStart + (time - layer.timelineStart) * (layer.speed ?? 1);
    if (Math.abs(vid.currentTime - srcTime) < 0.05) return;
    await new Promise(res => {
      const onSeeked = () => { vid.removeEventListener('seeked', onSeeked); res(); };
      vid.addEventListener('seeked', onSeeked);
      vid.currentTime = Math.max(0, srcTime);
      setTimeout(res, 800); // timeout fallback
    });
  }

  function renderOverlay(time) {
    _overlayTime = time;
    _renderOverlay(time);
  }

  return {
    init, play, pause, seek, setSpeed,
    getFrame, renderOverlay
  };
})();

window.Player = Player;
