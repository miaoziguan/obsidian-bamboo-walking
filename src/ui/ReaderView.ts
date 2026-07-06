/* ────────────── 主区域：文章阅读视图 ────────────── */
import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component } from "obsidian";
import type { Article, ArticleIndexEntry } from "../types";
import { VIEW_TYPE_READER } from "../types";
import { AUTHOR_NAME } from "../constants";

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

export class ReaderView extends ItemView {
  private article: Article | null = null;
  private component: Component;
  private isSaving = false;
  private onSave: (() => Promise<void>) | null = null;
  private onBack: (() => void) | null = null;
  private getArticles: (() => ArticleIndexEntry[]) | null = null;
  private onOpenArticle: ((slug: string) => void) | null = null;
  private tocElements = new Map<string, HTMLElement>();
  private headingElements: { id: string; el: HTMLElement }[] = [];
  private tocProgressBar: HTMLElement | null = null;
  private tocProgressPct: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  private fontSize = 16; // 基准字号 px
  private bodyEl: HTMLElement | null = null;
  private layoutEl: HTMLElement | null = null;
  private fabEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.component = new Component();
    const saved = this.app.loadLocalStorage("bw-font-size");
    if (saved) this.fontSize = parseInt(saved as string, 10);
  }

  getViewType(): string { return VIEW_TYPE_READER; }
  getDisplayText(): string {
    return this.article
      ? `${this.article.title} — 竹杖芒鞋`
      : "竹杖芒鞋专栏";
  }
  getIcon(): string { return "book-open-check"; }

  setOnSave(cb: () => Promise<void>): void { this.onSave = cb; }
  setOnBack(cb: () => void): void { this.onBack = cb; }
  setGetArticles(cb: () => ArticleIndexEntry[]): void { this.getArticles = cb; }
  setOnOpen(cb: (slug: string) => void): void { this.onOpenArticle = cb; }

  /** 公开当前文章引用，供 main.ts 读取 */
  get currentArticle(): Article | null { return this.article; }

  /** 展示加载中状态（内联，不弹 Notice） */
  showLoading(title?: string): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bwr-reader");
    const wrap = contentEl.createDiv({ cls: "bwr-loading" });
    wrap.createDiv({ cls: "bwr-loading-spinner" });
    wrap.createEl("p", {
      text: title ? `正在加载「${title}」…` : "正在加载…",
      cls: "bwr-loading-text",
    });
  }

  /** 展示加载失败 */
  showError(msg: string): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bwr-reader");
    const wrap = contentEl.createDiv({ cls: "bwr-error-state" });
    wrap.createEl("span", { text: "⚠", cls: "bwr-error-icon" });
    wrap.createEl("p", { text: "加载失败", cls: "bwr-error-title" });
    wrap.createEl("p", { text: msg, cls: "bwr-error-msg" });
  }

  /** 展示文章 */
  async showArticle(article: Article): Promise<void> {
    this.component.unload();
    this.component = new Component();
    this.component.load();
    this.isSaving = false;
    this.article = article;
    await this.render();
    const leafWithTab = this.leaf as unknown as { tabHeaderInnerTitleEl?: { setText: (t: string) => void } };
    leafWithTab.tabHeaderInnerTitleEl?.setText(this.getDisplayText());
  }

  async onOpen(): Promise<void> {
    this.component.load();
    await this.render();
  }

  async onClose(): Promise<void> {
    this.component.unload();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bwr-reader");
    this.tocElements.clear();
    this.headingElements = [];
    this.tocProgressBar = null;
    this.tocProgressPct = null;
    if (this.scrollHandler) { this.scrollHandler = null; }

    if (!this.article) {
      this.renderEmpty();
      return;
    }

    // 顶部固定区：absolute 在 contentEl，宽度对齐 content 列
    const topBar = contentEl.createDiv({ cls: "bwr-topbar" });
    this.renderToolbar(topBar);
    this.renderHeader(topBar);

    // 正文 + TOC 容器，顶部留出 topbar 高度
    const layout = contentEl.createDiv({ cls: "bwr-layout" });
    this.layoutEl = layout;
    layout.style.setProperty("--bwr-topbar-h", `${topBar.offsetHeight}px`);
    const contentCol = layout.createDiv({ cls: "bwr-content" });

    // ── TOC 侧栏（始终占位，保持内容列宽度稳定） ──
    const toc = this.extractToc(this.article.content);
    this.renderToc(layout, toc);

    // ── 正文区域 ──
    const body = contentCol.createDiv({ cls: "bwr-body markdown-preview-view" });
    this.bodyEl = body;
    this.applyFontSize();
    await MarkdownRenderer.render(
      this.app,
      this.article.content,
      body,
      "",
      this.component,
    );

    // 图片增强：懒加载 + 骨架 + 点击放大
    body.querySelectorAll("img").forEach((img) => {
      img.setAttribute("loading", "lazy");
      img.classList.add("bwr-img");
      img.addEventListener("load", () => img.classList.add("bwr-img--loaded"));
      if (img.complete) {
        img.classList.add("bwr-img--loaded");
      }
      img.addEventListener("click", () => this.openLightbox(img));
    });

    // 代码块增强：语言标签 + 复制按钮
    body.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      const lang = code?.className.match(/language-(\w+)/)?.[1];
      pre.classList.add("bwr-code");
      const header = pre.createDiv({ cls: "bwr-code-header" });
      if (lang) header.createSpan({ cls: "bwr-code-lang", text: lang });
      const copyBtn = header.createEl("button", { cls: "bwr-btn bwr-code-copy", text: "复制" });
      copyBtn.addEventListener("click", () => {
        const text = code?.textContent ?? "";
        void navigator.clipboard.writeText(text).then(() => {
          copyBtn.setText("已复制 ✓");
          window.setTimeout(() => copyBtn.setText("复制"), 1500);
        });
      });
      // 行号标注：遍历 code 子节点按换行分组，避免 innerHTML
      if (code) {
        const ownerDoc = this.contentEl.ownerDocument;
        const originalNodes = Array.from(code.childNodes);
        code.replaceChildren();

        // 逐行收集节点
        const lines: Node[][] = [[]];
        for (const child of originalNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const parts = (child.textContent ?? "").split("\n");
            for (let i = 0; i < parts.length; i++) {
              if (parts[i]) {
                lines[lines.length - 1].push(ownerDoc.createTextNode(parts[i]));
              }
              if (i < parts.length - 1) {
                lines.push([]);
              }
            }
          } else if (child.nodeName === "BR") {
            lines.push([]);
          } else {
            // clone 保留语法高亮 span
            lines[lines.length - 1].push(child.cloneNode(true));
          }
        }

        // 构建行号 span
        const frag = ownerDoc.createDocumentFragment();
        for (let i = 0; i < lines.length; i++) {
          const span = ownerDoc.createElement("span");
          span.className = "bwr-line";
          span.setAttribute("data-line", String(i + 1));
          for (const n of lines[i]) {
            span.appendChild(n);
          }
          frag.appendChild(span);
          if (i < lines.length - 1) {
            frag.appendChild(ownerDoc.createTextNode("\n"));
          }
        }
        code.appendChild(frag);
      }
    });

    // 给标题加 id，收集用于 scroll spy
    body.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
      const text = el.textContent?.trim() ?? "";
      const id = this.slugify(text);
      el.id = id;
      this.headingElements.push({ id, el: el as HTMLElement });
    });

    // 相关阅读推荐
    this.renderRelated(contentCol);

    // 浮动跳转按钮
    const fab = contentCol.createDiv({ cls: "bwr-fab" });
    this.fabEl = fab;
    fab.createEl("button", { cls: "bwr-fab-btn", text: "↑" })
      .addEventListener("click", () => this.scrollTo("top"));
    fab.createEl("button", { cls: "bwr-fab-btn", text: "↓" })
      .addEventListener("click", () => this.scrollTo("bottom"));

    // 滚动监听：TOC 进度 + 高亮（layout 是滚动容器）
    this.scrollHandler = () => {
      const scrollTop = layout.scrollTop;
      const scrollHeight = layout.scrollHeight - layout.clientHeight;

      // TOC 进度条 + 百分比
      const pct = scrollHeight > 0 ? Math.min(scrollTop / scrollHeight, 1) : 0;
      if (this.tocProgressBar) {
        this.tocProgressBar.style.width = `${pct * 100}%`;
      }
      if (this.tocProgressPct) {
        this.tocProgressPct.textContent = `${Math.round(pct * 100)}%`;
      }

      // TOC scroll spy
      if (this.headingElements.length > 0) {
        let activeId = this.headingElements[0].id;
        for (const h of this.headingElements) {
          if (h.el.offsetTop - layout.offsetTop <= scrollTop + 60) {
            activeId = h.id;
          } else {
            break;
          }
        }
        this.tocElements.forEach((el, id) => {
          el.classList.toggle("is-active", id === activeId);
        });
      }

      this.saveProgress(scrollTop);

      // FAB 显隐：内容超过一屏时显示
      if (this.fabEl) {
        this.fabEl.classList.toggle("bwr-fab--show", scrollHeight > 100);
      }
    };
    layout.addEventListener("scroll", this.scrollHandler);

    // 恢复阅读进度
    if (this.article) {
      const saved = this.app.loadLocalStorage(`bw-progress-${this.article.slug}`);
      if (saved) { layout.scrollTop = parseInt(saved as string, 10); }
    }
  }

  /** 持久化当前文章的滚动位置 */
  private saveProgress(scrollTop: number): void {
    if (!this.article) return;
    this.app.saveLocalStorage(`bw-progress-${this.article.slug}`, String(Math.round(scrollTop)));
  }

  private renderToolbar(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "bwr-toolbar" });

    if (this.onBack) {
      const backBtn = bar.createEl("button", {
        cls: "bwr-btn",
        attr: { "aria-label": "返回目录" },
      });
      backBtn.setText("← 文章列表");
      backBtn.addEventListener("click", () => {
        if (this.onBack) this.onBack();
      });
    }

    // 字号缩放
    const zoom = bar.createDiv({ cls: "bwr-zoom" });
    zoom.createEl("button", { cls: "bwr-btn bwr-btn-zoom", text: "A⁻" })
      .addEventListener("click", () => this.zoomFont(-1));
    zoom.createEl("button", { cls: "bwr-btn bwr-btn-zoom", text: "A" })
      .addEventListener("click", () => this.zoomFont(0));
    zoom.createEl("button", { cls: "bwr-btn bwr-btn-zoom", text: "A⁺" })
      .addEventListener("click", () => this.zoomFont(1));

    const actions = bar.createDiv({ cls: "bwr-actions" });
    const saveBtn = actions.createEl("button", {
      cls: "bwr-btn bwr-btn-save",
      text: "↓ 保存为笔记",
    });
    saveBtn.addEventListener("click", () => {
      void (async () => {
        if (this.isSaving || !this.onSave) return;
        this.isSaving = true;
        saveBtn.disabled = true;
        saveBtn.textContent = "保存中…";
        try {
          await this.onSave();
          saveBtn.textContent = "已保存 ✓";
          window.setTimeout(() => {
            saveBtn.textContent = "保存为笔记";
            saveBtn.disabled = false;
            this.isSaving = false;
          }, 2000);
        } catch {
          this.isSaving = false;
          saveBtn.disabled = false;
          saveBtn.textContent = "保存为笔记";
        }
      })();
    });
  }

  private renderHeader(container: HTMLElement): void {
    if (!this.article) return;
    const header = container.createDiv({ cls: "bwr-header" });

    header.createEl("h1", { cls: "bwr-title", text: this.article.title });

    const meta = header.createDiv({ cls: "bwr-meta" });
    meta.createSpan({ cls: "bwr-author", text: this.article.author || AUTHOR_NAME });
    meta.createSpan({ cls: "bwr-sep", text: "·" });
    meta.createSpan({ cls: "bwr-date", text: this.article.date });
    meta.createSpan({ cls: "bwr-sep", text: "·" });
    meta.createSpan({ cls: "bwr-category", text: this.article.category });

    if (this.article.readingTime) {
      meta.createSpan({ cls: "bwr-sep", text: "·" });
      meta.createSpan({
        cls: "bwr-reading-time",
        text: `约 ${this.article.readingTime} 分钟`,
      });
    }

    if (this.article.tags && this.article.tags.length > 0) {
      const tagRow = header.createDiv({ cls: "bwr-tags" });
      for (const tag of this.article.tags) {
        tagRow.createSpan({ cls: "bwr-tag", text: tag });
      }
    }
  }

  /* ── TOC 侧栏 ── */
  private renderToc(layout: HTMLElement, toc: TocEntry[]): void {
    const nav = layout.createDiv({ cls: "bwr-toc" });
    if (toc.length < 2) return;

    // 进度条
    const progressWrap = nav.createDiv({ cls: "bwr-toc-progress" });
    const bar = progressWrap.createDiv({ cls: "bwr-toc-bar" });
    this.tocProgressBar = bar;

    // 标题行：目录 + 百分比
    const titleRow = nav.createDiv({ cls: "bwr-toc-header" });
    titleRow.createDiv({ cls: "bwr-toc-title", text: "目录" });
    const pct = titleRow.createDiv({ cls: "bwr-toc-pct", text: "0%" });
    this.tocProgressPct = pct;

    const list = nav.createDiv({ cls: "bwr-toc-list" });

    for (const entry of toc) {
      const item = list.createDiv({
        cls: `bwr-toc-item bwr-toc-h${entry.level}`,
        text: entry.text,
        attr: { tabindex: "0", role: "link", "data-id": entry.id },
      });
      this.tocElements.set(entry.id, item);
      const scrollTarget = () => {
        const el = this.contentEl.querySelector(`#${CSS.escape(entry.id)}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      item.addEventListener("click", scrollTarget);
      item.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") scrollTarget();
      });
    }
  }

  private extractToc(markdown: string): TocEntry[] {
    const entries: TocEntry[] = [];
    const lines = markdown.split("\n");
    for (const line of lines) {
      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const text = match[2].replace(/[\]*_`~[]/g, "").trim();
        entries.push({
          level: match[1].length,
          text,
          id: this.slugify(text),
        });
      }
    }
    return entries;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private renderRelated(container: HTMLElement): void {
    if (!this.article || !this.getArticles) return;
    const all = this.getArticles();
    if (all.length < 2) return;

    const currentTags = new Set(this.article.tags ?? []);
    if (currentTags.size === 0) return;

    const scored = all
      .filter((a) => a.slug !== this.article!.slug)
      .map((a) => {
        const overlap = (a.tags ?? []).filter((t) => currentTags.has(t)).length;
        return { article: a, overlap };
      })
      .filter((s) => s.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3);

    if (scored.length === 0) return;

    const section = container.createDiv({ cls: "bwr-related" });
    section.createDiv({ cls: "bwr-related-title", text: "相关阅读" });
    for (const s of scored) {
      const link = section.createEl("a", {
        cls: "bwr-related-link",
        text: s.article.title,
        attr: { "data-slug": s.article.slug },
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const slug = (e.currentTarget as HTMLElement).getAttribute("data-slug");
        if (slug && this.onOpenArticle) this.onOpenArticle(slug);
      });
    }
  }

  private renderEmpty(): void {
    const empty = this.contentEl.createDiv({ cls: "bwr-empty" });
    empty.createDiv({ cls: "bwr-bamboo-art" });
    // SVG 装饰通过 CSS background-image 渲染，避免 innerHTML
    empty.createEl("h3", { text: "竹杖芒鞋轻胜马", cls: "bwr-empty-title" });
    empty.createEl("p", {
      text: "从左侧目录选择一篇文章开始阅读",
      cls: "bwr-empty-hint",
    });
  }

  private zoomFont(delta: -1 | 0 | 1): void {
    if (delta === 0) {
      this.fontSize = 16;
    } else {
      this.fontSize = Math.max(12, Math.min(22, this.fontSize + delta * 2));
    }
    this.app.saveLocalStorage("bw-font-size", String(this.fontSize));
    this.applyFontSize();
  }

  private scrollTo(direction: "top" | "bottom"): void {
    if (!this.layoutEl) return;
    const target = direction === "top" ? 0 : this.layoutEl.scrollHeight;
    this.layoutEl.scrollTo({ top: target, behavior: "smooth" });
  }

  private applyFontSize(): void {
    if (this.bodyEl) {
      this.bodyEl.style.fontSize = `${this.fontSize}px`;
    }
  }

  private openLightbox(img: HTMLImageElement): void {
    const doc = img.ownerDocument;
    const overlay = doc.body.createDiv({ cls: "bwr-lightbox" });
    const clone = overlay.createEl("img", { cls: "bwr-lightbox-img" });
    clone.src = img.src;
    clone.alt = img.alt;
    overlay.addEventListener("click", () => overlay.remove());
    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape") overlay.remove();
    }, { once: true });
  }
}
