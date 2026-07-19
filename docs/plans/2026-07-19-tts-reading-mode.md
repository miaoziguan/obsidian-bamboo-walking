# 实现计划：插件内「朗读模式」（TTS）

日期：2026-07-19
形态：路线 A — 客户端实时 TTS（Web Speech API），零后端零成本
已确认偏好：逐段高亮 + 自动滚动；工具栏加语音下拉

## 设计要点

- 复用 Obsidian 桌面端内置 `window.speechSynthesis`，无需任何依赖。
- 文本分段：直接遍历已渲染 `bodyEl` 下的语义块（`p/h1-h6/li/blockquote`），
  取 `textContent` 作为一段，保留 DOM 引用用于高亮 + 滚动。跳过代码块/图片。
- `TtsService` 封装浏览器 API：分段队列、播放/暂停/继续/停止、语速、语音选择、
  中文语音列表；回调 `onSegmentStart / onStateChange / onEnd`。
- 逐段 `speak()`，每段 `onend` 立即触发下一段，规避 Chromium 长文本静音 bug。
- 移动端 `speechSynthesis` 不支持 → 按钮禁用 + tooltip 提示。
- 续读记忆（持久化段落索引）、语速记忆（持久化）。

## 任务拆分（TDD：先写失败测试 → 实现 → 跑通）

### Task 1 — TtsService 核心（队列/状态/分段推进）
- 文件：`src/services/TtsService.ts`（新建）、`src/services/__tests__/TtsService.test.ts`（新建）
- 测试覆盖：
  1. 不支持时（synth=null）isSupported=false，speakSegments 无副作用
  2. speakSegments 逐段推进：第 1 段 onstart→onSegmentStart，模拟 onend→第 2 段
  3. 全部读完触发 onEnd + 状态 idle
  4. pause/resume 切换状态；stop 清空并 idle
  5. getChineseVoices 过滤含 zh/cmn/cn 的语音
  6. setRate/setVoice 写入下一次 utterance
- 通过依赖注入（synth + UtteranceCtor）使测试不需要真实浏览器环境。

### Task 2 — ReaderView 接入朗读控件
- 文件：`src/ui/ReaderView.ts`
- 工具栏加 TTS 分组：🔊播放/暂停、⏹停止、语速 select、语音 select。
- `extractReadableSegments()` 从 bodyEl 提取段落+DOM 引用。
- `onSegmentStart` → 高亮 `.bwr-tts-active` + `scrollIntoView` 居中。
- `showArticle / unload` 调 `ttsService.stop()` 并复位 UI，避免串音。
- 续读记忆、语速记忆、语音记忆均持久化。
- 不支持时禁用按钮 + title 提示。

### Task 语音下拉填充
- TtsService 暴露 `setVoicesChangedHandler(cb)`；ReaderView 在首次 populate，
  为空则监听 `voiceschanged` 再填充；选中即 setVoice + 持久化。

### Task 样式
- 文件：`styles.css`
- `.bwr-tts-active` 高亮（淡色背景 + 左侧色条）；
- `.bwr-tts` 控件组、按钮态（playing）、select 样式；与现有 toolbar 风格一致。

## 验证

- `npm run typecheck` 通过
- `npm run test`（vitest）通过，含 TtsService 单测
- `npm run sync` 部署到测试 vault 实测朗读（桌面端）
