/* ────────────── 分享工具：生成分享图（多形态 · 极简宣纸） ────────────── */
import type { Article, ArticleMeta, ArticleIndexEntry } from "../types";
import { AUTHOR_NAME } from "../constants";

/* ── 极简宣纸设计 token ── */
/** 偏白的竹绿（唯一背景，无渐变） */
const PAPER = "#fafdfb";
/** 暖墨黑（标题主文字） */
const INK = "#2b2b28";
/** 暖灰（正文 / 次级文字） */
const INK_SOFT = "#5b574e";
/** 唯一主色：竹青（仅用于品牌、分类点、署名、小字标） */
const BAMBOO = "#4a7c59";
/** 竹青（低透明，用于安静的字标） */
const BAMBOO_SOFT = "rgba(74,124,89,0.55)";

/** 正文无衬线（系统栈，保证长文可读） */
const SANS = "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
/** 标题 / 品牌 / 金句 衬线（文人气质） */
const SERIF = "'PingFang SC','Microsoft YaHei',sans-serif";
function serif(weight: number, size: number): string {
  return `${weight} ${size}px ${SERIF}`;
}
function sans(weight: number, size: number): string {
  return `${weight} ${size}px ${SANS}`;
}

/** 标点避头尾（中文排版禁则） */
const NO_LINE_START = new Set([
  "，", "。", "、", "；", "：", "！", "？", "…",
  "」", "』", "”", "）", "】", "〉", "》",
]);
const NO_LINE_END = new Set([
  "「", "『", "“", "‘", "（", "【", "〈", "《",
]);

/** 是否非「汉字/字母/数字」（用于两端对齐时压缩标点字距） */
function isPunct(ch: string): boolean {
  return !/[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9]/.test(ch);
}

/** 应用避头尾：行首禁则字符回退上一行，行尾禁则字符推迟下一行 */
function applyKinsoku(
  lines: string[],
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i];
    // 行首禁则：把行首的禁则字符移回上一行末尾
    while (ln.length > 1 && NO_LINE_START.has(ln[0]) && out.length > 0) {
      const prev = out[out.length - 1];
      const merged = prev + ln[0];
      if (ctx.measureText(merged).width <= maxWidth) {
        out[out.length - 1] = merged;
        ln = ln.slice(1);
      } else break;
    }
    // 行尾禁则：把行尾的禁则字符移到下一行开头
    while (ln.length > 1 && NO_LINE_END.has(ln[ln.length - 1]) && i < lines.length - 1) {
      const moved = ln[ln.length - 1];
      const next = moved + lines[i + 1];
      if (ctx.measureText(next).width <= maxWidth) {
        lines[i + 1] = next;
        ln = ln.slice(0, -1);
      } else break;
    }
    out.push(ln);
  }
  return out;
}

/** 两端对齐绘制一行：段落内非末行时逐字铺满 maxWidth，标点处字距减半 */
function fillJustified(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  const chars = Array.from(text);
  if (chars.length <= 1) {
    ctx.fillText(text, x, y);
    return;
  }
  const natural = ctx.measureText(text).width;
  const extra = maxWidth - natural;
  if (extra <= 0.5) {
    ctx.fillText(text, x, y);
    return;
  }
  // 弹性单位：汉字/字母/数字间隙=1，标点间隙=0.5（标点不被拉开）
  let units = 0;
  for (let i = 0; i < chars.length - 1; i++) {
    units += isPunct(chars[i]) || isPunct(chars[i + 1]) ? 0.5 : 1;
  }
  const gap = extra / units;
  let pen = x;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    ctx.fillText(ch, pen, y);
    if (i < chars.length - 1) {
      const g = isPunct(ch) || isPunct(chars[i + 1]) ? gap * 0.5 : gap;
      pen += ctx.measureText(ch).width + g;
    }
  }
}

/* ────────────── 形态维度 ────────────── */

/** 画布比例（适配平台） */
export type ShareSize = "square" | "portrait" | "story" | "landscape" | "wide";

/** 内容形态（信息密度） */
export type ShareForm = "summary" | "quote" | "long" | "series";

/** 每尺寸的排版规格（字号按尺寸手工调校，留白更克制） */
interface SizeSpec {
  w: number;
  h: number | "auto"; // 'auto' = 长图，高度按内容自适应
  pad: number;
  title: number;
  titleLines: number;
  sum: number;
  sumLines: number;
}

const SIZE_SPECS: Record<ShareSize, SizeSpec> = {
  square:    { w: 1080, h: 1080,      pad: 110, title: 64, titleLines: 4, sum: 33, sumLines: 6 },
  portrait:  { w: 1080, h: 1350,      pad: 110, title: 66, titleLines: 5, sum: 35, sumLines: 9 },
  story:     { w: 1080, h: 1920,      pad: 130, title: 74, titleLines: 6, sum: 39, sumLines: 14 },
  landscape: { w: 1200, h: 630,       pad: 72,  title: 48, titleLines: 3, sum: 26, sumLines: 3 },
  wide:      { w: 1920, h: 1080,      pad: 130, title: 68, titleLines: 3, sum: 33, sumLines: 5 },
};

/** 平台预设：每个平台绑定一个尺寸 + 形态 */
export interface PlatformPreset {
  key: string;
  label: string;
  size: ShareSize;
  form: ShareForm;
  hint: string;
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  { key: "wechat",   label: "微信",       size: "square",    form: "summary", hint: "1:1 通用卡片" },
  { key: "xhs",      label: "小红书",     size: "portrait",  form: "summary", hint: "4:5 竖版" },
  { key: "twitter",  label: "Twitter/X",  size: "landscape", form: "summary", hint: "1.91:1 横版" },
];

export interface ShareOptions {
  size?: ShareSize;
  form?: ShareForm;
  /** form='series' 时使用的文章列表（同专栏/系列） */
  series?: ArticleIndexEntry[];
}

/* ────────────── 文本工具 ────────────── */

/** 折行核心：按最大宽度折行，可选省略号截断，并统一应用避头尾 */
function wrapCore(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  truncate: boolean,
): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line = "";
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (truncate && lines.length === maxLines - 1) {
        break;
      }
    } else {
      line = test;
    }
  }
  if (truncate) {
    if (lines.length < maxLines) {
      lines.push(line);
    } else {
      let last = line;
      while (ctx.measureText(last + "…").width > maxWidth && last.length > 0) {
        last = last.slice(0, -1);
      }
      lines.push(last + "…");
    }
  } else if (line) {
    lines.push(line);
  }
  return applyKinsoku(lines, ctx, maxWidth);
}

/** 把长文本按最大宽度折行（带省略号截断） */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  return wrapCore(ctx, text, maxWidth, maxLines, true);
}

/** 折行但不截断（用于长图高度测量，与绘制共用同一避头尾逻辑） */
function wrapAll(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return wrapCore(ctx, text, maxWidth, Number.MAX_SAFE_INTEGER, false);
}

/** 去除 markdown / 链接语法，得到纯文本 */
function toPlain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从正文抽取一句最有分量的「金句」 */
function pickQuote(content: string): string {
  const body = toPlain(content);
  if (!body) return "";
  const parts = body.split(/([。！？”])/);
  const raw: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const seg = (parts[i] + (parts[i + 1] ?? "")).trim();
    if (seg) raw.push(seg);
  }
  const sents = raw.filter((s) => s.length >= 12 && s.length <= 60);
  if (sents.length === 0) {
    const fallback = body.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    return fallback[0] ?? "";
  }
  const keys = ["是", "即", "故", "所以", "意味着", "本质", "关键", "在于", "：", "——"];
  let best = sents[0];
  let bestScore = -1;
  for (const s of sents) {
    let score = 0;
    if (s.length >= 18 && s.length <= 42) score += 2;
    for (const k of keys) if (s.includes(k)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** 从正文抽取若干段摘录（用于长图） */
function extractExcerpts(content: string, count: number): string[] {
  const paras = content
    .split(/\n{2,}/)
    .map((p) => toPlain(p))
    .filter((p) => p.length >= 16 && !/^[#>\-*]/.test(p));
  if (paras.length === 0) return [];
  return paras.slice(0, count);
}

/* ────────────── 通用绘制原语 ────────────── */

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = createEl("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  return { canvas, ctx };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("导出图片失败"))),
      "image/png",
    );
  });
}

/** 满足 summary / series 卡片所需的元数据子集 */
type CardMeta = Pick<ArticleMeta, "title" | "category" | "summary" | "author" | "date">;

/** 在右下角画一个安静的「竹杖芒鞋」字标（非斜体、非长诗水印） */
function drawWordmark(ctx: CanvasRenderingContext2D, cr: number, y: number, size: number): void {
  ctx.textAlign = "right";
  ctx.fillStyle = BAMBOO_SOFT;
  ctx.font = serif(500, size);
  ctx.fillText("竹杖芒鞋", cr, y);
  ctx.textAlign = "left";
}

/* ────────────── 形态一：摘要卡（多比例 · 极简宣纸） ────────────── */

function drawSummaryCard(meta: CardMeta, size: ShareSize): Promise<Blob> {
  const spec = SIZE_SPECS[size];
  const w = spec.w;
  const h = typeof spec.h === "number" ? spec.h : 1080;
  const { ctx } = newCanvas(w, h);

  // 纯宣纸底，无渐变、无白卡
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const cx = spec.pad;
  const cr = w - spec.pad;
  const cw = cr - cx;

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // 栏目标识（竹青衬线，克制）
  const brandSize = Math.round(spec.title * 0.46);
  ctx.fillStyle = BAMBOO;
  ctx.font = serif(600, brandSize);
  const brandY = Math.round(spec.pad + brandSize * 1.1);
  ctx.fillText(`${AUTHOR_NAME} · 专栏`, cx, brandY);

  // 分类（竹青小圆点 + 暖灰文字，绝不用横杠/竖线）
  let anchorY = brandY;
  if (meta.category) {
    anchorY = brandY + Math.round(brandSize * 1.9);
    const dotR = Math.max(3, Math.round(brandSize * 0.16));
    ctx.fillStyle = BAMBOO;
    ctx.beginPath();
    ctx.arc(cx + dotR, anchorY - dotR * 1.1, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK_SOFT;
    ctx.font = sans(400, brandSize);
    ctx.fillText(meta.category, cx + dotR * 2 + 12, anchorY);
  }

  // 标题（衬线大字 + 大留白）
  ctx.fillStyle = INK;
  ctx.font = serif(700, spec.title);
  const titleLines = wrapText(ctx, meta.title, cw, spec.titleLines);
  const titleLh = Math.round(spec.title * 1.4);
  let y = anchorY + Math.round(spec.title * 1.5) + spec.title;
  for (let i = 0; i < titleLines.length; i++) {
    const ln = titleLines[i];
    if (i < titleLines.length - 1) fillJustified(ctx, ln, cx, y, cw);
    else ctx.fillText(ln, cx, y);
    y += titleLh;
  }

  // 摘要（无衬线暖灰，行距宽松）
  if (meta.summary) {
    ctx.fillStyle = INK_SOFT;
    ctx.font = sans(400, spec.sum);
    const sumLines = wrapText(ctx, meta.summary, cw, spec.sumLines);
    const sumLh = Math.round(spec.sum * 1.55);
    y += Math.round(spec.sum * 1.2);
    for (let i = 0; i < sumLines.length; i++) {
      const ln = sumLines[i];
      if (i < sumLines.length - 1) fillJustified(ctx, ln, cx, y, cw);
      else ctx.fillText(ln, cx, y);
      y += sumLh;
    }
  }

  // 底部署名 + 日期 + 安静字标
  const footerY = h - spec.pad - Math.round(spec.sum * 0.3);
  const author = meta.author ?? AUTHOR_NAME;
  ctx.fillStyle = BAMBOO;
  ctx.font = serif(600, Math.round(spec.title * 0.5));
  ctx.fillText(author, cx, footerY);

  ctx.fillStyle = INK_SOFT;
  ctx.font = sans(400, Math.round(spec.title * 0.42));
  ctx.fillText(meta.date, cx, footerY + Math.round(spec.title * 0.6));

  drawWordmark(ctx, cr, footerY + Math.round(spec.title * 0.6), Math.round(spec.title * 0.42));

  return canvasToBlob(ctx.canvas);
}

/* ────────────── 形态二：金句卡（Pull Quote · 极简宣纸） ────────────── */

function drawQuoteCard(article: Article, size: ShareSize): Promise<Blob> {
  const spec = SIZE_SPECS[size];
  const w = spec.w;
  const h = typeof spec.h === "number" ? spec.h : 1080;
  const { ctx } = newCanvas(w, h);

  // 纯宣纸底
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const pad = spec.pad + 12;
  const maxW = w - pad * 2;

  // 淡竹青大引号（编辑式装饰，非廉价水印）
  ctx.fillStyle = "rgba(74,124,89,0.16)";
  ctx.textBaseline = "alphabetic";
  ctx.font = serif(700, Math.round(w * 0.26));
  ctx.fillText("“", pad - Math.round(w * 0.01), Math.round(h * 0.3));

  // 金句（墨黑衬线大字）
  const quote = pickQuote(article.content) || article.summary || article.title;
  const qSize = Math.round(w * 0.055);
  ctx.fillStyle = INK;
  ctx.font = serif(700, qSize);
  const lines = wrapText(ctx, quote, maxW, 8);
  const lh = Math.round(qSize * 1.5);
  const blockH = lines.length * lh;
  let qy = Math.round((h - blockH) / 2) + Math.round(lh * 0.9);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (i < lines.length - 1) fillJustified(ctx, ln, pad, qy, maxW);
    else ctx.fillText(ln, pad, qy);
    qy += lh;
  }

  // 出处（竹青衬线小字）
  ctx.fillStyle = BAMBOO;
  ctx.font = serif(500, Math.round(w * 0.03));
  ctx.fillText(`— ${article.title}`, pad, qy + Math.round(qSize * 0.7));

  return canvasToBlob(ctx.canvas);
}

/* ────────────── 形态三：长图文摘卡（高度自适应 · 极简宣纸） ────────────── */

function drawLongCard(article: Article, size: ShareSize): Promise<Blob> {
  const spec = SIZE_SPECS[size];
  const w = spec.w;
  const pad = spec.pad;
  const cw = w - pad * 2;

  // 先计算内容高度（两遍渲染：先测量）
  const { ctx: mctx } = newCanvas(w, 10);

  const brandSize = Math.round(spec.title * 0.46);
  const titleLh = Math.round(spec.title * 1.4);
  const sumLh = Math.round(spec.sum * 1.55);

  let total = pad + brandSize * 1.1; // 栏目标识
  if (article.category) total += Math.round(brandSize * 1.9);

  mctx.font = serif(700, spec.title);
  total += wrapAll(mctx, article.title, cw).length * titleLh + Math.round(spec.title * 1.7);

  const excerpts = extractExcerpts(article.content, 4);
  const excerptSizes = excerpts.map((ex) => {
    mctx.font = sans(400, spec.sum);
    const ls = wrapAll(mctx, ex, cw);
    total += ls.length * sumLh + Math.round(spec.sum * 1.6); // 段间距
    return ls.length;
  });

  total += pad + Math.round(spec.title * 1.1); // 底部署名
  const h = Math.max(total, 1080);

  const { ctx } = newCanvas(w, h);

  // 纯宣纸底
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const cx = pad;
  const cr = w - pad;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // 栏目标识
  ctx.fillStyle = BAMBOO;
  ctx.font = serif(600, brandSize);
  const brandY = Math.round(pad + brandSize * 1.1);
  ctx.fillText(`${AUTHOR_NAME} · 专栏`, cx, brandY);

  let y = brandY;
  if (article.category) {
    y = brandY + Math.round(brandSize * 1.9);
    const dotR = Math.max(3, Math.round(brandSize * 0.16));
    ctx.fillStyle = BAMBOO;
    ctx.beginPath();
    ctx.arc(cx + dotR, y - dotR * 1.1, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK_SOFT;
    ctx.font = sans(400, brandSize);
    ctx.fillText(article.category, cx + dotR * 2 + 12, y);
  }

  // 标题
  ctx.fillStyle = INK;
  ctx.font = serif(700, spec.title);
  const titleLines = wrapText(ctx, article.title, cw, spec.titleLines + 6);
  y += Math.round(spec.title * 1.5) + spec.title;
  for (let i = 0; i < titleLines.length; i++) {
    const ln = titleLines[i];
    if (i < titleLines.length - 1) fillJustified(ctx, ln, cx, y, cw);
    else ctx.fillText(ln, cx, y);
    y += titleLh;
  }
  y += Math.round(spec.sum * 1.2);

  // 摘录段落
  ctx.fillStyle = INK_SOFT;
  ctx.font = sans(400, spec.sum);
  for (let i = 0; i < excerpts.length; i++) {
    const ls = wrapText(ctx, excerpts[i], cw, excerptSizes[i] + 4);
    for (let j = 0; j < ls.length; j++) {
      const ln = ls[j];
      if (j < ls.length - 1) fillJustified(ctx, ln, cx, y, cw);
      else ctx.fillText(ln, cx, y);
      y += sumLh;
    }
    y += Math.round(spec.sum * 1.6);
  }

  // 署名 + 安静字标
  const footerY = h - pad - Math.round(spec.sum * 0.3);
  const author = article.author ?? AUTHOR_NAME;
  ctx.fillStyle = BAMBOO;
  ctx.font = serif(600, Math.round(spec.title * 0.5));
  ctx.fillText(author, cx, footerY);

  ctx.fillStyle = INK_SOFT;
  ctx.font = sans(400, Math.round(spec.title * 0.42));
  ctx.fillText(article.date, cx, footerY + Math.round(spec.title * 0.6));

  drawWordmark(ctx, cr, footerY + Math.round(spec.title * 0.6), Math.round(spec.title * 0.42));

  return canvasToBlob(ctx.canvas);
}

/* ────────────── 主入口：按形态生成一张或多张 ────────────── */

/**
 * 生成分享卡片，返回 Blob 数组（series 形态为多张）。
 */
export async function renderShareCards(
  article: Article,
  opts: ShareOptions = {},
): Promise<Blob[]> {
  const size = opts.size ?? "square";
  const form = opts.form ?? "summary";

  switch (form) {
    case "quote":
      return [await drawQuoteCard(article, size)];
    case "long":
      return [await drawLongCard(article, size)];
    case "series": {
      const list = (opts.series && opts.series.length > 0 ? opts.series : [article]).slice(0, 6);
      const blobs = await Promise.all(
        list.map((entry) =>
          drawSummaryCard(
            {
              title: entry.title,
              category: entry.category,
              summary: entry.summary,
              author: entry.author,
              date: entry.date,
            },
            size,
          ),
        ),
      );
      return blobs;
    }
    case "summary":
    default:
      return [
        await drawSummaryCard(
          {
            title: article.title,
            category: article.category,
            summary: article.summary,
            author: article.author,
            date: article.date,
          },
          size,
        ),
      ];
  }
}

/** 兼容旧调用：生成单张摘要卡 */
export async function renderShareCard(article: Article): Promise<Blob> {
  const blobs = await renderShareCards(article);
  return blobs[0];
}

/** 生成安全的文件名 */
export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}
