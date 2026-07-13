# 🎋 Bamboo Walking · 竹杖芒鞋

> 竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。  
> — 苏轼《定风波》

**安装即订阅**。羽鳞君的个人写作专栏，以 Obsidian 插件的形式分发——你写文章，读者装插件，内容自动送达。

**Install = Subscribe.** A personal writing column by 羽鳞君, delivered as an Obsidian plugin.

---

## ✨ 怎么用 / How It Works

1. 在 Obsidian 社区插件市场搜索安装 **Bamboo Walking**
2. 打开侧边栏，浏览分类和文章
3. 读到喜欢的，一键保存到自己的 vault

1. Install **Bamboo Walking** from Obsidian's community plugin marketplace
2. Open the sidebar, browse by category
3. Save any article to your vault with one click

---

## 🛠 开发 / Development

### 内容双通道（DEV_MODE）

插件通过 `DEV_MODE` 决定内容来源，`DEV_MODE` 由构建脚本（`esbuild.config.mjs`）自动注入，无需手改：

- **生产模式（`npm run build`）**：从 GitHub 仓库 `miaoziguan/bamboo-column` 拉取文章（见 `src/constants.ts` 的 `GITHUB_OWNER/REPO/BRANCH`）。
- **开发模式（`npm run build:dev` 或 `npm run dev`）**：从本地同级目录 `../bamboo-column/articles/` 读取，方便边写边预览。

### 内容同步

文章源在 `bamboo-column/`，插件内嵌副本在 `content/articles/`。为避免两份内容分叉，构建前会自动同步：

```bash
npm run sync:content   # 重算 hash 并拷贝 bamboo-column/articles → content/articles
```

`package.json` 的 `prebuild` 钩子会在每次 `npm run build` 前自动执行；CI 发布流程也会显式调用并检查一致性（`--strict`），不一致则阻断发布。

### 构建与发布

```bash
npm install
npm run dev        # 开发构建（DEV_MODE=true），用 sync.sh 部署到测试 vault
npm run build      # 生产构建（自动同步内容）→ 产出 main.js / styles.css / manifest.json
```

打 tag 推送到 `miaoziguan/obsidian-bamboo-walking` 会触发 `.github/workflows/release.yml`：先 checkout 内容源仓库 `bamboo-column`，再 lint → 同步内容 → 构建 → 发 draft release。

### 质量门禁

```bash
npm run typecheck   # tsc --noEmit 类型检查
npm run lint        # ESLint + @typescript-eslint（未使用变量等）
npm run test        # vitest 单测（缓存版本 / 搜索匹配 / 内容脚本）
```

> 发布前请确保 `typecheck`、`lint`、`test`、`build` 全部通过。

---

## 📄 许可证 / License

- **插件源码**：[MIT](LICENSE)
- **文章内容**：[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-Hans) — 版权归羽鳞君所有，转载需授权

> Plugin source: MIT. Article content: CC BY-NC-ND 4.0. All rights reserved by the author.
