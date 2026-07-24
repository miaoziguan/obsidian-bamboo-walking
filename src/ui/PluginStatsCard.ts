/* ────────────── 插件态势极简卡组件 ────────────── */
import type { App } from "obsidian";
import { PLUGIN_CN_NAMES } from "../constants";
import { PluginStatsModal } from "./PluginStatsModal";
import type { PluginStatsResult, PluginStatsService } from "../services/PluginStatsService";
import { svgIcon } from "./icons";

/** 左栏插件态势卡：头部(标题+刷新) + 列表(插件名/下载量/+N 增量)，点击打开详情弹窗 */
export class PluginStatsCard {
  private bodyEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private loading = false;
  private service: PluginStatsService | null = null;
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /** 注入插件态势服务 */
  setService(svc: PluginStatsService): void {
    this.service = svc;
    // 若卡片已渲染（服务晚于首次渲染注入），补一次刷新
    if (this.cardEl) void this.refresh();
  }

  /** 创建或复用卡片 DOM */
  render(parent: HTMLElement): void {
    // 幂等：重复渲染时复用 DOM，仅刷新数据，杜绝重复创建
    const existing = parent.querySelector<HTMLElement>(".bws-pluginstats");
    if (existing) {
      this.cardEl = existing;
      this.bodyEl = existing.querySelector(".bws-pluginstats-body");
      if (this.service) void this.refresh();
      return;
    }
    // 增强功能：整体兜底，任何异常都不得阻断作者卡与主侧栏渲染
    try {
      const card = parent.createDiv({ cls: "bws-pluginstats" });
      this.cardEl = card;

      const head = card.createDiv({ cls: "bws-pluginstats-head" });
      const left = head.createDiv({ cls: "bws-pluginstats-left" });
      const label = left.createDiv({ cls: "bws-pluginstats-label" });
      svgIcon(label, "chart", "bws-pluginstats-ico");
      label.append(" 插件态势");
      const caret = left.createSpan({ cls: "bws-pluginstats-caret", attr: { "aria-hidden": "true" } });

      // 点击头部：折叠/展开为单行
      head.addEventListener("click", (e) => {
        e.stopPropagation();
        card.classList.toggle("is-collapsed");
        caret.setAttribute(
          "aria-label",
          card.classList.contains("is-collapsed") ? "展开插件态势" : "折叠插件态势",
        );
      });

      const actions = head.createDiv({ cls: "bws-pluginstats-actions" });

      const refresh = actions.createEl("button", {
        cls: "bws-pluginstats-refresh",
        attr: { "aria-label": "刷新插件态势", title: "刷新" },
      });
      svgIcon(refresh, "refresh");
      refresh.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.loading || !this.service) return;
        void this.refresh(true);
      });

      const detail = actions.createEl("button", {
        cls: "bws-pluginstats-detail",
        attr: { "aria-label": "查看插件态势详情", title: "详情" },
      });
      svgIcon(detail, "pulse");
      detail.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!this.service) return;
        new PluginStatsModal(this.app, this.service).open();
      });

      this.bodyEl = card.createDiv({
        cls: "bws-pluginstats-body",
        text: "载入中…",
      });

      // 整卡点击：仅在加载失败（灰卡）时重试；行级点击负责跳转市场
      card.addEventListener("click", () => {
        if (this.cardEl?.classList.contains("is-disabled")) {
          if (!this.loading) void this.refresh(true);
        }
      });

      void this.refresh();
    } catch (e) {
      console.error("[bamboo-walking] 插件态势卡片渲染失败：", e);
      const errCard = parent.createDiv({ cls: "bws-pluginstats bws-pluginstats-err" });
      errCard.setText("插件态势加载失败，详见控制台");
    }
  }

  /** 拉取并刷新极简卡（本地缓存秒开，过期/首次则后台拉取） */
  async refresh(force = false): Promise<void> {
    const body = this.bodyEl;
    const card = this.cardEl;
    if (!body || !card || !this.service) return;
    this.loading = true;
    body.empty();
    body.setText("载入中…");
    let result: PluginStatsResult;
    try {
      result = await this.service.refresh(force);
    } catch {
      this.loading = false;
      card.classList.add("is-disabled");
      body.empty();
      body.setText("加载失败，点此重试");
      return;
    }
    this.loading = false;
    this.renderBody(result);
  }

  /** 把一次刷新结果渲染到极简卡列表 */
  private renderBody(result: PluginStatsResult): void {
    const body = this.bodyEl;
    const card = this.cardEl;
    if (!body || !card) return;
    card.classList.remove("is-disabled");
    const entries = result.entries;
    if (entries.length === 0) {
      body.empty();
      body.setText("暂无数据（点刷新）");
      return;
    }
    body.empty();
    for (const e of entries) {
      const row = body.createDiv({
        cls: "bws-pluginstats-row" + (e.found ? " is-clickable" : ""),
      });
      row.createDiv({
        cls: "bws-pluginstats-name",
        text: PLUGIN_CN_NAMES[e.id] ?? e.name ?? e.id,
      });
      if (e.found) {
        row.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (!this.service) return;
          this.openMarket(e.id);
        });
      }
      const right = row.createDiv({ cls: "bws-pluginstats-right" });
      right.createSpan({
        cls: "bws-pluginstats-dl",
        text: e.found ? this.fmtInt(e.downloads) : "—",
      });
      if (e.found && e.history.length >= 2) {
        const delta =
          e.history[e.history.length - 1].downloads -
          e.history[e.history.length - 2].downloads;
        if (delta > 0) {
          right.createSpan({
            cls: "bws-pluginstats-delta",
            text: `+${this.fmtInt(delta)}`,
          });
        }
      } else if (!e.found) {
        right.createSpan({ cls: "bws-pluginstats-unfound", text: "未收录" });
      }
    }
    if (result.stale) {
      body.createDiv({ cls: "bws-pluginstats-stale", text: "（缓存·离线）" });
    }
  }

  /** 应用内直达插件市场详情页，失败回退网页市场页 */
  private openMarket(id: string): void {
    const enc = encodeURIComponent(id);
    const appUri = `obsidian://show-plugin?id=${enc}`;
    const webUrl = `https://community.obsidian.md/plugins/${enc}`;
    const w = window as unknown as { open?: (p: string) => Promise<unknown> | void };
    if (typeof w.open === "function") {
      const r = w.open(appUri);
      if (r && typeof r.catch === "function") {
        r.catch(() => {
          window.location.href = webUrl;
        });
        return;
      }
      return;
    }
    window.location.href = webUrl;
  }

  /** 千分位格式化 */
  private fmtInt(n: number): string {
    return n.toLocaleString("en-US");
  }
}
