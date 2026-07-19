/* ────────────── 竹杖芒鞋 · 文本统计工具 ────────────── */

/** 中文（含 CJK 扩展、兼容区、中文标点、全角符号）按字计数 */
const CJK_REGEX =
  /[㐀-鿿豈-﫿\u3000-〿＀-￯]/g;
/** 取反，用于摘除中文后统计拉丁词 */
const STRIP_CJK_REGEX =
  /[㐀-鿿豈-﫿\u3000-〿＀-￯]/g;

/**
 * 统计正文「字数」：
 * - 中文（含 CJK 扩展、兼容区、中文标点、全角符号）按「字」计
 * - 拉丁字母与数字按「词」计（按空白与标点切分）
 * 二者相加，贴近「中文字数」直觉。
 *
 * 统计前会剥离 frontmatter、代码块、行内码、图片、HTML 与残余 Markdown 符号，
 * 避免格式噪声污染计数。
 */
export function countWords(markdown: string): number {
  if (!markdown) return 0;

  let s = markdown.replace(/^---[\s\S]*?\n---/, ""); // frontmatter
  s = s.replace(/```[\s\S]*?```/g, " "); // 围栏代码块
  s = s.replace(/~~~[\s\S]*?~~~/g, " "); // 备选围栏
  s = s.replace(/`[^`]*`/g, " "); // 行内代码
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // 图片（不计入）
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // 链接保留文本
  s = s.replace(/<[^>]+>/g, " "); // HTML 标签
  s = s.replace(/[#>*_~`|+\-=]+/g, " "); // 残余 markdown 符号
  s = s.replace(/\s+/g, " "); // 多余空白

  const cjk = (s.match(CJK_REGEX) || []).length;
  const latin = s
    .replace(STRIP_CJK_REGEX, " ")
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;

  return cjk + latin;
}

/** 字数美化：过万显示「X.X 万字」，否则「X 字」。 */
export function formatWordCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`;
  return `${n} 字`;
}

/** 由字数估算阅读分钟数（中文约 350 字/分钟，至少 1 分钟）。 */
export function estimateReadingTime(words: number): number {
  return Math.max(1, Math.round(words / 350));
}
