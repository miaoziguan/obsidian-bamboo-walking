/* ────────────── 本地缓存服务 ────────────── */
import type { Article, ArticleIndexEntry, CacheData } from "../types";
import { CACHE_KEY } from "../constants";

export class CacheService {
  private data: CacheData;
  private saving = false;
  private pendingSave = false;

  constructor(
    private loadData: () => Promise<any>,
    private saveData: (data: any) => Promise<void>,
    private cacheExpiry: number,
  ) {
    this.data = {
      index: [],
      articles: {},
      lastFetch: 0,
      lastSeenSlugs: [],
      readSlugs: [],
    };
  }

  async load(): Promise<void> {
    const saved = await this.loadData();
    if (saved && saved[CACHE_KEY]) {
      this.data = {
        ...saved[CACHE_KEY],
        readSlugs: saved[CACHE_KEY].readSlugs ?? [],
      };
    }
  }

  async save(): Promise<void> {
    // 简易锁，防止并发保存互相覆盖
    if (this.saving) { this.pendingSave = true; return; }
    this.saving = true;
    try {
      const all = (await this.loadData()) || {};
      all[CACHE_KEY] = this.data;
      await this.saveData(all);
      if (this.pendingSave) {
        this.pendingSave = false;
        await this.save();
      }
    } finally {
      this.saving = false;
    }
  }

  isIndexExpired(): boolean {
    return Date.now() - this.data.lastFetch > this.cacheExpiry;
  }

  getIndex(): ArticleIndexEntry[] {
    return this.data.index;
  }

  async setIndex(entries: ArticleIndexEntry[]): Promise<string[]> {
    const oldSlugs = new Set(this.data.lastSeenSlugs);
    const newSlugs = entries.map((e) => e.slug);
    this.data.index = entries;
    this.data.lastFetch = Date.now();
    this.data.lastSeenSlugs = newSlugs;
    await this.save();
    return newSlugs.filter((s) => !oldSlugs.has(s));
  }

  getCachedArticle(slug: string): Article | null {
    const cached = this.data.articles[slug];
    if (!cached) return null;
    if (Date.now() - cached.fetchedAt > 24 * 60 * 60 * 1000) return null;
    return cached.article;
  }

  async setArticle(slug: string, article: Article): Promise<void> {
    this.data.articles[slug] = { article, fetchedAt: Date.now() };
    await this.save();
  }

  /* ── 已读追踪 ── */

  getReadSlugs(): Set<string> {
    return new Set(this.data.readSlugs);
  }

  isRead(slug: string): boolean {
    return this.data.readSlugs.includes(slug);
  }

  async markRead(slug: string): Promise<void> {
    if (!this.data.readSlugs.includes(slug)) {
      this.data.readSlugs.push(slug);
      // 防止已读列表无限增长，保留最近 500 条
      if (this.data.readSlugs.length > 500) {
        this.data.readSlugs = this.data.readSlugs.slice(-500);
      }
      await this.save();
    }
  }

  async clear(): Promise<void> {
    this.data = {
      index: [],
      articles: {},
      lastFetch: 0,
      lastSeenSlugs: [],
      readSlugs: this.data.readSlugs,  // 清缓存但保留已读记录
    };
    await this.save();
  }

  updateExpiry(ms: number): void {
    this.cacheExpiry = ms;
  }
}
