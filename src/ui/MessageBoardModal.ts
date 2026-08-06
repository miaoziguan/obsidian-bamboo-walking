/* ────────────── 留言板弹窗 ────────────── */
/*
 * 展示内容仓库 GitHub Issues 上的留言（列表），读者可在此浏览；
 * 想发言则点「去 GitHub 留言」跳转 Issues 页（需要 GitHub 账号）。
 */

import { App, Modal, Notice, setIcon } from "obsidian";
import { MessageBoardService, type MessageBoardEntry } from "../services/MessageBoardService";
import { MESSAGE_BOARD_URL } from "../constants";

export class MessageBoardModal extends Modal {
  private service = new MessageBoardService();
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private entries: MessageBoardEntry[] = [];

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("bw-board-modal");
    contentEl.empty();

    // ── 头部：标题 + 去 GitHub 留言 ──
    const head = contentEl.createDiv({ cls: "bw-board-head" });
    const headLeft = head.createDiv({ cls: "bw-board-head-left" });
    const titleRow = headLeft.createDiv({ cls: "bw-board-title-row" });
    const icon = titleRow.createSpan({ cls: "bw-board-title-ico" });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- setIcon 是 Obsidian 官方 API
    setIcon(icon, "message-square");
    titleRow.createDiv({ cls: "bw-board-title", text: "留言板" });
    this.statusEl = headLeft.createDiv({ cls: "bw-board-status", text: "加载中…" });

    const actions = head.createDiv({ cls: "bw-board-actions" });
    const refresh = actions.createEl("button", {
      cls: "bw-board-btn bw-board-refresh",
      text: "刷新",
      attr: { "aria-label": "刷新留言", title: "刷新留言" },
    });
    refresh.addEventListener("click", () => void this.load(true));
    const goGithub = actions.createEl("button", {
      cls: "bw-board-btn bw-board-primary",
      text: "去 GitHub 留言",
      attr: { "aria-label": "在 GitHub 留言", title: "在 GitHub 留言" },
    });
    goGithub.addEventListener("click", () => {
      // 读者主动点击：打开仓库 Issues 页（本插件内容，无剪贴板读取）
      window.open(MESSAGE_BOARD_URL, "_blank", "noopener,noreferrer");
    });

    // ── 留言列表 ──
    this.listEl = contentEl.createDiv({ cls: "bw-board-list" });
    void this.load(false);
  }

  private async load(force: boolean): Promise<void> {
    if (!this.listEl) return;
    this.statusEl?.setText("加载中…");
    this.listEl.empty();

    const result = await this.service.fetchMessages(force);
    this.entries = result.entries;

    if (result.stale) {
      new Notice("留言加载失败，显示缓存内容");
    }

    if (this.entries.length === 0) {
      this.statusEl?.setText(result.stale ? "暂时无法连接" : "还没有留言");
      const empty = this.listEl.createDiv({ cls: "bw-board-empty" });
      empty.createDiv({ cls: "bw-board-empty-title", text: "这里还很安静" });
      empty.createDiv({ cls: "bw-board-empty-sub", text: "点右上角「去 GitHub 留言」，成为第一个留言的人。" });
      return;
    }

    this.statusEl?.setText(`${this.entries.length} 条留言${result.stale ? "（缓存）" : ""}`);
    for (const entry of this.entries) {
      this.renderEntry(entry);
    }
  }

  private renderEntry(entry: MessageBoardEntry): void {
    if (!this.listEl) return;
    const card = this.listEl.createDiv({ cls: "bw-board-card" });

    // 头行：头像 + 作者 + 时间
    const meta = card.createDiv({ cls: "bw-board-meta" });
    const avatar = meta.createEl("img", {
      cls: "bw-board-avatar",
      attr: { alt: "", loading: "lazy" },
    });
    if (entry.authorAvatar) avatar.src = entry.authorAvatar;
    const nameTime = meta.createDiv({ cls: "bw-board-name-time" });
    nameTime.createDiv({ cls: "bw-board-author", text: entry.author });
    nameTime.createDiv({ cls: "bw-board-time", text: this.formatTime(entry.createdAt) });

    // 标题
    if (entry.title) {
      card.createDiv({ cls: "bw-board-card-title", text: entry.title });
    }

    // 正文（多行省略，点击整卡跳转 GitHub 看完整）
    if (entry.body) {
      const body = card.createDiv({ cls: "bw-board-card-body" });
      const lines = entry.body.split("\n").filter((l) => l.trim());
      body.createDiv({ text: lines.join("\n") });
    }

    card.addEventListener("click", () => {
      window.open(entry.url, "_blank", "noopener,noreferrer");
    });
  }

  private formatTime(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
