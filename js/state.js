/**
 * state.js — Central reactive state store + event bus
 * All modules read/write state through this API only.
 */

const State = (() => {
  // ── Default project skeleton ───────────────────
  const defaultProject = () => ({
    version: '1.0',
    meta: {
      name: '未命名项目',
      created: Date.now(),
      modified: Date.now(),
      fps: 30,
      width: 1920,
      height: 1080
    },
    layers: [],
    tags: [],
    teleprompter: {
      text: '',
      entries: null,   // null = plain text; [{time, text}] = timed
      format: 'plain'  // 'plain' | 'lrc' | 'json'
    }
  });

  // ── Default settings ───────────────────────────
  const defaultSettings = () => ({
    // System
    language: (navigator.language || 'zh').startsWith('en') ? 'en' : 'zh',
    theme: 'dark',
    uiFontSize: 13,

    // Recording
    resolution: '1920x1080',
    fps: 30,
    videoBitrate: 8000,
    audioBitrate: 192,

    // Teleprompter
    teleprompterVisible: true,
    teleprompterCollapseOnPause: false,
    teleprompterOpacity: 1.0,
    teleprompterBg: 'rgba(8, 8, 18, 0.7)',
    teleprompterBgAlpha: 0.7,
    teleprompterFontColor: '#ffffff',
    teleprompterFontColorAlpha: 1.0,
    teleprompterFontSize: 14,
    teleprompterAlign: 'left',
    teleprompterWithExport: false,

    // Timeline
    tagSelectionMode: 'cursor-to-tag',  // 'cursor-to-tag' | 'tag-to-tag'

    // Preview
    overlayOpacity: 0.30,
    previewSpeed: 1.0,
    tagColor: '#f0a040',
    selectionColor: '#5b7cf6',

    // Transitions
    transitionType: 'fade',     // 'fade' | 'optical-flow'
    transitionFrames: 8,        // 0–30

    // Export
    exportEngine: 'webcodecs',  // 'webcodecs' | 'ffmpeg'
    exportFormat: 'mp4',
    exportSpeed: 1.0,
    exportWithTeleprompter: false
  });

  // ── Internal store ─────────────────────────────
  const _store = {
    project:     defaultProject(),
    settings:    defaultSettings(),
    playhead:    0,          // seconds (float)
    selection:   null,       // SelectionRange | null
    isRecording: false,
    isPaused:    false,
    isPlaying:   false,
    mode:        'insert',   // 'insert' | 'overwrite'
    statusMsg:   '',         // shown in status bar
    zoomLevel:   80,         // timeline pixels per second
    scrollLeft:  0,          // timeline horizontal scroll offset (px)
    totalDuration: 0,        // seconds, computed from layers
  };

  // ── Event bus ──────────────────────────────────
  const _listeners = {};  // { 'event:name': Set<handler> }

  function on(event, handler) {
    if (!_listeners[event]) _listeners[event] = new Set();
    _listeners[event].add(handler);
  }

  function off(event, handler) {
    _listeners[event]?.delete(handler);
  }

  function emit(event, data) {
    _listeners[event]?.forEach(h => {
      try { h(data); } catch (e) { console.error(`[State] handler error on "${event}":`, e); }
    });
    // Also fire wildcard listener
    _listeners['*']?.forEach(h => {
      try { h(event, data); } catch (e) {}
    });
  }

  // ── Accessors ──────────────────────────────────
  function get(key) {
    return _store[key];
  }

  function set(key, value) {
    const prev = _store[key];
    _store[key] = value;
    emit(`state:change:${key}`, { value, prev });
    emit('state:change', { key, value, prev });
  }

  // Deep-merge partial into a sub-object key
  function merge(key, partial) {
    const current = _store[key];
    if (typeof current !== 'object' || current === null) {
      set(key, partial);
      return;
    }
    set(key, { ...current, ...partial });
  }

  // Update nested project fields
  function setProject(partial) {
    merge('project', { ...partial, meta: { ..._store.project.meta, modified: Date.now(), ...partial.meta } });
  }

  function setSetting(key, value) {
    const settings = { ..._store.settings, [key]: value };
    set('settings', settings);
    emit(`settings:change:${key}`, { value });
    // Persist to localStorage
    try { localStorage.setItem('vidcut_settings', JSON.stringify(settings)); } catch (_) {}
  }

  function getSetting(key) {
    return _store.settings[key];
  }

  // ── Init: load persisted settings ─────────────
  function init() {
    try {
      const saved = localStorage.getItem('vidcut_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        set('settings', { ...defaultSettings(), ...parsed });
      }
    } catch (_) {}

    // Load autosaved project if present
    try {
      const autosave = localStorage.getItem('vidcut_autosave');
      if (autosave) {
        const parsed = JSON.parse(autosave);
        if (parsed?.version) {
          set('project', { ...defaultProject(), ...parsed });
          console.info('[State] Restored autosaved project.');
        }
      }
    } catch (_) {}
  }

  // ── Computed helpers ───────────────────────────
  // Call after layers change to recompute totalDuration
  function recomputeDuration() {
    const layers = _store.project.layers;
    let max = 0;
    for (const l of layers) {
      if (l.timelineEnd > max) max = l.timelineEnd;
    }
    set('totalDuration', max);
  }

  // Reset to a fresh project
  function newProject() {
    set('project', defaultProject());
    set('playhead', 0);
    set('selection', null);
    set('isRecording', false);
    set('isPaused', false);
    set('isPlaying', false);
    set('totalDuration', 0);
    set('scrollLeft', 0);
    emit('project:new', {});
  }

  return {
    get, set, merge, on, off, emit,
    setProject, setSetting, getSetting,
    init, recomputeDuration, newProject,
    _store  // exposed for debugging only
  };
})();

// Make globally available
window.State = State;
