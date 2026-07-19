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
  hash?: string;         // 文章 .md 内容的 SHA256，用于缓存失效检测
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
  version: number;        // 缓存 schema 版本
  index: ArticleIndexEntry[];
  articles: Record<string, CachedArticle>;
  lastFetch: number;
  lastSeenSlugs: string[];
  readSlugs: string[];
}

interface CachedArticle {
  article: Article;
  fetchedAt: number;
  hash?: string;         // 缓存时的文章 hash，与 index.json 对比判断是否过期
  wordCount?: number;    // 文章「字数」（中文按字 + 英文按词），缓存时预计算；旧缓存缺省则懒补算
}

/** 视图类型常量 */
export const VIEW_TYPE_SIDEBAR = "bamboo-walking-sidebar";
export const VIEW_TYPE_READER = "bamboo-walking-reader";

/** 读者侧默认配置 */
export const DEFAULT_SETTINGS: BambooWalkingSettings = {
  savePath: "竹杖芒鞋",
};

