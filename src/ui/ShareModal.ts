/* ────────────── 分享卡片浮层：多形态选择 + 预览 + 下载 ────────────── */
import { App, Modal, Notice } from "obsidian";
import type { Article, ArticleIndexEntry } from "../types";
import {
  renderShareCards,
  safeFileName,
  PLATFORM_PRESETS,
  type ShareSize,
  type ShareForm,
} from "../utils/share";

const SIZE_LABELS: Record<ShareSize, string> = {
  square: "正方形 1:1",
  portrait: "竖版 4:5",
  story: "故事 9:16",
  landscape: "横版 1.91:1",
  wide: "宽屏 16:9",
};

const FORM_LABELS: Record<ShareForm, string> = {
  summary: "摘要卡",
  quote: "金句卡",
  long: "长图文摘",
  series: "系列多图",
};

const SIZE_ORDER: ShareSize[] = ["square", "portrait", "story", "landscape", "wide"];
const FORM_ORDER: ShareForm[] = ["summary", "quote", "long", "series"];

/**
 * 分享卡片浮层：用户点击「分享」后弹出，选择平台预设 / 比例 / 形态，
 * 实时预览，确认后下载（或复制到剪贴板）。
 */
export class ShareModal extends Modal {
  private article: Article;
  private allEntries: ArticleIndexEntry[];
  private series: ArticleIndexEntry[];
  /** 用户在阅读视图中选中的文字；提供时默认走金句卡形态 */
  private selectedText?: string;

  private size: ShareSize = "square";
  private form: ShareForm = "summary";

  private blobs: Blob[] = [];
  private previewUrl: string | null = null;

  private previewImg: HTMLImageElement | null = null;
  private previewNote: HTMLElement | null = null;
  private downloadBtn: HTMLButtonElement | null = null;
  private copyBtn: HTMLButtonElement | null = null;

  private sizeChips = new Map<ShareSize, HTMLElement>();
  private formChips = new Map<ShareForm, HTMLElement>();

  constructor(app: App, article: Article, allEntries: ArticleIndexEntry[], selectedText?: string) {
    super(app);
    this.article = article;
    this.allEntries = allEntries;
    this.selectedText = selectedText;
    const cat = article.category;
    this.series = allEntries
      .slice()
      .sort(
        (a, b) =>
          (a.slug === article.slug ? -1 : 0) - (b.slug === article.slug ? -1 : 0) ||
          (a.category === cat ? -1 : 0) - (b.category === cat ? -1 : 0),
      )
      .slice(0, 6);
    // 有选中文字时默认金句卡形态，直接出用户选的那句
    if (selectedText && selectedText.trim()) {
      this.form = "quote";
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("bw-share-modal");
    contentEl.empty();
    contentEl.addClass("bw-share");

    contentEl.createEl("h2", { cls: "bw-share-title", text: "生成分享卡片" });

    // ── 平台预设 ──
    const platSec = contentEl.createDiv({ cls: "bw-share-section" });
    platSec.createDiv({ cls: "bw-share-label", text: "平台预设" });
    const platRow = platSec.createDiv({ cls: "bw-share-chips" });
    for (const p of PLATFORM_PRESETS) {
      const chip = platRow.createEl("button", {
        cls: "bw-share-chip",
        text: p.label,
        attr: { title: p.hint, "data-key": p.key },
      });
      chip.addEventListener("click", () => {
        this.size = p.size;
        this.form = p.form;
        this.syncChips();
        void this.refresh();
      });
    }

    // ── 比例 ──
    const sizeSec = contentEl.createDiv({ cls: "bw-share-section" });
    sizeSec.createDiv({ cls: "bw-share-label", text: "画布比例" });
    const sizeRow = sizeSec.createDiv({ cls: "bw-share-chips" });
    for (const s of SIZE_ORDER) {
      const chip = sizeRow.createEl("button", {
        cls: "bw-share-chip",
        text: SIZE_LABELS[s],
        attr: { "data-size": s },
      });
      chip.addEventListener("click", () => {
        this.size = s;
        this.syncChips();
        void this.refresh();
      });
      this.sizeChips.set(s, chip);
    }

    // ── 形态 ──
    const formSec = contentEl.createDiv({ cls: "bw-share-section" });
    formSec.createDiv({ cls: "bw-share-label", text: "内容形态" });
    const formRow = formSec.createDiv({ cls: "bw-share-chips" });
    for (const f of FORM_ORDER) {
      const chip = formRow.createEl("button", {
        cls: "bw-share-chip",
        text: FORM_LABELS[f],
        attr: { "data-form": f },
      });
      chip.addEventListener("click", () => {
        this.form = f;
        this.syncChips();
        void this.refresh();
      });
      this.formChips.set(f, chip);
    }

    // ── 预览 ──
    const previewWrap = contentEl.createDiv({ cls: "bw-share-preview" });
    const img = previewWrap.createEl("img", { cls: "bw-share-preview-img" });
    img.alt = "分享卡片预览";
    const note = previewWrap.createDiv({ cls: "bw-share-preview-note", text: "生成中…" });
    this.previewImg = img;
    this.previewNote = note;

    // ── 操作 ──
    const actions = contentEl.createDiv({ cls: "bw-share-actions" });
    const dlBtn = actions.createEl("button", {
      cls: "bw-share-btn bw-share-btn--primary",
      text: "下载",
    });
    dlBtn.addEventListener("click", () => this.download());
    this.downloadBtn = dlBtn;

    const cpBtn = actions.createEl("button", { cls: "bw-share-btn", text: "复制" });
    cpBtn.addEventListener("click", () => { void this.copy(); });
    this.copyBtn = cpBtn;

    this.syncChips();
    void this.refresh();
  }

  /** 同步 chip 高亮态 */
  private syncChips(): void {
    this.sizeChips.forEach((el, s) => el.classList.toggle("is-active", s === this.size));
    this.formChips.forEach((el, f) => el.classList.toggle("is-active", f === this.form));
  }

  /** 按当前选择重新生成预览 */
  private async refresh(): Promise<void> {
    if (!this.previewNote) return;
    this.previewNote.setText("生成中…");
    try {
      const blobs = await renderShareCards(this.article, {
        size: this.size,
        form: this.form,
        series: this.series,
        selectedText: this.selectedText,
      });
      this.blobs = blobs;
      if (this.previewUrl) {
        URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = null;
      }
      const first = blobs[0];
      this.previewUrl = URL.createObjectURL(first);
      if (this.previewImg) this.previewImg.src = this.previewUrl;
      const label =
        this.form === "series"
          ? `下载（${blobs.length} 张）`
          : `下载（${SIZE_LABELS[this.size]} · ${FORM_LABELS[this.form]}）`;
      this.downloadBtn?.setText(label);
      this.copyBtn?.setText(blobs.length > 1 ? "复制首张" : "复制");
      this.previewNote.setText(
        blobs.length > 1
          ? `共 ${blobs.length} 张卡片，将依次下载`
          : this.selectedText && this.form === "quote"
            ? `选中文字 · ${SIZE_LABELS[this.size]} · ${FORM_LABELS[this.form]}`
            : `${SIZE_LABELS[this.size]} · ${FORM_LABELS[this.form]}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "未知错误";
      this.previewNote.setText(`生成失败：${msg}`);
    }
  }

  /** 下载全部卡片 */
  private download(): void {
    if (this.blobs.length === 0) return;
    const tag = `${this.form}-${this.size}`;
    this.blobs.forEach((blob, i) => {
      const url = URL.createObjectURL(blob);
      const a = createEl("a");
      a.href = url;
      const suffix = this.blobs.length > 1 ? `-${i + 1}` : "";
      a.download = `竹杖芒鞋-${safeFileName(this.article.title)}${suffix}-${tag}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    new Notice(this.blobs.length > 1 ? `已开始下载 ${this.blobs.length} 张卡片` : "分享图已下载");
  }

  /** 复制（首张）到剪贴板 */
  private async copy(): Promise<void> {
    if (this.blobs.length === 0) return;
    const blob = this.blobs[0];
    let copied = false;
    try {
      const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (CI && navigator.clipboard && "write" in navigator.clipboard) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- navigator.clipboard 是浏览器标准 API
        await navigator.clipboard.write([new CI({ "image/png": blob })]);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (this.blobs.length > 1) {
      new Notice(copied ? "已复制第一张卡片到剪贴板" : "复制失败，请改用下载");
    } else {
      new Notice(copied ? "分享图已复制到剪贴板" : "复制失败，请改用下载");
    }
  }

  onClose(): void {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
    this.contentEl.empty();
  }
}
