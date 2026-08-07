/* ────────────── 主区：全局留言板视图 ────────────── */
/*
 * 独立的主区页面（非弹窗），展示内容仓库 GitHub Issues 上的「全局留言」
 * （标签「留言板」）。读者在此浏览全部留言，并可用自己的 GitHub token 直接发布。
 * 文章评论（标签「评论」）在文章阅读区正文末尾展示，不在此页。
 */

import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { VIEW_TYPE_MESSAGE_BOARD } from "../types";
import { MESSAGE_BOARD_LABEL, MESSAGE_BOARD_URL } from "../constants";
import { MessageBoardService, type MessageBoardEntry } from "../services/MessageBoardService";

export class MessageBoardView extends ItemView {
  private service: MessageBoardService;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private loading = false;

  constructor(leaf: WorkspaceLeaf, service?: MessageBoardService) {
    super(leaf);
    this.service = service ?? new MessageBoardService();
  }

  getViewType(): string {
    return VIEW_TYPE_MESSAGE_BOARD;
  }

  getDisplayText(): string {
    return "留言板";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bw-board-view");

    // ── 头部：标题 + 刷新 + 写留言 + GitHub ──
    const head = contentEl.createDiv({ cls: "bw-board-head" });
    const headLeft = head.createDiv({ cls: "bw-board-head-left" });
    const titleRow = headLeft.createDiv({ cls: "bw-board-title-row" });
    const icon = titleRow.createSpan({ cls: "bw-board-title-ico" });
    setIcon(icon, "message-square");
    titleRow.createDiv({ cls: "bw-board-title", text: "留言板" });
    this.statusEl = headLeft.createDiv({ cls: "bw-board-status", text: "加载中…" });

    const actions = head.createDiv({ cls: "bw-board-actions" });
    const refresh = actions.createEl("button", {
      cls: "bw-board-btn bw-board-refresh",
      text: "刷新",
      attr: { "aria-label": "刷新留言", title: "刷新留言" },
    });
    refresh.addEventListener("click", () => void this.loadBoard(true));
    const goGithub = actions.createEl("button", {
      cls: "bw-board-btn bw-board-secondary",
      text: "GitHub",
      attr: { "aria-label": "在 GitHub 查看留言", title: "在 GitHub 查看留言" },
    });
    goGithub.addEventListener("click", () => {
      window.open(MESSAGE_BOARD_URL, "_blank", "noopener,noreferrer");
    });

    // ── 留言列表（上方，可滚动） ──
    this.listEl = contentEl.createDiv({ cls: "bw-board-list" });
    void this.loadBoard(false);

    // ── 写留言区（底部常显） ──
    this.buildCompose(contentEl);
  }

  /** 构建写留言区：token 输入 + 标题 + 正文 + 发布（底部常显） */
  private buildCompose(contentEl: HTMLElement): void {
    const wrap = contentEl.createDiv({ cls: "bw-board-compose" });

    const tokenRow = wrap.createDiv({ cls: "bw-board-field" });
    tokenRow.createDiv({ cls: "bw-board-field-label", text: "GitHub Token" });
    const tokenInput = tokenRow.createEl("input", {
      type: "password",
      cls: "bw-board-input",
      attr: { placeholder: "你的 GitHub Personal Access Token（public_repo 权限）" },
    });
    tokenInput.value = this.service.getToken();
    wrap.createDiv({ cls: "bw-board-tip", text: "Token 仅保存在本机，用于以你的身份创建留言。" });

    const titleRow = wrap.createDiv({ cls: "bw-board-field" });
    titleRow.createDiv({ cls: "bw-board-field-label", text: "标题" });
    const titleInput = titleRow.createEl("input", {
      type: "text",
      cls: "bw-board-input",
      attr: { placeholder: "留言标题" },
    });

    const bodyRow = wrap.createDiv({ cls: "bw-board-field" });
    bodyRow.createDiv({ cls: "bw-board-field-label", text: "内容" });
    const bodyInput = wrap.createEl("textarea", {
      cls: "bw-board-input bw-board-textarea",
      attr: { placeholder: "留言内容（选填）", rows: "4" },
    });

    const submitRow = wrap.createDiv({ cls: "bw-board-submit-row" });
    const submit = submitRow.createEl("button", {
      cls: "bw-board-btn bw-board-primary",
      text: "发布留言",
    });

    let submitting = false;
    submit.addEventListener("click", () => {
      void (async () => {
        if (submitting) return;
        const token = tokenInput.value.trim();
        if (token) this.service.setToken(token);
        const title = titleInput.value.trim();
        if (!title) {
          new Notice("请填写留言标题");
          return;
        }
        submitting = true;
        submit.setText("发布中…");
        try {
          await this.service.createMessage(title, bodyInput.value);
          new Notice("留言已发布");
          titleInput.value = "";
          bodyInput.value = "";
          void this.loadBoard(true);
        } catch (e) {
          new Notice((e as Error).message ?? "发布失败");
        } finally {
          submitting = false;
          submit.setText("发布留言");
        }
      })();
    });
  }

  private async loadBoard(force: boolean): Promise<void> {
    if (this.loading || !this.listEl) return;
    this.loading = true;
    this.statusEl?.setText("加载中…");
    this.listEl.empty();

    const result = await this.service.fetchMessages(MESSAGE_BOARD_LABEL, force);
    this.loading = false;

    if (result.stale) new Notice("留言加载失败，显示缓存内容");

    if (result.entries.length === 0) {
      this.statusEl?.setText(result.stale ? "暂时无法连接" : "还没有留言");
      const empty = this.listEl.createDiv({ cls: "bw-board-empty" });
      empty.createDiv({ cls: "bw-board-empty-title", text: "这里还很安静" });
      empty.createDiv({ cls: "bw-board-empty-sub", text: "点右上角「写留言」或「GitHub」，留下第一条留言。" });
      return;
    }

    this.statusEl?.setText(`${result.entries.length} 条留言${result.stale ? "（缓存）" : ""}`);
    for (const entry of result.entries) {
      this.renderEntry(entry);
    }
  }

  private renderEntry(entry: MessageBoardEntry): void {
    if (!this.listEl) return;
    const card = this.listEl.createDiv({ cls: "bw-board-card" });

    const meta = card.createDiv({ cls: "bw-board-meta" });
    const avatar = meta.createEl("img", {
      cls: "bw-board-avatar",
      attr: { alt: "", loading: "lazy" },
    });
    if (entry.authorAvatar) avatar.src = entry.authorAvatar;
    const nameTime = meta.createDiv({ cls: "bw-board-name-time" });
    nameTime.createDiv({ cls: "bw-board-author", text: entry.author });
    nameTime.createDiv({ cls: "bw-board-time", text: this.formatTime(entry.createdAt) });

    if (entry.title) card.createDiv({ cls: "bw-board-card-title", text: entry.title });
    if (entry.body) {
      card.createDiv({ cls: "bw-board-card-body", text: entry.body });
    }

    card.addEventListener("click", () => {
      window.open(entry.url, "_blank", "noopener,noreferrer");
    });
  }

  private formatTime(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
