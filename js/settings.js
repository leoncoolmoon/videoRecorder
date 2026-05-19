/**
 * settings.js — 完整设置面板
 * Session 3: 设备枚举下拉、i18n zh/en、所有控件实时反映、自动存档
 */

const Settings = (() => {
  let _contentEl = null;
  let _activeTab = 'teleprompter';

  // ════════════════════════════════════════════════
  // i18n
  // ════════════════════════════════════════════════
  const I18N = {
    zh: {
      // Tab labels
      tab_teleprompter: '台词', tab_video: '视频', tab_export: '保存', tab_system: '系统',
      // Teleprompter
      sec_display: '显示', sec_export_tp: '导出台词', sec_tag_sel: '标签选区',
      show_teleprompter: '显示台词', collapse_on_pause: '暂停时收起',
      font_size: '字体大小', bg_color: '背景颜色', font_color: '文字颜色',
      align: '对齐', align_left: '左对齐', align_center: '居中', align_right: '右对齐',
      export_with_tp: '导出时叠加台词',
      tag_sel_mode: '点击Tag选区',
      tag_sel_cursor: '光标→Tag', tag_sel_tag: 'Tag→下一Tag',
      // Video
      sec_recording: '录制', sec_overlay: '叠加预览', sec_transition: '过渡', sec_colors: '颜色',
      resolution: '分辨率', fps: '帧率', video_bitrate: '视频码率', audio_bitrate: '音频码率',
      camera: '摄像头', microphone: '麦克风', no_devices: '（无设备）',
      overlay_opacity: '叠加透明度',
      transition_type: '过渡类型', fade: '淡入淡出', optical_flow: '光流（预留）',
      transition_frames: '过渡帧数',
      tag_color: 'Tag 颜色', sel_color: '选区颜色',
      // Export
      sec_engine: '导出引擎', sec_format: '格式', sec_project: '项目', sec_export_video: '导出视频',
      engine: '引擎', webcodecs: 'WebCodecs（轻量）', ffmpeg: 'ffmpeg.wasm（完整）',
      format: '格式', export_speed: '播放倍速', export_with_tp2: '叠加台词',
      save_project: '保存项目 (JSON+ZIP)', load_project: '载入项目 (ZIP)',
      export_mp4: '导出 MP4', export_selection: '导出选区',
      // System
      sec_appearance: '外观', sec_autosave: '自动保存', sec_danger: '危险操作',
      theme: '主题', theme_dark: '深色', theme_light: '浅色', theme_system: '跟随系统',
      language: '语言',
      autosave: '自动保存',
      new_project: '新建项目', reset_settings: '恢复默认设置',
      confirm_new: '新建项目将丢失未保存内容，确认吗？',
      confirm_reset: '恢复所有设置到默认值？',
    },
    en: {
      tab_teleprompter: 'Script', tab_video: 'Video', tab_export: 'Save', tab_system: 'System',
      sec_display: 'Display', sec_export_tp: 'Export Script', sec_tag_sel: 'Tag Selection',
      show_teleprompter: 'Show Script', collapse_on_pause: 'Collapse on Pause',
      font_size: 'Font Size', bg_color: 'Background', font_color: 'Text Color',
      align: 'Align', align_left: 'Left', align_center: 'Center', align_right: 'Right',
      export_with_tp: 'Overlay script on export',
      tag_sel_mode: 'Click tag to select',
      tag_sel_cursor: 'Cursor → Tag', tag_sel_tag: 'Tag → Next Tag',
      sec_recording: 'Recording', sec_overlay: 'Preview Overlay', sec_transition: 'Transition', sec_colors: 'Colors',
      resolution: 'Resolution', fps: 'Frame Rate', video_bitrate: 'Video Bitrate', audio_bitrate: 'Audio Bitrate',
      camera: 'Camera', microphone: 'Microphone', no_devices: '(no devices)',
      overlay_opacity: 'Overlay Opacity',
      transition_type: 'Transition', fade: 'Fade', optical_flow: 'Optical Flow (future)',
      transition_frames: 'Transition Frames',
      tag_color: 'Tag Color', sel_color: 'Selection Color',
      sec_engine: 'Export Engine', sec_format: 'Format', sec_project: 'Project', sec_export_video: 'Export Video',
      engine: 'Engine', webcodecs: 'WebCodecs (light)', ffmpeg: 'ffmpeg.wasm (full)',
      format: 'Format', export_speed: 'Playback Speed', export_with_tp2: 'Overlay Script',
      save_project: 'Save Project (JSON+ZIP)', load_project: 'Load Project (ZIP)',
      export_mp4: 'Export MP4', export_selection: 'Export Selection',
      sec_appearance: 'Appearance', sec_autosave: 'Auto-Save', sec_danger: 'Danger Zone',
      theme: 'Theme', theme_dark: 'Dark', theme_light: 'Light', theme_system: 'System',
      language: 'Language',
      autosave: 'Auto-Save',
      new_project: 'New Project', reset_settings: 'Reset Settings',
      confirm_new: 'New project will discard unsaved changes. Continue?',
      confirm_reset: 'Reset all settings to defaults?',
    }
  };

  function t(key) {
    const lang = State.getSetting('language') || 'zh';
    return (I18N[lang] || I18N.zh)[key] || key;
  }
  window.t = t;  // expose for other modules

  // ════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════
  function init(panelEl) {
    _contentEl = panelEl || document.getElementById('settings-content');
    _initTabs();
    renderTab(_activeTab);

    // Re-render on language change
    State.on('settings:change:language', () => renderTab(_activeTab));

    console.info('[Settings] Initialized.');
  }

  function _initTabs() {
    document.querySelectorAll('.stab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _activeTab = btn.dataset.tab;
        renderTab(_activeTab);
      });
    });
  }

  function renderTab(tab) {
    if (!_contentEl) return;
    _contentEl.innerHTML = '';
    ({ teleprompter: _renderTeleprompter,
       video:        _renderVideo,
       export:       _renderExport,
       system:       _renderSystem }[tab] || _renderTeleprompter)();
  }

  // ════════════════════════════════════════════════
  // BUILDER HELPERS
  // ════════════════════════════════════════════════
  function _sec(title) {
    const sec = document.createElement('div');
    sec.className = 'settings-section';
    const hdr = document.createElement('div');
    hdr.className = 'settings-section-title';
    hdr.textContent = title;
    sec.appendChild(hdr);
    _contentEl.appendChild(sec);
    return sec;
  }

  function _row(sec, label, control) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const lbl = document.createElement('span');
    lbl.className   = 'setting-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(control);
    sec.appendChild(row);
    return row;
  }

  function _toggle(key, onChange) {
    const btn = document.createElement('div');
    btn.className = 'setting-toggle' + (State.getSetting(key) ? ' on' : '');
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', State.getSetting(key) ? 'true' : 'false');
    btn.addEventListener('click', () => {
      const v = !State.getSetting(key);
      State.setSetting(key, v);
      btn.classList.toggle('on', v);
      btn.setAttribute('aria-checked', v ? 'true' : 'false');
      if (onChange) onChange(v);
    });
    return btn;
  }

  function _slider(key, min, max, step, suffix, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1;min-width:0';
    const inp = document.createElement('input');
    inp.type  = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = State.getSetting(key) ?? min;
    inp.style.flex = '1';
    const val = document.createElement('span');
    val.className   = 'setting-val';
    val.textContent = inp.value + (suffix || '');
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      val.textContent = v + (suffix || '');
      State.setSetting(key, v);
      if (onChange) onChange(v);
    });
    wrap.appendChild(inp);
    wrap.appendChild(val);
    return wrap;
  }

  function _select(key, options, onChange) {
    const sel = document.createElement('select');
    const cur = State.getSetting(key);
    for (const [v, label] of options) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = label;
      if (String(cur) === String(v)) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      State.setSetting(key, sel.value);
      if (onChange) onChange(sel.value);
    });
    return sel;
  }

  function _color(key, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'color';
    inp.value = State.getSetting(key) || '#ffffff';
    inp.addEventListener('input', () => {
      State.setSetting(key, inp.value);
      if (onChange) onChange(inp.value);
    });
    return inp;
  }

  function _btn(label, svgPath, cls, onClick) {
    const btn = document.createElement('button');
    btn.className = 'setting-btn' + (cls ? ' ' + cls : '');
    btn.innerHTML = svgPath
      ? `<svg viewBox="0 0 16 16"><path d="${svgPath}"/></svg>${label}`
      : label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Device selector (async, populates after enum)
  function _deviceSelect(kind, settingKey, onChangeAsync) {
    const sel = document.createElement('select');
    const cur = State.getSetting(settingKey);

    // Placeholder option
    const ph = document.createElement('option');
    ph.textContent = t('no_devices');
    ph.disabled = true;
    sel.appendChild(ph);

    // Attempt to get devices from Recorder
    const fill = (devices) => {
      sel.innerHTML = '';
      if (!devices || !devices.length) {
        sel.appendChild(ph); return;
      }
      for (const d of devices) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `${kind} ${sel.options.length + 1}`;
        if (d.deviceId === cur) opt.selected = true;
        sel.appendChild(opt);
      }
    };

    // Try immediately, then listen for device update
    try {
      const devs = Recorder.getDevices();
      fill(kind === 'video' ? devs.video : devs.audio);
    } catch (_) {}

    State.on('recorder:devices', ({ video, audio }) => {
      fill(kind === 'video' ? video : audio);
    });

    sel.addEventListener('change', () => {
      State.setSetting(settingKey, sel.value);
      if (onChangeAsync) onChangeAsync(sel.value);
    });
    return sel;
  }

  // ════════════════════════════════════════════════
  // TAB: 台词
  // ════════════════════════════════════════════════
  function _renderTeleprompter() {
    const s1 = _sec(t('sec_display'));
    _row(s1, t('show_teleprompter'),
      _toggle('teleprompterVisible', v => Teleprompter.setVisible(v)));
    _row(s1, t('collapse_on_pause'),
      _toggle('teleprompterCollapseOnPause'));
    _row(s1, t('font_size'),
      _slider('teleprompterFontSize', 10, 36, 1, 'px', v => Teleprompter.setFontSize(v)));
    _row(s1, t('bg_color'),
      _color('teleprompterBg', v => Teleprompter.setBg(v)));
    _row(s1, t('font_color'),
      _color('teleprompterFontColor', v => Teleprompter.setFontColor(v)));
    _row(s1, t('align'),
      _select('teleprompterAlign',
        [['left', t('align_left')], ['center', t('align_center')], ['right', t('align_right')]],
        v => Teleprompter.setAlign(v)));

    const s2 = _sec(t('sec_export_tp'));
    _row(s2, t('export_with_tp'), _toggle('teleprompterWithExport'));

    const s3 = _sec(t('sec_tag_sel'));
    _row(s3, t('tag_sel_mode'),
      _select('tagSelectionMode',
        [['cursor-to-tag', t('tag_sel_cursor')], ['tag-to-tag', t('tag_sel_tag')]]));
  }

  // ════════════════════════════════════════════════
  // TAB: 视频处理
  // ════════════════════════════════════════════════
  function _renderVideo() {
    const s1 = _sec(t('sec_recording'));
    _row(s1, t('resolution'),
      _select('resolution', [
        ['1920x1080','1080p FHD'], ['1280x720','720p HD'],
        ['3840x2160','4K UHD'],   ['640x480','480p'],
      ]));
    _row(s1, t('fps'),
      _select('fps',
        [['30','30 fps'],['60','60 fps'],['24','24 fps']],
        v => State.setProject({ meta: { fps: parseInt(v) } })));
    _row(s1, t('video_bitrate'),
      _slider('videoBitrate', 1000, 50000, 500, 'k'));
    _row(s1, t('audio_bitrate'),
      _slider('audioBitrate', 64, 320, 32, 'k'));

    // Device selectors
    _row(s1, t('camera'),
      _deviceSelect('video', 'activeVideoDeviceId', id => Recorder.setVideoDevice(id)));
    _row(s1, t('microphone'),
      _deviceSelect('audio', 'activeAudioDeviceId', id => Recorder.setAudioDevice(id)));

    const s2 = _sec(t('sec_overlay'));
    _row(s2, t('overlay_opacity'),
      _slider('overlayOpacity', 0, 1, 0.05, '',
        v => State.emit('player:overlayopacity', v)));

    const s3 = _sec(t('sec_transition'));
    _row(s3, t('transition_type'),
      _select('transitionType', [
        ['fade', t('fade')],
        ['optical-flow', t('optical_flow')],
      ]));
    _row(s3, t('transition_frames'),
      _slider('transitionFrames', 0, 30, 1, t('frame_unit') || '帧'));

    const s4 = _sec(t('sec_colors'));
    _row(s4, t('tag_color'),
      _color('tagColor'));
    _row(s4, t('sel_color'),
      _color('selectionColor'));
  }

  // ════════════════════════════════════════════════
  // TAB: 保存/导出
  // ════════════════════════════════════════════════
  function _renderExport() {
    const s1 = _sec(t('sec_engine'));
    _row(s1, t('engine'),
      _select('exportEngine', [
        ['webcodecs', t('webcodecs')],
        ['ffmpeg',    t('ffmpeg')],
      ]));

    const s2 = _sec(t('sec_format'));
    _row(s2, t('format'),
      _select('exportFormat', [
        ['mp4','MP4 (H.264)'],['webm','WebM (VP9)'],['mov','MOV'],
      ]));
    _row(s2, t('export_speed'),
      _slider('exportSpeed', 0.2, 3, 0.1, '×'));
    _row(s2, t('export_with_tp2'), _toggle('exportWithTeleprompter'));

    const s3 = _sec(t('sec_project'));
    s3.appendChild(_btn(t('save_project'),
      'M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1', '', () => {
        Project.save().then(blob => _dl(blob, 'vidcut-project.zip'));
      }));
    s3.appendChild(_btn(t('load_project'),
      'M8 14V6M5 9l3-3 3 3M2 4v-1a1 1 0 011-1h10a1 1 0 011 1v1', '', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.zip,.json';
        inp.onchange = e => { if (e.target.files[0]) Project.load(e.target.files[0]); };
        inp.click();
      }));

    const s4 = _sec(t('sec_export_video'));
    s4.appendChild(_btn(t('export_mp4'),
      'M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1', 'accent', () => {
        State.emit('export:start', {});
      }));
    s4.appendChild(_btn(t('export_selection'),
      'M3 3h10v10H3zM6 5l5 3-5 3z', '', () => {
        State.emit('export:start', { selection: State.get('selection') });
      }));

    // Wire top-bar buttons (idempotent – may already be wired from main.js)
    const btnExport = document.getElementById('btn-export');
    if (btnExport && !btnExport._wired) {
      btnExport._wired = true;
      btnExport.addEventListener('click', () => State.emit('export:start', {}));
    }
    const btnSave = document.getElementById('btn-save');
    if (btnSave && !btnSave._wired) {
      btnSave._wired = true;
      btnSave.addEventListener('click', () => {
        Project.save().then(blob => _dl(blob, 'vidcut-project.zip'));
      });
    }
  }

  // ════════════════════════════════════════════════
  // TAB: 系统
  // ════════════════════════════════════════════════
  function _renderSystem() {
    const s1 = _sec(t('sec_appearance'));
    _row(s1, t('theme'),
      _select('theme', [
        ['dark',   t('theme_dark')],
        ['light',  t('theme_light')],
        ['system', t('theme_system')],
      ], v => UI.applyTheme(v)));
    _row(s1, t('language'),
      _select('language', [['zh','中文'],['en','English']],
        () => renderTab(_activeTab)));

    const s2 = _sec(t('sec_autosave'));
    _row(s2, t('autosave'),
      _toggle('autosave', v => { if (v) Project.autosave(); }));

    const s3 = _sec(t('sec_danger'));
    s3.appendChild(_btn(t('new_project'),
      'M4 4h12v12H4zM8 8v4M8 8h4', 'danger', () => {
        if (confirm(t('confirm_new'))) State.newProject();
      }));
    s3.appendChild(_btn(t('reset_settings'),
      'M4 8a6 6 0 0112 0M4 8l-2 2 2 2', 'danger', () => {
        if (confirm(t('confirm_reset'))) reset();
      }));
  }

  // ── Helpers ────────────────────────────────────
  function _dl(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function get(key)        { return State.getSetting(key); }
  function set(key, value) { State.setSetting(key, value); }
  function reset() {
    localStorage.removeItem('vidcut_settings');
    location.reload();
  }

  return { init, get, set, reset, renderTab, t };
})();

window.Settings = Settings;
