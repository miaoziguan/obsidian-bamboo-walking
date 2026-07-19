/* ────────────── 主区域：文章阅读视图 ────────────── */
import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component, Notice, setIcon } from "obsidian";
import type { Article, ArticleIndexEntry } from "../types";
import { VIEW_TYPE_READER } from "../types";
import { AUTHOR_NAME } from "../constants";
import { countWords, formatWordCount, estimateReadingTime } from "../utils/text";
import { ShareModal } from "./ShareModal";
import { TtsService, type TtsSegment, type TtsState } from "../services/TtsService";
import { getAtomicNotesApi, buildExtractionText, findRelatedNotes } from "../services/AtomicNotesBridge";

/** 语速档位 */
const TTS_RATES = [0.75, 1.0, 1.25, 1.5];

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

  // ── 朗读（TTS）状态 ──
  private ttsService: TtsService | null = null;
  private ttsActiveEl: HTMLElement | null = null; // 当前高亮的朗读段落
  private ttsRate = 1.0; // 语速（记忆）
  private ttsVoice: SpeechSynthesisVoice | null = null; // 选中语音（记忆）
  private ttsPlayBtn: HTMLButtonElement | null = null;
  private ttsStopBtn: HTMLButtonElement | null = null;
  private ttsRateSel: HTMLSelectElement | null = null;
  private ttsVoiceSel: HTMLSelectElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.component = new Component();
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
    this.ttsStop();
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
    this.ttsStop();
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

    const actions = bar.createDiv({ cls: "bwr-actions" });

    // 专注模式：隐藏 TOC / 顶栏装饰，仅留正文
    const focusBtn = actions.createEl("button", {
      cls: "bwr-btn bwr-btn-focus",
      text: "◎ 专注",
      attr: { title: "专注阅读（隐藏侧栏，Esc 退出）" },
    });
    focusBtn.addEventListener("click", () => this.toggleFocusMode());

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
      attr: { "aria-label": "保存为笔记" },
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

    // ── 朗读（TTS）控件 ──
    this.renderTtsControls(bar);
  }

  /** 渲染朗读控件：播放/暂停、停止、语速、语音下拉 */
  private renderTtsControls(bar: HTMLElement): void {
    const group = bar.createDiv({ cls: "bwr-tts" });

    const playBtn = group.createEl("button", {
      cls: "bwr-btn bwr-btn-tts-play",
      text: "朗读",
      attr: { title: "朗读全文（可暂停/继续）", "aria-label": "朗读全文" },
    });
    const stopBtn = group.createEl("button", {
      cls: "bwr-btn bwr-btn-tts-stop",
      text: "停止",
      attr: { title: "停止朗读", "aria-label": "停止朗读" },
    });
    stopBtn.disabled = true;

    const rateSel = group.createEl("select", {
      cls: "bwr-tts-select",
      attr: { title: "语速", "aria-label": "语速" },
    });
    for (const r of TTS_RATES) {
      rateSel.createEl("option", { text: `${r}x`, value: String(r) });
    }

    const voiceSel = group.createEl("select", {
      cls: "bwr-tts-select",
      attr: { title: "朗读语音", "aria-label": "朗读语音" },
    });

    this.ttsPlayBtn = playBtn;
    this.ttsStopBtn = stopBtn;
    this.ttsRateSel = rateSel;
    this.ttsVoiceSel = voiceSel;

    // 语速记忆
    const savedRate = this.loadLocalString("bw-tts-rate");
    if (savedRate) {
      this.ttsRate = parseFloat(savedRate);
      rateSel.value = savedRate;
    }

    playBtn.addEventListener("click", () => this.toggleTtsPlay());
    stopBtn.addEventListener("click", () => this.ttsStop());
    rateSel.addEventListener("change", () => {
      this.ttsRate = parseFloat(rateSel.value);
      this.app.saveLocalStorage("bw-tts-rate", String(this.ttsRate));
      this.getTts()?.setRate(this.ttsRate);
    });
    voiceSel.addEventListener("change", () => {
      const name = voiceSel.value;
      const v = name
        ? (this.getTts()?.getVoices().find((vv) => vv.name === name) ?? null)
        : null;
      this.ttsVoice = v;
      if (name) this.app.saveLocalStorage("bw-tts-voice", name);
      this.getTts()?.setVoice(v);
      // 切换语音需先停止，避免朗读中重排抖动
      if (this.getTts()?.getState() !== "idle") {
        this.ttsStop();
      }
    });

    // 填充语音下拉；不支持时禁用整组
    const tts = this.getTts();
    if (!tts || !tts.isSupported()) {
      for (const el of [playBtn, stopBtn, rateSel, voiceSel]) {
        el.disabled = true;
      }
      playBtn.setAttr("title", "当前平台暂不支持朗读（需桌面端 Obsidian）");
      return;
    }
    this.populateVoices();
  }

  /** 懒初始化朗读服务（绑定回调） */
  private getTts(): TtsService | null {
    if (this.ttsService) return this.ttsService;
    const svc = new TtsService({
      onSegmentStart: (i, seg) => this.onTtsSegmentStart(i, seg),
      onStateChange: (s) => this.onTtsStateChange(s),
      onEnd: () => this.onTtsEnd(),
    });
    this.ttsService = svc;
    return svc;
  }

  /** 从已渲染正文提取可朗读段落（保留 DOM 引用用于高亮+滚动） */
  private extractReadableSegments(): TtsSegment[] {
    if (!this.bodyEl) return [];
    const nodes = Array.from(
      this.bodyEl.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, blockquote"),
    );
    const segs: TtsSegment[] = [];
    for (const el of nodes) {
      const text = el.textContent?.trim();
      if (text) segs.push({ text, el });
    }
    return segs;
  }

  /** 播放/暂停/继续 三态切换 */
  private toggleTtsPlay(): void {
    const tts = this.getTts();
    if (!tts || !tts.isSupported()) return;

    const state = tts.getState();
    if (state === "playing") {
      tts.pause();
      return;
    }
    if (state === "paused") {
      tts.resume();
      return;
    }

    // idle → 从头或续读开始
    // 仅在用户真正点击朗读、且系统只有机械音时，才提示一次去装增强语音
    if (!tts.hasEnhancedChineseVoice()) {
      ReaderView.promptEnhancedVoiceOnce();
    }

    const segs = this.extractReadableSegments();
    if (segs.length === 0) return;
    let start = 0;
    if (this.article) {
      const saved = this.loadLocalString(`bw-tts-pos-${this.article.slug}`);
      if (saved) start = Math.max(0, parseInt(saved, 10) || 0);
    }
    tts.setRate(this.ttsRate);
    tts.setVoice(this.ttsVoice);
    tts.speakSegments(segs, start);
  }

  /** 停止朗读并复位 UI */
  private ttsStop(): void {
    this.getTts()?.stop();
    this.resetTtsUi();
  }

  private onTtsSegmentStart(index: number, seg: TtsSegment): void {
    if (this.ttsActiveEl && this.ttsActiveEl !== seg.el) {
      this.ttsActiveEl.removeClass("bwr-tts-active");
    }
    this.ttsActiveEl = seg.el;
    seg.el.addClass("bwr-tts-active");
    seg.el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (this.article) {
      this.app.saveLocalStorage(`bw-tts-pos-${this.article.slug}`, String(index));
    }
  }

  private onTtsStateChange(state: TtsState): void {
    if (!this.ttsPlayBtn) return;
    if (state === "playing") {
      this.ttsPlayBtn.setText("暂停");
      if (this.ttsStopBtn) this.ttsStopBtn.disabled = false;
    } else if (state === "paused") {
      this.ttsPlayBtn.setText("继续");
    } else {
      this.ttsPlayBtn.setText("朗读");
      if (this.ttsStopBtn) this.ttsStopBtn.disabled = true;
    }
  }

  private onTtsEnd(): void {
    // 自然读完：清除续读进度，回到开头
    if (this.article) {
      this.app.saveLocalStorage(`bw-tts-pos-${this.article.slug}`, "0");
    }
    this.resetTtsUi();
  }

  /** 清除当前高亮段落 */
  private clearTtsHighlight(): void {
    if (this.ttsActiveEl) {
      this.ttsActiveEl.removeClass("bwr-tts-active");
      this.ttsActiveEl = null;
    }
  }

  /** 复位朗读 UI：清除高亮 + 按钮回到初始态 */
  private resetTtsUi(): void {
    this.clearTtsHighlight();
    if (this.ttsPlayBtn) this.ttsPlayBtn.setText("朗读");
    if (this.ttsStopBtn) this.ttsStopBtn.disabled = true;
  }

  /** 填充中文语音下拉；列表异步加载时监听 voiceschanged 再填充 */
  private populateVoices(): void {
    const tts = this.getTts();
    if (!tts || !this.ttsVoiceSel) return;
    const zh = tts.getChineseVoices();
    if (zh.length === 0) {
      tts.setVoicesChangedHandler(() => this.populateVoices());
      return;
    }
    this.ttsVoiceSel.empty();
    for (const v of zh) {
      this.ttsVoiceSel.createEl("option", { text: v.name, value: v.name });
    }
    const savedName = this.loadLocalString("bw-tts-voice");
    const match =
      (savedName ? zh.find((v) => v.name === savedName) : undefined) ?? zh[0];
    if (match) {
      this.ttsVoice = match;
      this.ttsVoiceSel.value = match.name;
    }
    // 仅机械音时：下拉常驻引导 + 一次性安装提示，引导用户装增强中文语音
    if (!tts.hasEnhancedChineseVoice()) {
      this.ttsVoiceSel.setAttr(
        "title",
        "当前系统只有机械音。想更自然？去系统装增强/神经中文语音（如 macOS「婷婷(增强)」、Windows「Microsoft Xiaoxiao Neural」），下次自动优先。",
      );
    }
  }

  /** 仅弹一次「去装增强语音」提示（用户点击朗读时触发），避免重复打扰 */
  private static enhancedVoiceNoticeShown = false;
  private static promptEnhancedVoiceOnce(): void {
    if (ReaderView.enhancedVoiceNoticeShown) return;
    ReaderView.enhancedVoiceNoticeShown = true;
    const guide =
      typeof process !== "undefined" && process.platform === "darwin"
        ? "系统设置 → 辅助功能 → 朗读内容 → 系统嗓音 → 管理嗓音，下载「婷婷(增强)」或「Yue」"
        : typeof process !== "undefined" && process.platform === "win32"
          ? "设置 → 时间和语言 → 语音 → 管理语音，下载「Microsoft Xiaoxiao Neural」等神经语音"
          : "当前系统未提供增强中文语音，朗读偏机械属正常；可尝试安装系统增强/神经中文语音";
    new Notice("朗读偏机械？去系统装增强/神经中文语音可更自然。\n" + guide, 9000);
  }

  /** 打开分享卡片浮层 */
  private openShareModal(): void {
    if (!this.article) return;
    const all = this.getArticles ? this.getArticles() : [];
    new ShareModal(this.app, this.article, all).open();
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
   * 用 createElementNS 创建 SVG 元素，避开 HTMLElement 命名空间与类型限制。
   */
  private appendIcon(parent: HTMLElement, pathD: string): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("bwr-icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    parent.appendChild(svg);
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
