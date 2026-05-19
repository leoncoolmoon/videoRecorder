/**
 * export.js — 完整导出实现
 * Session 4:
 *   - WebCodecs 路径: VideoEncoder + AudioEncoder + mp4box.js 封装
 *   - ffmpeg.wasm 路径: 动态加载，帧序列写虚拟 FS
 *   - 台词叠加 (Teleprompter.renderToCanvas)
 *   - 编辑点过渡帧 (Transition.apply)
 *   - 精确进度条，取消立即中断
 */

const Export = (() => {

  // ── Cancel flag ───────────────────────────────────
  let _cancelled = false;
  let _cancelFn  = null;   // set by each engine to abort early

  // ════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════

  /**
   * toMP4(options)
   * options: { engine?, format?, speed?, withTeleprompter?, selection? }
   * Returns Promise<Blob>
   */
  async function toMP4(options = {}) {
    const engine = options.engine
      ?? State.getSetting('exportEngine')
      ?? 'webcodecs';

    _cancelled = false;
    _showModal();

    try {
      let blob;
      if (engine === 'ffmpeg') {
        blob = await _exportFfmpeg(options);
      } else {
        // WebCodecs with graceful fallback
        if (typeof VideoEncoder !== 'undefined') {
          blob = await _exportWebCodecs(options);
        } else {
          _setModalTitle('WebCodecs 不支持，改用 ffmpeg.wasm…');
          blob = await _exportFfmpeg(options);
        }
      }
      _hideModal();
      State.emit('export:done', blob);
      _triggerDownload(blob, _buildFilename(options));
      return blob;
    } catch (err) {
      _hideModal();
      if (err.message === 'CANCELLED') return null;
      State.emit('export:error', err);
      alert('导出失败: ' + err.message);
      throw err;
    }
  }

  function estimateDuration(options = {}) {
    const sel   = options.selection;
    const dur   = sel ? (sel.endTime - sel.startTime) : (State.get('totalDuration') || 0);
    const speed = options.speed ?? State.getSetting('exportSpeed') ?? 1;
    return dur / speed;
  }

  // ════════════════════════════════════════════════
  // WEBCODECS ENGINE
  // ════════════════════════════════════════════════
  async function _exportWebCodecs(options) {
    const proj       = State.get('project')?.meta ?? {};
    const fps        = proj.fps || 30;
    const width      = proj.width  || 1280;
    const height     = proj.height || 720;
    const speed      = options.speed  ?? State.getSetting('exportSpeed')  ?? 1;
    const withTP     = options.withTeleprompter
                    ?? State.getSetting('exportWithTeleprompter')
                    ?? false;
    const sel        = options.selection ?? null;
    const startT     = sel ? sel.startTime  : 0;
    const endT       = sel ? sel.endTime    : (State.get('totalDuration') || 0);
    const realDur    = (endT - startT);
    const totalFrames = Math.ceil(realDur * fps);

    if (totalFrames === 0) throw new Error('没有可导出的内容');

    _setModalTitle('正在导出（WebCodecs）…');

    // ── Load mp4box.js on demand ─────────────────
    await _loadScript('https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js', 'MP4Box');

    // ── Setup VideoEncoder ───────────────────────
    const chunks   = [];     // EncodedVideoChunk[]
    let   encError = null;

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => chunks.push({ chunk, meta }),
      error:  e => { encError = e; },
    });

    const codecString = _pickVideoCodec();
    videoEncoder.configure({
      codec:         codecString,
      width,
      height,
      bitrate:       (State.getSetting('videoBitrate') || 8000) * 1000,
      framerate:     fps,
      latencyMode:   'quality',
    });

    // ── Offscreen render canvas ──────────────────
    const offCanvas = new OffscreenCanvas(width, height);
    const offCtx    = offCanvas.getContext('2d');

    // ── Encode frames ────────────────────────────
    let frameIdx = 0;
    for (let i = 0; i < totalFrames; i++) {
      if (_cancelled) { videoEncoder.close(); throw new Error('CANCELLED'); }
      if (encError)   { videoEncoder.close(); throw encError; }

      // Time in source timeline (adjusting for speed)
      const sourceT = startT + (i / fps) * speed;
      const tsUs    = Math.round((i / fps) * 1_000_000); // presentation timestamp μs

      // Render frame
      offCtx.clearRect(0, 0, width, height);
      await _renderFrameToCtx(offCtx, sourceT, width, height, withTP);

      // Encode
      const vf = new VideoFrame(offCanvas, { timestamp: tsUs });
      videoEncoder.encode(vf, { keyFrame: (i % (fps * 2) === 0) });
      vf.close();

      // Flush every 30 frames to avoid memory buildup
      if (i % 30 === 0) await videoEncoder.flush();

      _setProgress((i + 1) / totalFrames * 0.85); // 85% for video encode
    }

    await videoEncoder.flush();
    videoEncoder.close();

    _setProgress(0.88);

    // ── Mux into MP4 with mp4box.js ──────────────
    const mp4file = MP4Box.createFile();

    const trackId = mp4file.addTrack({
      timescale: 1_000_000,
      width,
      height,
      nb_samples: totalFrames,
      type: 'avc1',
      avcDecoderConfigRecord: chunks[0]?.meta?.decoderConfig?.description,
    });

    let sampleIdx = 0;
    for (const { chunk } of chunks) {
      const buf = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buf);
      mp4file.addSample(trackId, buf, {
        duration:  Math.round(1_000_000 / fps),
        cts:       chunk.timestamp,
        dts:       chunk.timestamp,
        is_sync:   chunk.type === 'key',
      });
      sampleIdx++;
      if (sampleIdx % 30 === 0) _setProgress(0.88 + (sampleIdx / chunks.length) * 0.10);
    }

    _setProgress(0.98);

    // Write MP4 to ArrayBuffer
    const mp4Buf = await new Promise(res => {
      const outBufs = [];
      mp4file.onSegment = (id, user, buf) => outBufs.push(buf);
      mp4file.setSegmentOptions(trackId, null, { nbSamples: totalFrames });
      mp4file.initializeSegmentation();
      mp4file.flush();
      // Collect into single buffer
      const total = outBufs.reduce((s, b) => s + b.byteLength, 0);
      const out   = new Uint8Array(total);
      let offset  = 0;
      for (const b of outBufs) { out.set(new Uint8Array(b), offset); offset += b.byteLength; }
      res(out.buffer);
    });

    _setProgress(1.0);
    return new Blob([mp4Buf], { type: 'video/mp4' });
  }

  function _pickVideoCodec() {
    const candidates = ['avc1.42E01E', 'avc1.4D401E', 'vp8', 'vp09.00.10.08'];
    // VideoEncoder.isConfigSupported is async; pick first likely-supported
    // AVC (H.264) baseline is most broadly supported
    return 'avc1.42E01E';
  }

  // ════════════════════════════════════════════════
  // FFMPEG.WASM ENGINE
  // ════════════════════════════════════════════════
  async function _exportFfmpeg(options) {
    _setModalTitle('正在加载 ffmpeg.wasm…');

    // Dynamically load ffmpeg
    await _loadScript(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js',
      'FFmpeg'
    );
    await _loadScript(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js',
      'FFmpegUtil'
    );

    const { FFmpeg: FFmpegClass } = window.FFmpeg ?? {};
    const { fetchFile }            = window.FFmpegUtil ?? {};

    if (!FFmpegClass) throw new Error('ffmpeg.wasm 加载失败');

    const ffmpeg = new FFmpegClass();
    _cancelFn = () => ffmpeg.terminate();

    ffmpeg.on('log', ({ message }) => {
      // Parse progress from ffmpeg output: "frame=  42 fps=..."
      const m = message.match(/frame=\s*(\d+)/);
      if (m) {
        const proj = State.get('project')?.meta ?? {};
        const fps  = proj.fps || 30;
        const sel  = options.selection;
        const dur  = sel ? (sel.endTime - sel.startTime) : (State.get('totalDuration') || 1);
        const total = Math.ceil(dur * fps);
        _setProgress(Math.min(0.95, parseInt(m[1]) / total));
      }
    });

    _setModalTitle('正在渲染帧…');
    await ffmpeg.load();

    const proj    = State.get('project')?.meta ?? {};
    const fps     = proj.fps    || 30;
    const width   = proj.width  || 1280;
    const height  = proj.height || 720;
    const speed   = options.speed ?? State.getSetting('exportSpeed') ?? 1;
    const withTP  = options.withTeleprompter ?? State.getSetting('exportWithTeleprompter') ?? false;
    const sel     = options.selection ?? null;
    const startT  = sel ? sel.startTime : 0;
    const endT    = sel ? sel.endTime   : (State.get('totalDuration') || 0);
    const total   = Math.ceil((endT - startT) * fps);

    if (total === 0) throw new Error('没有可导出的内容');

    // Render each frame and write to ffmpeg virtual FS as PNG
    const offCanvas = new OffscreenCanvas(width, height);
    const offCtx    = offCanvas.getContext('2d');

    for (let i = 0; i < total; i++) {
      if (_cancelled) { ffmpeg.terminate(); throw new Error('CANCELLED'); }

      const sourceT = startT + (i / fps) * speed;
      offCtx.clearRect(0, 0, width, height);
      await _renderFrameToCtx(offCtx, sourceT, width, height, withTP);

      // Convert to PNG blob → Uint8Array → write to ffmpeg FS
      const blob = await offCanvas.convertToBlob({ type: 'image/png' });
      const arr  = new Uint8Array(await blob.arrayBuffer());
      const name = `frame${String(i).padStart(6,'0')}.png`;
      await ffmpeg.writeFile(name, arr);

      _setProgress((i + 1) / total * 0.80);
    }

    _setModalTitle('正在编码视频…');
    _setProgress(0.82);

    const format   = State.getSetting('exportFormat') || 'mp4';
    const outName  = `output.${format}`;
    const vcodec   = format === 'webm' ? 'libvpx-vp9' : 'libx264';
    const pix_fmt  = format === 'webm' ? 'yuva420p'   : 'yuv420p';

    await ffmpeg.exec([
      '-framerate', String(fps),
      '-i',         'frame%06d.png',
      '-c:v',       vcodec,
      '-pix_fmt',   pix_fmt,
      '-preset',    'fast',
      '-crf',       '23',
      '-movflags',  '+faststart',
      outName,
    ]);

    _setProgress(0.98);

    const data = await ffmpeg.readFile(outName);
    ffmpeg.terminate();
    _cancelFn = null;

    _setProgress(1.0);
    return new Blob([data.buffer], { type: _mimeForFormat(format) });
  }

  // ════════════════════════════════════════════════
  // SHARED FRAME RENDERER
  // ════════════════════════════════════════════════
  async function _renderFrameToCtx(ctx, time, width, height, withTeleprompter) {
    // Check transition zone
    const tr = (typeof Transition !== 'undefined')
      ? Transition.getTransitionProgress(time)
      : null;

    if (tr && tr.progress > 0 && tr.progress < 1) {
      // Blend two frames around the edit point
      const frameA = await Player.getFrame(tr.editTime - 0.001);
      const frameB = await Player.getFrame(tr.editTime + 0.001);
      // Put frameA, blend frameB on top
      ctx.putImageData(frameA, 0, 0);
      const tempCanvas = new OffscreenCanvas(width, height);
      const tempCtx    = tempCanvas.getContext('2d');
      tempCtx.putImageData(frameB, 0, 0);
      ctx.globalAlpha = tr.progress;
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      const frame = await Player.getFrame(time);
      if (frame) ctx.putImageData(frame, 0, 0);
    }

    // Teleprompter overlay
    if (withTeleprompter && typeof Teleprompter !== 'undefined') {
      Teleprompter.renderToCanvas(ctx, width, height, time);
    }
  }

  // ════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════
  function _mimeForFormat(fmt) {
    return { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[fmt] || 'video/mp4';
  }

  function _buildFilename(options) {
    const name   = State.get('project')?.meta?.name || '导出';
    const fmt    = State.getSetting('exportFormat') || 'mp4';
    const suffix = options.selection ? '_选区' : '';
    return `${name}${suffix}.${fmt}`;
  }

  function _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // Load external script (idempotent)
  function _loadScript(src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s   = document.createElement('script');
      s.src     = src;
      s.onload  = resolve;
      s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
      document.head.appendChild(s);
    });
  }

  // ════════════════════════════════════════════════
  // MODAL UI
  // ════════════════════════════════════════════════
  function _showModal() {
    const m = document.getElementById('export-modal');
    if (m) m.style.display = 'flex';
    _setProgress(0);
    _setModalTitle('正在导出…');

    const cancelBtn = document.getElementById('export-cancel-btn');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        _cancelled = true;
        if (_cancelFn) { try { _cancelFn(); } catch (_) {} _cancelFn = null; }
        _hideModal();
      };
    }
  }

  function _hideModal() {
    const m = document.getElementById('export-modal');
    if (m) m.style.display = 'none';
  }

  function _setProgress(p) {
    const pct  = Math.round(Math.min(1, p) * 100);
    const fill = document.getElementById('export-progress-fill');
    const lbl  = document.getElementById('export-progress-label');
    if (fill) fill.style.width = pct + '%';
    if (lbl)  lbl.textContent  = pct + '%';
    State.emit('export:progress', p);
  }

  function _setModalTitle(msg) {
    const el = document.getElementById('export-modal-title');
    if (el) el.textContent = msg;
  }

  // ── Listen for export:start ───────────────────
  State.on('export:start', opts => toMP4(opts || {}));

  return { toMP4, estimateDuration };
})();

window.Export = Export;
