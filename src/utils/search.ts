import type { ArticleIndexEntry } from "../types";

export interface MatchOptions {
  /** true 时轻量未命中再查正文（通过 getContent 取正文） */
  fullText: boolean;
  /** 取某 slug 正文（小写），仅 fullText=true 时需要 */
  getContent?: (slug: string) => string;
}

/**
 * 统一的文章匹配：
 * - 轻量字段（标题/摘要/分类/标签）即时匹配，不碰正文；
 * - fullText=true 且轻量未命中时，再用 getContent 取正文做全文匹配。
 * 大小写不敏感；空查询视为全部命中。
 */
export function matchArticle(
  query: string,
  entry: ArticleIndexEntry,
  opts: MatchOptions,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const hit =
    entry.title.toLowerCase().includes(q) ||
    entry.summary.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q) ||
    (entry.tags ?? []).some((t) => t.toLowerCase().includes(q));

  if (hit) return true;

  if (opts.fullText && opts.getContent) {
    return opts.getContent(entry.slug).toLowerCase().includes(q);
  }
  return false;
}
