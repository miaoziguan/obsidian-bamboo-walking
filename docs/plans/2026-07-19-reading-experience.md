# 阅读体验修复与增强计划

日期：2026-07-19
范围：全覆盖（明确缺陷 + 进阶排版 + 可选增强）
涉及文件：`styles.css`、`src/ui/ReaderView.ts`（可能新增纯函数 + 单测）

## 背景
前序已完成 P0/P1/P2 正文排版（苹方字体、行宽 38em、两端对齐、标点避头尾、暗色统一、图片增强）。
本轮基于对真实代码的复盘，修两处明确缺陷并补齐进阶/可选项。

## 验证方式
- 每项改完：`npm run lint` 通过 → `bash sync.sh` 构建同步。
- 可提取的纯逻辑（中英文间距）用 vitest 单测（TDD）。
- CSS/DOM 交互项靠 lint+build+真机确认（无法单测）。

---

## A. 明确缺陷（🔴）

### A1 代码块长行截断
- 现状：`pre.bwr-code { overflow: hidden }`（styles.css:1122），超宽代码行被裁掉、无法横看。
- 改法：`overflow: hidden` → 头部圆角保留，代码区 `overflow-x: auto`；加 `max-height` + `overflow-y: auto` 防超长撑爆。
- 落点：`.bwr-code` / `.bwr-code code` 区块。

### A2 字号 CSS/JS 冲突
- 现状：CSS `.bwr-body{font-size:15px}` 被 `applyFontSize()` 内联 16px 覆盖，P0 的 15px 未生效。
- 改法：字号交由 JS 单一控制。CSS 移除写死的 `font-size:15px`（保留响应式），基准由 `fontSize=16` 统一；重置=16 概念一致。
- 落点：`styles.css` `.bwr-body`、响应式段；`ReaderView.ts` 无需改逻辑。

---

## B. 进阶排版（🟡）

### B1 中英混排自动间距
- 改法：`.bwr-body` 加 `text-autospace: normal`（Chromium 渐进支持）；不依赖它作硬保证。
- 落点：`.bwr-body`。

### B2 ::selection 竹绿高亮
- 改法：`.bwr-body ::selection { background: <竹绿浅底>; }`，暗色单独校准。
- 落点：新增区块 + `.theme-dark`。

### B3 行内 code 排除两端对齐
- 现状：`p{text-align:justify}` 会拉散段内 inline code。
- 改法：`.bwr-body code { text-align: initial; }`（inline 影响有限，主要防块级），并确保 inline code 不参与 justify 拉伸——实测以 `white-space` 保护。
- 落点：`.bwr-body code`。

### B4 text-spacing-trim 兼容加固
- 改法：保留现有 `text-spacing-trim: trim-start`，补 `line-break: strict`；真机验证行首标点。若旧内核无效，记录为已知限制（不做重 JS 后处理，风险高）。
- 落点：`.bwr-body`。

---

## C. 可选增强（🟢）

### C1 内部链接行为
- 现状：`a.internal-link` 未拦截，点击可能无响应/跳出。
- 改法：渲染后遍历 `.bwr-body a`：
  - `internal-link` → `app.workspace.openLinkText(href, "", false)`。
  - 外部链接（http/https）→ 新窗口 `window.open` + `rel=noopener`。
- 落点：`ReaderView.ts` render 后（图片增强附近）。

### C2 无障碍
- 改法：`bwr-body a`/关键按钮补 `:focus-visible` 焦点环（CSS）；工具栏字号/分享/保存按钮补 `aria-label`（TS）。
- 落点：`styles.css` + `renderToolbar`。

### C3 阅读专注模式
- 改法：工具栏加「◎ 专注」按钮，toggle `contentEl` 上的 `.bwr-focus` class：隐藏 TOC、正文列加宽居中、隐藏 topbar 非必要项。再次点击退出；Esc 退出。状态存 localStorage。
- 落点：`ReaderView.ts`（按钮+toggle+Esc）+ `styles.css`（`.bwr-focus` 规则）。

---

## 执行顺序
A1 → A2 → B1 → B2 → B3 → B4 → C1 → C2 → C3 → 统一 lint/build/sync 收尾。
风险低的 CSS 项可合并提交；C1/C3 涉及 TS 行为，单独验证。
