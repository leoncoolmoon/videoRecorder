/**
 * layers.js — Layer model: CRUD, ordering, split, delete range
 * Session 2 will fill in full implementations.
 */

const Layers = (() => {
  let _nextId = 1;

  function _uid() { return 'layer_' + (_nextId++) + '_' + Date.now(); }

  const DEFAULTS = {
    type: 'video',
    src: '',
    trackIndex: 0,
    timelineStart: 0,
    timelineEnd: 0,
    sourceStart: 0,
    sourceEnd: 0,
    x: 0, y: 0,
    width: 1, height: 1,
    opacity: 1,
    chromaKey: null,
    speed: 1,
    blendMode: 'normal',
    name: '未命名层',
    thumbnail: null
  };

  function create(partial = {}) {
    return { ...DEFAULTS, id: _uid(), ...partial };
  }

  function add(layer) {
    const project = State.get('project');
    const layers = [...project.layers, layer];
    State.setProject({ layers });
    State.recomputeDuration();
    State.emit('layers:change', { action: 'add', layer });
    return layer;
  }

  function remove(id) {
    const project = State.get('project');
    const layers = project.layers.filter(l => l.id !== id);
    State.setProject({ layers });
    State.recomputeDuration();
    State.emit('layers:change', { action: 'remove', id });
  }

  function update(id, partial) {
    const project = State.get('project');
    const layers = project.layers.map(l => l.id === id ? { ...l, ...partial } : l);
    State.setProject({ layers });
    if ('timelineEnd' in partial || 'timelineStart' in partial) State.recomputeDuration();
    State.emit('layers:change', { action: 'update', id, partial });
  }

  function reorder(id, newTrackIndex) {
    update(id, { trackIndex: newTrackIndex });
  }

  function getAll() {
    return State.get('project').layers;
  }

  function getById(id) {
    return getAll().find(l => l.id === id) || null;
  }

  function getAtTime(t) {
    return getAll().filter(l => l.timelineStart <= t && l.timelineEnd > t);
  }

  // Split a layer at `time`, return two new layers (replaces original)
  function split(id, time) {
    const layer = getById(id);
    if (!layer) return null;
    if (time <= layer.timelineStart || time >= layer.timelineEnd) return null;

    const sourceSplit = layer.sourceStart + (time - layer.timelineStart) * layer.speed;
    const left  = { ...layer, id: _uid(), timelineEnd: time, sourceEnd: sourceSplit };
    const right = { ...layer, id: _uid(), timelineStart: time, sourceStart: sourceSplit };

    const project = State.get('project');
    const layers = project.layers.map(l => l.id === id ? null : l)
      .filter(Boolean);
    layers.push(left, right);
    layers.sort((a, b) => a.timelineStart - b.timelineStart);
    State.setProject({ layers });
    State.emit('layers:change', { action: 'split', id, left, right });
    return [left, right];
  }

  // Delete content in [startTime, endTime], close gap
  function deleteRange(startTime, endTime, trackIds = null) {
    const dur = endTime - startTime;
    let layers = getAll();
    const result = [];

    for (const layer of layers) {
      if (trackIds && !trackIds.includes(layer.id)) { result.push(layer); continue; }
      const { timelineStart: ts, timelineEnd: te } = layer;

      if (te <= startTime || ts >= endTime) {
        // Outside range: shift if after
        if (ts >= endTime) {
          result.push({ ...layer, timelineStart: ts - dur, timelineEnd: te - dur });
        } else {
          result.push(layer);
        }
      } else if (ts >= startTime && te <= endTime) {
        // Fully inside: remove
      } else if (ts < startTime && te > endTime) {
        // Straddles: split into two, close gap
        const sourceSplit1 = layer.sourceStart + (startTime - ts) * layer.speed;
        const sourceSplit2 = layer.sourceStart + (endTime - ts) * layer.speed;
        result.push({ ...layer, id: _uid(), timelineEnd: startTime, sourceEnd: sourceSplit1 });
        result.push({ ...layer, id: _uid(), timelineStart: startTime, timelineEnd: te - dur, sourceStart: sourceSplit2 });
      } else if (ts < startTime) {
        // Overlaps start: trim end
        const sourceTrimEnd = layer.sourceStart + (startTime - ts) * layer.speed;
        result.push({ ...layer, timelineEnd: startTime, sourceEnd: sourceTrimEnd });
      } else {
        // Overlaps end: trim start, shift left
        const sourceTrimStart = layer.sourceStart + (endTime - ts) * layer.speed;
        result.push({ ...layer, id: _uid(), timelineStart: startTime, timelineEnd: te - dur, sourceStart: sourceTrimStart });
      }
    }

    State.setProject({ layers: result });
    State.recomputeDuration();
    State.emit('layers:change', { action: 'deleteRange', startTime, endTime });
  }

  // Push all layers at or after `time` by `delta` seconds (for insert mode)
  function insertGap(time, delta) {
    const layers = getAll().map(l => {
      if (l.timelineStart >= time) {
        return { ...l, timelineStart: l.timelineStart + delta, timelineEnd: l.timelineEnd + delta };
      }
      return l;
    });
    State.setProject({ layers });
    State.recomputeDuration();
    State.emit('layers:change', { action: 'insertGap', time, delta });
  }

  // Lazy thumbnail: stub — player.js fills this
  async function getThumbnail(id, time) {
    const layer = getById(id);
    if (!layer) return null;
    if (layer.thumbnail) return layer.thumbnail;
    // Delegate to player
    if (window.Player?.getFrame) {
      try {
        const frame = await Player.getFrame(time, [layer]);
        if (frame) {
          const thumb = frameToDataURL(frame);
          update(id, { thumbnail: thumb });
          return thumb;
        }
      } catch (_) {}
    }
    return null;
  }

  function frameToDataURL(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  return {
    create, add, remove, update, reorder,
    getAll, getById, getAtTime,
    split, deleteRange, insertGap,
    getThumbnail
  };
})();

window.Layers = Layers;
