/**
 * recorder.js — 完整录制实现
 * Session 2/3: insert/overwrite 模式、设备选择、暂停续录、首帧缩略图
 */

const Recorder = (() => {
  let _stream    = null;   // MediaStream (camera + mic)
  let _recorder  = null;   // MediaRecorder
  let _chunks    = [];
  let _layer     = null;   // 当前录制层
  let _recStartPerfT = 0;  // performance.now() at segment start
  let _recStartPlayhead = 0; // playhead at segment start
  let _rafId     = null;
  let _insertGapApplied = false;

  // ── Device lists ─────────────────────────────────
  let _videoDevices = [];
  let _audioDevices = [];
  let _activeVideoId = null;
  let _activeAudioId = null;

  // ════════════════════════════════════════════════
  // INIT — request permissions + enumerate devices
  // ════════════════════════════════════════════════
  async function init() {
    try {
      // Request permissions first (needed to enumerate labelled devices)
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) {
      console.warn('[Recorder] Permission denied or no camera.');
    }

    await _enumerateDevices();

    // Start with defaults
    await _openStream(_activeVideoId, _activeAudioId);
    console.info('[Recorder] Initialized.');
  }

  async function _enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      _videoDevices = devices.filter(d => d.kind === 'videoinput');
      _audioDevices = devices.filter(d => d.kind === 'audioinput');
      if (_videoDevices.length) _activeVideoId = _videoDevices[0].deviceId;
      if (_audioDevices.length) _activeAudioId = _audioDevices[0].deviceId;
      State.emit('recorder:devices', { video: _videoDevices, audio: _audioDevices });
    } catch (e) {
      console.warn('[Recorder] enumerateDevices failed:', e);
    }
  }

  async function _openStream(videoDeviceId, audioDeviceId) {
    // Stop old stream
    if (_stream) _stream.getTracks().forEach(t => t.stop());

    const settings = State.get('settings');
    const [rw, rh] = (settings.resolution || '1280x720').split('x').map(Number);

    const constraints = {
      video: videoDeviceId
        ? { deviceId: { exact: videoDeviceId }, width: rw, height: rh, frameRate: settings.fps || 30 }
        : { width: rw, height: rh, frameRate: settings.fps || 30 },
      audio: audioDeviceId
        ? { deviceId: { exact: audioDeviceId } }
        : true,
    };

    try {
      _stream = await navigator.mediaDevices.getUserMedia(constraints);
      const liveEl = document.getElementById('preview-live');
      if (liveEl) { liveEl.srcObject = _stream; }
      State.emit('recorder:stream-ready', _stream);
    } catch (e) {
      console.error('[Recorder] getUserMedia failed:', e);
      State.emit('recorder:error', e);
    }
  }

  // ── Public device selectors ───────────────────────
  async function setVideoDevice(deviceId) {
    _activeVideoId = deviceId;
    await _openStream(deviceId, _activeAudioId);
  }

  async function setAudioDevice(deviceId) {
    _activeAudioId = deviceId;
    await _openStream(_activeVideoId, deviceId);
  }

  function getDevices() {
    return { video: _videoDevices, audio: _audioDevices };
  }

  function getStream() { return _stream; }
  function setMode(mode) { State.set('mode', mode); }

  // ════════════════════════════════════════════════
  // START / PAUSE / STOP
  // ════════════════════════════════════════════════
  function start() {
    if (!_stream) { init().then(() => start()); return; }
    // If already recording (not paused), no-op
    if (State.get('isRecording') && !State.get('isPaused')) return;
    // Resume from pause
    if (State.get('isPaused') && _recorder?.state === 'paused') {
      _resume(); return;
    }
    _startNewSegment();
  }

  function _startNewSegment() {
    _chunks   = [];
    _insertGapApplied = false;

    const mime = _pickMime();
    _recorder  = new MediaRecorder(_stream, mime ? { mimeType: mime } : {});
    _recorder.ondataavailable = e => { if (e.data?.size > 0) _chunks.push(e.data); };
    _recorder.onstop = _onRecorderStop;

    const playhead = State.get('playhead');
    const mode     = State.get('mode');

    // In OVERWRITE mode: delete content under cursor before recording
    if (mode === 'overwrite') {
      // We don't know end time yet; we'll delete as we go via deleteRange on stop
      // For simplicity: mark start point; on stop, deleteRange(start, end)
    }

    // In INSERT mode: shift existing layers right to make room
    // We'll apply the gap on stop once we know duration
    // (Can't know duration in advance)

    // Create placeholder layer
    _layer = Layers.create({
      type:          'recording',
      name:          `录制 ${new Date().toLocaleTimeString()}`,
      timelineStart: playhead,
      timelineEnd:   playhead,
      sourceStart:   0,
      sourceEnd:     0,
      x: 0, y: 0, width: 1, height: 1,
      opacity: 1, speed: 1,
    });
    Layers.add(_layer);

    _recorder.start(100);   // collect every 100 ms
    _recStartPerfT    = performance.now();
    _recStartPlayhead = playhead;

    State.set('isRecording', true);
    State.set('isPaused',    false);
    _tickTimer();
    State.emit('recorder:start', { layer: _layer });
  }

  function _resume() {
    _recorder.resume();
    _recStartPerfT = performance.now() - (_recStartPlayhead - State.get('playhead')) * 1000 / (State.getSetting('previewSpeed') || 1);
    State.set('isPaused', false);
    _tickTimer();
    State.emit('recorder:resume', {});
  }

  function pause() {
    if (!State.get('isRecording') || State.get('isPaused')) return;
    if (_recorder?.state === 'recording') _recorder.pause();
    _stopTimer();
    State.set('isPaused', true);
    State.emit('recorder:pause', {});
  }

  function stop() {
    if (!_recorder) return;
    _stopTimer();
    _recorder.stop();   // triggers _onRecorderStop via onstop
    State.set('isRecording', false);
    State.set('isPaused',    false);
    State.emit('recorder:stop', {});
  }

  // ── Timer — updates layer.timelineEnd in real time ──
  function _tickTimer() {
    _rafId = requestAnimationFrame(() => {
      if (!State.get('isRecording') || State.get('isPaused')) return;
      const elapsed = (performance.now() - _recStartPerfT) / 1000;
      const newEnd  = _recStartPlayhead + elapsed;
      if (_layer) {
        Layers.update(_layer.id, {
          timelineEnd: newEnd,
          sourceEnd:   elapsed,
        });
        State.set('playhead', newEnd);
      }
      _tickTimer();
    });
  }

  function _stopTimer() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  // ── Finalise recording segment ────────────────────
  function _onRecorderStop() {
    const blob    = new Blob(_chunks, { type: _chunks[0]?.type || 'video/webm' });
    const url     = URL.createObjectURL(blob);
    const dur     = (performance.now() - _recStartPerfT) / 1000;
    const start   = _recStartPlayhead;
    const end     = start + dur;
    const mode    = State.get('mode');

    if (_layer) {
      // Apply insert/overwrite adjustments
      if (mode === 'insert') {
        // Shift all OTHER layers that start at or after `start` forward by `dur`
        Layers.getAll().forEach(l => {
          if (l.id !== _layer.id && l.timelineStart >= start) {
            Layers.update(l.id, {
              timelineStart: l.timelineStart + dur,
              timelineEnd:   l.timelineEnd   + dur,
            });
          }
        });
      } else if (mode === 'overwrite') {
        // Delete content from other layers that overlaps our recording
        Layers.getAll().forEach(l => {
          if (l.id === _layer.id) return;
          if (l.timelineEnd > start && l.timelineStart < end) {
            // Split or trim the layer
            if (l.timelineStart < start && l.timelineEnd > end) {
              Layers.split(l.id, start);
              // Right part: trim its start to `end`
              const right = Layers.getAll().find(x =>
                x.id !== l.id && x.src === l.src && x.timelineStart === start);
              if (right) Layers.update(right.id, { timelineStart: end });
            } else if (l.timelineStart < start) {
              Layers.update(l.id, { timelineEnd: start });
            } else if (l.timelineEnd > end) {
              Layers.update(l.id, { timelineStart: end });
            } else {
              Layers.remove(l.id); // fully covered
            }
          }
        });
      }

      Layers.update(_layer.id, {
        src:        url,
        timelineEnd: end,
        sourceEnd:   dur,
      });

      // Generate thumbnail from first frame
      _generateThumbnail(url, _layer.id);
    }

    _chunks   = [];
    _layer    = null;
    _recorder = null;
  }

  async function _generateThumbnail(blobUrl, layerId) {
    try {
      const vid = document.createElement('video');
      vid.src   = blobUrl;
      vid.muted = true;
      await new Promise(res => {
        vid.onloadeddata = res;
        vid.onerror      = res;
        setTimeout(res, 2000);
        vid.load();
      });
      vid.currentTime = 0.1;
      await new Promise(res => { vid.onseeked = res; setTimeout(res, 800); });
      const off = document.createElement('canvas');
      off.width  = 160; off.height = 90;
      off.getContext('2d').drawImage(vid, 0, 0, 160, 90);
      const thumb = off.toDataURL('image/jpeg', 0.7);
      Layers.update(layerId, { thumbnail: thumb });
    } catch (e) {
      console.warn('[Recorder] thumbnail failed:', e);
    }
  }

  function _pickMime() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  return {
    init, start, pause, stop,
    getStream, getDevices,
    setMode, setVideoDevice, setAudioDevice,
  };
})();

window.Recorder = Recorder;
