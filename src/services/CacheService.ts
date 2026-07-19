/* ────────────── 本地缓存服务 ────────────── */
import type { Article, ArticleIndexEntry, CacheData } from "../types";
import { countWords } from "../utils/text";
import { CACHE_KEY, CACHE_VERSION } from "../constants";

export class CacheService {
  private data: CacheData;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private loadData: () => Promise<Record<string, unknown> | null>,
    private saveData: (data: Record<string, unknown>) => Promise<void>,
  ) {
    this.data = {
      version: CACHE_VERSION,
      index: [],
      articles: {},
      lastFetch: 0,
      lastSeenSlugs: [],
      readSlugs: [],
    };
  }

  async load(): Promise<void> {
    const saved = await this.loadData();
    const cached = saved?.[CACHE_KEY] as CacheData | undefined;
    if (cached && cached.version === CACHE_VERSION) {
      // 版本匹配：正常加载
      this.data = { ...cached, readSlugs: cached.readSlugs ?? [] };
    } else {
      // 版本不匹配（旧缓存/无版本）：丢弃索引与文章，但保留旧缓存的已读记录
      const keptRead = cached?.readSlugs ?? this.data.readSlugs;
      this.data = {
        version: CACHE_VERSION,
        index: [],
        articles: {},
        lastFetch: 0,
        lastSeenSlugs: [],
        readSlugs: keptRead,
      };
    }
  }

  /** 串行化所有写操作，避免并发 save 交错覆盖 */
  async save(): Promise<void> {
    const run = this.saveQueue.then(async () => {
      const all = ((await this.loadData()) ?? {}) as Record<string, CacheData>;
      all[CACHE_KEY] = this.data;
      await this.saveData(all);
    });
    // 让后续 save 排在同一链条之后；吞掉错误避免整条链断裂
    this.saveQueue = run.catch(() => {});
    return run;
  }

  getIndex(): ArticleIndexEntry[] {
    return this.data.index;
  }

  /** 最近一次成功拉取索引的时间戳（ms），0 表示从未成功拉取 */
  getLastFetch(): number {
    return this.data.lastFetch;
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

  /** 获取缓存文章；提供 hash 时若与缓存不匹配则返回 null（内容已更新） */
  getCachedArticle(slug: string, hash?: string): Article | null {
    const cached = this.data.articles[slug];
    if (!cached) return null;
    if (hash && cached.hash && cached.hash !== hash) return null;
    return cached.article;
  }

  async setArticle(slug: string, article: Article, hash?: string): Promise<void> {
    this.data.articles[slug] = {
      article,
      fetchedAt: Date.now(),
      hash,
      wordCount: countWords(article.content),
    };
    await this.save();
  }

  /** 取某篇文章的「字数」；缓存命中但缺字段（旧缓存）时懒补算并落盘，未缓存则返回 undefined */
  getWordCount(slug: string): number | undefined {
    const cached = this.data.articles[slug];
    if (!cached) return undefined;
    if (typeof cached.wordCount === "number") return cached.wordCount;
    // 旧缓存缺字段：用正文现算并回写，下次直接命中
    const wc = countWords(cached.article.content);
    cached.wordCount = wc;
    void this.save().catch(() => {}); // fire-and-forget 落盘
    return wc;
  }

  /** 全站已统计字数之和（仅累加已知 wordCount 的文章） */
  getTotalWordCount(): number {
    let total = 0;
    for (const slug of Object.keys(this.data.articles)) {
      const wc = this.data.articles[slug].wordCount;
      if (typeof wc === "number") total += wc;
    }
    return total;
  }

  /* ── 已读追踪 ── */

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
      version: CACHE_VERSION,
      index: [],
      articles: {},
      lastFetch: 0,
      lastSeenSlugs: [],
      readSlugs: this.data.readSlugs,  // 清缓存但保留已读记录
    };
    await this.save();
  }
}
