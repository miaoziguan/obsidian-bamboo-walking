/* ────────────── 竹林系列联动卡组件 ────────────── */
/*
 * 左栏「竹林系列」卡：把同作者（羽鳞君·喵字馆）出品的四个 Obsidian 插件
 * 串成一条可互达的产品链——每个插件一行，点击即可一键打开（已装）或安装（未装）。
 *
 * 联动逻辑全部经 src/services/MarketBridge.ts 实现，本组件只负责渲染与交互，
 * 任何异常都被吞掉，绝不阻断主侧栏（作者卡 / 战略复盘 / 黑曜石作品）的渲染。
 */
import type { App } from "obsidian";
import { svgIcon } from "./icons";
import {
  BAMBOO_SERIES,
  isPluginEnabled,
  openBambooSeriesItem,
  openChineseMarket,
} from "../services/MarketBridge";

/** 左栏竹林系列卡：头部(标题+前往市场) + 插件列表（已装/未装/当前），点击联动 */
export class BambooSeriesCard {
  private cardEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /** 创建或复用卡片 DOM（幂等） */
  render(parent: HTMLElement): void {
    const existing = parent.querySelector<HTMLElement>(".bws-bambooseries");
    if (existing) {
      this.cardEl = existing;
      this.bodyEl = existing.querySelector(".bws-bambooseries-body");
      void this.refresh();
      return;
    }
    try {
      const card = parent.createDiv({ cls: "bws-bambooseries" });
      this.cardEl = card;

      const head = card.createDiv({ cls: "bws-bambooseries-head" });
      const left = head.createDiv({ cls: "bws-bambooseries-left" });
      const label = left.createDiv({ cls: "bws-bambooseries-label" });
      svgIcon(label, "chart", "bws-bambooseries-ico");
      label.append(" 竹林系列");
      left.createSpan({ cls: "bws-bambooseries-caret", attr: { "aria-hidden": "true" } });

      // 点击头部：折叠/展开为单行
      head.addEventListener("click", (e) => {
        e.stopPropagation();
        card.classList.toggle("is-collapsed");
      });

      // 头部右侧动作：前往中文区插件市场（chinese-plugin-market）
      const actions = head.createDiv({ cls: "bws-bambooseries-actions" });
      const market = actions.createEl("button", {
        cls: "bws-bambooseries-market",
        attr: { "aria-label": "打开中文区插件市场", title: "前往市场" },
      });
      svgIcon(market, "pulse");
      market.addEventListener("click", (e) => {
        e.stopPropagation();
        openChineseMarket(this.app);
      });

      this.bodyEl = card.createDiv({ cls: "bws-bambooseries-body" });
      if (document.body.classList.contains("is-mobile")) {
        card.classList.add("is-collapsed");
      }
      void this.refresh();
    } catch (e) {
      console.error("[bamboo-walking] 竹林系列卡片渲染失败：", e);
      const errCard = parent.createDiv({ cls: "bws-bambooseries bws-bambooseries-err" });
      errCard.setText("竹林系列加载失败，详见控制台");
    }
  }

  /** 渲染插件列表（实时探测已装/未装，点击联动） */
  async refresh(): Promise<void> {
    const body = this.bodyEl;
    const card = this.cardEl;
    if (!body || !card) return;
    body.empty();
    let installedCount = 0;
    for (const item of BAMBOO_SERIES) {
      const enabled = isPluginEnabled(this.app, item.id);
      if (enabled) installedCount++;

      const row = body.createDiv({
        cls:
          "bws-bambooseries-row" +
          (enabled ? " is-installed" : " is-missing") +
          (item.isSelf ? " is-self" : ""),
      });

      const nameEl = row.createDiv({ cls: "bws-bambooseries-name" });
      nameEl.append(item.name);

      const right = row.createDiv({ cls: "bws-bambooseries-right" });
      right.createSpan({
        cls: "bws-bambooseries-state",
        text: item.isSelf ? "使用中" : enabled ? "已装" : "未装",
      });

      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (item.isSelf) return; // 自身：不重复打开
        openBambooSeriesItem(this.app, item);
      });
    }
    // 头部标题后缀：已装数量（除自身外），给个轻量进度感
    const otherInstalled = installedCount - (isPluginEnabled(this.app, "bamboo-walking") ? 1 : 0);
    const total = BAMBOO_SERIES.length - 1;
    const caret = card.querySelector<HTMLElement>(".bws-bambooseries-caret");
    if (caret) caret.textContent = `${otherInstalled}/${total}`;
  }
}
