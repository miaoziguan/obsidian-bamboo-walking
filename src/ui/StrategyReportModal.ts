/* ────────────── 战略复盘报告弹层（克制 · 主题感知 · 去仪表盘化） ────────────── */
import { App, Modal, Notice, createDiv } from "obsidian";
import {
  getStrategyOverview,
  type StrategyOverview,
  type GoalStats,
} from "../services/BambooReviewBridge";
import { svgIcon, type IconName } from "./icons";

/** 等级色（明度兼顾深色主题；浅色下亦清晰） */
const LEVEL_COLOR: Record<string, string> = {
  excellent: "#3f8f63",
  good: "#5fae7a",
  warning: "#c89642",
  risk: "#c04a3e",
};

/** 进度条色（与等级色同调） */
function barColor(v: number): string {
  if (v >= 80) return LEVEL_COLOR.excellent;
  if (v >= 60) return LEVEL_COLOR.good;
  if (v >= 40) return LEVEL_COLOR.warning;
  return LEVEL_COLOR.risk;
}

export class StrategyReportModal extends Modal {
  private data: StrategyOverview | null = null;
  private loading = false;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("bw-strategy-modal-shell");
    contentEl.empty();
    contentEl.createDiv({ cls: "bw-strategy-modal" });
    void this.load();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    const root = this.contentEl.querySelector(".bw-strategy-modal");
    if (!root) return;
    this.loading = true;
    this.renderLoading(root);
    try {
      this.data = await getStrategyOverview(this.app);
    } catch {
      this.data = null;
      new Notice("战略复盘拉取失败，请确认「竹林修仙传」插件已启用");
    } finally {
      this.loading = false;
      this.render(root);
    }
  }

  private renderLoading(root: HTMLElement): void {
    root.empty();
    const title = root.createDiv({ cls: "bw-strategy-title" });
    title.appendChild(svgIcon("chart"));
    title.append(" 战略复盘");
    root.createDiv({
      cls: "bw-strategy-loading",
      text: "正在核算修行全貌…",
    });
  }

  private render(root: HTMLElement): void {
    root.empty();
    if (!this.data) {
      this.renderEmpty(root);
      return;
    }

    // ── 头部 ──
    const head = root.createDiv({ cls: "bw-strategy-head" });
    const titleBox = head.createDiv({ cls: "bw-strategy-titlebox" });
    const t = titleBox.createDiv({ cls: "bw-strategy-title" });
    t.appendChild(svgIcon("chart"));
    t.append(" 战略复盘");
    const updated = new Date(this.data.updatedAt);
    const hh = String(updated.getHours()).padStart(2, "0");
    const mm = String(updated.getMinutes()).padStart(2, "0");
    titleBox.createDiv({
      cls: "bw-strategy-sub",
      text: `更新于 ${hh}:${mm}`,
    });
    const refresh = head.createEl("button", { cls: "bw-strategy-refresh" });
    refresh.appendChild(svgIcon("refresh"));
    refresh.createSpan({ text: "重新核算" });
    refresh.addEventListener("click", () => {
      if (this.loading) return;
      void this.load();
    });

    // ── 综合（一行式） ──
    root.appendChild(this.renderSummary(this.data));

    // ── 数据概览（与竹林修仙传战略复盘口径完全一致） ──
    const sec = root.createDiv({ cls: "bw-strategy-section" });
    sec.createDiv({ cls: "bw-strategy-section-title", text: "数据概览" });
    sec.appendChild(this.renderOverview(this.data.overview));
  }

  private renderEmpty(root: HTMLElement): void {
    root.empty();
    const title = root.createDiv({ cls: "bw-strategy-title" });
    title.appendChild(svgIcon("chart"));
    title.append(" 战略复盘");
    const empty = root.createDiv({ cls: "bw-strategy-empty" });
    empty.appendChild(svgIcon("chart"));
    empty.createEl("p", {
      text: "未检测到「竹林修仙传」的修行数据。",
    });
    empty.createEl("p", {
      cls: "bw-strategy-empty-sub",
      text: "请先安装并启用「竹林修仙传」插件，在其中创建目标并跑一次诊断，再回到此处查看战略复盘。",
    });
  }

  /** 综合：一行式（数字 + 紧凑 metadata），不再用 chip 阵列 */
  private renderSummary(data: StrategyOverview): HTMLElement {
    const wrap = createDiv({ cls: "bw-strategy-summary" });

    const score =
      data.goals.length > 0
        ? Math.round(
            data.goals.reduce((s, g) => s + g.score, 0) / data.goals.length,
          )
        : 0;
    const alerts =
      data.overview.urgentGoals.length +
      data.overview.overdueGoals.length +
      data.overview.upcomingGoals.length +
      data.overview.stagnantGoals.length;

    const scoreBox = wrap.createDiv({ cls: "bw-strategy-score" });
    const num = scoreBox.createDiv({
      cls: "bw-strategy-score-num",
      text: String(score),
    });
    num.style.color = barColor(score);
    scoreBox.createDiv({ cls: "bw-strategy-score-label", text: "综合健康" });

    const meta = wrap.createDiv({ cls: "bw-strategy-meta" });
    const addMeta = (k: string, v: number, accent?: boolean): void => {
      const s = meta.createSpan({ cls: "bw-strategy-meta-item" });
      s.createSpan({ cls: "bw-strategy-meta-k", text: k });
      const val = s.createSpan({
        cls: "bw-strategy-meta-v",
        text: String(v),
      });
      if (accent) val.style.color = LEVEL_COLOR.risk;
    };
    addMeta("目标", data.goals.length);
    addMeta("紧急", data.overview.urgentGoals.length);
    addMeta("逾期", data.overview.overdueGoals.length);
    addMeta("即将", data.overview.upcomingGoals.length);
    addMeta("停滞", data.overview.stagnantGoals.length);
    addMeta("预警", alerts, alerts > 0);

    return wrap;
  }

  /** 数据概览：与「竹林修仙传·战略复盘」口径完全一致（7 节） */
  private renderOverview(o: GoalStats): HTMLElement {
    const wrap = createDiv({ cls: "bw-strategy-overview" });
    const safe = (s?: string): string => (s && s.trim() ? s : "(未命名)");

    // ① 核心指标
    const core = wrap.createDiv({ cls: "bw-strategy-group" });
    core.createDiv({ cls: "bw-strategy-group-title", text: "核心指标" });
    const kpis = core.createDiv({ cls: "bw-strategy-kpis" });
    const kpi = (k: string, v: string | number): void => {
      const cell = kpis.createDiv({ cls: "bw-strategy-kpi" });
      cell.createDiv({ cls: "bw-strategy-kpi-v", text: String(v) });
      cell.createDiv({ cls: "bw-strategy-kpi-k", text: k });
    };
    kpi("总目标", o.totalGoals);
    kpi("已完成", o.completedGoals);
    kpi("进行中", o.inProgressGoals);
    kpi("平均进度", `${o.avgProgress}%`);
    kpi("子项总数", o.totalSubItems);
    kpi("子项完成率", `${o.subItemCompletionRate}%`);

    // ② 时间预警（紧急 / 已逾期 / 即将到期 / 停滞）
    const alertG = wrap.createDiv({ cls: "bw-strategy-group" });
    alertG.createDiv({ cls: "bw-strategy-group-title", text: "时间预警" });
    const alerts: Array<{
      icon: IconName;
      cls: string;
      title: string;
      desc: string;
      list: string[];
    }> = [
      {
        icon: "fire",
        cls: "urgent",
        title: "紧急到期",
        desc: "3天内需要关注",
        list: o.urgentGoals.map((g) => `${safe(g.title)}·${g.daysLeft}天`),
      },
      {
        icon: "alert",
        cls: "overdue",
        title: "已逾期",
        desc: "需要立即处理",
        list: o.overdueGoals.map((g) => `${safe(g.title)}·${g.daysOverdue}天`),
      },
      {
        icon: "clock",
        cls: "upcoming",
        title: "即将到期",
        desc: "7天内需要准备",
        list: o.upcomingGoals.map((g) => `${safe(g.title)}·${g.daysLeft}天`),
      },
      {
        icon: "pause",
        cls: "stagnant",
        title: "停滞预警",
        desc: "超过14天无进展",
        list: o.stagnantGoals.map((g) => safe(g.title)),
      },
    ];
    if (alerts.every((a) => a.list.length === 0)) {
      const good = alertG.createDiv({ cls: "bw-strategy-allgood" });
      good.appendChild(svgIcon("pulse"));
      const gtxt = good.createDiv();
      gtxt.createDiv({ cls: "bw-strategy-allgood-title", text: "一切顺利" });
      gtxt.createDiv({
        cls: "bw-strategy-allgood-desc",
        text: "所有目标进度良好",
      });
    } else {
      const cards = alertG.createDiv({ cls: "bw-strategy-alertcards" });
      for (const a of alerts) {
        if (a.list.length === 0) continue;
        const card = cards.createDiv({ cls: `bw-strategy-acard ${a.cls}` });
        const top = card.createDiv({ cls: "bw-strategy-acard-top" });
        const ico = top.createDiv({ cls: "bw-strategy-acard-icon" });
        ico.appendChild(svgIcon(a.icon));
        top.createDiv({
          cls: "bw-strategy-acard-count",
          text: String(a.list.length),
        });
        card.createDiv({ cls: "bw-strategy-acard-title", text: a.title });
        card.createDiv({ cls: "bw-strategy-acard-desc", text: a.desc });
      }
    }

    // ③ 进度梯队分布（降序，与竹林一致）
    const tierG = wrap.createDiv({ cls: "bw-strategy-group" });
    tierG.createDiv({ cls: "bw-strategy-group-title", text: "进度梯队分布" });
    const tierLine = tierG.createDiv({ cls: "bw-strategy-tiers" });
    const tiers: Array<[string, number, string]> = [
      ["100% 完成", o.progressTiers.tier100, LEVEL_COLOR.excellent],
      ["76-99%", o.progressTiers.tier76_99, LEVEL_COLOR.excellent],
      ["51-75%", o.progressTiers.tier51_75, LEVEL_COLOR.good],
      ["26-50%", o.progressTiers.tier26_50, LEVEL_COLOR.warning],
      ["0-25%", o.progressTiers.tier0_25, LEVEL_COLOR.risk],
    ];
    const maxTier = Math.max(1, ...tiers.map((t) => t[1]));
    for (const [name, val, color] of tiers) {
      const seg = tierLine.createDiv({ cls: "bw-strategy-tier" });
      const bar = seg.createDiv({
        cls: "bw-strategy-bar bw-strategy-tier-bar",
      });
      const fill = bar.createDiv({
        cls: "bw-strategy-bar-fill bw-strategy-tier-fill",
      });
      fill.style.width = `${(val / maxTier) * 100}%`;
      fill.style.background = color;
      const meta = seg.createDiv({ cls: "bw-strategy-tier-meta" });
      meta.createSpan({ cls: "bw-strategy-tier-num", text: String(val) });
      meta.createSpan({ cls: "bw-strategy-tier-name", text: name });
    }



    return wrap;
  }
}
