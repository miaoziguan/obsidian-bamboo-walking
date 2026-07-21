/* ────────────── 插件态势服务 ────────────── */
/*
 * 拉取 Obsidian 官方公开统计文件，按 GitHub 手柄自动发现「我的插件」，
 * 计算下载量 / 全站排名 / 7日·30日增量趋势，并本地缓存 + 滚动历史快照。
 *
 * 纯客户端、零后端、无需 token；任何异常都降级到上次缓存，不影响主功能。
 */

import { requestUrl } from "obsidian";
import type {
  PluginStatEntry,
  PluginStatsCache,
  PluginStatSnapshot,
} from "../types";
import {
  COMMUNITY_PLUGINS_URL,
  PLUGIN_STATS_CACHE_KEY,
  PLUGIN_STATS_CACHE_VERSION,
  PLUGIN_STATS_FETCH_TIMEOUT,
  PLUGIN_STATS_HISTORY_MAX,
  PLUGIN_STATS_REFRESH_MS,
  PLUGIN_STATS_URL,
} from "../constants";

/** stats.json 顶层结构：{ [pluginId]: { downloads, updated, [version]: count } } */
interface StatsJson {
  [id: string]: { downloads?: number; updated?: number; [ver: string]: unknown };
}

/** community-plugins.json 单条：{ id, name, author, repo: "owner/name", ... } */
interface CommunityPlugin {
  id: string;
  name?: string;
  author?: string;
  repo?: string;
}

/** 对外返回结果 */
export interface PluginStatsResult {
  entries: PluginStatEntry[];
  /** 本次是否为降级缓存（离线/超时/失败） */
  stale: boolean;
  lastFetch: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 取插件仓库 owner（repo 的 owner 段），用于手柄匹配 */
function repoOwner(repo: string | undefined): string {
  if (!repo) return "";
  return repo.split("/")[0]?.toLowerCase() ?? "";
}

/** 判断某插件是否属于给定手柄集合（匹配 repo owner，回退到 author） */
function matchesHandle(
  p: CommunityPlugin,
  handles: string[],
): boolean {
  const norm = handles.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (norm.length === 0) return false;
  const owner = repoOwner(p.repo);
  if (owner && norm.includes(owner)) return true;
  const author = (p.author ?? "").toLowerCase().trim();
  return author.length > 0 && norm.includes(author);
}

export class PluginStatsService {
  private cache: PluginStatsCache = {
    version: PLUGIN_STATS_CACHE_VERSION,
    entries: {},
    lastFetch: 0,
  };
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private authorHandles: string[],
    private loadData: () => Promise<Record<string, unknown> | null>,
    private saveData: (data: Record<string, unknown>) => Promise<void>,
  ) {}

  /** 启动时从插件 data 对象载入本地缓存（秒开） */
  async init(): Promise<void> {
    try {
      const saved = await this.loadData();
      const cached = saved?.[PLUGIN_STATS_CACHE_KEY] as
        | PluginStatsCache
        | undefined;
      if (cached && cached.version === PLUGIN_STATS_CACHE_VERSION) {
        this.cache = cached;
      }
    } catch {
      /* 缓存读取失败则使用空缓存，下次刷新重建 */
    }
  }

  /** 设置页变更时同步配置 */
  setConfig(authorHandles: string[]): void {
    this.authorHandles = authorHandles;
  }

  /** 当前缓存中的条目（可能为空） */
  peek(): PluginStatEntry[] {
    return Object.values(this.cache.entries);
  }

  getLastFetch(): number {
    return this.cache.lastFetch;
  }

  /**
   * 拉取并刷新。若缓存未过期且不强制，则直接返回缓存（秒开、不请求网络）。
   */
  async refresh(force = false): Promise<PluginStatsResult> {
    const now = Date.now();
    const fresh =
      this.cache.lastFetch > 0 &&
      now - this.cache.lastFetch < PLUGIN_STATS_REFRESH_MS &&
      Object.keys(this.cache.entries).length > 0;

    if (!force && fresh) {
      return {
        entries: Object.values(this.cache.entries),
        stale: false,
        lastFetch: this.cache.lastFetch,
      };
    }

    try {
      const [statsRaw, communityRaw] = await Promise.all([
        this.fetchJson<StatsJson>(PLUGIN_STATS_URL),
        this.fetchJson<CommunityPlugin[]>(COMMUNITY_PLUGINS_URL),
      ]);

      // 1) 按手柄自动发现「我的插件」
      const authorIds = new Set<string>();
      for (const p of communityRaw) {
        if (matchesHandle(p, this.authorHandles)) authorIds.add(p.id);
      }

      // 2) 全站排名：按 downloads 降序
      const allIds = Object.keys(statsRaw);
      const sorted = [...allIds].sort(
        (a, b) =>
          (statsRaw[b]?.downloads ?? 0) - (statsRaw[a]?.downloads ?? 0),
      );
      const rankIndex = new Map<string, number>();
      sorted.forEach((id, i) => rankIndex.set(id, i + 1));
      const total = allIds.length;

      // 4) 构建条目 + 滚动历史快照
      const now2 = Date.now();
      const next: Record<string, PluginStatEntry> = {};
      for (const id of authorIds) {
        const stat = statsRaw[id];
        if (!stat) {
          next[id] = {
            id,
            found: false,
            downloads: 0,
            updated: 0,
            rank: 0,
            total,
            history: [],
          };
          continue;
        }
        const downloads = stat.downloads ?? 0;
        const prev = this.cache.entries[id];
        const snapshot: PluginStatSnapshot = { ts: now2, downloads };
        let history = prev?.history ?? [];
        const last = history[history.length - 1];
        const changed = last && last.downloads !== downloads;
        const oldEnough = last && now2 - last.ts > DAY_MS;
        if (!last || changed || oldEnough) {
          history = [...history, snapshot];
          if (history.length > PLUGIN_STATS_HISTORY_MAX) {
            history = history.slice(-PLUGIN_STATS_HISTORY_MAX);
          }
        }
        next[id] = {
          id,
          found: true,
          downloads,
          updated: stat.updated ?? 0,
          rank: rankIndex.get(id) ?? 0,
          total,
          history,
        };
      }

      this.cache = {
        version: PLUGIN_STATS_CACHE_VERSION,
        entries: next,
        lastFetch: now2,
      };
      await this.persist();
      return { entries: Object.values(next), stale: false, lastFetch: now2 };
    } catch {
      // 降级：有缓存则返回缓存并标注 stale
      if (Object.keys(this.cache.entries).length > 0) {
        return {
          entries: Object.values(this.cache.entries),
          stale: true,
          lastFetch: this.cache.lastFetch,
        };
      }
      throw new Error("插件态势拉取失败（首次无缓存）");
    }
  }

  /** 带超时的 JSON 拉取 */
  private async fetchJson<T>(url: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(
        () => reject(new Error("请求超时")),
        PLUGIN_STATS_FETCH_TIMEOUT,
      ),
    );
    const req = requestUrl({ url }).then((resp) => {
      if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
      return resp.json as T;
    });
    return Promise.race([req, timeout]);
  }

  /** 落盘（与 settings / 文章缓存同存于插件 data 对象） */
  private async persist(): Promise<void> {
    const run = this.saveQueue.then(async () => {
      const all = ((await this.loadData()) ?? {}) as Record<string, unknown>;
      all[PLUGIN_STATS_CACHE_KEY] = this.cache;
      await this.saveData(all);
    });
    this.saveQueue = run.catch(() => {});
    await run;
  }
}
