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
      // Sections
      sec_display: '显示', sec_export_tp: '导出台词', sec_tag_sel: '标签选区',
      sec_recording: '录制', sec_overlay: '叠加预览', sec_transition: '过渡', sec_colors: '颜色',
      sec_engine: '导出引擎', sec_format: '格式', sec_project: '项目', sec_export_video: '导出视频',
      sec_appearance: '外观', sec_autosave: '自动保存', sec_danger: '危险操作',
      // Fields
      show_teleprompter: '显示台词', collapse_on_pause: '暂停时收起',
      font_size: '字体大小', bg_color: '背景颜色', font_color: '文字颜色',
      align: '对齐', align_left: '左对齐', align_center: '居中', align_right: '右对齐',
      export_with_tp: '导出时叠加台词',
      tag_sel_mode: '点击Tag选区',
      tag_sel_cursor: '光标→Tag', tag_sel_tag: 'Tag→下一Tag',
      resolution: '分辨率', fps: '帧率', video_bitrate: '视频码率', audio_bitrate: '音频码率',
      camera: '摄像头', microphone: '麦克风', no_devices: '（无设备）',
      overlay_opacity: '叠加透明度',
      transition_type: '过渡类型', fade: '淡入淡出', optical_flow: '光流（预留）',
      transition_frames: '过渡帧数',
      tag_color: 'Tag 颜色', sel_color: '选区颜色',
      engine: '引擎', webcodecs: 'WebCodecs（轻量）', ffmpeg: 'ffmpeg.wasm（完整）',
      format: '格式', export_speed: '播放倍速', export_with_tp2: '叠加台词',
      save_project: '保存项目 (JSON+ZIP)', load_project: '载入项目 (ZIP)',
      export_mp4: '导出 MP4', export_selection: '导出选区',
      theme: '主题', theme_dark: '深色', theme_light: '浅色', theme_system: '跟随系统',
      language: '语言', ui_font_size: '界面文字大小',
      autosave: '自动保存',
      new_project: '新建项目', reset_settings: '恢复默认设置',
      confirm_new: '新建项目将丢失未保存内容，确认吗？',
      confirm_reset: '恢复所有设置到默认值？',
      // Static Labels & Tooltips
      label_assets: '素材库',
      label_settings: '设置',
      label_teleprompter_hint: '将台词文件拖入此处（支持 .txt / .lrc / .json）',
      label_drop_assets: '拖入素材',
      label_drop_hint: '视频 · 图片 · 音频',
      label_timeline_speed: '速率',
      label_timeline_start: '起点',
      label_timeline_duration: '时长',
      label_timeline_end: '终点',
      sb_playhead: '指示器',
      sb_total: '总时长',
      sb_fps: '帧率',
      sb_mode: '模式',
      sb_status: '状态',
      tip_save: '保存项目 (Ctrl+S)',
      tip_export: '导出 MP4',
      tip_fullscreen: '全屏模式 (F11)',
      tip_exit_fullscreen: '退出全屏',
      tip_settings: '设置面板',
      tip_collapse_assets: '折叠素材库',
      tip_collapse_settings: '折叠设置',
      tip_rec: '录制 / 暂停 (Enter)',
      tip_stop: '停止录制',
      tip_play: '播放预览 (P)',
      tip_rewind: '跳到开始 (Home)',
      tip_mode_insert: '插入模式 (默认)',
      tip_mode_overwrite: '覆盖模式 (Insert+Space)',
      tip_add_tag: '添加标签 (Space)',
      tip_zoom_out: '缩小时间轴',
      tip_zoom_in: '放大时间轴',
      tip_del_sel: '删除选区 (Del)',
      tip_play_sel: '播放选区',
      tip_export_sel: '导出选区',
    },
    en: {
      tab_teleprompter: 'Script', tab_video: 'Video', tab_export: 'Save', tab_system: 'System',
      sec_display: 'Display', sec_export_tp: 'Export Script', sec_tag_sel: 'Tag Selection',
      sec_recording: 'Recording', sec_overlay: 'Preview Overlay', sec_transition: 'Transition', sec_colors: 'Colors',
      sec_engine: 'Export Engine', sec_format: 'Format', sec_project: 'Project', sec_export_video: 'Export Video',
      sec_appearance: 'Appearance', sec_autosave: 'Auto-Save', sec_danger: 'Danger Zone',
      show_teleprompter: 'Show Script', collapse_on_pause: 'Collapse on Pause',
      font_size: 'Font Size', bg_color: 'Background', font_color: 'Text Color',
      align: 'Align', align_left: 'Left', align_center: 'Center', align_right: 'Right',
      export_with_tp: 'Overlay script on export',
      tag_sel_mode: 'Click tag to select',
      tag_sel_cursor: 'Cursor → Tag', tag_sel_tag: 'Tag → Next Tag',
      resolution: 'Resolution', fps: 'Frame Rate', video_bitrate: 'Video Bitrate', audio_bitrate: 'Audio Bitrate',
      camera: 'Camera', microphone: 'Microphone', no_devices: '(no devices)',
      overlay_opacity: 'Overlay Opacity',
      transition_type: 'Transition', fade: 'Fade', optical_flow: 'Optical Flow (future)',
      transition_frames: 'Transition Frames',
      tag_color: 'Tag Color', sel_color: 'Selection Color',
      engine: 'Engine', webcodecs: 'WebCodecs (light)', ffmpeg: 'ffmpeg.wasm (full)',
      format: 'Format', export_speed: 'Playback Speed', export_with_tp2: 'Overlay Script',
      save_project: 'Save Project (JSON+ZIP)', load_project: 'Load Project (ZIP)',
      export_mp4: 'Export MP4', export_selection: 'Export Selection',
      theme: 'Theme', theme_dark: 'Dark', theme_light: 'Light', theme_system: 'System',
      language: 'Language', ui_font_size: 'UI Font Size',
      autosave: 'Auto-Save',
      new_project: 'New Project', reset_settings: 'Reset Settings',
      confirm_new: 'New project will discard unsaved changes. Continue?',
      confirm_reset: 'Reset all settings to defaults?',
      label_assets: 'Asset Library',
      label_settings: 'Settings',
      label_teleprompter_hint: 'Drop script files here (.txt / .lrc / .json)',
      label_drop_assets: 'Drop Assets',
      label_drop_hint: 'Video · Image · Audio',
      label_timeline_speed: 'Speed',
      label_timeline_start: 'Start',
      label_timeline_duration: 'Dur',
      label_timeline_end: 'End',
      sb_playhead: 'Playhead',
      sb_total: 'Total',
      sb_fps: 'FPS',
      sb_mode: 'Mode',
      sb_status: 'Status',
      tip_save: 'Save Project (Ctrl+S)',
      tip_export: 'Export MP4',
      tip_fullscreen: 'Fullscreen (F11)',
      tip_exit_fullscreen: 'Exit Fullscreen',
      tip_settings: 'Settings Panel',
      tip_collapse_assets: 'Collapse Assets',
      tip_collapse_settings: 'Collapse Settings',
      tip_rec: 'Record / Pause (Enter)',
      tip_stop: 'Stop Recording',
      tip_play: 'Play Preview (P)',
      tip_rewind: 'Rewind (Home)',
      tip_mode_insert: 'Insert Mode (Default)',
      tip_mode_overwrite: 'Overwrite Mode (Insert+Space)',
      tip_add_tag: 'Add Tag (Space)',
      tip_zoom_out: 'Zoom Out',
      tip_zoom_in: 'Zoom In',
      tip_del_sel: 'Delete Selection (Del)',
      tip_play_sel: 'Play Selection',
      tip_export_sel: 'Export Selection',
    }
  };

  function t(key) {
    const lang = State.getSetting('language') || 'zh';
    return (I18N[lang] || I18N.zh)[key] || key;
  }
  window.t = t;

  function init(panelEl) {
    _contentEl = panelEl || document.getElementById('settings-content');
    _initTabs();
    renderTab(_activeTab);

    State.on('settings:change:language', () => {
      renderTab(_activeTab);
      UI.updateStaticLabels();
    });

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

  function _color(key, onChange, showAlpha = false) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1';

    const inp = document.createElement('input');
    inp.type  = 'color';
    const curVal = State.getSetting(key) || '#ffffff';
    inp.value = curVal.startsWith('rgba') ? _rgbaToHex(curVal) : curVal;

    inp.addEventListener('input', () => {
      const alphaKey = key + 'Alpha';
      const alpha = showAlpha ? (State.getSetting(alphaKey) ?? 1) : 1;
      const finalColor = alpha < 1 ? _hexToRgba(inp.value, alpha) : inp.value;
      State.setSetting(key, finalColor);
      if (onChange) onChange(finalColor);
    });

    wrap.appendChild(inp);

    if (showAlpha) {
      const alphaKey = key + 'Alpha';
      const initialAlpha = _getAlphaFromRgba(curVal) ?? State.getSetting(alphaKey) ?? 1;
      const slider = _slider(alphaKey, 0, 1, 0.05, '', (v) => {
        const finalColor = v < 1 ? _hexToRgba(inp.value, v) : inp.value;
        State.setSetting(key, finalColor);
        if (onChange) onChange(finalColor);
      });
      slider.style.flex = '1';
      const sliderInp = slider.querySelector('input');
      if (sliderInp) sliderInp.value = initialAlpha;
      const sliderVal = slider.querySelector('.setting-val');
      if (sliderVal) sliderVal.textContent = initialAlpha;

      wrap.appendChild(slider);
    }

    return wrap;
  }

  function _rgbaToHex(rgba) {
    const m = rgba.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!m) return '#ffffff';
    const r = parseInt(m[1]).toString(16).padStart(2, '0');
    const g = parseInt(m[2]).toString(16).padStart(2, '0');
    const b = parseInt(m[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function _getAlphaFromRgba(rgba) {
    const m = rgba.match(/rgba?\(.*,\s*([\d.]+)\)$/);
    return m ? parseFloat(m[1]) : null;
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

  function _deviceSelect(kind, settingKey, onChangeAsync) {
    const sel = document.createElement('select');
    const cur = State.getSetting(settingKey);
    const ph = document.createElement('option');
    ph.textContent = t('no_devices');
    ph.disabled = true;
    sel.appendChild(ph);

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

  function _renderTeleprompter() {
    const s1 = _sec(t('sec_display'));
    _row(s1, t('show_teleprompter'),
      _toggle('teleprompterVisible', v => Teleprompter.setVisible(v)));
    _row(s1, t('collapse_on_pause'),
      _toggle('teleprompterCollapseOnPause'));
    _row(s1, t('font_size'),
      _slider('teleprompterFontSize', 10, 36, 1, 'px', v => Teleprompter.setFontSize(v)));
    _row(s1, t('bg_color'),
      _color('teleprompterBg', v => Teleprompter.setBg(v), true));
    _row(s1, t('font_color'),
      _color('teleprompterFontColor', v => Teleprompter.setFontColor(v), true));
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
      _slider('transitionFrames', 0, 30, 1, '帧'));

    const s4 = _sec(t('sec_colors'));
    _row(s4, t('tag_color'),
      _color('tagColor', null, true));
    _row(s4, t('sel_color'),
      _color('selectionColor', null, true));
  }

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
    _row(s1, t('ui_font_size'),
      _slider('uiFontSize', 10, 20, 1, 'px', v => UI.applyFontSize(v)));

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
