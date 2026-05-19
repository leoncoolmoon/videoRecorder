/**
 * main.js — Entry point. Initializes all modules in dependency order.
 */

(async function main() {
  console.info('[VidCut] Starting…');

  // 1. Core state + UI shell
  UI.init();

  // 2. Timeline rendering
  Timeline.init();

  // 3. Player (composite preview canvas)
  Player.init(document.getElementById('preview-canvas'));

  // 4. Teleprompter
  Teleprompter.init(document.getElementById('teleprompter-bar'));

  // 5. Settings panel (after Teleprompter so it can call Teleprompter.setVisible etc.)
  Settings.init(document.getElementById('settings-content'));

  // 6. Keyboard shortcuts
  Keyboard.init();

  // 7. Recorder (async — may prompt for camera permission)
  Recorder.init().catch(() => {});

  // When devices enumerated, refresh video settings tab if active
  State.on('recorder:devices', () => {
    if (document.querySelector('.stab[data-tab="video"]')?.classList.contains('active')) {
      Settings.renderTab('video');
    }
  });

  // ── Wire up top-bar record/play buttons ──────
  document.getElementById('btn-rec-toggle')?.addEventListener('click', () => {
    if (State.get('isRecording') && !State.get('isPaused')) {
      Recorder.pause();
    } else {
      Recorder.start();
    }
  });

  document.getElementById('btn-stop')?.addEventListener('click', () => {
    Recorder.stop();
  });

  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (State.get('isPlaying')) { Player.pause(); }
    else { Player.play(); }
  });

  document.getElementById('btn-rewind')?.addEventListener('click', () => {
    State.set('playhead', 0);
    State.emit('player:seek', 0);
    Player.pause();
  });

  document.getElementById('btn-add-tag')?.addEventListener('click', () => {
    Tags.add(State.get('playhead'));
  });

  // ── Wire up timeline toolbar selection buttons ─
  document.getElementById('tl-btn-del-sel')?.addEventListener('click', () => {
    const sel = State.get('selection');
    if (sel) { Layers.deleteRange(sel.startTime, sel.endTime); Tags.clearSelection(); }
  });

  document.getElementById('tl-btn-play-sel')?.addEventListener('click', () => {
    const sel = State.get('selection');
    if (sel) {
      State.set('playhead', sel.startTime);
      Player.play(sel.startTime, sel.endTime);
    } else {
      if (State.get('isPlaying')) Player.pause();
      else Player.play();
    }
  });

  document.getElementById('tl-btn-export-sel')?.addEventListener('click', () => {
    const sel = State.get('selection');
    State.emit('export:start', sel ? { selection: sel } : {});
  });

  // ── Asset drop zone ───────────────────────────
  _initAssetDrop();

  // ── Apply teleprompter settings ───────────────
  Teleprompter.setFontSize(State.getSetting('teleprompterFontSize'));
  Teleprompter.setFontColor(State.getSetting('teleprompterFontColor'));
  Teleprompter.setBg(State.getSetting('teleprompterBg'));
  Teleprompter.setAlign(State.getSetting('teleprompterAlign'));

  // ── Initial timeline render ───────────────────
  Timeline.render();

  // 8. Check for autosave on startup (after a tick so UI is painted)
  setTimeout(() => Project.checkAndRestoreAutosave(), 300);

  console.info('[VidCut] Ready.');
})();


// ── Asset drop / file import ───────────────────
function _initAssetDrop() {
  const zone = document.getElementById('asset-dropzone');
  const grid = document.getElementById('asset-grid');

  function handleFiles(files) {
    for (const file of files) {
      const url  = URL.createObjectURL(file);
      const type = file.type.startsWith('video/') ? 'video'
                 : file.type.startsWith('audio/') ? 'audio'
                 : file.type.startsWith('image/') ? 'image'
                 : 'video';

      // Check if it's a teleprompter file
      const ext = file.name.split('.').pop().toLowerCase();
      if (['txt','lrc','json'].includes(ext) && !file.type.startsWith('video')) {
        Teleprompter.load(file);
        continue;
      }

      // Create layer from asset
      const playhead = State.get('playhead');
      const duration = 5; // default 5s; video duration updated after load
      const layer = Layers.create({
        type,
        src:  url,
        name: file.name.replace(/\.[^.]+$/, ''),
        timelineStart: playhead,
        timelineEnd:   playhead + duration,
        sourceStart: 0,
        sourceEnd:   duration,
        x: 0, y: 0, width: 1, height: 1,
        opacity: 1
      });

      // For video/audio: get real duration
      if (type === 'video' || type === 'audio') {
        const tmp = document.createElement(type === 'audio' ? 'audio' : 'video');
        tmp.src = url;
        tmp.onloadedmetadata = () => {
          Layers.update(layer.id, {
            timelineEnd: playhead + tmp.duration,
            sourceEnd:   tmp.duration
          });
        };
      }

      Layers.add(layer);
      _addAssetThumb(file, url, type, layer.id);
    }
  }

  zone?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'video/*,audio/*,image/*,.txt,.lrc,.json';
    inp.onchange = e => handleFiles(Array.from(e.target.files));
    inp.click();
  });

  zone?.addEventListener('drop', e => {
    e.stopPropagation();
    handleFiles(Array.from(e.dataTransfer.files));
  });

  // Global drop anywhere (not on teleprompter bar)
  document.addEventListener('drop', e => {
    if (e.defaultPrevented) return; // already handled
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    // Filter media files to asset, text to teleprompter
    handleFiles(files);
  });
}

function _addAssetThumb(file, url, type, layerId) {
  const grid = document.getElementById('asset-grid');
  if (!grid) return;
  const item = document.createElement('div');
  item.className = 'asset-item';
  item.dataset.layerId = layerId;
  item.draggable = true;

  const badge = document.createElement('div');
  badge.className = 'asset-item-type';
  badge.textContent = type.toUpperCase();
  item.appendChild(badge);

  if (type === 'image') {
    const img = document.createElement('img');
    img.src = url;
    item.appendChild(img);
  } else if (type === 'video') {
    const vid = document.createElement('video');
    vid.src = url; vid.muted = true;
    vid.addEventListener('mouseenter', () => vid.play());
    vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
    item.appendChild(vid);
  } else {
    const icon = document.createElement('div');
    icon.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;font-size:24px;opacity:0.4';
    icon.textContent = '♫';
    item.appendChild(icon);
  }

  const lbl = document.createElement('div');
  lbl.className = 'asset-item-label';
  lbl.textContent = file.name;
  item.appendChild(lbl);

  // Drag onto timeline
  item.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', layerId);
  });

  // Click: jump playhead to layer start
  item.addEventListener('click', () => {
    const layer = Layers.getById(layerId);
    if (layer) {
      State.set('playhead', layer.timelineStart);
      State.emit('player:seek', layer.timelineStart);
    }
  });

  grid.appendChild(item);
}
