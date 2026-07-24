/* ────────────── 战略复盘极简概览卡组件 ────────────── */
import type { App } from "obsidian";
import { svgIcon } from "./icons";
import {
  getBambooImmortalsApi,
  getCultivationRealm,
  getBambooCoinAvailableBalance,
} from "../services/BambooReviewBridge";
import { StrategyReportModal } from "./StrategyReportModal";

/** 左栏竹林概览卡：头部(标题+重算) / 健康预警行 / 境界竹币行，点击打开完整抽屉 */
export class StrategyMiniCard {
  private infoEl: HTMLElement | null = null;
  private cultEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private loading = false;
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /** 创建或复用卡片 DOM */
  render(parent: HTMLElement): void {
    // 幂等：若卡片已存在（如反复渲染 / onOpen 重入），复用 DOM 仅刷新数据，杜绝重复创建
    const existing = parent.querySelector<HTMLElement>(".bws-strategy-mini");
    if (existing) {
      this.cardEl = existing;
      this.infoEl = existing.querySelector(".bws-strategy-mini-info");
      this.cultEl = existing.querySelector(".bws-strategy-mini-cult");
      void this.refresh();
      return;
    }
    // 战略复盘为增强功能：整体兜底，任何异常都不得阻断作者卡与主侧栏渲染
    try {
      const card = parent.createDiv({ cls: "bws-strategy-mini" });
      this.cardEl = card;

      const head = card.createDiv({ cls: "bws-strategy-mini-head" });
      const left = head.createDiv({ cls: "bws-strategy-mini-left" });
      const label = left.createDiv({ cls: "bws-strategy-mini-label" });
      svgIcon(label, "chart", "bws-strategy-mini-ico");
      label.append(" 战略复盘");

      this.infoEl = left.createDiv({
        cls: "bws-strategy-mini-info",
        text: "载入中…",
      });

      const refresh = head.createEl("button", {
        cls: "bws-strategy-mini-refresh",
        attr: { "aria-label": "重新核算战略复盘", title: "重新核算" },
      });
      svgIcon(refresh, "refresh");
      refresh.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.loading) return;
        void this.refresh();
      });

      card.addEventListener("click", () => {
        if (this.cardEl?.classList.contains("is-disabled")) {
          // 灰卡（未启用/无数据/失败）：点击触发重新核算，而非什么都不做
          if (!this.loading) void this.refresh();
          return;
        }
        new StrategyReportModal(this.app).open();
      });

      void this.refresh();

      // 修行境界 · 竹币 行（卡片内第二行，与战略复盘总览解耦、独立降级）
      const cult = card.createDiv({ cls: "bws-strategy-mini-cult bws-hidden" });
      this.cultEl = cult;
      void this.refreshCultivation();
    } catch (e) {
      // 不抛出：主侧栏其余内容（作者卡 / 状态栏 / 列表）正常渲染，但记录并给出可见提示
      console.error("[bamboo-walking] 战略复盘卡片渲染失败：", e);
      const errCard = parent.createDiv({ cls: "bws-strategy-mini bws-strategy-mini-err" });
      errCard.setText("战略复盘加载失败，详见控制台");
    }
  }

  /** 拉取并刷新极简条上的数字（实时核算，零缓存） */
  async refresh(): Promise<void> {
    const info = this.infoEl;
    const card = this.cardEl;
    if (!info || !card) {
      console.error("[bamboo-walking] 战略复盘：strategyMini 元素未就绪（info/card 为 null），跳过刷新");
      return;
    }
    this.loading = true;
    // 区分竹林不可用与数据为空：卡片始终可见，给出明确文案（解决「还是没有出现」）
    const api = getBambooImmortalsApi(this.app);
    if (!api || typeof api.getStrategyOverview !== "function") {
      // 竹林未装 / 未启用 / 版本过旧（未实现该接口）：明确提示，卡片可见可点重试
      info.textContent = "安装「竹林修仙传」以解锁";
      card.classList.add("is-disabled");
      this.loading = false;
      void this.refreshCultivation();
      return;
    }
    info.textContent = "核算中…";
    try {
      const data = await api.getStrategyOverview();
      if (!data) {
        // 竹林已启用且有 API，但暂无数据：可见、可点重试
        info.textContent = "暂无数据，点此重试";
        card.classList.add("is-disabled");
        return;
      }
      const goals = Array.isArray(data.goals) ? data.goals : [];
      const overview = data.overview;
      // 优先消费竹林返回的权威整体健康分；旧版竹林未提供 health 时回退到本地二次平均
      const score =
        data.health && typeof data.health.avgScore === "number"
          ? data.health.avgScore
          : goals.length > 0
            ? Math.round(
                goals.reduce((s, g) => s + (g.score ?? 0), 0) / goals.length,
              )
            : 0;
      const alerts =
        (overview.urgentGoals?.length ?? 0) +
        (overview.overdueGoals?.length ?? 0) +
        (overview.stagnantGoals?.length ?? 0);
      info.textContent = "";
      info.append("健康 ");
      info.createEl("strong", { cls: "bws-stat-num", text: String(score) });
      info.append(" · 预警 ");
      info.createEl("strong", { cls: "bws-stat-num", text: String(alerts) });
      card.classList.remove("is-disabled");
    } catch {
      // 读取失败：给出明确文案，保留入口可重试
      info.textContent = "暂不可用，点此重试";
      card.classList.add("is-disabled");
    } finally {
      this.loading = false;
      // 境界 / 竹币独立于战略复盘总览，始终一并刷新
      void this.refreshCultivation();
    }
  }

  /** 拉取并刷新境界 / 竹币常驻行（与战略复盘总览解耦，独立降级） */
  private async refreshCultivation(): Promise<void> {
    const el = this.cultEl;
    if (!el) return;
    try {
      const [realm, balance] = await Promise.all([
        getCultivationRealm(this.app),
        getBambooCoinAvailableBalance(this.app),
      ]);
      if (realm == null && balance == null) {
        el.classList.add("bws-hidden");
        return;
      }
      el.classList.remove("bws-hidden");
      el.textContent = "";
      if (realm) {
        const item = el.createSpan({ cls: "bws-cult-item bws-cult-realm" });
        item.createSpan({ cls: "bws-cult-val", text: `${realm.realm}·第${realm.layer}层` });
      }
      if (balance != null) {
        const item = el.createSpan({ cls: "bws-cult-item bws-cult-coin" });
        item.createSpan({ cls: "bws-cult-val", text: `竹币 ${balance}` });
      }
    } catch {
      // 读取失败（如竹林插件异常）→ 隐藏境界/竹币行，不阻塞战略复盘
      el.classList.add("bws-hidden");
    }
  }
}
