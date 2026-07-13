# 竹杖芒鞋 · 工程改进设计文档

> **日期**：2026-07-14
> **状态**：待批准（Brainstorming 阶段产出，批准后写入实现计划并进入子代理驱动开发）
> **范围**：上一轮复盘 + 死代码清理之后，对 `obsidian-bamboo-walking` 插件与 `bamboo-column` 内容源的 9 项工程改进。

---

## 1. 目标与范围

把上一轮"能跑但有隐患"的状态推进为"工程化、可防护、可持续维护"的状态。覆盖 9 项改进，分三组：

| 组 | 项 | 意图 |
|---|---|---|
| **核心隐患** | #1 内容目录统一 | 消除 `bamboo-column/articles/` 与 `content/articles/` 两份副本的手动漂移 |
| | #2 搜索语义合并 | 统一时间线/分类两种搜索逻辑，消除行为不一致 |
| **工程化** | #3 冗余清理 | 清理 `ReaderView:115` 无意义判断 |
| | #4 ESLint + CI 门禁 | 在 PR/发布阶段拦住"未导入/未使用"类问题（曾导致 B13/B14） |
| | #5 脚本健壮性 | `generate-index.js` 缺字段/文件不一致时报错而非静默 |
| | #6 缓存版本 | `CacheData` 加 schema 版本号，旧缓存读时安全重建 |
| **体验/文档** | #7 刷新失败提示 | 网络/解析失败时给出可重试的明确提示 |
| | #8 分享卡片去硬编码 | `renderShareCard` 用常量替换散落硬编码 |
| | #9 README | 说明 DEV_MODE 双通道与内容同步流程 |

**非目标（YAGNI）**：不重构整体架构、不引入新运行时依赖、不改变用户可见功能行为（#7/#8 仅提升提示质量，不改变交互逻辑）。

---

## 2. 总体架构与原则

- **TDD 强制**：每个可测逻辑（#2/#5/#6）先写失败测试，再实现。
- **最小改动、向后兼容**：不在插件运行时引入破坏性变更；旧版缓存、旧 slug 格式继续可用。
- **子代理驱动 + 双评审**：实现用独立子代理，每段代码经 spec 评审 + 代码质量评审。
- **频繁 commit**：每个 task 绿灯后单独提交，便于回滚。
- **发布安全**：CI 门禁（lint）失败则不发布。

### 测试框架选择
项目为 esbuild 打包的 Obsidian 插件，当前**无任何测试框架**。引入 **`vitest`**（devDependency，配置简单、原生支持 TS/ESM）覆盖纯逻辑单测。UI/配置类改动（#1/#3/#4/#7/#8/#9）靠 `typecheck` + `build` + `lint` + 手动验证保证，不强行单测 DOM。

---

## 3. 各改进项设计

### #1 内容目录自动同步（策略：自动同步脚本）
**问题**：`content/articles/` 是 `bamboo-column/articles/` 的手动副本，曾因 hash 不一致出过 B3。CI 只在 tag push 跑 `npm install && npm run build`，**不跑 generate-index，也不校验同步**。

**方案**：
- 新增 `scripts/sync-content.js`（Node，零依赖）：
  1. 校验源目录 `bamboo-column/articles/` 存在，否则 `exit(1)`。
  2. 在源目录运行 hash 生成（`generate-index.js` 逻辑内联或 child_process 调用），确保 `index.json` 含最新 64 位 hash。
  3. `rm -rf` 目标 `obsidian-bamboo-walking/content/articles/` 后 `cp -R` 源目录过去。
  4. 同步后校验：目标 `index.json` 存在且条目数与源一致；不一致 `exit(1)` 并打印 diff。
- `package.json` 增加 `"sync:content": "node scripts/sync-content.js"`，`"prebuild": "npm run sync:content"`（生产构建前自动同步）。
- `release.yml` 在 `npm run build` 前插入 `node scripts/sync-content.js` 步骤，失败则 CI 失败。
- **错误处理**：源缺失/同步校验失败 → 非零退出，CI 阻断，绝不让陈旧 `content/` 流入发布包。

**测试**：`scripts/__tests__/sync-content.test.ts` 用临时 fixture 目录验证"源改后目标被更新、hash 一致、校验失败退出码非零"。

### #2 搜索语义合并
**问题**：`SidebarView` 有 `matchLight`（轻量字段）和 `matchArticle`（轻量 + 全文 `cachedContent`），分类模式调 `matchArticle`、时间线模式走 `filteredArticles` 内部全文匹配，两套语义易分叉。

**方案**：
- 抽纯函数模块 `src/utils/search.ts`：
  ```ts
  export function matchArticle(
    query: string,
    entry: ArticleIndexEntry,
    opts: { fullText: boolean; getContent?: (slug: string) => string },
  ): boolean
  ```
  - `fullText=false`：仅标题/摘要/分类/标签（原 `matchLight` 语义）。
  - `fullText=true`：轻量命中即返回，否则用 `getContent(slug).toLowerCase().includes(query)`（原 `matchArticle` 语义）。
- `SidebarView` 删除 `matchLight`/`matchArticle` 私有方法，统一调用 `matchArticle(this.searchQuery, a, { fullText: ..., getContent: (s)=>this.cachedContent(s) })`。时间线与分类共用同一实现。
- **错误处理**：`getContent` 缺失时降级为仅轻量匹配，不抛错。

**测试**：`src/utils/__tests__/search.test.ts` 覆盖中文子串、标签匹配、全文命中、区分大小写（`toLowerCase`）。

### #3 冗余清理
`ReaderView.ts:115` `if (this.scrollHandler) { this.scrollHandler = null; }` → `this.scrollHandler = null;`。顺带检查 `scrollHandler` 是否在其他处被解绑（避免事件泄漏）；若有 `registerScroll` 之类，确保 `render()` 重入时先解绑旧监听再置空。

**测试**：无（单行清理 + lint 保证）。

### #4 ESLint + CI 门禁
**问题**：`tsc --noEmit` 不查未使用 import/变量，B13/B14 靠人工发现。

**方案**：
- devDependencies 增加 `eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`、`typescript`。
- 新增 `.eslintrc.cjs`：`parser: @typescript-eslint/parser`，`plugins: ['@typescript-eslint']`，`extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended']`，规则 `no-unused-vars` / `@typescript-eslint/no-unused-vars: error`，`parserOptions.project: './tsconfig.json'`。忽略 `main.js`、`*.cjs` 脚本按需。
- `package.json`：`"lint": "eslint src --ext .ts"`。
- `release.yml`：`npm run build` 前加 `npm run lint` 步骤，失败阻断发布。
- **错误处理**：首次接入可能因历史代码报 unused，先修复再提交，确保 `npm run lint` 全绿。

**测试**：CI 步骤自动执行；本地 `npm run lint` 验证零错误。

### #5 generate-index.js 健壮性
**问题**：缺 frontmatter/字段、`.md` 缺失时只 `console.warn` 跳过，静默产出不完整 `index.json`。

**方案**（改造 `bamboo-column/scripts/generate-index.js`，同步更新 `sync-content.js` 调用）：
- 每篇读取后校验必需字段（`slug`/`title`/`date`/`category`/`summary`）；缺失则 `console.error` 并 `missing++` 统计。
- 结束输出摘要：`更新 X 篇，缺失 Y 篇，目录文件与 index.json 不一致 Z 处`。
- 一致性检查：遍历 `articles/` 下 `.md`，若存在 `.md` 无对应 `index.json` 条目（或反之），打印告警并 `exit(1)`（可由 `sync-content.js` 传 `--strict` 触发，本地宽松、CI 严格）。
- **错误处理**：`--strict` 模式下不一致即非零退出。

**测试**：`bamboo-column/scripts/__tests__/generate-index.test.ts` 用 fixture 验证"缺字段报错、文件缺失告警、strict 模式退出码"。

### #6 缓存 schema 版本
**问题**：`CacheData` 无版本字段，未来 `ArticleMeta` 加字段时旧缓存缺字段不报错但可能行为异常。

**方案**：
- `src/constants.ts` 加 `export const CACHE_VERSION = 1;`。
- `src/types.ts` 的 `CacheData` 加 `version: number;`。
- `CacheService.load()`：读取后若 `cached.version !== CACHE_VERSION`，丢弃旧缓存重建（`this.data = freshData()`），但**保留 `readSlugs`**（已读记录不丢）。
- `save()` 写入时自动带 `version: CACHE_VERSION`。
- **错误处理**：版本不匹配静默重建，不抛错；`readSlugs` 跨版本保留。

**测试**：`src/services/__tests__/CacheService.test.ts` 构造 `version:0` 旧缓存，验证 `load()` 后 `index` 为空、`readSlugs` 保留、后续 `save()` 写入 `version:1`。

### #7 刷新失败提示
**问题**：`main.ts refreshArticles` 的 `catch` 已有 `Notice`，但文案笼统，不区分网络错误/解析错误，无重试指引。

**方案**：
- 在 `catch` 中按错误类型给出更明确 `Notice`：
  - 网络/拉取失败：`竹杖芒鞋：刷新失败（网络问题），可稍后重试`；
  - 解析失败：`竹杖芒鞋：内容解析失败，请检查网络或稍后重试`；
  - 兜底：`竹杖芒鞋：刷新失败：${msg}`。
- 不改变刷新触发逻辑，仅提升提示质量。
- **错误处理**：保持 `silent` 模式静默（自动刷新不打扰）。

**测试**：`src/__tests__/refresh.test.ts` 用 mock `ArticleService` 抛错，验证 `Notice` 文案匹配（需将 `refreshArticles` 中 Notice 文案抽取为可断言的常量或 spy `new Notice`）。

### #8 分享卡片去硬编码
**问题**：`renderShareCard`（`src/utils/share.ts`）可能散落作者名/品牌硬编码，应复用 `AUTHOR_NAME` 等常量。

**方案**：
- 通读 `share.ts`，将硬编码的"竹杖芒鞋"/作者名/落款替换为 `AUTHOR_NAME`、`PROFILE_NAME` 等已存在常量。
- 仅替换确实硬编码且已有常量的地方；无对应常量的不强行抽。
- **错误处理**：替换后 `build` + 人工预览确认卡片渲染不变。

**测试**：无（替换后 build + 手动预览）。

### #9 README
新增/补全 `README.md`：说明 DEV_MODE 双通道（生产走 GitHub `bamboo-column`，DEV 走本地 `bamboo-column/`）、内容同步脚本 `npm run sync:content`、构建/发布流程、ESLint 门禁。

**测试**：无。

---

## 4. 错误处理与回滚策略

- 每个 task 独立 commit，出问题 `git revert <sha>` 即可回滚单步。
- CI 门禁（#4 lint、#1 sync 校验）失败直接阻断发布，不会流出坏包。
- `CacheService` 版本重建（#6）向后兼容，旧用户无感。
- 不删除 `content/` 目录（保留离线/CI 能力），仅改为自动同步产物。

---

## 5. 测试策略小结

| 项 | 测试方式 |
|---|---|
| #1 | vitest + 临时 fixture，验证同步与校验退出码 |
| #2 | vitest 单测纯函数 `matchArticle`（中文/标签/全文/大小写） |
| #3 | 无，靠 lint + build |
| #4 | CI 步骤 + 本地 `npm run lint` 零错误 |
| #5 | vitest + fixture，验证缺字段/strict 退出码 |
| #6 | vitest 单测 `CacheService.load` 版本重建与 readSlugs 保留 |
| #7 | vitest spy `Notice`，验证错误文案 |
| #8 | build + 手动预览 |
| #9 | 无 |

**全量绿灯门槛**：每项合并前必须通过 `npm run typecheck && npm run lint && npm run build`（#1/#2/#5/#6/#7 额外含 `npm run test` 对应用例）。

---

## 6. 当前仓库状态备注（执行前需处理）

git 当前有上一轮改进与死代码清理的未提交改动（`main.ts`/`CacheService.ts`/`SidebarView.ts`/`constants.ts`/`package.json`/`tsconfig.json`/`share.ts`/`yaml.ts`/`LocalArticleService.ts`/`SettingTab.ts`/`content/articles/index.json` 已改，`avatar.png` 已删），以及 `content/articles/<分类>/` 未跟踪目录（正常的分类子目录，sync 后未 add）。**建议在执行 #1 前，先把上一轮改动整理为一个 baseline commit**，再在其上叠加本次 9 项改进，保持历史清晰。
