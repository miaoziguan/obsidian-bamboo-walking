/* ────────────── 竹杖芒鞋 · 类型定义 ────────────── */

/** 文章元数据（frontmatter） */
export interface ArticleMeta {
  title: string;
  date: string;          // YYYY-MM-DD
  category: string;      // 专栏分类名
  summary: string;
  tags?: string[];
  cover?: string;        // 封面图 URL（可选）
  readingTime?: number;  // 预估阅读分钟数
  author?: string;       // 作者名（可选，默认用 constants 里的 AUTHOR_NAME）
}

/** 索引文件 articles/index.json 的单条记录 */
export interface ArticleIndexEntry extends ArticleMeta {
  slug: string;          // 文章路径标识，如 "技术随想/2026-07-04-hello"
}

/** 内存中的完整文章对象 */
export interface Article extends ArticleMeta {
  slug: string;
  content: string;       // markdown 正文
}

/** 按分类分组后的文章列表 */
export interface CategoryGroup {
  name: string;
  articles: ArticleIndexEntry[];
}

/** 读者侧可配置项 */
export interface BambooWalkingSettings {
  /** 保存笔记的目标文件夹 */
  savePath: string;
}

/** 缓存数据结构 */
export interface CacheData {
  index: ArticleIndexEntry[];
  articles: Record<string, CachedArticle>;
  lastFetch: number;
  lastSeenSlugs: string[];
  readSlugs: string[];
}

export interface CachedArticle {
  article: Article;
  fetchedAt: number;
}

/** 视图类型常量 */
export const VIEW_TYPE_SIDEBAR = "bamboo-walking-sidebar";
export const VIEW_TYPE_READER = "bamboo-walking-reader";

/** 读者侧默认配置 */
export const DEFAULT_SETTINGS: BambooWalkingSettings = {
  savePath: "竹杖芒鞋",
};

