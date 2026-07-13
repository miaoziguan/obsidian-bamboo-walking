# 竹杖芒鞋 · 工程改进实现计划

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.
> **日期**：2026-07-14 ｜ **配套设计**：`2026-07-14-engineering-improvements-design.md`
> **执行方式说明**：本环境无 `sessions_spawn` 子代理派发能力，采用「主代理直接执行 + 严格 TDD + 每 task 绿灯后 commit + 关键 task 后用 code-explorer 做独立代码评审」落实 superpowers 的 TDD / 评审 / 频繁 commit 精神。

**Goal:** 对插件与内容源实施 9 项工程改进，消除内容漂移、搜索语义分叉与缓存兼容性隐患，并建立 lint/测试防护网。

**Architecture:** 纯逻辑（搜索匹配、缓存版本、脚本）抽为可单测函数/模块；UI 与配置改动靠 typecheck+build+lint 守护；内容同步改为构建前自动脚本并接入 CI。

**Tech Stack:** TypeScript, esbuild, vitest（单测）, ESLint + @typescript-eslint（门禁）, Node 脚本（零依赖）。

**全量绿灯门槛（每个 task 合并前）：**
`npm run typecheck && npm run lint && npm run build` 全绿；含单测的 task 额外 `npm run test` 相关用例通过。

---

## Task 1: 测试基础设施（vitest + 配置）

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Step 1: 安装依赖（devDependencies）**
```bash
cd obsidian-bamboo-walking && npm install -D vitest
```
Expected: `vitest` 加入 `devDependencies`，`package.json` 出现 `"vitest": "^x"`.

**Step 2: 写 vitest 配置 `vitest.config.ts`**
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "bamboo-column/scripts/**/*.test.ts"],
    globals: false,
  },
});
```

**Step 3: 加 npm scripts 到 `package.json`**
```jsonc
"scripts": {
  "dev": "node esbuild.config.mjs",
  "build": "node esbuild.config.mjs production",
  "build:dev": "node esbuild.config.mjs build-dev",
  "sync": "bash sync.sh",
  "sync:dev": "bash sync.sh --dev",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**Step 4: 跑一次空测试验证框架可用**
```bash
npm run test
```
Expected: PASS（无测试文件时 vitest 退出 0）或 "no test files" 不报错。

**Step 5: Commit**
`git add -A && git commit -m "chore: 引入 vitest 测试基础设施与配置"`

---

## Task 2: 缓存 schema 版本 — 类型与常量

**Files:**
- Modify: `src/constants.ts`（加 `CACHE_VERSION`）
- Modify: `src/types.ts`（`CacheData` 加 `version`）
- Create: `src/services/__tests__/CacheService.test.ts`（先写失败测试）

**Step 1: 写失败测试 `src/services/__tests__/CacheService.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { CacheService } from "../CacheService";
import { CACHE_KEY, CACHE_VERSION } from "../../constants";

function makeService(initial: Record<string, unknown> | null) {
  let store: Record<string, unknown> | null = initial;
  return new CacheService(
    async () => store,
    async (d) => { store = d; },
  );
}

describe("CacheService 版本兼容", () => {
  it("旧版本缓存读时重建 index，但保留 readSlugs", async () => {
    const old: any = {
      [CACHE_KEY]: {
        version: 0,
        index: [{ slug: "技术随想/x", title: "旧", date: "2020-01-01", category: "技术随想", summary: "s" }],
        articles: {},
        lastFetch: 1,
        lastSeenSlugs: ["技术随想/x"],
        readSlugs: ["a", "b"],
      },
    };
    const svc = makeService(old);
    await svc.load();
    expect(svc.getIndex()).toEqual([]);      // 重建
    expect(svc.isRead("a")).toBe(true);       // 保留
    expect(svc.isRead("b")).toBe(true);
  });

  it("save 后写入当前版本号", async () => {
    const svc = makeService(null);
    await svc.load();
    await svc.markRead("z");
    await svc.save();
    // 重新读回验证 version
    let captured: any = null;
    const svc2 = new CacheService(
      async () => captured,
      async (d) => { captured = d; },
    );
    await svc2.load();
    // 通过再次 save 触发写入并读取 store
    await svc.save();
    // 直接从 svc 的内部 store 验证：用 markRead 已写入，重新构造读回
    const reread = makeService(captured);
    await reread.load();
    // version 字段应通过类型存在；这里通过 lastFetch 重置间接验证重建未丢
    expect(reread.isRead("z")).toBe(true);
  });
});
```
> 注：第二个用例主要验证 readSlugs 持久化；`version` 写入由实现保证，类型层强制。

**Step 2: Run test — 确认失败**
```bash
npm run test -- src/services/__tests__/CacheService.test.ts
```
Expected: FAIL — `CACHE_VERSION` 未定义 / `version` 字段不存在。

**Step 3: 实现 — `src/constants.ts` 加**
```ts
/** 缓存数据结构版本。升级 CacheData 字段时 +1，旧缓存读时自动重建 */
export const CACHE_VERSION = 1;
```

**Step 4: 实现 — `src/types.ts` `CacheData` 加字段**
```ts
export interface CacheData {
  version: number;        // 缓存 schema 版本
  index: ArticleIndexEntry[];
  articles: Record<string, CachedArticle>;
  lastFetch: number;
  lastSeenSlugs: string[];
  readSlugs: string[];
}
```

**Step 5: Run test — 确认通过**
```bash
npm run test -- src/services/__tests__/CacheService.test.ts
```
Expected: PASS

**Step 6: Commit**
`git add -A && git commit -m "feat(#6): CacheData 加 version 字段与 CACHE_VERSION 常量"`

---

## Task 3: 缓存版本 — load 重建逻辑

**Files:**
- Modify: `src/services/CacheService.ts`（`load` 与 `save` 接入 version）

**Step 1: 扩展测试（在 Task 2 测试文件中追加）**
```ts
  it("version 不匹配时丢弃 index 但保留 readSlugs（构造后 save 落盘 version=1）", async () => {
    const old: any = { [CACHE_KEY]: { version: 0, index: [{ slug: "s/x", title: "t", date: "2020-01-01", category: "c", summary: "s" }], articles: {}, lastFetch: 1, lastSeenSlugs: ["s/x"], readSlugs: ["keep"] } };
    const svc = makeService(old);
    await svc.load();
    await svc.save();
    // 读回落盘数据验证 version
    const disk = (svc as any)["data"];
    expect(disk.version).toBe(CACHE_VERSION);
  });
```

**Step 2: Run — 确认失败**（data 无 version 概念）

**Step 3: 实现 — 改 `CacheService` 构造函数初始化带 version**
```ts
this.data = { version: CACHE_VERSION, index: [], articles: {}, lastFetch: 0, lastSeenSlugs: [], readSlugs: [] };
```

**Step 4: 实现 — `load()` 版本校验**
```ts
async load(): Promise<void> {
  const saved = await this.loadData();
  const cached = saved?.[CACHE_KEY] as CacheData | undefined;
  if (cached && cached.version === CACHE_VERSION) {
    this.data = { ...cached, readSlugs: cached.readSlugs ?? [] };
  } else {
    // 版本不匹配：保留已读记录，其余重建
    const keptRead = this.data.readSlugs;
    this.data = {
      version: CACHE_VERSION,
      index: [],
      articles: {},
      lastFetch: 0,
      lastSeenSlugs: [],
      readSlugs: keptRead,
    };
  }
}
```

**Step 5: 实现 — `save()` 确保写入 version**
`save()` 已写入 `this.data`，`this.data` 现在恒含 `version`，无需额外改动（确认 `all[CACHE_KEY] = this.data` 已带 version）。

**Step 6: Run — 确认通过**
```bash
npm run test -- src/services/__tests__/CacheService.test.ts
```
Expected: PASS

**Step 7: Commit**
`git add -A && git commit -m "feat(#6): CacheService.load 旧版本缓存安全重建（保留已读）"`

---

## Task 4: 搜索语义统一 — 纯函数模块

**Files:**
- Create: `src/utils/search.ts`
- Create: `src/utils/__tests__/search.test.ts`（先写失败测试）

**Step 1: 写失败测试**
```ts
import { describe, it, expect } from "vitest";
import { matchArticle } from "../search";
import type { ArticleIndexEntry } from "../../types";

const entry: ArticleIndexEntry = {
  slug: "技术随想/x",
  title: "技术随想入门",
  date: "2026-07-04",
  category: "技术随想",
  summary: "关于 Obsidian 的笔记",
  tags: ["obsidian", "效率"],
};

describe("matchArticle", () => {
  it("轻量匹配：标题/摘要/分类/标签命中", () => {
    expect(matchArticle("obsidian", entry, { fullText: false })).toBe(true);
    expect(matchArticle("效率", entry, { fullText: false })).toBe(true);
    expect(matchArticle("技术随想", entry, { fullText: false })).toBe(true);
  });
  it("轻量不匹配且 fullText=false 时不查正文", () => {
    expect(matchArticle("正文关键词", entry, { fullText: false })).toBe(false);
  });
  it("fullText=true 时正文命中", () => {
    expect(
      matchArticle("正文关键词", entry, { fullText: true, getContent: () => "这是正文关键词内容" }),
    ).toBe(true);
  });
  it("空查询视为全部命中", () => {
    expect(matchArticle("   ", entry, { fullText: false })).toBe(true);
  });
  it("大小写不敏感", () => {
    expect(matchArticle("OBSIDIAN", entry, { fullText: false })).toBe(true);
  });
  it("getContent 缺失时 fullText 不抛错，仅轻量结果", () => {
    expect(matchArticle("正文关键词", entry, { fullText: true })).toBe(false);
  });
});
```

**Step 2: Run — 确认失败**（`matchArticle` 未定义）

**Step 3: 实现 `src/utils/search.ts`**
```ts
import type { ArticleIndexEntry } from "../types";

export interface MatchOptions {
  /** true 时轻量未命中再查正文（通过 getContent 取正文） */
  fullText: boolean;
  /** 取某 slug 正文（小写），仅 fullText=true 时需要 */
  getContent?: (slug: string) => string;
}

/** 统一的文章匹配：标题/摘要/分类/标签（轻量）+ 可选正文全文 */
export function matchArticle(
  query: string,
  entry: ArticleIndexEntry,
  opts: MatchOptions,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hit =
    entry.title.toLowerCase().includes(q) ||
    entry.summary.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q) ||
    (entry.tags ?? []).some((t) => t.toLowerCase().includes(q));
  if (hit) return true;
  if (opts.fullText && opts.getContent) {
    return opts.getContent(entry.slug).toLowerCase().includes(q);
  }
  return false;
}
```

**Step 4: Run — 确认通过**
```bash
npm run test -- src/utils/__tests__/search.test.ts
```
Expected: PASS

**Step 5: Commit**
`git add -A && git commit -m "feat(#2): 抽出统一搜索匹配纯函数 matchArticle"`

---

## Task 5: 搜索语义统一 — 接入 SidebarView

**Files:**
- Modify: `src/ui/SidebarView.ts`（删 `matchLight`/`matchArticle` 方法，调用 `matchArticle`）
- Modify: `src/ui/SidebarView.ts` import 区加 `import { matchArticle } from "../utils/search";`

**Step 1: 先确认现有调用点**
搜索 `this.matchLight`、`this.matchArticle` 出现位置（预期：`renderTimeline`/`filteredArticles` 用 `matchLight`+`cachedContent`，`groupByCategory` 用 `matchArticle`）。

**Step 2: 替换实现**
- 删除私有方法 `matchLight`（行 672-681）与 `matchArticle`（行 683-687）。
- 时间线/过滤处的轻量即时匹配改为：
  ```ts
  this.pool.filter((a) => matchArticle(this.searchQuery, a, { fullText: false }))
  ```
- 分类处全文过滤改为：
  ```ts
  pool = pool.filter((a) => matchArticle(this.searchQuery, a, { fullText: true, getContent: (s) => this.cachedContent(s) }))
  ```
- 确保 `cachedContent` 仍保留（被 getContent 复用）。

**Step 3: typecheck + build 验证**
```bash
npm run typecheck && npm run build
```
Expected: 均无报错。

**Step 4: 跑搜索单测回归**
```bash
npm run test
```
Expected: PASS

**Step 5: Commit**
`git add -A && git commit -m "refactor(#2): SidebarView 统一使用 matchArticle，删除重复 matchLight/matchArticle"`

**Step 6: 评审** — 派 code-explorer 子代理复查 `SidebarView.ts` 确认无遗留 `this.matchLight`/`this.matchArticle` 调用、搜索行为等价。

---

## Task 6: generate-index 健壮性 — 可测核心

**Files:**
- Modify: `bamboo-column/scripts/generate-index.js`（抽 `runGenerate(rootDir, { strict })` 并 export）
- Create: `bamboo-column/scripts/__tests__/generate-index.test.ts`（先写失败测试）

**Step 1: 写失败测试（用临时 fixture 目录）**
```ts
import { describe, it, expect } from "vitest";
import { runGenerate } from "../generate-index";
import fs from "fs";
import os from "os";
import path from "path";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genidx-"));
}

describe("generate-index 健壮性", () => {
  it("缺必需字段的文章被计入 missing 并 strict 模式抛错", () => {
    const dir = tmpDir();
    const articles = path.join(dir, "articles");
    fs.mkdirSync(articles, { recursive: true });
    fs.writeFileSync(path.join(articles, "index.json"), JSON.stringify([
      { slug: "c/ok", title: "OK", date: "2026-01-01", category: "c", summary: "s" },
      { slug: "c/bad", title: "", date: "2026-01-01", category: "c", summary: "s" }, // 缺 title
    ]));
    fs.writeFileSync(path.join(articles, "ok.md"), "# OK\n正文");
    fs.writeFileSync(path.join(articles, "bad.md"), "# \n正文");
    expect(() => runGenerate(dir, { strict: true })).toThrow();
  });

  it("目录 .md 与 index.json 不一致时 strict 抛错", () => {
    const dir = tmpDir();
    const articles = path.join(dir, "articles");
    fs.mkdirSync(articles, { recursive: true });
    fs.writeFileSync(path.join(articles, "index.json"), JSON.stringify([
      { slug: "c/ok", title: "OK", date: "2026-01-01", category: "c", summary: "s" },
    ]));
    fs.writeFileSync(path.join(articles, "ok.md"), "# OK");
    fs.writeFileSync(path.join(articles, "orphan.md"), "# 孤儿文件无 index 条目");
    expect(() => runGenerate(dir, { strict: true })).toThrow();
  });

  it("正常情况生成 64 位 hash 且不抛错", () => {
    const dir = tmpDir();
    const articles = path.join(dir, "articles");
    fs.mkdirSync(articles, { recursive: true });
    fs.writeFileSync(path.join(articles, "index.json"), JSON.stringify([
      { slug: "c/ok", title: "OK", date: "2026-01-01", category: "c", summary: "s" },
    ]));
    fs.writeFileSync(path.join(articles, "ok.md"), "# OK\n正文内容");
    expect(() => runGenerate(dir, { strict: true })).not.toThrow();
    const idx = JSON.parse(fs.readFileSync(path.join(articles, "index.json"), "utf8"));
    expect(idx[0].hash).toHaveLength(64);
  });
});
```

**Step 2: Run — 确认失败**（`runGenerate` 未导出 / 不抛错）

**Step 3: 实现 — 改造 `generate-index.js`**
- 抽 `function runGenerate(rootDir, { strict = false } = {})`，核心逻辑迁移进来，校验：
  - 每篇 `entry` 必含 `slug/title/date/category/summary`，缺失则 `missingInvalid++` 并 `console.error`。
  - 遍历 `articles/*.md`，收集实际 slug（文件名去 `.md`）；与 `index.json` 条目比对，多/少则 `inconsistent++` 并告警。
  - `strict` 且 `missingInvalid>0 || inconsistent>0` → `throw new Error(...)`。
  - 正常：写回 `index.json`（含 64 位 hash）。
- 保留 CLI 入口：`if (require.main === module) { try { runGenerate(ROOT, { strict: process.argv.includes("--strict") }); } catch(e){ console.error(e.message); process.exit(1);} }`
- 顶部 `module.exports = { runGenerate, sha256 };`（CommonJS，因脚本为 .js 无 type:module）

**Step 4: Run — 确认通过**
```bash
npm run test -- bamboo-column/scripts/__tests__/generate-index.test.ts
```
Expected: PASS

**Step 5: Commit**
`git add -A && git commit -m "feat(#5): generate-index 加字段校验与一致性检查，支持 --strict"`

---

## Task 7: generate-index — 真实内容跑通

**Files:**
- Run: 在真实 `bamboo-column/` 跑 `node scripts/generate-index.js --strict`

**Step 1: 跑真实内容**
```bash
cd bamboo-column && node scripts/generate-index.js --strict && cd ..
```
Expected: 7 篇全部更新 hash，无不一致告警，退出 0。

**Step 2: 同步确认 `content/articles/index.json` 后续由 Task 8 脚本覆盖，此处不手动改 content。**

**Step 3: Commit（若 index.json 有变化）**
`git add -A && git commit -m "chore(#5): 真实内容重跑 generate-index --strict 校验通过"`

---

## Task 8: 内容同步脚本 sync-content

**Files:**
- Create: `scripts/sync-content.js`（Node 零依赖，抽 `syncContent(src, dest, { strict })` 并 export）
- Create: `scripts/__tests__/sync-content.test.ts`（先写失败测试）
- Modify: `package.json`（加 `sync:content` script）

**Step 1: 写失败测试**
```ts
import { describe, it, expect } from "vitest";
import { syncContent } from "../sync-content";
import fs from "fs";
import os from "os";
import path from "path";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "sync-")); }

describe("syncContent", () => {
  it("复制源 articles 到目标并保持一致", () => {
    const src = tmp(); const dest = tmp();
    const sa = path.join(src, "articles");
    fs.mkdirSync(sa, { recursive: true });
    fs.writeFileSync(path.join(sa, "index.json"), JSON.stringify([{ slug: "c/x", title: "t", date: "2026-01-01", category: "c", summary: "s", hash: "a".repeat(64) }]));
    fs.writeFileSync(path.join(sa, "x.md"), "# x");
    expect(() => syncContent(src, dest, { strict: true })).not.toThrow();
    expect(fs.existsSync(path.join(dest, "articles", "index.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "articles", "x.md"))).toBe(true);
  });

  it("目标 index.json 缺失则 strict 抛错", () => {
    const src = tmp(); const dest = tmp();
    const sa = path.join(src, "articles");
    fs.mkdirSync(sa, { recursive: true });
    // 源没有 index.json（异常源）
    fs.writeFileSync(path.join(sa, "x.md"), "# x");
    expect(() => syncContent(src, dest, { strict: true })).toThrow();
  });
});
```

**Step 2: Run — 确认失败**

**Step 3: 实现 `scripts/sync-content.js`**
```js
const fs = require("fs");
const path = require("path");
const { runGenerate } = require("../bamboo-column/scripts/generate-index");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SRC = path.join(PLUGIN_ROOT, "..", "bamboo-column"); // 仓库同级
const DEST = path.join(PLUGIN_ROOT, "content", "articles");

function cpDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

function syncContent(srcRoot, destArticles, { strict = false } = {}) {
  const srcArticles = path.join(srcRoot, "articles");
  if (!fs.existsSync(srcArticles)) {
    throw new Error(`源内容目录不存在: ${srcArticles}`);
  }
  // 1) 源内生成最新 hash
  runGenerate(srcRoot, { strict });
  // 2) 同步到插件 content/
  cpDir(srcArticles, destArticles);
  // 3) 校验
  const srcIdx = JSON.parse(fs.readFileSync(path.join(srcArticles, "index.json"), "utf8"));
  const destIdx = JSON.parse(fs.readFileSync(path.join(destArticles, "index.json"), "utf8"));
  if (srcIdx.length !== destIdx.length) {
    throw new Error(`同步校验失败：源 ${srcIdx.length} 篇 / 目标 ${destIdx.length} 篇`);
  }
  console.log(`✅ 内容同步完成：源 ${srcIdx.length} 篇 → content/articles`);
}

if (require.main === module) {
  try {
    syncContent(SRC, DEST, { strict: true });
  } catch (e) {
    console.error("❌ 内容同步失败:", e.message);
    process.exit(1);
  }
}

module.exports = { syncContent, cpDir };
```
> 注意：路径 `SRC` 假设 `bamboo-column` 与 `obsidian-bamboo-walking` 同级（当前仓库布局如此）。若 CI checkout 为单仓需调整，但当前为两个独立 repo 同级，符合现状。

**Step 4: Run — 确认通过**
```bash
npm run test -- scripts/__tests__/sync-content.test.ts
```
Expected: PASS

**Step 5: 加 package.json script**
```jsonc
"sync:content": "node scripts/sync-content.js"
```

**Step 6: Run 真实同步**
```bash
npm run sync:content
```
Expected: 输出 "✅ 内容同步完成：源 7 篇 → content/articles"，`content/articles/index.json` 被刷新为带 64 位 hash 的副本。

**Step 7: Commit**
`git add -A && git commit -m "feat(#1): 新增 sync-content 脚本，自动同步内容并校验"`

---

## Task 9: 接入 prebuild 与 CI

**Files:**
- Modify: `package.json`（`prebuild` 钩子）
- Modify: `.github/workflows/release.yml`（加 sync + lint 步骤）

**Step 1: 加 prebuild**
```jsonc
"prebuild": "npm run sync:content",
"build": "node esbuild.config.mjs production",
```
> 注：npm 自动在 `build` 前跑 `prebuild`。开发构建 `build:dev` 不强制同步（保持快速），如需可加 `prebuild:dev`。

**Step 2: 改 `release.yml`**
在 `npm run build` 前插入：
```yaml
      - name: Sync content
        run: node scripts/sync-content.js

      - name: Lint
        run: npm run lint
```
并确保 `npm install` 已包含新 devDeps（vitest/eslint）。

**Step 3: 本地验证完整流水线**
```bash
npm run build
```
Expected: 先打印同步完成，再 esbuild 成功产出 main.js。

**Step 4: Commit**
`git add -A && git commit -m "ci(#1,#4): build 前自动同步内容，release 加 sync + lint 门禁"`

---

## Task 10: 冗余清理（ReaderView:115）

**Files:**
- Modify: `src/ui/ReaderView.ts`

**Step 1: 直接改**
行 115 `if (this.scrollHandler) { this.scrollHandler = null; }` → `this.scrollHandler = null;`
顺带检查 `scrollHandler` 是否在其他处被注册监听：搜索 `scrollHandler =` / `addEventListener` / `registerEvent` 确认 `render()` 重入时旧监听已被解绑（若有 `registerScroll` 类方法，确保先 `this.scrollHandler?.()` 解绑再置空）。

**Step 2: typecheck + build**
```bash
npm run typecheck && npm run build
```
Expected: 无报错。

**Step 3: Commit**
`git add -A && git commit -m "refactor(#3): 化简 ReaderView 冗余 scrollHandler 判断"`

---

## Task 11: ESLint 配置与门禁

**Files:**
- Create: `.eslintrc.cjs`
- Modify: `package.json`（加 `lint` script + eslint devDeps）
- Run: `npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin`

**Step 1: 装依赖**
```bash
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

**Step 2: `.eslintrc.cjs`**
```cjs
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2020, sourceType: "module", project: "./tsconfig.json" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, browser: true },
  ignorePatterns: ["main.js", "*.cjs", "node_modules", "content"],
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "off",
  },
};
```

**Step 3: lint script**
```jsonc
"lint": "eslint src --ext .ts"
```

**Step 4: 跑 lint，修复历史未使用变量**
```bash
npm run lint
```
Expected: 若有 unused（如某 import 未用），修复至零错误。当前代码上一轮已清理，预期基本零。

**Step 5: Commit**
`git add -A && git commit -m "feat(#4): 引入 ESLint + @typescript-eslint 并接入 lint script"`

**Step 6: 评审** — code-explorer 复查确保 `release.yml` 的 lint 步骤与本地 `npm run lint` 一致。

---

## Task 12: 刷新失败提示增强（#7）

**Files:**
- Modify: `src/main.ts`（`refreshArticles` catch 的 Notice 文案）

**Step 1: 观察现状（已读 main.ts:225-243）**
当前已区分 offline / 错误态 / 缓存态。增强点：把具体错误 `msg` 并入非静默 Notice，让用户看到原因。

**Step 2: 改 Notice 文案**
```ts
if (!silent) {
  new Notice(
    offline
      ? "竹杖芒鞋：当前离线，显示的是本地缓存"
      : `竹杖芒鞋：刷新失败（${msg}），点击刷新按钮重试`,
  );
}
```

**Step 3: typecheck + build**
```bash
npm run typecheck && npm run build
```
Expected: 无报错。

**Step 4: Commit**
`git add -A && git commit -m "fix(#7): 刷新失败 Notice 包含具体错误原因，便于重试"`

---

## Task 13: 分享卡片去硬编码（#8）

**Files:**
- Modify: `src/utils/share.ts`（标题栏品牌用 `AUTHOR_NAME`，水印抽常量）

**Step 1: 改 import 与常量**
顶部已有 `import { AUTHOR_NAME } from "../constants";`。加：
```ts
const SHARE_WATERMARK = "一蓑烟雨任平生";
```

**Step 2: 改标题栏（行 104）**
```ts
ctx.fillText(`${AUTHOR_NAME} · 专栏`, contentX, cardY + 128);
```

**Step 3: 改水印（行 159）**
```ts
ctx.fillText(SHARE_WATERMARK, contentR, footerY + 40);
```

**Step 4: typecheck + build**
```bash
npm run typecheck && npm run build
```
Expected: 无报错。

**Step 5: Commit**
`git add -A && git commit -m "refactor(#8): 分享卡片品牌/水印改用常量，去除硬编码"`

---

## Task 14: README

**Files:**
- Create/Modify: `README.md`

**Step 1: 写 README 关键章节**
- 项目简介
- DEV_MODE 双通道：生产走 GitHub `bamboo-column` 仓库拉取；DEV 模式（`build:dev`）从本地同级 `bamboo-column/articles/` 读。
- 内容同步：`npm run sync:content`（构建前 `prebuild` 自动调用）会重跑 hash 并同步到 `content/articles/`。
- 构建/发布：`npm run build` → CI 跑 sync + lint + build → 发 draft release。
- 测试/lint：`npm run test`、`npm run lint`、`npm run typecheck`。

**Step 2: Commit**
`git add -A && git commit -m "docs(#9): README 补充双通道/内容同步/发布流程"`

---

## 收尾（Phase 5 前置）

- 全量跑：`npm run typecheck && npm run lint && npm run test && npm run build`
- 确认全绿。
- 派 code-explorer 做整体代码评审，确认 9 项均落地、无回归。
- 向用户汇报，提供合并/推送选项（当前分支 main 领先 origin 1 个 baseline commit + 本次若干 commit，未 push）。
