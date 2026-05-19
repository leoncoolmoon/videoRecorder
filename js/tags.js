/**
 * tags.js — Tag/marker logic and selection ranges
 * Session 4 will fill in full implementations.
 */

const Tags = (() => {
  let _nextId = 1;
  function _uid() { return 'tag_' + (_nextId++); }

  function _getTags() { return State.get('project').tags || []; }
  function _setTags(tags) { State.setProject({ tags }); State.emit('tags:change', tags); }

  function add(time, label = '') {
    const tag = {
      id: _uid(),
      time,
      label: label || UI.formatTime(time),
      color: State.getSetting('tagColor') || '#f0a040',
      isPlayhead: false
    };
    _setTags([..._getTags(), tag].sort((a, b) => a.time - b.time));
    State.emit('tags:added', tag);
    return tag;
  }

  function remove(id) {
    _setTags(_getTags().filter(t => t.id !== id));
  }

  function update(id, partial) {
    _setTags(_getTags().map(t => t.id === id ? { ...t, ...partial } : t));
  }

  function getAll() { return _getTags(); }

  function getNearest(time) {
    const tags = _getTags();
    if (!tags.length) return null;
    return tags.reduce((a, b) => Math.abs(a.time - time) < Math.abs(b.time - time) ? a : b);
  }

  function getNext(time) {
    return _getTags().find(t => t.time > time) || null;
  }

  function getPrev(time) {
    const tags = _getTags().filter(t => t.time < time);
    return tags.length ? tags[tags.length - 1] : null;
  }

  function selectToNext(fromTagId) {
    const tags = _getTags();
    const idx = tags.findIndex(t => t.id === fromTagId);
    if (idx < 0) return;
    const from = tags[idx];
    const to   = tags[idx + 1];
    if (!to) return;
    State.set('selection', { startTime: from.time, endTime: to.time, anchorTagId: fromTagId });
  }

  function selectToCursor(tagId) {
    const tag = _getTags().find(t => t.id === tagId);
    if (!tag) return;
    const cursor = State.get('playhead');
    const start  = Math.min(tag.time, cursor);
    const end    = Math.max(tag.time, cursor);
    State.set('selection', { startTime: start, endTime: end, anchorTagId: tagId });
  }

  function selectShiftArrow(dir, delta) {
    const sel = State.get('selection');
    const cur = State.get('playhead');
    if (sel) {
      const newEnd = Math.max(sel.startTime, sel.endTime + (dir === 'right' ? delta : -delta));
      State.set('selection', { ...sel, endTime: newEnd });
    } else {
      const start = Math.min(cur, cur + (dir === 'right' ? delta : -delta));
      const end   = Math.max(cur, cur + (dir === 'right' ? delta : -delta));
      State.set('selection', { startTime: start, endTime: end, anchorTagId: null });
    }
  }

  function clearSelection() { State.set('selection', null); }
  function getSelection()   { return State.get('selection'); }

  // Clicking a tag: jump playhead there
  function jumpToTag(id) {
    const tag = _getTags().find(t => t.id === id);
    if (!tag) return;
    State.set('playhead', tag.time);
    State.emit('player:seek', tag.time);
  }

  return {
    add, remove, update, getAll,
    getNearest, getNext, getPrev,
    selectToNext, selectToCursor, selectShiftArrow,
    clearSelection, getSelection, jumpToTag
  };
})();

window.Tags = Tags;
