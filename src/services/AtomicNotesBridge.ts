/* ────────────── 竹杖芒鞋 · 「竹叶飞刃」联动桥接 ────────────── */
import type { App } from "obsidian";

/** 竹叶飞刃插件 ID（与其 manifest.json 的 id 保持一致） */
export const ATOMIC_NOTES_PLUGIN_ID = "atomic-notes-extractor";

/**
 * 竹叶飞刃对外暴露的集成 API 形状（duck typing）。
 * 只依赖 extractFromText 这一稳定入口，不耦合其内部实现，
 * 便于双方各自演进而不破坏联动契约。
 */
/** 竹叶飞刃返回的「相关笔记」形状 */
export interface RelatedNote {
  path: string;
  title: string;
  score: number;
}

export interface AtomicNotesApi {
  extractFromText(text: string): Promise<void>;
  /** 可选：旧版飞刃无此方法；调用方应做存在性判断 */
  findRelatedNotes?: (
    query: string,
    opts?: { topK?: number; jaccardThreshold?: number; targetFolder?: string },
  ) => Promise<Array<{ path: string; title: string; score: number }>>;
}

/** 组装提炼文本所需的最小文章形状 */
export interface ExtractableArticle {
  title: string;
  category?: string;
  content: string;
}

/**
 * 查找已启用的「竹叶飞刃」插件并校验其集成 API。
 * 未安装 / 未启用 / 版本过旧（无 extractFromText）时返回 null。
 */
export function getAtomicNotesApi(app: App): AtomicNotesApi | null {
  // Obsidian 未在公开类型里声明 app.plugins，此处按运行时结构安全取用
  const plugins = (
    app as unknown as {
      plugins?: { getPlugin?: (id: string) => unknown };
    }
  ).plugins;
  const plugin = plugins?.getPlugin?.(ATOMIC_NOTES_PLUGIN_ID);
  if (
    plugin &&
    typeof (plugin as { extractFromText?: unknown }).extractFromText ===
      "function"
  ) {
    return plugin as AtomicNotesApi;
  }
  return null;
}

/**
 * 把文章组装为提炼输入文本：标题 + 正文。
 * 标题作为上下文能显著提升竹叶飞刃质量门控与提炼的命中率。
 */
export function buildExtractionText(article: ExtractableArticle): string {
  const title = (article.title ?? "").trim();
  const content = (article.content ?? "").trim();
  const parts: string[] = [];
  if (title) parts.push(`# ${title}`);
  if (content) parts.push(content);
  return parts.join("\n\n").trim();
}

/**
 * 查询竹叶飞刃中与给定文本相关的原子笔记（知识回流）。
 * 未安装 / 未启用 / 飞刃版本旧（无 findRelatedNotes）时返回 null，
 * 由调用方决定隐藏相关区域而不抛错。
 *
 * @returns 相关笔记数组；不可用时返回 null
 */
export async function findRelatedNotes(
  app: App,
  query: string,
  opts?: { topK?: number; jaccardThreshold?: number; targetFolder?: string },
): Promise<RelatedNote[] | null> {
  const api = getAtomicNotesApi(app);
  if (!api || typeof api.findRelatedNotes !== "function") return null;
  return api.findRelatedNotes(query, opts);
}
