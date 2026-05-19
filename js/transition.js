/**
 * transition.js — 编辑点过渡：淡入淡出 + 插件注册
 * Session 3: player.js 播放时识别编辑点并插入混合帧
 */

const Transition = (() => {
  const _plugins = {};   // name → fn(ctx, frameA, frameB, progress)

  // ════════════════════════════════════════════════
  // CORE API
  // ════════════════════════════════════════════════

  /**
   * apply(ctx, frameA, frameB, progress, type)
   * frameA / frameB : ImageData  (same dimensions)
   * progress        : 0.0 – 1.0
   * type            : 'fade' | 'optical-flow' | custom plugin name
   */
  function apply(ctx, frameA, frameB, progress, type) {
    const t = type || State.getSetting('transitionType') || 'fade';
    if (_plugins[t]) {
      try { _plugins[t](ctx, frameA, frameB, progress); return; } catch (_) {}
    }
    _fade(ctx, frameA, frameB, progress);
  }

  // ── Fade (alpha blend) ────────────────────────
  function _fade(ctx, frameA, frameB, progress) {
    if (!frameA || !frameB) return;
    const w   = frameA.width;
    const h   = frameA.height;
    const out = ctx.createImageData(w, h);
    const a   = frameA.data;
    const b   = frameB.data;
    const o   = out.data;
    const t   = progress;
    const s   = 1 - t;

    for (let i = 0; i < o.length; i += 4) {
      o[i]   = (a[i]   * s + b[i]   * t) | 0;
      o[i+1] = (a[i+1] * s + b[i+1] * t) | 0;
      o[i+2] = (a[i+2] * s + b[i+2] * t) | 0;
      o[i+3] = (a[i+3] * s + b[i+3] * t) | 0;
    }
    ctx.putImageData(out, 0, 0);
  }

  // ── Plugin registration ───────────────────────
  function registerPlugin(name, fn) {
    _plugins[name] = fn;
    console.info('[Transition] Plugin registered:', name);
  }

  // ════════════════════════════════════════════════
  // EDIT POINT DETECTION
  // Called by player.js / export.js to determine if
  // a given time `t` falls within a transition zone
  // between two adjacent layer segments.
  // ════════════════════════════════════════════════

  /**
   * getEditPoints() — returns array of { time, layerBefore, layerAfter }
   * An edit point exists where one layer ends and the next begins
   * on the same track (or where any layer's timelineEnd falls).
   */
  function getEditPoints() {
    const fps     = State.get('project')?.meta?.fps || 30;
    const nFrames = State.getSetting('transitionFrames') || 0;
    if (nFrames === 0) return [];

    const layers = Layers.getAll().sort((a, b) => a.timelineStart - b.timelineStart);
    const points = [];
    const seen   = new Set();

    for (const layer of layers) {
      const t = layer.timelineEnd;
      if (seen.has(t)) continue;
      seen.add(t);
      // Is there another layer starting within ±1 frame?
      const next = layers.find(l =>
        l.id !== layer.id &&
        l.trackIndex === layer.trackIndex &&
        Math.abs(l.timelineStart - t) < 1 / fps
      );
      points.push({ time: t, layerBefore: layer, layerAfter: next || null });
    }
    return points;
  }

  /**
   * getTransitionProgress(time) → { progress, type } | null
   * Returns blend progress (0–1) if `time` is inside a transition zone,
   * else null (meaning normal render).
   */
  function getTransitionProgress(time) {
    const fps     = State.get('project')?.meta?.fps || 30;
    const nFrames = State.getSetting('transitionFrames') || 0;
    if (nFrames === 0) return null;

    const halfDur = (nFrames / 2) / fps;  // seconds each side of edit point

    for (const pt of getEditPoints()) {
      const zoneStart = pt.time - halfDur;
      const zoneEnd   = pt.time + halfDur;
      if (time >= zoneStart && time <= zoneEnd) {
        const progress = (time - zoneStart) / (halfDur * 2); // 0 → 1
        return {
          progress,
          editTime:    pt.time,
          layerBefore: pt.layerBefore,
          layerAfter:  pt.layerAfter,
          type: State.getSetting('transitionType') || 'fade',
        };
      }
    }
    return null;
  }

  return { apply, registerPlugin, getEditPoints, getTransitionProgress };
})();

window.Transition = Transition;
