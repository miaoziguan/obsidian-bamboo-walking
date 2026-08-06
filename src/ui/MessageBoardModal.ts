/* ────────────── 留言板弹窗 ────────────── */
/*
 * 展示内容仓库 GitHub Issues 上的留言（列表），读者可在此浏览；
 * 想发言则点「去 GitHub 留言」跳转 Issues 页（需要 GitHub 账号）。
 */

import { App, Modal, Notice, setIcon } from "obsidian";
import { MessageBoardService, type MessageBoardEntry } from "../services/MessageBoardService";
import { MESSAGE_BOARD_URL } from "../constants";

export class MessageBoardModal extends Modal {
  private service: MessageBoardService;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private entries: MessageBoardEntry[] = [];
  private tokenEl: HTMLInputElement | null = null;
  private composeWrap: HTMLElement | null = null;

  constructor(app: App, service?: MessageBoardService) {
    super(app);
    this.service = service ?? new MessageBoardService();
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
    const writeBtn = actions.createEl("button", {
      cls: "bw-board-btn bw-board-primary",
      text: "写留言",
      attr: { "aria-label": "写留言", title: "写留言" },
    });
    writeBtn.addEventListener("click", () => {
      const wasHidden = this.composeWrap?.classList.contains("bw-hidden") ?? true;
      this.composeWrap?.toggleClass("bw-hidden", !wasHidden);
      if (wasHidden) {
        this.tokenEl?.focus();
      }
    });
    const refresh = actions.createEl("button", {
      cls: "bw-board-btn bw-board-refresh",
      text: "刷新",
      attr: { "aria-label": "刷新留言", title: "刷新留言" },
    });
    refresh.addEventListener("click", () => void this.load(true));
    const goGithub = actions.createEl("button", {
      cls: "bw-board-btn bw-board-secondary",
      text: "GitHub",
      attr: { "aria-label": "在 GitHub 留言", title: "在 GitHub 留言" },
    });
    goGithub.addEventListener("click", () => {
      window.open(MESSAGE_BOARD_URL, "_blank", "noopener,noreferrer");
    });

    // ── 写留言区（默认收起） ──
    this.buildCompose(contentEl);

    // ── 留言列表 ──
    this.listEl = contentEl.createDiv({ cls: "bw-board-list" });
    void this.load(false);
  }

  /** 构建写留言区：token 输入 + 标题 + 正文 + 提交 */
  private buildCompose(contentEl: HTMLElement): void {
    const wrap = contentEl.createDiv({ cls: "bw-board-compose bw-hidden" });
    this.composeWrap = wrap;

    // Token 输入（读者自己的 GitHub PAT，需 public_repo 权限）
    const tokenRow = wrap.createDiv({ cls: "bw-board-field" });
    tokenRow.createDiv({ cls: "bw-board-field-label", text: "GitHub Token" });
    const tokenInput = tokenRow.createEl("input", {
      type: "password",
      cls: "bw-board-input",
      attr: { placeholder: "输入你的 GitHub Personal Access Token（public_repo 权限）" },
    });
    tokenInput.value = this.service.getToken();
    this.tokenEl = tokenInput;
    // Token 仅保存在本机，用于以你的身份创建留言
    wrap.createDiv({ cls: "bw-board-tip", text: "Token 仅保存在本机，用于以你的身份创建留言。" });

    // 标题
    const titleRow = wrap.createDiv({ cls: "bw-board-field" });
    titleRow.createDiv({ cls: "bw-board-field-label", text: "标题" });
    const titleInput = titleRow.createEl("input", {
      type: "text",
      cls: "bw-board-input",
      attr: { placeholder: "留言标题" },
    });

    // 正文
    const bodyRow = wrap.createDiv({ cls: "bw-board-field" });
    bodyRow.createDiv({ cls: "bw-board-field-label", text: "内容" });
    const bodyInput = wrap.createEl("textarea", {
      cls: "bw-board-input bw-board-textarea",
      attr: { placeholder: "留言内容（选填）", rows: "3" },
    });

    const submitRow = wrap.createDiv({ cls: "bw-board-submit-row" });
    const submit = submitRow.createEl("button", {
      cls: "bw-board-btn bw-board-primary",
      text: "发布留言",
    });

    let submitting = false;
    submit.addEventListener("click", async () => {
      if (submitting) return;
      // 保存 token（有值才存，避免清空）
      const token = tokenInput.value.trim();
      if (token) {
        this.service.setToken(token);
      }
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
        wrap.addClass("bw-hidden");
        titleInput.value = "";
        bodyInput.value = "";
        void this.load(true);
      } catch (e) {
        new Notice((e as Error).message ?? "发布失败");
      } finally {
        submitting = false;
        submit.setText("发布留言");
      }
    });
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
