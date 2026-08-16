/* ────────────── 竹林系列联动桥 ────────────── */
/*
 * 竹杖芒鞋（bamboo-walking）与同作者「竹林系列」其它插件的发现/联动桥。
 *
 * 设计原则（与 BambooReviewBridge / AtomicNotesBridge 一致）：
 *  - 纯 duck-type 探测：通过 app.plugins.getPlugin(id) 判断是否已安装启用，
 *    绝不硬依赖任何插件的内部实现；
 *  - 优雅降级：目标插件未装 / 未启用 / 旧版无 API 时，回退到
 *    obsidian://show-plugin?id= 引导安装，绝不抛错或白屏；
 *  - 市场侧零改动：本桥不要求 chinese-plugin-market 暴露任何公开 API，
 *    仅复用其已上架的 translator-view 视图类型（探测失败即回退）。
 *
 * 「竹林系列」清单与中文名在此处自包含维护（不依赖外部 JSON 文件存在），
 * 与 chinese-plugin-market 的 plugin-bamboo-series.json 同源对齐。
 */

import type { App } from "obsidian";

/** 竹林系列单个插件的定义 */
export interface BambooSeriesItem {
  /** 插件 id（社区插件仓库名 / manifest.id） */
  id: string;
  /** 中文品牌名（社区官方 name 为英文，此处提供中文） */
  name: string;
  /** 副标题（一句话定位，增强发现体验） */
  desc: string;
  /** 该插件注册的视图类型（用于已装时直接拉起；为空则回退 show-plugin） */
  viewType?: string;
  /** 是否为竹杖芒鞋自身（自身不重复提供「打开」动作） */
  isSelf?: boolean;
}

/**
 * 竹林系列清单（羽鳞君·喵字馆 出品）。
 * 顺序即侧栏展示顺序；新增竹林系插件时在此补充即可。
 */
export const BAMBOO_SERIES: BambooSeriesItem[] = [
  {
    id: "bamboo-walking",
    name: "竹杖芒鞋",
    desc: "安装即订阅的专栏阅读器",
    isSelf: true,
  },
  {
    id: "bamboo-immortals",
    name: "竹林修仙传",
    desc: "目标管理 × 修行境界体系",
    viewType: "bamboo-immortals-review",
  },
  {
    id: "atomic-notes-extractor",
    name: "竹叶飞刃",
    desc: "网页/文章一键提炼为笔记",
    viewType: "atomic-notes-extractor",
  },
  {
    id: "chinese-plugin-market",
    name: "中文区插件市场",
    desc: "华人开发者插件的中文浏览与筛选",
    viewType: "translator-view",
  },
];

/** 运行时插件实例的 duck-type 形状（只声明联动用到的成员） */
interface PluginLike {
  activateView?: () => unknown;
  [k: string]: unknown;
}

/** 探测某插件是否已安装并启用（duck-type，零依赖）。
 *  Obsidian 未在公开类型里声明 app.plugins，按运行时结构安全取用（与 BambooReviewBridge 对齐）。 */
export function getPlugin(app: App, id: string): PluginLike | null {
  try {
    const plugins = (
      app as unknown as {
        plugins?: { getPlugin?: (id: string) => unknown };
      }
    ).plugins;
    const p = plugins?.getPlugin?.(id) as PluginLike | undefined;
    return p ?? null;
  } catch {
    return null;
  }
}

/** 是否已安装并启用给定插件 */
export function isPluginEnabled(app: App, id: string): boolean {
  return getPlugin(app, id) != null;
}

/**
 * 打开竹林系列中的某个插件：
 *  - 已装启用：优先调用其 activateView()（若存在），否则尝试 setViewState 拉起其视图，
 *    再失败则回退 obsidian://show-plugin 引导；
 *  - 未装：直接 obsidian://show-plugin?id= 跳转社区市场安装页。
 * 任何异常都被吞掉，保证不阻断调用方。
 */
export function openBambooSeriesItem(app: App, item: BambooSeriesItem): void {
  const plugin = getPlugin(app, item.id);
  if (plugin) {
    try {
      // 优先：插件自身暴露的 activateView（竹林修仙传/竹叶飞刃均提供）
      if (typeof plugin.activateView === "function") {
        void plugin.activateView();
        return;
      }
    } catch {
      /* 继续尝试视图拉起 */
    }
    if (item.viewType) {
      try {
        const existing = app.workspace.getLeavesOfType(item.viewType)[0];
        if (existing) {
          void app.workspace.revealLeaf(existing);
          void app.workspace.setActiveLeaf(existing, { focus: true });
          return;
        }
        const leaf = app.workspace.getLeaf(false);
        if (leaf) {
          void leaf.setViewState({ type: item.viewType, active: true });
          return;
        }
      } catch {
        /* 回退 show-plugin */
      }
    }
  }
  // 未装 / 视图拉起失败 → 社区市场安装页
  openShowPlugin(app, item.id);
}

/** 打开社区插件市场的「该插件」页面（用于引导安装/查看） */
export function openShowPlugin(app: App, id: string): void {
  try {
    window.open(`obsidian://show-plugin?id=${encodeURIComponent(id)}`, "_blank");
  } catch {
    /* 极端环境兜底：什么都不做，不抛错 */
  }
}

/**
 * 打开中文区插件市场（chinese-plugin-market）的浏览视图。
 * 市场侧未暴露公开 API，故采用「视图探测 + 回退」策略：
 *  - 已装启用且 translator-view 可拉起 → 直接打开；
 *  - 否则 → obsidian://show-plugin?id=chinese-plugin-market 引导安装/打开。
 */
export function openChineseMarket(app: App): void {
  const market = getPlugin(app, "chinese-plugin-market");
  if (market) {
    try {
      const existing = app.workspace.getLeavesOfType("translator-view")[0];
      if (existing) {
        void app.workspace.revealLeaf(existing);
        void app.workspace.setActiveLeaf(existing, { focus: true });
        return;
      }
      const leaf = app.workspace.getLeaf(false);
      if (leaf) {
        void leaf.setViewState({ type: "translator-view", active: true });
        return;
      }
    } catch {
      /* 回退 show-plugin */
    }
  }
  openShowPlugin(app, "chinese-plugin-market");
}
