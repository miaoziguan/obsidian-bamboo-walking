/* ────────────── 分享工具：生成分享图 ────────────── */
import type { Article } from "../types";

/* ── 分享图：竹林风格卡片，Canvas 绘制导出 PNG ── */

interface ShareTheme {
  bg1: string;
  bg2: string;
  ink: string;
  inkLight: string;
  bamboo: string;
  bambooDeep: string;
  paper: string;
}

const THEME: ShareTheme = {
  bg1: "#faf8f3",
  bg2: "#eef3ea",
  ink: "#2c2c2c",
  inkLight: "#5a5a5a",
  bamboo: "#4a7c59",
  bambooDeep: "#3d6b4a",
  paper: "#ffffff",
};

const W = 1080;
const H = 1080;
const PAD = 96;

/** 把长文本按最大宽度折行 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line = "";
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines - 1) {
        // 最后一行，剩余全部塞入并省略
        break;
      }
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines) {
    lines.push(line);
  } else {
    // 超出，末行加省略号
    let last = line;
    while (ctx.measureText(last + "…").width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines.push(last + "…");
  }
  return lines;
}

/** 渲染分享卡片为 Blob（PNG） */
export async function renderShareCard(article: Article): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  // 背景渐变
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, THEME.bg1);
  grad.addColorStop(1, THEME.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 内层留白卡片
  const cardX = 56;
  const cardY = 56;
  const cardW = W - cardX * 2;
  const cardH = H - cardY * 2;
  ctx.fillStyle = THEME.paper;
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fill();

  // 左侧竹青竖条装饰
  ctx.fillStyle = THEME.bamboo;
  roundRect(ctx, cardX, cardY + 64, 8, cardH - 128, 4);
  ctx.fill();

  const contentX = PAD;
  const contentR = W - PAD;
  const contentW = contentR - contentX;

  // 顶部：栏目标识
  ctx.fillStyle = THEME.bamboo;
  ctx.font = "600 30px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("竹杖芒鞋 · 专栏", contentX, cardY + 128);

  // 分类
  if (article.category) {
    ctx.fillStyle = THEME.inkLight;
    ctx.font = "400 26px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.fillText(`# ${article.category}`, contentX, cardY + 176);
  }

  // 标题（大字，最多 4 行）
  ctx.fillStyle = THEME.ink;
  ctx.font = "700 62px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const titleLines = wrapText(ctx, article.title, contentW, 4);
  let y = cardY + 288;
  const titleLh = 84;
  for (const ln of titleLines) {
    ctx.fillText(ln, contentX, y);
    y += titleLh;
  }

  // 标题下短竹节线
  y += 12;
  ctx.fillStyle = THEME.bamboo;
  roundRect(ctx, contentX, y, 96, 6, 3);
  ctx.fill();
  y += 60;

  // 摘要（最多 6 行）
  if (article.summary) {
    ctx.fillStyle = THEME.inkLight;
    ctx.font = "400 34px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const sumLines = wrapText(ctx, article.summary, contentW, 6);
    const sumLh = 52;
    for (const ln of sumLines) {
      ctx.fillText(ln, contentX, y);
      y += sumLh;
    }
  }

  // 底部署名 + 日期
  const footerY = cardY + cardH - 96;
  ctx.fillStyle = THEME.bambooDeep;
  ctx.font = "600 32px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const author = article.author || AUTHOR_NAME;
  ctx.fillText(author, contentX, footerY);

  ctx.fillStyle = THEME.inkLight;
  ctx.font = "400 26px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(article.date, contentX, footerY + 40);

  // 右下角水印
  ctx.textAlign = "right";
  ctx.fillStyle = THEME.bamboo;
  ctx.font = "italic 400 24px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText("一蓑烟雨任平生", contentR, footerY + 40);
  ctx.textAlign = "left";

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("导出图片失败"));
    }, "image/png");
  });
}

/** 圆角矩形路径 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 生成安全的文件名 */
export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}
