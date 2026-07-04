# 竹杖芒鞋 · Bamboo Walking

> 竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。

**安装即订阅**的个人写作专栏 Obsidian 插件。你写文章，读者装插件，内容自动送达。

**Install = Subscribe.** A personal writing column delivered as an Obsidian plugin. You write, readers install, articles arrive automatically.

---

## ✨ 核心概念 / Core Concept

传统的内容分发需要读者关注 RSS、订阅公众号、收藏链接。**竹杖芒鞋**把分发渠道变成了 Obsidian 插件市场本身：

- **作者**在一个 GitHub 仓库里写 Markdown 文章
- **读者**在 Obsidian 社区插件里搜索安装
- 安装插件 = 订阅专栏，打开 Obsidian 就能看到最新文章

Traditional content distribution requires RSS feeds, newsletter subscriptions, or bookmarked links. **Bamboo Walking** turns the Obsidian plugin marketplace itself into the distribution channel:

- **Authors** write Markdown articles in a GitHub repository
- **Readers** install the plugin from Obsidian's community plugins
- Installing the plugin = subscribing to the column; open Obsidian and read

---

## 🎋 功能特性 / Features

- **零配置** — 读者安装即用，不需要填写任何 URL 或账号
- **未读/全部切换** — 默认只显示未读文章，读完自动归档
- **中文日期** — 今天、昨天、3天前……符合中文阅读习惯
- **分类浏览** — 文章按作者设定的分类组织，支持折叠
- **搜索过滤** — 标题、摘要、标签全文搜索
- **阅读进度条** — 顶部细竹色进度条，一眼知道读到哪
- **目录导航** — 右侧 TOC 侧栏 + 滚动高亮
- **保存为笔记** — 喜欢的文章一键保存到自己的 vault
- **键盘导航** — ↑↓ 切换文章，Enter 打开
- **暗色模式** — 完整的 dark theme 适配
- **竹林主题** — 竹青配色、宣纸暖白、水墨留白

- **Zero config** — readers install and read, no URLs or accounts needed
- **Unread/All filter** — defaults to unread; read articles auto-archive
- **Chinese-friendly dates** — 今天, 昨天, 3天前…
- **Category browsing** — author-defined categories with collapsible sections
- **Full-text search** — title, summary, and tag search
- **Reading progress bar** — thin bamboo-colored progress indicator
- **Table of contents** — right sidebar TOC with scroll spy
- **Save as note** — one-click save articles to your vault
- **Keyboard navigation** — ↑↓ to browse, Enter to open
- **Dark mode** — full dark theme support
- **Bamboo theme** — bamboo green, warm paper white, ink-wash whitespace

---

## 📦 安装 / Installation

### 从社区插件市场（推荐）

1. 打开 Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 **竹杖芒鞋** 或 **Bamboo Walking**
3. 点击安装 → 启用

### 手动安装

1. 从 [Releases](../../releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入你的 vault：`.obsidian/plugins/bamboo-walking/`
3. 重启 Obsidian，在设置里启用插件

### From Community Plugins (Recommended)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for **Bamboo Walking**
3. Install → Enable

### Manual Install

1. Download `main.js`, `manifest.json`, `styles.css` from [Releases](../../releases)
2. Place them in `.obsidian/plugins/bamboo-walking/`
3. Restart Obsidian and enable the plugin in Settings

---

## 🖥️ 截图 / Screenshots

![sidebar](docs/screenshot-sidebar.png)
![reader](docs/screenshot-reader.png)

---

## ✍️ 给作者：如何创建你的专栏 / For Authors

> 想用自己的文章做一个这样的专栏？

1. Fork 本仓库
2. 修改 `src/constants.ts`：填入你的 GitHub 用户名、仓库名、分支
3. 在你的内容仓库里按以下结构组织文章：

```
your-content-repo/
  articles/
    index.json          # 文章索引（元数据数组）
    分类名/
      2026-07-05-slug.md  # 文章正文（带 frontmatter）
```

4. `index.json` 格式：

```json
[
  {
    "slug": "技术随想/2026-07-05-hello",
    "title": "你好世界",
    "date": "2026-07-05",
    "category": "技术随想",
    "summary": "我的第一篇文章",
    "tags": ["随笔"],
    "readingTime": 3
  }
]
```

5. 文章 `.md` 文件头部使用 YAML frontmatter：

```yaml
---
title: "你好世界"
date: 2026-07-05
category: "技术随想"
summary: "我的第一篇文章"
tags: [随笔]
readingTime: 3
---

正文内容……
```

6. 构建并发布：`npm run build`，创建 GitHub Release

> Want to create your own column like this?

1. Fork this repository
2. Edit `src/constants.ts`: set your GitHub username, repo name, and branch
3. Organize articles in your content repo following the structure above
4. Build and publish: `npm run build`, create a GitHub Release

---

## 🔧 开发 / Development

```bash
# 安装依赖
npm install

# 开发模式（watch + sourcemap）
npm run dev

# 生产构建（minified）
npm run build

# 同步到本地 vault 测试
npm run sync        # 生产构建
npm run sync:dev    # 开发构建
```

---

## 📄 许可证 / License

本项目的插件代码和文章内容适用不同许可证：

- **插件源码**（TS/CSS/构建脚本）：[MIT](LICENSE)
- **文章内容**：署名-非商业性使用-禁止演绎 4.0 国际 [(CC BY-NC-ND 4.0)](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-Hans)  
  文章版权归 **羽鳞君** 所有，任何转载、摘编、再分发需获得作者书面授权。

> This project uses dual licensing: plugin source code is MIT, article content is CC BY-NC-ND 4.0.  
> All article copyrights belong to the author.

---

<p align="center">
  <em>竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。</em><br>
  <small>— 苏轼《定风波》</small>
</p>
