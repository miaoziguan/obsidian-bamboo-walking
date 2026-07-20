/* ────────────── 竹杖芒鞋 · 「竹林修仙传」联动桥接 ────────────── */
import type { App } from "obsidian";

/** 竹林修仙传插件 ID（与其 manifest.json 的 id 保持一致） */
export const BAMBOO_IMMORTALS_PLUGIN_ID = "bamboo-immortals";

/**
 * 竹林修仙传对外暴露的集成 API 形状（duck typing）。
 * 只依赖 planExternalText 这一稳定入口，不耦合其内部实现，
 * 便于双方各自演进而不破坏联动契约。
 */
/** 竹林健康等级（与竹林 healthScore.ts 的 HealthLevel 同义） */
export type GoalHealthLevel = "excellent" | "good" | "warning" | "risk";

/** 单目标健康卡（与竹林 strategyOverview.ts 的 GoalHealthCard 同形状） */
export interface GoalHealthCard {
  id: string;
  title: string;
  level: GoalHealthLevel;
  label: string;
  color: string;
  score: number;
  l1: number;
  l2: number;
  l3: number;
  progress: number;
  statusText: string;
}

export interface GoalStatsProgressTiers {
  tier0_25: number;
  tier26_50: number;
  tier51_75: number;
  tier76_99: number;
  tier100: number;
}

export interface GoalStatsCategoryEntry {
  category: { id: string; name: string; icon?: string; color: string };
  avgProgress: number;
  goalCount: number;
}

/** 数据概览聚合（与竹林 goalStats.ts 的 GoalStats 同形状） */
export interface GoalStats {
  totalGoals: number;
  completedGoals: number;
  inProgressGoals: number;
  notStartedGoals: number;
  avgProgress: number;
  catStats: GoalStatsCategoryEntry[];
  upcomingGoals: Array<{ id?: string; title?: string; daysLeft: number }>;
  urgentGoals: Array<{ id?: string; title?: string; daysLeft: number }>;
  overdueGoals: Array<{ id?: string; title?: string; daysOverdue: number }>;
  recentlyCompleted: Array<{ id?: string; title?: string }>;
  progressTiers: GoalStatsProgressTiers;
  stagnantGoals: Array<{ id?: string; title?: string }>;
  totalSubItems: number;
  completedSubItems: number;
  subItemCompletionRate: number;
  timeSpanStats: { shortTerm: number; mediumTerm: number; longTerm: number };
  activeGoals: number;
  highPriorityRate: number;
}

/** 战略复盘总览快照（与竹林 strategyOverview.ts 的 StrategyOverview 同形状） */
export interface StrategyOverview {
  /** ISO 时间戳，竹杖芒鞋据此展示「更新于 xx:xx」 */
  updatedAt: string;
  /** 逐目标健康卡 */
  goals: GoalHealthCard[];
  /** 数据概览聚合 */
  overview: GoalStats;
  /** 权威整体健康分（竹林 computeHealthSet 即时算出，侧栏直接消费，避免二次平均）。
   * 旧版竹林未提供时缺失，调用方回退到本地二次平均，保证兼容。 */
  health?: {
    avgScore: number;
    avgLevel: string;
    avgLabel: string;
    avgColor: string;
    count: number;
  };
}

/** 修行境界快照（与竹林 cultivation.ts 的 CultivationRealm 同形状） */
export interface CultivationRealm {
  completedGoals: number;
  layer: number;
  realm: string;
  title: string;
  nextRealm: string | null;
  nextLayerGoal: number | null;
  currentLayerGoal: number;
}

export interface BambooReviewApi {
  /** 把外部文本（如金句）经大模型拆解为修行目标卡片；不依赖当前打开的笔记 */
  planExternalText: (
    text: string,
    opts?: { sourceLabel?: string; sourceRef?: string }
  ) => Promise<void>;
  /**
   * 实时战略复盘总览（逐目标健康分 + 数据概览）。
   * 可选：旧版竹林修仙传未实现时返回 undefined，调用方据此优雅降级。
   */
  getStrategyOverview?: () => Promise<StrategyOverview | null>;
  /**
   * 当前修行境界（由已完成目标数映射）。
   * 可选：旧版竹林修仙传未实现时返回 undefined，调用方据此优雅降级。
   */
  getCultivationRealm?: () => Promise<CultivationRealm | null>;
  /**
   * 当前竹币余额。
   * 可选：旧版竹林修仙传未实现时返回 undefined，调用方据此优雅降级。
   */
  getBambooCoinBalance?: () => Promise<number | null>;
}

/**
 * 查找已启用的「竹林修仙传」插件并校验其集成 API。
 * 未安装 / 未启用 / 版本过旧（无 planExternalText）时返回 null。
 */
export function getBambooImmortalsApi(app: App): BambooReviewApi | null {
  // Obsidian 未在公开类型里声明 app.plugins，此处按运行时结构安全取用
  const plugins = (
    app as unknown as {
      plugins?: { getPlugin?: (id: string) => unknown };
    }
  ).plugins;
  const plugin = plugins?.getPlugin?.(BAMBOO_IMMORTALS_PLUGIN_ID);
  if (
    plugin &&
    typeof (plugin as { planExternalText?: unknown }).planExternalText ===
      "function"
  ) {
    return plugin as BambooReviewApi;
  }
  return null;
}

/**
 * 把一段文本（金句）炼化为竹林修仙传的修行目标卡片。
 * 未安装 / 未启用竹林修仙传，或版本过旧无 planExternalText 时返回 false，
 * 由调用方据此隐藏入口，优雅降级（与竹叶飞刃联动同策略）。
 *
 * @returns 成功发起炼化流程返回 true；未检测到竹林修仙传返回 false
 */
export async function refineQuoteToGoal(
  app: App,
  text: string,
  sourceLabel?: string
): Promise<boolean> {
  const api = getBambooImmortalsApi(app);
  if (!api) return false;
  await api.planExternalText(text, {
    sourceLabel: sourceLabel ?? "竹杖芒鞋·金句",
    sourceRef: "bamboo-walking:quote",
  });
  return true;
}

/**
 * 拉取「竹林修仙传」的实时战略复盘总览（逐目标健康分 + 数据概览）。
 * 每次调用都在竹林侧即时重算（即「一键重新诊断」），零缓存、确定性。
 *
 * 未安装 / 未启用竹林修仙传，或版本过旧无 getStrategyOverview 时返回 null，
 * 由调用方据此隐藏入口或展示空态，优雅降级（与金句炼化联动同策略）。
 */
export async function getStrategyOverview(
  app: App,
): Promise<StrategyOverview | null> {
  const api = getBambooImmortalsApi(app);
  if (api && typeof api.getStrategyOverview === "function") {
    return api.getStrategyOverview();
  }
  return null;
}

/**
 * 拉取「竹林修仙传」的当前修行境界（由已完成目标数映射）。
 * 未安装 / 未启用竹林修仙传，或版本过旧无 getCultivationRealm 时返回 null，
 * 由调用方据此隐藏境界区块，优雅降级（与战略复盘联动同策略）。
 */
export async function getCultivationRealm(
  app: App,
): Promise<CultivationRealm | null> {
  const api = getBambooImmortalsApi(app);
  if (api && typeof api.getCultivationRealm === "function") {
    return api.getCultivationRealm();
  }
  return null;
}

/**
 * 拉取「竹林修仙传」的当前竹币余额。
 * 未安装 / 未启用竹林修仙传，或版本过旧无 getBambooCoinBalance 时返回 null，
 * 由调用方据此隐藏竹币区块，优雅降级（与战略复盘联动同策略）。
 */
export async function getBambooCoinBalance(
  app: App,
): Promise<number | null> {
  const api = getBambooImmortalsApi(app);
  if (api && typeof api.getBambooCoinBalance === "function") {
    return api.getBambooCoinBalance();
  }
  return null;
}
