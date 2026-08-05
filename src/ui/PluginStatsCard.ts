/* ────────────── 插件态势极简卡组件 ────────────── */
import type { App } from "obsidian";
import { PLUGIN_CN_NAMES, THEME_CN_NAMES } from "../constants";
import { PluginStatsModal } from "./PluginStatsModal";
import type { PluginStatEntry } from "../types";
import type { PluginStatsResult, PluginStatsService } from "../services/PluginStatsService";
import { svgIcon } from "./icons";

// Obsidian 内部 API：app.setting 在官方类型定义中未暴露，但运行时存在，
// 用于打开社区插件设置页并自动填入搜索词。此处补充类型声明以通过 typecheck。
declare module "obsidian" {
  interface App {
    setting: {
      open(): void;
      openTabById(id: string): unknown;
      containerEl: HTMLElement;
    };
  }
}

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
      label.append(" 黑曜石作品");
      const caret = left.createSpan({ cls: "bws-pluginstats-caret", attr: { "aria-hidden": "true" } });

      // 点击头部：折叠/展开为单行
      head.addEventListener("click", (e) => {
        e.stopPropagation();
        card.classList.toggle("is-collapsed");
        caret.setAttribute(
          "aria-label",
          card.classList.contains("is-collapsed") ? "展开黑曜石作品" : "折叠黑曜石作品",
        );
      });

      const actions = head.createDiv({ cls: "bws-pluginstats-actions" });

      const refresh = actions.createEl("button", {
        cls: "bws-pluginstats-refresh",
        attr: { "aria-label": "刷新黑曜石作品", title: "刷新" },
      });
      svgIcon(refresh, "refresh");
      refresh.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.loading || !this.service) return;
        void this.refresh(true);
      });

      const detail = actions.createEl("button", {
        cls: "bws-pluginstats-detail",
        attr: { "aria-label": "查看黑曜石作品详情", title: "详情" },
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

      // 移动端（Obsidian body.is-mobile）默认折叠成单行标题，节省列表空间
      if (document.body.classList.contains("is-mobile")) {
        card.classList.add("is-collapsed");
      }

      void this.refresh();
    } catch (e) {
      console.error("[bamboo-walking] 黑曜石作品卡片渲染失败：", e);
      const errCard = parent.createDiv({ cls: "bws-pluginstats bws-pluginstats-err" });
      errCard.setText("黑曜石作品加载失败，详见控制台");
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
      const isTheme = e.kind === "theme";
      const row = body.createDiv({
        cls:
          "bws-pluginstats-row" +
          (e.found ? " is-clickable" : "") +
          (isTheme ? " is-theme" : ""),
      });
      const nameEl = row.createDiv({
        cls: "bws-pluginstats-name",
      });
      nameEl.append(
        isTheme ? THEME_CN_NAMES[e.id] ?? e.name ?? e.id
                : PLUGIN_CN_NAMES[e.id] ?? e.name ?? e.id,
      );
      if (e.found) {
        row.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (!this.service) return;
          this.openMarket(e);
        });
      }
      const right = row.createDiv({ cls: "bws-pluginstats-right" });
      if (isTheme) {
        // 主题：下载量 + 增量（与插件同口径）
        right.createSpan({
          cls: "bws-pluginstats-dl",
          text: e.found && e.downloads > 0 ? this.fmtInt(e.downloads) : "已收录",
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
        }
        if (e.modes && e.modes.length > 0) {
          right.createSpan({
            cls: "bws-pluginstats-modes",
            text: e.modes.map((m) => (m === "dark" ? "暗" : "亮")).join("/"),
          });
        }
      } else {
        // 插件：下载量 + 增量
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
    }
    if (result.stale) {
      body.createDiv({ cls: "bws-pluginstats-stale", text: "（缓存·离线）" });
    }
  }

  /** 打开市场（插件→社区插件设置页；主题→社区主题网页） */
  private openMarket(e: PluginStatEntry): void {
    if (e.kind === "theme") {
      // 主题：打开社区主题网页详情页（用户指定的链接）
      window.open("https://community.obsidian.md/themes/bamboo-china", "_blank");
      return;
    }
    // 插件：打开社区插件设置页并自动搜索填入插件 ID
    this.app.setting.open();
    this.app.setting.openTabById("community-plugins");
    window.setTimeout(() => {
      const input = this.app.setting.containerEl.querySelector<HTMLInputElement>(
        'input[type="text"][placeholder*="搜索"], input[type="text"][placeholder*="Search"]',
      );
      if (input) {
        input.value = e.id;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
    }, 300);
  }

  /** 千分位格式化 */
  private fmtInt(n: number): string {
    return n.toLocaleString("en-US");
  }
}
