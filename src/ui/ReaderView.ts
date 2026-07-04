/* ────────────── 主区域：文章阅读视图 ────────────── */
import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component } from "obsidian";
import type { Article } from "../types";
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
  private tocElements = new Map<string, HTMLElement>();
  private headingElements: { id: string; el: HTMLElement }[] = [];
  private scrollHandler: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.component = new Component();
  }

  getViewType(): string { return VIEW_TYPE_READER; }
  getDisplayText(): string {
    return this.article
      ? `${this.article.title} — 竹杖芒鞋`
      : "竹杖芒鞋 · 阅读";
  }
  getIcon(): string { return "book-open-check"; }

  setOnSave(cb: () => Promise<void>): void { this.onSave = cb; }
  setOnBack(cb: () => void): void { this.onBack = cb; }

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
    (this.leaf as any).tabHeaderInnerTitleEl?.setText(this.getDisplayText());
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
    if (this.scrollHandler) { this.scrollHandler = null; }

    if (!this.article) {
      this.renderEmpty();
      return;
    }

    // 阅读进度条
    const progressBar = contentEl.createDiv({ cls: "bwr-progress" });

    this.renderToolbar(contentEl);

    // 正文 + TOC 容器
    const layout = contentEl.createDiv({ cls: "bwr-layout" });

    // 内容列（header + body），跟 TOC 并排
    const contentCol = layout.createDiv({ cls: "bwr-content" });
    this.renderHeader(contentCol);

    // ── TOC 侧栏（始终占位，保持内容列宽度稳定） ──
    const toc = this.extractToc(this.article.content);
    this.renderToc(layout, toc);

    // ── 正文区域 ──
    const body = contentCol.createDiv({ cls: "bwr-body markdown-preview-view" });
    await MarkdownRenderer.renderMarkdown(
      this.article.content,
      body,
      "",
      this.component,
    );

    // 给标题加 id，收集用于 scroll spy
    body.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
      const text = el.textContent?.trim() ?? "";
      const id = this.slugify(text);
      el.id = id;
      this.headingElements.push({ id, el: el as HTMLElement });
    });

    // 滚动监听：进度条 + TOC 高亮
    this.scrollHandler = () => {
      const scrollTop = contentCol.scrollTop;
      const scrollHeight = contentCol.scrollHeight - contentCol.clientHeight;

      // 进度条
      const pct = scrollHeight > 0 ? Math.min(scrollTop / scrollHeight, 1) : 0;
      progressBar.style.width = `${pct * 100}%`;

      // TOC scroll spy
      if (this.headingElements.length === 0) return;
      let activeId = this.headingElements[0].id;
      for (const h of this.headingElements) {
        if (h.el.offsetTop - contentCol.offsetTop <= scrollTop + 60) {
          activeId = h.id;
        } else {
          break;
        }
      }
      this.tocElements.forEach((el, id) => {
        el.classList.toggle("is-active", id === activeId);
      });
    };
    contentCol.addEventListener("scroll", this.scrollHandler);

    // 滚动到顶部
    contentCol.scrollTop = 0;
  }

  private renderToolbar(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "bwr-toolbar" });

    if (this.onBack) {
      const backBtn = bar.createEl("button", {
        cls: "bwr-btn",
        attr: { "aria-label": "返回目录" },
      });
      backBtn.innerHTML = "← 目录";
      backBtn.addEventListener("click", () => {
        if (this.onBack) this.onBack();
      });
    }

    const actions = bar.createDiv({ cls: "bwr-actions" });
    const saveBtn = actions.createEl("button", {
      cls: "bwr-btn bwr-btn-save",
      text: "保存为笔记",
    });
    saveBtn.addEventListener("click", async () => {
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

    nav.createDiv({ cls: "bwr-toc-title", text: "目录" });
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
        const text = match[2].replace(/[*_`~\[\]]/g, "").trim();
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

  private renderEmpty(): void {
    const empty = this.contentEl.createDiv({ cls: "bwr-empty" });
    const bamboo = empty.createDiv({ cls: "bwr-bamboo-art" });
    bamboo.innerHTML = `
      <svg width="120" height="160" viewBox="0 0 120 160" fill="none">
        <rect x="55" y="20" width="10" height="140" rx="5" fill="var(--bw-bamboo)" opacity="0.3"/>
        <rect x="55" y="20" width="10" height="140" rx="5" stroke="var(--bw-bamboo)" stroke-width="1" opacity="0.4"/>
        <line x1="53" y1="50" x2="67" y2="50" stroke="var(--bw-bamboo-deep)" stroke-width="1.5" opacity="0.4"/>
        <line x1="53" y1="80" x2="67" y2="80" stroke="var(--bw-bamboo-deep)" stroke-width="1.5" opacity="0.4"/>
        <line x1="53" y1="110" x2="67" y2="110" stroke="var(--bw-bamboo-deep)" stroke-width="1.5" opacity="0.4"/>
        <line x1="53" y1="140" x2="67" y2="140" stroke="var(--bw-bamboo-deep)" stroke-width="1.5" opacity="0.4"/>
        <path d="M65 45 Q80 35 90 40 Q78 42 65 48" fill="var(--bw-bamboo)" opacity="0.25"/>
        <path d="M65 42 Q82 30 95 33 Q80 36 65 45" fill="var(--bw-bamboo-deep)" opacity="0.2"/>
        <path d="M55 75 Q38 65 30 70 Q40 72 55 78" fill="var(--bw-bamboo)" opacity="0.25"/>
        <path d="M55 72 Q35 60 25 65 Q38 66 55 75" fill="var(--bw-bamboo-deep)" opacity="0.2"/>
        <path d="M65 105 Q82 95 92 100 Q80 102 65 108" fill="var(--bw-bamboo)" opacity="0.25"/>
      </svg>`;
    empty.createEl("h3", { text: "竹杖芒鞋轻胜马", cls: "bwr-empty-title" });
    empty.createEl("p", {
      text: "从左侧目录选择一篇文章开始阅读",
      cls: "bwr-empty-hint",
    });
  }
}
