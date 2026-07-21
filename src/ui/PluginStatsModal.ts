/* ────────────── 插件态势详情弹窗 ────────────── */
/*
 * 表格展示每个被跟踪插件的：当前下载量 / 距上次 / 7日 / 30日 增量 / 全站排名，
 * 并给出「在社区查看 ↗」跳转。顶部刷新按钮强制重新拉取。
 */

import { App, Modal } from "obsidian";
import type { PluginStatEntry } from "../types";
import type { PluginStatsResult, PluginStatsService } from "../services/PluginStatsService";
import { COMMUNITY_PLUGIN_PAGE } from "../constants";
import { svgIcon } from "./icons";

/** 千分位格式化 */
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** 带正负号的数字（用于增量） */
function signed(n: number): string {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `-${fmt(Math.abs(n))}`;
  return "0";
}

/** 距上次快照的增量 */
function deltaSincePrev(e: PluginStatEntry): number {
  if (!e.found || e.history.length < 2) return 0;
  const last = e.history[e.history.length - 1];
  const prev = e.history[e.history.length - 2];
  return last.downloads - prev.downloads;
}

/** 距 N 天前的增量（用历史快照里最接近 target 的较早快照） */
function deltaSinceDays(e: PluginStatEntry, days: number): number {
  if (!e.found || e.history.length === 0) return 0;
  const target = Date.now() - days * 24 * 60 * 60 * 1000;
  let chosen = e.history[0];
  for (const s of e.history) {
    if (s.ts <= target) chosen = s;
    else break;
  }
  return e.downloads - chosen.downloads;
}

export class PluginStatsModal extends Modal {
  private loading = false;
  private root: HTMLElement | null = null;

  constructor(
    app: App,
    private service: PluginStatsService,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("bw-pluginstats-modal-shell");
    contentEl.empty();
    this.root = contentEl.createDiv({ cls: "bw-pluginstats-modal" });
    void this.load();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    const root = this.root;
    if (!root) return;
    this.loading = true;
    this.renderLoading(root);
    let result: PluginStatsResult;
    try {
      result = await this.service.refresh(true);
    } catch (e) {
      this.loading = false;
      this.renderError(root, e instanceof Error ? e.message : "未知错误");
      return;
    }
    this.loading = false;
    this.render(root, result);
  }

  private renderLoading(root: HTMLElement): void {
    root.empty();
    const head = root.createDiv({ cls: "bw-pluginstats-head" });
    const t = head.createDiv({ cls: "bw-pluginstats-title" });
    svgIcon(t, "chart");
    t.append(" 插件态势");
    root.createDiv({ cls: "bw-pluginstats-loading", text: "正在拉取社区数据…" });
  }

  private renderError(root: HTMLElement, msg: string): void {
    root.empty();
    const head = root.createDiv({ cls: "bw-pluginstats-head" });
    const t = head.createDiv({ cls: "bw-pluginstats-title" });
    svgIcon(t, "chart");
    t.append(" 插件态势");
    const empty = root.createDiv({ cls: "bw-pluginstats-empty" });
    empty.createEl("p", { text: `拉取失败：${msg}` });
    empty.createEl("p", {
      cls: "bw-pluginstats-empty-sub",
      text: "请检查网络后重试，或在插件设置中确认「作者手柄」。",
    });
  }

  private render(root: HTMLElement, result: PluginStatsResult): void {
    root.empty();

    // ── 头部 ──
    const head = root.createDiv({ cls: "bw-pluginstats-head" });
    const titleBox = head.createDiv({ cls: "bw-pluginstats-titlebox" });
    const t = titleBox.createDiv({ cls: "bw-pluginstats-title" });
    svgIcon(t, "chart");
    t.append(" 插件态势");
    const updated = new Date(result.lastFetch);
    const hh = String(updated.getHours()).padStart(2, "0");
    const mm = String(updated.getMinutes()).padStart(2, "0");
    titleBox.createDiv({
      cls: "bw-pluginstats-sub",
      text: `更新于 ${hh}:${mm}`,
    });
    const refresh = head.createEl("button", { cls: "bw-pluginstats-refresh" });
    svgIcon(refresh, "refresh");
    refresh.createSpan({ text: "刷新" });
    refresh.addEventListener("click", () => {
      if (this.loading) return;
      void this.load();
    });

    if (result.stale) {
      root.createDiv({
        cls: "bw-pluginstats-banner",
        text: "离线或拉取失败，当前显示为上次缓存数据",
      });
    }

    const entries = result.entries;
    if (entries.length === 0) {
      const empty = root.createDiv({ cls: "bw-pluginstats-empty" });
      empty.createEl("p", { text: "暂无跟踪的插件。" });
      empty.createEl("p", {
        cls: "bw-pluginstats-empty-sub",
        text: "可在插件设置中配置「作者手柄」（自动发现你的插件）或「额外跟踪插件」。",
      });
      return;
    }

    // ── 表格 ──
    const table = root.createEl("table", { cls: "bw-pluginstats-table" });
    const thead = table.createEl("thead");
    const htr = thead.createEl("tr");
    ["插件", "下载量", "距上次", "7日", "30日", "全站排名", "社区"].forEach(
      (h) => htr.createEl("th", { text: h }),
    );
    const tbody = table.createEl("tbody");
    for (const e of entries) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { cls: "bw-ps-name", text: e.id });
      tr.createEl("td", {
        cls: "bw-ps-num",
        text: e.found ? fmt(e.downloads) : "未收录",
      });
      tr.createEl("td", {
        cls: "bw-ps-num",
        text: e.found ? signed(deltaSincePrev(e)) : "—",
      });
      tr.createEl("td", {
        cls: "bw-ps-num",
        text: e.found ? signed(deltaSinceDays(e, 7)) : "—",
      });
      tr.createEl("td", {
        cls: "bw-ps-num",
        text: e.found ? signed(deltaSinceDays(e, 30)) : "—",
      });
      tr.createEl("td", {
        cls: "bw-ps-num",
        text: e.found && e.rank > 0 ? `#${fmt(e.rank)} / ${fmt(e.total)}` : "—",
      });
      const linkTd = tr.createEl("td", { cls: "bw-ps-link-td" });
      const link = linkTd.createEl("a", {
        text: "查看 ↗",
        href: `${COMMUNITY_PLUGIN_PAGE}${e.id}`,
        cls: "bw-ps-link",
      });
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      link.setAttribute("aria-label", "在社区查看");
    }
  }
}
