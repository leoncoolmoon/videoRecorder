/**
 * project.js — 完整项目存取实现
 * Session 4:
 *   - JSZip 打包: project.json + sources/ blob 文件
 *   - 载入 ZIP: 还原 blob URL，重建层/tag，触发全量刷新
 *   - 启动时检测 autosave，弹窗询问恢复
 *   - 版本兼容检查
 */

const Project = (() => {
  const CURRENT_VERSION = '1.1';
  const AUTOSAVE_KEY    = 'vidcut_autosave';
  const AUTOSAVE_META_KEY = 'vidcut_autosave_meta';

  let _autosaveTimer = null;
  let _jsZipLoaded   = false;

  // ════════════════════════════════════════════════
  // SERIALISATION
  // ════════════════════════════════════════════════
  function toJSON() {
    const project  = State.get('project');
    const settings = State.get('settings');
    // Strip blob: URLs from JSON (they'll be stored as separate files in zip)
    const layers = (project.layers || []).map(l => ({
      ...l,
      // Replace blob URL with a reference key; restored on load
      src: l.src?.startsWith('blob:') ? `__blob__:${l.id}` : (l.src || ''),
      thumbnail: null,  // thumbnails regenerated on demand; don't bloat JSON
    }));
    return JSON.stringify({
      version:  CURRENT_VERSION,
      meta:     project.meta,
      layers,
      tags:     project.tags || [],
      teleprompter: project.teleprompter || { text: '', entries: null, format: 'plain' },
      _settings: settings,
    }, null, 2);
  }

  function fromJSON(str, blobMap = {}) {
    let data;
    try {
      data = JSON.parse(str);
    } catch (e) {
      throw new Error('项目文件损坏：无效 JSON');
    }

    // Version compatibility
    const ver = data.version || '1.0';
    if (ver !== CURRENT_VERSION) {
      console.warn(`[Project] 版本 ${ver} → 当前 ${CURRENT_VERSION}，尝试兼容加载`);
    }

    // Restore blob URLs
    const layers = (data.layers || []).map(l => {
      let src = l.src || '';
      if (src.startsWith('__blob__:')) {
        const id = src.replace('__blob__:', '');
        src = blobMap[id] || '';
      }
      return { ...l, src };
    });

    // Restore state
    State.setProject({
      meta:         data.meta         || {},
      layers,
      tags:         data.tags         || [],
      teleprompter: data.teleprompter || { text: '', entries: null, format: 'plain' },
    });

    if (data._settings) {
      State.set('settings', { ...State.get('settings'), ...data._settings });
    }

    State.set('playhead', 0);
    State.set('selection', null);
    State.recomputeDuration();
    State.emit('project:loaded', State.get('project'));

    // Reload teleprompter text
    const tp = data.teleprompter;
    if (tp?.text && typeof Teleprompter !== 'undefined') {
      if (tp.format === 'lrc') {
        Teleprompter.load(new File([tp.text], 'script.lrc', { type: 'text/plain' }));
      } else if (tp.format === 'json') {
        Teleprompter.load(new File([tp.text], 'script.json', { type: 'application/json' }));
      }
      // plain: will be set via setProject
    }

    console.info('[Project] Loaded. Layers:', layers.length, 'Tags:', data.tags?.length);
    return data;
  }

  // ════════════════════════════════════════════════
  // SAVE (ZIP)
  // ════════════════════════════════════════════════
  async function save() {
    await _ensureJSZip();
    const json    = toJSON();
    const zip     = new JSZip();
    zip.file('project.json', json);

    const sources = zip.folder('sources');
    const layers  = State.get('project').layers || [];

    let packed = 0;
    for (const layer of layers) {
      if (!layer.src?.startsWith('blob:')) continue;
      try {
        const resp = await fetch(layer.src);
        const blob = await resp.blob();
        const ext  = _extFromMime(blob.type);
        sources.file(`${layer.id}.${ext}`, blob);
        packed++;
      } catch (e) {
        console.warn('[Project] Could not pack blob for layer', layer.id, e);
      }
    }

    console.info(`[Project] Packing ZIP: ${packed} media files`);
    const zipBlob = await zip.generateAsync({
      type:        'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 3 },  // fast, media is already compressed
    });

    console.info(`[Project] ZIP size: ${(zipBlob.size / 1024 / 1024).toFixed(2)} MB`);
    return zipBlob;
  }

  // ════════════════════════════════════════════════
  // LOAD (ZIP or JSON)
  // ════════════════════════════════════════════════
  async function load(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'json') {
      const text = await file.text();
      fromJSON(text);
    } else if (ext === 'zip') {
      await _loadZip(file);
    } else {
      alert('不支持的文件格式，请选择 .zip 或 .json');
    }
  }

  async function _loadZip(file) {
    await _ensureJSZip();
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      throw new Error('ZIP 文件损坏：' + e.message);
    }

    const jsonFile = zip.file('project.json');
    if (!jsonFile) throw new Error('无效项目文件：缺少 project.json');

    const json = await jsonFile.async('string');

    // Restore media blobs
    const blobMap  = {};
    const srcFolder = zip.folder('sources');
    if (srcFolder) {
      const fileList = [];
      srcFolder.forEach((relPath, zipEntry) => {
        if (!zipEntry.dir) fileList.push({ relPath, zipEntry });
      });

      for (const { relPath, zipEntry } of fileList) {
        const layerId = relPath.replace(/\.[^.]+$/, ''); // strip extension
        const data    = await zipEntry.async('arraybuffer');
        const mime    = _mimeFromExt(relPath.split('.').pop());
        const blob    = new Blob([data], { type: mime });
        blobMap[layerId] = URL.createObjectURL(blob);
      }
    }

    fromJSON(json, blobMap);

    // Regenerate thumbnails for restored layers asynchronously
    setTimeout(() => _regenerateThumbnails(), 500);
  }

  async function _regenerateThumbnails() {
    const layers = State.get('project').layers || [];
    for (const layer of layers) {
      if (!layer.src || layer.thumbnail) continue;
      try {
        await Layers.getThumbnail(layer.id, layer.timelineStart + 0.1);
      } catch (_) {}
    }
    State.emit('layers:change', { action: 'thumbnails-ready' });
  }

  // ════════════════════════════════════════════════
  // AUTOSAVE
  // ════════════════════════════════════════════════
  function autosave() {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
      if (!State.getSetting('autosave')) return;
      try {
        // Don't include blob media in localStorage (too large)
        // Store just the project structure; blobs are lost on refresh
        const json = toJSON();
        localStorage.setItem(AUTOSAVE_KEY, json);
        localStorage.setItem(AUTOSAVE_META_KEY, JSON.stringify({
          ts:   Date.now(),
          name: State.get('project')?.meta?.name || '未命名',
        }));
        console.info('[Project] Autosaved to localStorage');
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          console.warn('[Project] localStorage quota exceeded, autosave skipped');
          localStorage.removeItem(AUTOSAVE_KEY);
        }
      }
    }, 3000);
  }

  function getAutoSave() {
    try { return localStorage.getItem(AUTOSAVE_KEY); } catch (_) { return null; }
  }

  function clearAutoSave() {
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(AUTOSAVE_META_KEY);
  }

  // ════════════════════════════════════════════════
  // STARTUP: check for autosave
  // ════════════════════════════════════════════════
  function checkAndRestoreAutosave() {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (!saved) return;
      const meta = JSON.parse(localStorage.getItem(AUTOSAVE_META_KEY) || '{}');
      const age  = meta.ts ? Math.round((Date.now() - meta.ts) / 60000) : 0;
      const name = meta.name || '未命名';

      const msg = `发现自动存档「${name}」\n保存时间：${age} 分钟前\n\n是否恢复？`;
      if (confirm(msg)) {
        try {
          fromJSON(saved, {}); // blobs won't restore, but structure is saved
          console.info('[Project] Autosave restored.');
        } catch (e) {
          console.warn('[Project] Autosave restore failed:', e);
          clearAutoSave();
        }
      } else {
        clearAutoSave();
      }
    } catch (_) {}
  }

  // ════════════════════════════════════════════════
  // JSZIP LOADER
  // ════════════════════════════════════════════════
  async function _ensureJSZip() {
    if (typeof JSZip !== 'undefined') return;
    if (_jsZipLoaded) return;
    await new Promise((resolve, reject) => {
      const s   = document.createElement('script');
      s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload  = () => { _jsZipLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('JSZip 加载失败'));
      document.head.appendChild(s);
    });
  }

  // ════════════════════════════════════════════════
  // MIME / EXTENSION HELPERS
  // ════════════════════════════════════════════════
  function _extFromMime(mime) {
    const map = {
      'video/webm':       'webm',
      'video/mp4':        'mp4',
      'video/ogg':        'ogv',
      'audio/webm':       'webm',
      'audio/mp4':        'm4a',
      'audio/mpeg':       'mp3',
      'audio/ogg':        'ogg',
      'image/jpeg':       'jpg',
      'image/png':        'png',
      'image/webp':       'webp',
    };
    return map[mime?.split(';')[0]] || 'bin';
  }

  function _mimeFromExt(ext) {
    const map = {
      webm: 'video/webm', mp4: 'video/mp4', ogv: 'video/ogg',
      m4a:  'audio/mp4',  mp3: 'audio/mpeg', ogg: 'audio/ogg',
      jpg:  'image/jpeg', jpeg: 'image/jpeg',
      png:  'image/png',  webp: 'image/webp',
    };
    return map[ext?.toLowerCase()] || 'application/octet-stream';
  }

  // ════════════════════════════════════════════════
  // STATE HOOKS
  // ════════════════════════════════════════════════
  State.on('layers:change', () => autosave());
  State.on('tags:change',   () => autosave());
  State.on('project:new',   () => clearAutoSave());

  return {
    save, load, toJSON, fromJSON,
    autosave, getAutoSave, clearAutoSave,
    checkAndRestoreAutosave,
  };
})();

window.Project = Project;
