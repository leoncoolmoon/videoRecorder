# VideoEditor — Master Architecture

## File Structure
```
videoeditor/
├── index.html          # Shell, layout, panel structure
├── style.css           # All styles, CSS variables, themes
├── js/
│   ├── state.js        # Central state store + event bus
│   ├── timeline.js     # Timeline rendering + interaction
│   ├── recorder.js     # Camera/mic capture, recording logic
│   ├── player.js       # Preview playback, composite rendering
│   ├── layers.js       # Layer model, CRUD, ordering
│   ├── tags.js         # Tag/marker logic, selection ranges
│   ├── teleprompter.js # Teleprompter load, scroll, display
│   ├── export.js       # WebCodecs / ffmpeg.wasm export
│   ├── project.js      # Save/load JSON, ZIP packaging
│   ├── settings.js     # Settings panel, persistence (localStorage)
│   ├── keyboard.js     # All keyboard shortcuts
│   ├── ui.js           # Panel resizing, tooltips, status bar
│   └── transition.js   # Fade / (future: optical flow) transitions
└── assets/
    └── icons/          # SVG icon sprites (no emoji, no text buttons)
```

---

## Core Data Structures

### Layer (universal unit for all media)
```js
{
  id: String,            // uuid
  type: 'video'|'audio'|'image'|'recording',
  src: String,           // blob URL or file path
  trackIndex: Number,    // row index in timeline (0 = top)
  
  // Time (in seconds, float)
  timelineStart: Number, // when this layer starts on the timeline
  timelineEnd: Number,   // when it ends
  sourceStart: Number,   // trim: start offset within source file
  sourceEnd: Number,     // trim: end offset within source file
  
  // Spatial (ignored for audio)
  x: Number,             // 0.0–1.0 relative to canvas width
  y: Number,
  width: Number,         // 0.0–1.0
  height: Number,
  
  // Visual
  opacity: Number,       // 0.0–1.0
  chromaKey: String|null,// hex color for keying, null if off
  speed: Number,         // playback rate, 0.2–3.0
  blendMode: String,     // CSS mix-blend-mode value
  
  // Metadata
  name: String,
  thumbnail: String|null // base64 thumbnail, generated on demand
}
```

### Tag (marker on timeline)
```js
{
  id: String,
  time: Number,          // seconds
  label: String,
  color: String,         // hex
  isPlayhead: Boolean    // true = this is the moveable playhead marker
}
```

### SelectionRange
```js
{
  startTime: Number,
  endTime: Number,
  anchorTagId: String|null  // tag that anchored the selection start
}
```

### Project (saved JSON)
```js
{
  version: '1.0',
  meta: { name, created, modified, fps, width, height },
  layers: Layer[],
  tags: Tag[],
  teleprompter: {
    text: String,
    entries: [{time: Number, text: String}]|null,  // null = plain text
    format: 'plain'|'lrc'|'json'
  },
  settings: Settings
}
```

### Settings (persisted to localStorage)
```js
{
  // System
  language: 'zh'|'en',
  theme: 'dark'|'light'|'system',
  
  // Recording
  resolution: '1920x1080'|'1280x720'|'3840x2160',
  fps: 24|30|60,
  videoBitrate: Number,  // kbps
  audioBitrate: Number,
  
  // Teleprompter
  teleprompterVisible: Boolean,
  teleprompterCollapseOnPause: Boolean,
  teleprompterOpacity: Number,
  teleprompterBg: String,
  teleprompterFontColor: String,
  teleprompterFontSize: Number,
  teleprompterAlign: 'left'|'center'|'right',
  teleprompterWithExport: Boolean,   // include in exported video?
  
  // Timeline
  tagSelectionMode: 'cursor-to-tag'|'tag-to-tag',
  
  // Preview
  overlayOpacity: Number,       // cursor-position overlay, default 0.3
  previewSpeed: Number,         // 0.5–2.0
  tagColor: String,
  selectionColor: String,
  
  // Transitions
  transitionType: 'fade'|'optical-flow',
  transitionFrames: Number,     // 0–30
  
  // Export
  exportEngine: 'webcodecs'|'ffmpeg',
  exportFormat: 'mp4'|'webm'|'mov',
  exportSpeed: Number,          // 0.2–3.0
  exportWithTeleprompter: Boolean
}
```

---

## Module APIs

### state.js — Central Store + Event Bus
```js
// State is a single reactive object. Modules read/write via these functions.

State.get(key)                    // → any
State.set(key, value)             // fires event 'state:change:key'
State.on(event, handler)          // subscribe
State.off(event, handler)         // unsubscribe
State.emit(event, data)           // fire arbitrary event

// Top-level state keys:
// 'project'     → Project
// 'playhead'    → Number (current time, seconds)
// 'selection'   → SelectionRange | null
// 'isRecording' → Boolean
// 'isPaused'    → Boolean
// 'mode'        → 'insert' | 'overwrite'
// 'settings'    → Settings
// 'statusMsg'   → String  (shown in status bar on hover)
// 'zoomLevel'   → Number  (timeline pixels per second)
```

### layers.js — Layer Model
```js
Layers.create(partial)            // → Layer (fills defaults)
Layers.add(layer)                 // adds to project, fires 'layers:change'
Layers.remove(id)                 // fires 'layers:change'
Layers.update(id, partial)        // fires 'layers:change'
Layers.reorder(id, newTrackIndex) // swap track rows
Layers.getAll()                   // → Layer[]
Layers.getAtTime(t)               // → Layer[] visible at time t
Layers.split(id, time)            // split layer at time → [Layer, Layer]
Layers.deleteRange(startTime, endTime, trackIds?)  // remove+close gap
Layers.insertGap(time, duration)  // push all layers after time by duration
Layers.getThumbnail(id, time)     // → Promise<base64>  (lazy, cached)
```

### tags.js — Tags & Selection
```js
Tags.add(time, label?)            // → Tag
Tags.remove(id)
Tags.update(id, partial)
Tags.getAll()                     // → Tag[] sorted by time
Tags.getNearest(time)             // → Tag
Tags.getNext(time)                // → Tag | null
Tags.getPrev(time)                // → Tag | null

Tags.selectToNext(fromTagId)      // set SelectionRange tag→next tag
Tags.selectToCursor(tagId)        // set SelectionRange tag→playhead
Tags.selectShiftArrow(dir, delta) // extend selection by delta seconds
Tags.clearSelection()
Tags.getSelection()               // → SelectionRange | null
```

### recorder.js — Capture
```js
Recorder.init()                   // request camera + mic permissions
Recorder.start()                  // begin recording, adds recording layer
Recorder.pause()                  // pause, update layer timelineEnd
Recorder.resume()                 // continue (insert or overwrite)
Recorder.stop()                   // finalize, bake blob URL
Recorder.getStream()              // → MediaStream (for live preview)
Recorder.setMode(mode)            // 'insert'|'overwrite'
// fires: 'recorder:start' 'recorder:pause' 'recorder:stop'
```

### player.js — Composite Preview
```js
Player.init(canvasEl)             // set up offscreen canvas composite
Player.play(startTime?)           // composite all layers via requestAnimationFrame
Player.pause()
Player.seek(time)                 // jump to time, render single frame
Player.setSpeed(rate)
Player.getFrame(time)             // → Promise<ImageData>  (for thumbnails)
Player.renderOverlay(time)        // render cursor-position overlay frame
// fires: 'player:timeupdate' (time), 'player:ended'
```

### timeline.js — Timeline UI
```js
Timeline.init(containerEl)
Timeline.render()                 // full redraw (called on state change)
Timeline.setZoom(pixelsPerSecond) // 1–200, fires redraw
Timeline.scrollTo(time)
Timeline.pixelToTime(px)          // → Number
Timeline.timeToPixel(t)           // → Number
Timeline.addTrackRow(layer)       // insert new row
Timeline.removeTrackRow(id)
Timeline.startDrag(layerId, edge) // 'left'|'right'|'move' drag handle
Timeline.renderThumbnails()       // lazy-load visible thumbnail slots
// Internally handles: click, drag, scroll, wheel-zoom
```

### keyboard.js — Shortcuts
```js
Keyboard.init()
// Registered shortcuts:
// Enter              → Recorder.start() / Recorder.pause()
// Space              → Tags.add(State.get('playhead'))
// Insert+Space       → State.set('mode','overwrite'), Recorder.start()
// ArrowLeft/Right    → movePlayhead(±1frame, accelerating)
// Shift+ArrowLeft/Right → Tags.selectShiftArrow(dir, delta)
// Shift+Click(tag)   → Tags.selectToNext / Tags.selectToCursor per settings

Keyboard.getFrameMoveSpeed()      // → frames, increases while held, max=totalFrames/20
Keyboard.resetFrameMoveSpeed()
```

### teleprompter.js — Teleprompter
```js
Teleprompter.init(containerEl)
Teleprompter.load(file)           // auto-detect plain/lrc/json, parse
Teleprompter.seek(time)           // scroll to correct line for time
Teleprompter.setVisible(bool)
Teleprompter.setOpacity(v)
Teleprompter.setFontColor(hex)
Teleprompter.setBg(hex)
Teleprompter.setFontSize(px)
Teleprompter.setAlign(align)
Teleprompter.getText()            // → String (plain, for export overlay)
// Drag-and-drop handled internally via dragover/drop on container
```

### transition.js — Transitions
```js
Transition.apply(ctx, frameA, frameB, progress, type)
// type: 'fade' | 'optical-flow'
// progress: 0.0–1.0
// For 'fade': alpha blend frameA and frameB
// For 'optical-flow': placeholder that calls OpticalFlow plugin if loaded

Transition.registerPlugin(name, fn) // future: plug in optical-flow WASM
// fn(ctx, frameA, frameB, progress) → void
```

### export.js — Export
```js
Export.toMP4(options)             // → Promise<Blob>
// options: { engine, format, speed, withTeleprompter, selection? }
// engine='webcodecs': uses VideoEncoder + AudioEncoder (WebCodecs API)
// engine='ffmpeg': dynamically loads ffmpeg.wasm, passes frames

Export.toProjectZip()            // → Promise<Blob>  (JSON + source blobs)
Export.estimateDuration(options) // → Number seconds (estimate for progress bar)
// fires: 'export:progress' (0–1), 'export:done' (blob), 'export:error' (err)
```

### project.js — Save / Load
```js
Project.save()                    // → Promise<Blob> (zip)
Project.load(file)                // unzip, restore State + blobs
Project.toJSON()                  // → String
Project.fromJSON(str)             // restore (blobs must be re-attached)
Project.autosave()                // writes toJSON to localStorage
Project.getAutoSave()             // → String|null
```

### settings.js — Settings Panel
```js
Settings.init(panelEl)
Settings.get(key)                 // → value
Settings.set(key, value)          // persists to localStorage, fires 'settings:change:key'
Settings.render()                 // build 4-tab panel: 台词/视频处理/保存/系统
Settings.reset()                  // restore defaults
```

### ui.js — Shell & Status Bar
```js
UI.init()
UI.setStatus(msg)                 // set status bar text
UI.onButtonHover(el, msg)         // register hover→status message
UI.showTooltip(el, msg)           // (status bar tooltip, not floating)
UI.setPanelWidth(panel, px)       // resizable panels via drag
UI.applyTheme(theme)              // 'dark'|'light'|'system'
UI.formatTime(sec)                // → '00:01:23.06'  (HH:MM:SS.frame)
UI.parseTime(str)                 // → Number seconds
```

---

## Event Flow (key scenarios)

### Recording a clip
1. User presses Enter → `keyboard.js` → `Recorder.start()`
2. `Recorder` creates new Layer (type='recording'), adds via `Layers.add()`
3. `Timeline.render()` reacts to 'layers:change'
4. Every 100ms, `Recorder` updates layer.timelineEnd → `Timeline.render()`
5. User presses Space → `Tags.add(State.get('playhead'))`
6. User presses Enter → `Recorder.pause()`, layer finalized

### Moving playhead with arrow keys
1. `keyboard.js` captures ArrowLeft/Right on keydown
2. Calls `Player.seek(playhead ± speed * frameTime)` on each tick
3. `Player.seek()` calls `Player.renderOverlay()` → overlay canvas updates
4. `Timeline.render()` moves playhead indicator
5. On keyup: `Keyboard.resetFrameMoveSpeed()`

### Deleting a selection
1. User has SelectionRange via Tags or Shift+arrow
2. Clicks delete button → `Layers.deleteRange(sel.start, sel.end)`
3. `Layers.deleteRange()` splits affected layers, removes segment, closes gap
4. `transition.js` marks edit points for fade rendering
5. `Timeline.render()` redraws

### Export
1. User clicks export → `Export.toMP4(options)`
2. `Export` iterates frames: for each frame time, calls `Player.getFrame(t)`
3. At edit-point frames: `Transition.apply()` blends
4. Frames fed to `VideoEncoder` (WebCodecs) or buffered for ffmpeg
5. `export:progress` events update progress bar in status bar

---

## Implementation Order (6 sessions)

| Session | Modules | Goal |
|---------|---------|------|
| 1 | index.html + style.css + ui.js + state.js | Shell, layout, themes, status bar |
| 2 | layers.js + timeline.js | Timeline rendering, layer rows, zoom, scroll |
| 3 | recorder.js + player.js + keyboard.js | Live preview, recording, playhead movement |
| 4 | tags.js + selection + timeline interaction | Tags, selection ranges, drag handles |
| 5 | teleprompter.js + settings.js + transition.js | Teleprompter, settings panel, fade |
| 6 | export.js + project.js | Export MP4, save/load ZIP |
