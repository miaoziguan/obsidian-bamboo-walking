/* ────────────── 主区域：文章阅读视图 ────────────── */
import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component, Notice, Menu, setIcon } from "obsidian";
import type { Article, ArticleIndexEntry } from "../types";
import { VIEW_TYPE_READER } from "../types";
import { AUTHOR_NAME } from "../constants";
import { countWords, formatWordCount, estimateReadingTime } from "../utils/text";
import { ShareModal } from "./ShareModal";
import { TtsControls } from "./TtsControls";
import { getAtomicNotesApi, buildExtractionText, findRelatedNotes } from "../services/AtomicNotesBridge";
import { getBambooImmortalsApi, refineQuoteToGoal } from "../services/BambooReviewBridge";

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
  private focusMode = false; // 专注模式：隐藏侧栏/TOC，仅留正文
  private focusExitHandler: ((e: KeyboardEvent) => void) | null = null;

  // ── 朗读控制（TTS） ──
  private ttsControls: TtsControls;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.component = new Component();
    this.ttsControls = new TtsControls({
      app: this.app,
      getContentEl: () => this.contentEl,
      getBodyEl: () => this.bodyEl,
      getArticle: () => this.article,
      loadLocal: (k) => this.loadLocalString(k),
      saveLocal: (k, v) => this.app.saveLocalStorage(k, v),
    });
    const saved = this.loadLocalString("bw-font-size");
    if (saved) this.fontSize = parseInt(saved, 10);
  }

  /** Obsidian loadLocalStorage 返回 any，在此处窄化为 string | null */
  private loadLocalString(key: string): string | null {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Obsidian 类型声明 loadLocalStorage 返回 any | null
    const val: unknown = this.app.loadLocalStorage(key);
    return typeof val === "string" ? val : null;
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
  setSavePathHint(hint: string): void { this._savePathHint = hint; }
  private _savePathHint = "竹杖芒鞋/";
  private getSavePathHint(): string { return this._savePathHint; }

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
    setIcon(wrap.createSpan({ cls: "bwr-error-icon" }), "alert-triangle");
    wrap.createEl("p", { text: "加载失败", cls: "bwr-error-title" });
    wrap.createEl("p", { text: msg, cls: "bwr-error-msg" });
  }

  /** 展示文章 */
  async showArticle(article: Article): Promise<void> {
    this.ttsControls.stop();
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
    this.ttsControls.stop();
    this.component.unload();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bwr-reader");
    // 恢复专注模式（持久化）
    if (this.loadLocalString("bw-focus-mode") === "1") {
      this.focusMode = true;
      contentEl.addClass("bwr-focus-mode");
    }
    this.tocElements.clear();
    this.headingElements = [];
    this.tocProgressBar = null;
    this.tocProgressPct = null;
    this.scrollHandler = null;

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
    layout.setCssProps({ "--bwr-topbar-h": `${topBar.offsetHeight}px` });
    const contentCol = layout.createDiv({ cls: "bwr-content" });

    // ── Markdown 预处理（排版规范化）：统一中英间距、标点等 ──
    const processedContent = this.preprocessMarkdown(this.article.content);

    // ── TOC 侧栏（始终占位，保持内容列宽度稳定） ──
    const toc = this.extractToc(processedContent);
    this.renderToc(layout, toc);

    // ── 正文区域 ──
    const body = contentCol.createDiv({ cls: "bwr-body markdown-preview-view" });
    this.bodyEl = body;
    // 右键正文选区 → 弹出自定义菜单（生成分享卡片 / 复制选中文字）
    body.addEventListener("contextmenu", (e) => this.onBodyContextMenu(e));
    this.applyFontSize();
    await MarkdownRenderer.render(
      this.app,
      processedContent,
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
        // 仅在用户主动点击时写入剪贴板（当前文章代码），从不读取剪贴板
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- navigator.clipboard 是浏览器标准 API
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
        const frag = createFragment();
        for (let i = 0; i < lines.length; i++) {
          const span = createSpan({ cls: "bwr-line", attr: { "data-line": String(i + 1) } });
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

    // 链接行为定制：内部链接优先在插件内打开，外部链接新标签打开
    this.interceptLinks(body);

    // 给标题加 id，收集用于 scroll spy
    body.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
      const text = el.textContent?.trim() ?? "";
      const id = this.slugify(text);
      el.id = id;
      this.headingElements.push({ id, el: el as HTMLElement });
    });

    // 上/下篇导航（基于当前文章在列表中的位置）
    this.renderPrevNext(contentCol);

    // 相关阅读推荐
    this.renderRelated(contentCol);

    // 知识回流：本文在你本地知识库（竹叶飞刃）里的相关原子笔记
    void this.renderRelatedNotes(contentCol);

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
        this.tocProgressBar.setCssStyles({ width: `${pct * 100}%` });
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
      const saved = this.loadLocalString(`bw-progress-${this.article.slug}`);
      if (saved) { layout.scrollTop = parseInt(saved, 10); }
    }
  }

  /* ── Markdown 预处理：中英混排 + 排版规范化 ── */

  /** 预处理 Markdown，使渲染结果排版更规范 */
  private preprocessMarkdown(md: string): string {
    // 步骤 1：保护代码块和内联代码，避免正则误伤
    const codeBlocks: string[] = [];
    const inlineCodes: string[] = [];

    // 提取 ``` 围栏代码块，用占位符替换
    let processed = md.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
    });

    // 提取 `行内代码`（占位符不含反引号，不会被误匹配）
    processed = processed.replace(/`[^`]*`/g, (match) => {
      inlineCodes.push(match);
      return `\x00INLINECODE${inlineCodes.length - 1}\x00`;
    });

    // 步骤 2：中英/中数之间加细空格（\u2009 窄空格，视觉更精致）
    processed = processed
      // 中文后跟英文或数字：在中间插窄空格
      .replace(/([\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef])([a-zA-Z0-9@&%$#])/g, "$1\u2009$2")
      // 英文或数字后跟中文：在中间插窄空格
      .replace(/([a-zA-Z0-9@&%$#])([\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef])/g, "$1\u2009$2");

    // 步骤 3：还原被保护的内容
    // eslint-disable-next-line no-control-regex -- \x00 为有意使用的占位符分隔符
    processed = processed.replace(/\x00INLINECODE(\d+)\x00/g, (_, idx: string) => inlineCodes[parseInt(idx, 10)] ?? "``");
    // eslint-disable-next-line no-control-regex -- \x00 为有意使用的占位符分隔符
    processed = processed.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, idx: string) => codeBlocks[parseInt(idx, 10)] ?? "```");

    return processed;
  }

  /** 持久化当前文章的滚动位置 */
  private saveProgress(scrollTop: number): void {
    if (!this.article) return;
    this.app.saveLocalStorage(`bw-progress-${this.article.slug}`, String(Math.round(scrollTop)));
  }

  private renderToolbar(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "bwr-toolbar" });

    // ── 导航区 ──
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

    // 分隔符
    bar.createDiv({ cls: "bwr-toolbar-sep" });

    // ── 阅读区 ──
    const zoom = bar.createDiv({ cls: "bwr-zoom" });
    zoom.createEl("button", {
      cls: "bwr-btn bwr-btn-zoom",
      text: "A⁻",
      attr: { "aria-label": "减小字号", title: "减小字号" },
    }).addEventListener("click", () => this.zoomFont(-1));
    zoom.createEl("button", {
      cls: "bwr-btn bwr-btn-zoom",
      text: "A",
      attr: { "aria-label": "重置字号", title: "重置字号" },
    }).addEventListener("click", () => this.zoomFont(0));
    zoom.createEl("button", {
      cls: "bwr-btn bwr-btn-zoom",
      text: "A⁺",
      attr: { "aria-label": "增大字号", title: "增大字号" },
    }).addEventListener("click", () => this.zoomFont(1));

    const focusBtn = bar.createEl("button", {
      cls: "bwr-btn bwr-btn-focus",
      text: "◎ 专注",
      attr: { title: "专注阅读（隐藏侧栏，Esc 退出）" },
    });
    focusBtn.addEventListener("click", () => this.toggleFocusMode());

    // 分隔符
    bar.createDiv({ cls: "bwr-toolbar-sep" });

    // ── 操作区 ──
    const actions = bar.createDiv({ cls: "bwr-actions" });

    // 分享动作：弹出分享卡片浮层（多形态）
    const imgBtn = actions.createEl("button", {
      cls: "bwr-btn bwr-btn-share",
      text: "◱ 分享卡片",
      attr: { title: "生成分享卡片", "aria-label": "生成分享卡片" },
    });
    imgBtn.addEventListener("click", () => this.openShareModal());

    // 提炼原子笔记：联动「竹叶飞刃」，把本文一键沉淀为可检索的知识节点
    const extractBtn = actions.createEl("button", {
      cls: "bwr-btn bwr-btn-extract",
      attr: {
        title: "用竹叶飞刃把本文提炼为原子笔记",
        "aria-label": "提炼为原子笔记",
      },
    });
    // 线性漏斗图标：表达「提炼 / 蒸馏」语义
    this.appendIcon(extractBtn, "M2.5 3h11l-4 5.6V13l-3-1.4V8.6L2.5 3z");
    extractBtn.createSpan({ text: "提炼笔记" });
    extractBtn.addEventListener("click", () => this.extractToAtomicNotes());

    const saveBtn = actions.createEl("button", {
      cls: "bwr-btn bwr-btn-save",
      text: "↓ 保存为笔记",
      attr: {
        "aria-label": "保存为笔记",
        title: `保存到 ${this.getSavePathHint()}`,
      },
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

    // ── 朗读触发按钮（点击展开底部浮动 TTS 面板） ──
    const ttsToggle = bar.createEl("button", {
      cls: "bwr-btn bwr-btn-tts-toggle",
      text: "朗读",
      attr: { title: "朗读全文（可暂停/继续）", "aria-label": "朗读全文" },
    });
    ttsToggle.addEventListener("click", () => this.ttsControls.toggleBar());
    this.ttsControls.setPlayBtn(ttsToggle);
  }

  /** 打开分享卡片浮层。selected 为已确定的选中文字（右键菜单传入）；省略时自动读取正文选区 */
  private openShareModal(selected?: string): void {
    if (!this.article) return;
    const all = this.getArticles ? this.getArticles() : [];
    const selText = selected ?? this.getReaderSelection();
    new ShareModal(this.app, this.article, all, selText).open();
  }

  /** 正文右键菜单：仅当存在文字选区时拦截，提供「生成分享卡片 / 复制选中文字」；否则放行系统菜单 */
  private onBodyContextMenu(e: MouseEvent): void {
    const sel = this.getReaderSelection();
    if (!sel) return;
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("生成分享卡片")
        .setIcon("image")
        .onClick(() => this.openShareModal(sel)),
    );
    menu.addItem((item) =>
      item
        .setTitle("复制选中文字")
        .setIcon("copy")
        .onClick(() => {
          // 仅写入用户主动选中的文字，从不读取剪贴板
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- navigator.clipboard 是浏览器标准 API
            void navigator.clipboard.writeText(sel).then(
              () => new Notice("已复制选中文字"),
              () => new Notice("复制失败"),
            );
          } catch {
            new Notice("复制失败");
          }
        }),
    );
    // 跨插件联动：仅当检测到「竹林修仙传」插件时，提供「炼化为修行目标」
    if (getBambooImmortalsApi(this.app)) {
      menu.addItem((item) =>
        item
          .setTitle("炼化为修行目标")
          .setIcon("target")
          .onClick(() => {
            void refineQuoteToGoal(this.app, sel, this.article?.title).then((ok) => {
              if (!ok) new Notice("未检测到「竹林修仙传」插件，无法炼化");
            });
          }),
      );
    }
    menu.showAtMouseEvent(e);
  }

  /** 取阅读正文内的当前文字选区，归一化为单行空格；非正文选区或为空则返回 undefined */
  private getReaderSelection(): string | undefined {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return undefined;
    if (!sel.anchorNode || !this.contentEl.contains(sel.anchorNode)) return undefined;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    return text.length > 0 ? text : undefined;
  }

  /** 联动竹叶飞刃：把当前文章提炼为原子笔记 */
  private extractToAtomicNotes(): void {
    if (!this.article) return;
    const api = getAtomicNotesApi(this.app);
    if (!api) {
      new Notice(
        "未检测到「竹叶飞刃」插件。请先安装并启用竹叶飞刃（Bamboo Darts），即可把本文一键提炼为原子笔记。",
        8000,
      );
      return;
    }
    const text = buildExtractionText(this.article);
    if (!text) {
      new Notice("本文暂无可提炼的正文");
      return;
    }
    // 交给竹叶飞刃接管后续（质量门控 / 去重 / 提炼 / 保存及其进度提示）
    void api.extractFromText(text);
    new Notice("已发送至竹叶飞刃提炼…");
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

    const words = countWords(this.article.content);
    const reading = this.article.readingTime ?? estimateReadingTime(words);
    meta.createSpan({ cls: "bwr-sep", text: "·" });
    meta.createSpan({
      cls: "bwr-words",
      text: `约 ${formatWordCount(words)} · ${reading} 分钟`,
    });

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

  /** 上/下篇导航：基于当前文章在同一分类内的排序位置 */
  private renderPrevNext(container: HTMLElement): void {
    if (!this.article || !this.getArticles) return;
    const all = this.getArticles();
    if (all.length < 2) return;

    // 按同一分类 + 日期排序，找到当前文章的相邻篇
    const currentCategory = this.article.category ?? "";
    const sameCategory = all
      .filter((a) => (a.category ?? "") === currentCategory)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const currentIdx = sameCategory.findIndex((a) => a.slug === this.article!.slug);

    const prevArticle = currentIdx >= 0 && currentIdx < sameCategory.length - 1
      ? sameCategory[currentIdx + 1]
      : null;
    const nextArticle = currentIdx > 0
      ? sameCategory[currentIdx - 1]
      : null;

    if (!prevArticle && !nextArticle) return;

    const nav = container.createDiv({ cls: "bwr-prev-next" });

    if (prevArticle) {
      const prev = nav.createDiv({ cls: "bwr-prev-next-item bwr-prev-next-prev" });
      prev.createDiv({ cls: "bwr-prev-next-label", text: "← 上一篇" });
      const link = prev.createEl("a", {
        cls: "bwr-prev-next-title",
        text: prevArticle.title ?? "",
        attr: { "data-slug": prevArticle.slug },
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const slug = (e.currentTarget as HTMLElement).getAttribute("data-slug");
        if (slug && this.onOpenArticle) this.onOpenArticle(slug);
      });
    } else {
      nav.createDiv({ cls: "bwr-prev-next-item bwr-prev-next-prev bwr-prev-next-empty" });
    }

    if (nextArticle) {
      const next = nav.createDiv({ cls: "bwr-prev-next-item bwr-prev-next-next" });
      next.createDiv({ cls: "bwr-prev-next-label", text: "下一篇 →" });
      const link = next.createEl("a", {
        cls: "bwr-prev-next-title",
        text: nextArticle.title ?? "",
        attr: { "data-slug": nextArticle.slug },
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const slug = (e.currentTarget as HTMLElement).getAttribute("data-slug");
        if (slug && this.onOpenArticle) this.onOpenArticle(slug);
      });
    } else {
      nav.createDiv({ cls: "bwr-prev-next-item bwr-prev-next-next bwr-prev-next-empty" });
    }
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

  /**
   * 知识回流：展示竹叶飞刃知识库中与本文明相关的原子笔记。
   * 仅当装了「竹叶飞刃」且存在相关笔记时渲染；其余情况安静隐藏。
   * 异步查询，不阻塞正文渲染；若查询期间已切换文章则丢弃结果。
   */
  private async renderRelatedNotes(container: HTMLElement): Promise<void> {
    if (!this.article) return;
    const anchorSlug = this.article.slug;
    const notes = await findRelatedNotes(this.app, this.article.content, { topK: 5 });
    if (!notes || notes.length === 0) return;
    // 文章已切换，放弃渲染（旧的 detached 容器不再可见）
    if (!this.article || this.article.slug !== anchorSlug) return;

    const section = container.createDiv({ cls: "bwr-atomic-related" });
    const titleEl = section.createDiv({ cls: "bwr-related-title" });
    // 线性叠书图标：呼应原 📚 表情，表达"你记过的知识库"
    this.appendIcon(titleEl, "M3 3.2h9v3.2H3z M3 7.2h9v3.2H3z M3 11.2h9v3.2H3z");
    titleEl.createSpan({ text: "你记过的相关笔记" });
    const list = section.createDiv({ cls: "bwr-atomic-related-list" });
    for (const n of notes) {
      const row = list.createEl("a", {
        cls: "bwr-atomic-related-item",
        attr: { href: "#", title: `${n.title}（相关度 ${(n.score * 100).toFixed(0)}%）` },
      });
      row.createSpan({ cls: "bwr-atomic-related-title", text: n.title });
      row.createSpan({
        cls: "bwr-atomic-related-score",
        text: `${(n.score * 100).toFixed(0)}%`,
      });
      row.addEventListener("click", (e) => {
        e.preventDefault();
        // 跳转到本地原子笔记（竹叶飞刃的知识节点）
        void this.app.workspace.openLinkText(n.path, "", false);
      });
    }
  }

  /**
   * 向指定父元素追加一个线性 SVG 图标（自有风格）：
   * viewBox 16×16，stroke=currentColor，stroke-width=1.5，圆头连接。
   * 颜色与尺寸由父元素上的 .bwr-icon / .bwr-related-title 控制。
   * 用 Obsidian 自带的 createSvg（规则 prefer-create-el 推荐的 SVG 写法，
   * 自动创建正确命名空间元素），不使用 document.createElementNS。
   */
  private appendIcon(parent: HTMLElement, pathD: string): void {
    const svg = createSvg("svg", {
      cls: "bwr-icon",
      attr: {
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
      },
    });
    svg.createSvg("path", { attr: { d: pathD } });
    parent.appendChild(svg);
  }

  /** 展示空状态（未选中文章时）或首次启动引导态 */
  renderWelcome(isFirstLaunch = false): void {
    const { contentEl } = this;
    if (!contentEl.querySelector(".bwr-reader")) {
      contentEl.empty();
      contentEl.addClass("bwr-reader");
    }
    contentEl.empty();
    contentEl.addClass("bwr-reader");

    const empty = contentEl.createDiv({ cls: "bwr-empty" });
    empty.createDiv({ cls: "bwr-bamboo-art" });
    empty.createEl("h3", { text: "竹杖芒鞋轻胜马", cls: "bwr-empty-title" });

    if (isFirstLaunch) {
      empty.createEl("p", {
        text: "从 GitHub 拉取文章中，请稍候…",
        cls: "bwr-empty-hint bwr-empty-loading",
      });
      // 功能亮点
      const features = empty.createDiv({ cls: "bwr-empty-features" });
      const items = ["自动同步专栏文章", "离线阅读，随时回顾", "一键保存到本地知识库"];
      for (const item of items) {
        const row = features.createDiv({ cls: "bwr-empty-feature" });
        row.createSpan({ cls: "bwr-empty-feature-dot" });
        row.createSpan({ text: item });
      }
    } else {
      empty.createEl("p", {
        text: "从左侧目录选择一篇文章开始阅读",
        cls: "bwr-empty-hint",
      });
    }
  }

  private renderEmpty(): void {
    this.renderWelcome(false);
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
    // 同步基准字号变量，标题（h1.bwr-title）用 calc 跟随缩放，保证与正文比例一致
    this.contentEl.setCssProps({ "--bwr-base-size": `${this.fontSize}px` });
    if (this.bodyEl) {
      this.bodyEl.setCssStyles({ fontSize: `${this.fontSize}px` });
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

  /** 链接行为定制：正文内链接点击不再盲目跳出插件 */
  private interceptLinks(body: HTMLElement): void {
    body.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") ?? a.dataset.href ?? "";
      if (!href) return;

      if (a.classList.contains("external-link")) {
        // 外部链接：新标签打开
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener noreferrer");
        return;
      }

      // 内部链接：优先在插件内打开对应文章
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const match =
          this.getArticles?.()?.find((entry) =>
            entry.slug === href ||
            entry.title === href ||
            entry.slug === `技术随想/${href}` ||
            entry.slug.split("/").pop() === href,
          );
        if (match && this.onOpenArticle) {
          this.onOpenArticle(match.slug);
        } else {
          // 非本专栏文章：交回 Obsidian 标准打开逻辑
          void this.app.workspace.openLinkText(href, "", e.ctrlKey || e.metaKey);
        }
      });
    });
  }

  /** 专注模式：隐藏 TOC 与顶栏装饰，仅留正文；Esc 退出 */
  private toggleFocusMode(): void {
    this.focusMode = !this.focusMode;
    this.contentEl.toggleClass("bwr-focus-mode", this.focusMode);
    this.app.saveLocalStorage("bw-focus-mode", this.focusMode ? "1" : "0");
    if (this.focusMode) {
      const doc = this.contentEl.ownerDocument;
      const exit = (e: KeyboardEvent) => {
        if (e.key === "Escape" && this.focusMode) {
          this.toggleFocusMode();
          doc.removeEventListener("keydown", exit);
        }
      };
      doc.addEventListener("keydown", exit);
      this.focusExitHandler = exit;
    } else if (this.focusExitHandler) {
      this.contentEl.ownerDocument.removeEventListener("keydown", this.focusExitHandler);
      this.focusExitHandler = null;
    }
  }
}
