# VidCut

基于浏览器的视频录像与剪辑工具，无需安装，纯 HTML + JavaScript 实现。

---

## 功能概览

### 录制
- 摄像头 + 麦克风同步录制，支持多设备切换
- **插入模式**：新录制片段插入当前时间点，后续内容自动后移
- **覆盖模式**：录制内容覆盖当前时间点的已有内容
- 录制过程中随时按 `Space` 打 Tag 标记
- 按 `Enter` 暂停后可移动指示器，从任意位置续录

### 时间轴
- 多轨道叠加（视频、图片、音频统一层模型）
- 画中画 (PIP)：多层同时段叠加，独立位置/尺寸/透明度
- Clip 水平拖拽移动，跨轨道垂直拖拽
- 左右缩放把手精确修剪入出点
- `Ctrl + 滚轮` 平滑缩放，极限为按帧显示
- 关键帧缩略图懒加载，音频轨道波形可视化
- 右键菜单：重命名、切割、复制、删除层

### 指示器与选区
- 播放头可鼠标拖拽或键盘精确控制
- `←` `→` 逐帧移动，按住自动加速（上限为总时长 1/20）
- `Shift + ←→` 或鼠标拖拽空白区域创建选区
- `Shift + 点击 Tag` 快速选区（光标→Tag 或 Tag→下一Tag，可设置）
- 指示器位置叠加半透明预览，方便对齐拍摄角度

### Tag 标记
- 录制/播放时随时打 Tag
- 双击重命名，拖拽调整时间位置
- 右键菜单：选区、删除、跳转

### 台词提示器
- 支持拖入 `.txt`（手动滚动）、`.lrc`（自动滚动）、`.json`（自动滚动）
- LRC 支持 `[mm:ss.xx]` 和 `[mm:ss:ff]` 双格式
- 当前行居中高亮，上下渐隐遮罩
- 手动滚动后 3 秒自动恢复跟随
- 高度可拖拽调整，可设置是否在暂停时自动收起
- 导出时可选择将台词叠加到视频画面

### 过渡效果
- 编辑点自动识别，可设置过渡帧数（0 = 硬切）
- 当前支持淡入淡出，预留光流插帧插件接口

### 素材库
- 拖入视频、图片、音频，或点击素材区上传
- 缩略图网格可缩放
- 视频素材鼠标悬停预览
- 拖拽素材到时间轴任意轨道/位置

### 导出
- **WebCodecs 引擎**（默认）：浏览器原生编码，轻量快速
- **ffmpeg.wasm 引擎**：完整编解码支持，自动降级备用
- 支持 MP4 (H.264)、WebM (VP9)、MOV 格式
- 播放倍速调节（0.2× ~ 3×）
- 可选择导出全片或选区
- 精确进度条，随时取消

### 项目保存
- 保存为 ZIP（`project.json` + 所有媒体文件）
- 载入 ZIP 完整还原项目
- 自动存档到 localStorage（3 秒防抖，仅保存结构）
- 启动时检测自动存档并询问是否恢复

---

## 快速开始

```bash
# 解压后进入目录
unzip vidcut-session4-final.zip
cd videoeditor

# 启动本地服务器（任选一种）
python3 -m http.server 8080
# 或
npx serve .

# 浏览器打开
# http://localhost:8080
```

> 录制功能需要 HTTPS 或 `localhost`（浏览器 `getUserMedia` 安全限制）。

### ffmpeg.wasm 引擎额外要求

ffmpeg.wasm 需要 `SharedArrayBuffer`，需在服务器响应头加入：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

用 `npx serve` 启动时：

```bash
npx serve . --headers '{"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"}'
```

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 开始 / 暂停录制 |
| `Space` | 添加 Tag 标记 |
| `Insert` + `Space` | 切换到覆盖模式并开始录制 |
| `←` `→` | 逐帧移动指示器（按住加速） |
| `Shift` + `←` `→` | 扩展 / 收缩选区 |
| `Shift` + 点击 Tag | 选区到该 Tag |
| `P` | 播放 / 暂停预览 |
| `Home` | 跳到开始 |
| `End` | 跳到结尾 |
| `Delete` | 删除当前选区 |
| `Ctrl` + `S` | 保存项目（ZIP） |
| `Ctrl` + 滚轮 | 时间轴缩放 |

---

## 界面布局

```
┌──────────────────────────────────────────────────────────┐
│  VidCut  [项目名]     [录制][停止][播放][插入/覆盖][Tag]  [保存][导出][设置]  │
├──────────┬───────────────────────────────────┬───────────┤
│          │  台词提示器（可折叠，高度可拖拽）      │           │
│  素材库  ├───────────────────────────────────┤  设置面板  │
│          │                                   │           │
│  视频    │      实时预览 / Canvas 合成         │  台词     │
│  图片    │                                   │  视频处理  │
│  音频    │  [总时长 HUD]        [叠加透明度]   │  保存导出  │
│          ├───────────────────────────────────┤  系统     │
│  [缩放]  │  [缩小] ──── 时间轴缩放 ──── [放大]  │           │
│          │  [删除选区] [播放选区] [导出选区]     │           │
│          ├───────────────────────────────────┤           │
│          │ 标尺  00:00  00:30  01:00  01:30  │           │
│          │ 轨道0 ████▓▓▓▓████████             │           │
│          │ 轨道1      ████ PIP ████           │           │
│          │ 音频  ~~~~~~~~~~~~~~~~~~~~         │           │
│          │ [滚动条]                           │           │
├──────────┴───────────────────────────────────┴───────────┤
│  指示器 00:01:23.06  ·  总时长 00:02:34.18  ·  30fps  ·  插入  ·  就绪  │
└──────────────────────────────────────────────────────────┘
```

---

## 文件结构

```
videoeditor/
├── index.html              # 主页面 HTML 骨架
├── style.css               # 全部样式（深色/浅色主题 CSS 变量）
└── js/
    ├── state.js            # 响应式状态中心 + 事件总线
    ├── ui.js               # Shell、状态栏、面板缩放、主题、时间格式化
    ├── layers.js           # 统一层模型（视频/音频/图片/录制）CRUD
    ├── tags.js             # Tag 标记、选区逻辑
    ├── timeline.js         # 时间轴渲染与交互
    ├── player.js           # Canvas 多层合成播放器
    ├── recorder.js         # MediaRecorder 录制逻辑
    ├── teleprompter.js     # 台词提示器
    ├── transition.js       # 编辑点过渡效果
    ├── settings.js         # 设置面板（含 i18n）
    ├── keyboard.js         # 键盘快捷键
    ├── export.js           # WebCodecs / ffmpeg.wasm 导出
    ├── project.js          # 项目保存与载入（ZIP）
    └── main.js             # 初始化入口
```

---

## 浏览器兼容性

| 功能 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| 录制 (MediaRecorder) | 49+ ✓ | 25+ ✓ | 14.1+ ✓ | 79+ ✓ |
| Canvas 合成 | ✓ | ✓ | ✓ | ✓ |
| WebCodecs 导出 | 94+ ✓ | — | — | 94+ ✓ |
| ffmpeg.wasm 导出 | 68+ ✓ | 79+ ✓ | 15.2+ ✓ | 79+ ✓ |
| OffscreenCanvas | 69+ ✓ | 105+ ✓ | 16.4+ ✓ | 79+ ✓ |

**推荐使用 Chrome 94+ 或 Edge 94+** 以获得 WebCodecs 原生导出支持。

---

## 层模型说明

VidCut 使用统一的层（Layer）数据结构管理所有媒体：

```js
{
  id:             String,   // 唯一标识
  type:           'video' | 'audio' | 'image' | 'recording',
  src:            String,   // Blob URL 或文件路径
  trackIndex:     Number,   // 时间轴行号（z 轴顺序）

  // 时间（秒，浮点）
  timelineStart:  Number,   // 在时间轴上的开始时间
  timelineEnd:    Number,   // 在时间轴上的结束时间
  sourceStart:    Number,   // 素材内部的起始偏移
  sourceEnd:      Number,   // 素材内部的结束偏移

  // 空间（0.0–1.0 相对值，音频忽略）
  x, y:           Number,
  width, height:  Number,

  // 视觉
  opacity:        Number,   // 0.0–1.0
  chromaKey:      String,   // 抠图颜色（HEX），null 表示关闭
  speed:          Number,   // 播放速率
  blendMode:      String,   // CSS mix-blend-mode
}
```

所有编辑操作（插入、覆盖、切割、删除、导出）都基于此统一结构，音频层与视频层共享同一套剪辑逻辑。

---

## 台词文件格式

### LRC 歌词格式
```lrc
[ti:标题]
[ar:作者]
[00:01.50]第一句台词
[00:03.00]第二句台词
[01:23.45]最后一句
```

### JSON 格式（三种结构均支持）
```json
[
  { "time": 1.5,  "text": "第一句台词" },
  { "time": 3.0,  "text": "第二句台词" },
  { "time": 83.45,"text": "最后一句" }
]
```

### 纯文本
直接拖入 `.txt` 文件，手动滚动或触摸拖动。

---

## 过渡插件接口

如需接入自定义过渡效果（如光流插帧）：

```js
Transition.registerPlugin('my-effect', (ctx, frameA, frameB, progress) => {
  // frameA, frameB: ImageData（相同尺寸）
  // progress: 0.0 → 1.0
  // 在 ctx 上绘制混合结果
  const out = ctx.createImageData(frameA.width, frameA.height);
  // ... 自定义混合逻辑
  ctx.putImageData(out, 0, 0);
});
```

在设置面板「过渡类型」中选择注册的插件名即可启用。

---

## 已知限制

- **WebCodecs 无音频轨道**：当前 WebCodecs 路径仅编码视频，音频需通过 ffmpeg.wasm 引擎导出。
- **autosave 不含媒体文件**：localStorage 容量有限，自动存档仅保存项目结构，刷新页面后媒体 Blob URL 失效，需重新载入媒体文件或使用完整 ZIP 保存。
- **ChromaKey 为软件实现**：使用 Canvas 像素遍历，对高分辨率视频实时抠图性能有限。如需高性能抠图可通过 WebGL 插件扩展。
- **移动端**：布局和键盘快捷键以桌面为主，触摸操作支持基础，未针对小屏优化。

---

## License

MIT
