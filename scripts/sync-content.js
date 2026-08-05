#!/usr/bin/env node
/**
 * 将内容源 bamboo-column/articles 同步到插件 content/articles。
 * 先在本仓库内重算 hash（generate-index --strict），再整体拷贝，
 * 最后校验条目数一致。任一环节失败则非零退出，阻断 CI 流出陈旧 content。
 *
 * 用法: node scripts/sync-content.js
 */

const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
// CI 下通过 BAMBOO_COLUMN_ROOT 注入（checkout 到 workspace 内）；
// 本地开发与 GitHub 拉取通道下，bamboo-column 与 obsidian-bamboo-walking 同级。
const SRC_ROOT = process.env.BAMBOO_COLUMN_ROOT
  ? path.resolve(process.env.BAMBOO_COLUMN_ROOT)
  : path.resolve(__dirname, "..", "..", "bamboo-column");

const GEN_INDEX = path.join(SRC_ROOT, "scripts", "generate-index.js");
const DEST_ARTICLES = path.join(PLUGIN_ROOT, "content", "articles");

function cpDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

/**
 * 同步内容源到插件 content/。
 * 内容源（bamboo-column）在 CI 构建环境下通常不存在：本地开发时它常与插件
 * 仓库同级；CI 仅 checkout 插件仓库且未注入 BAMBOO_COLUMN_ROOT。此时跳过
 * 同步，直接使用仓库内已提交的 content/articles，不阻塞插件构建。
 * @param {string} srcRoot 内容源仓库根（含 articles/）
 * @param {string} destArticles 插件 content/articles 目标目录
 * @param {{strict?: boolean}} [opts]
 * @returns {boolean} true=已同步，false=源不可用已跳过
 */
function syncContent(srcRoot, destArticles, { strict = false } = {}) {
  const srcArticles = path.join(srcRoot, "articles");
  // 源脚本或源目录缺失（典型 CI 场景）：跳过，复用已提交的 content
  if (!fs.existsSync(GEN_INDEX) || !fs.existsSync(srcArticles)) {
    console.warn(
      `⚠️ 未找到内容源 (${srcRoot})，跳过内容同步，` +
        `使用仓库内已提交的 content/articles。`,
    );
    return false;
  }

  // 动态加载内容源的 generate-index（路径随 SRC_ROOT 而定，兼容 CI 与本地）
  const { runGenerate } = require(GEN_INDEX);

  // 1) 源内生成最新 hash（strict 模式校验字段与一致性）
  runGenerate(srcRoot, { strict });

  // 2) 整体拷贝到插件 content/
  cpDir(srcArticles, destArticles);

  // 3) 校验：条目数一致
  const readCount = (p) =>
    JSON.parse(fs.readFileSync(p, "utf8")).length;
  const srcIdx = path.join(srcArticles, "index.json");
  const destIdx = path.join(destArticles, "index.json");
  if (!fs.existsSync(destIdx)) {
    throw new Error(`同步校验失败：目标缺少 index.json (${destIdx})`);
  }
  const srcN = readCount(srcIdx);
  const destN = readCount(destIdx);
  if (srcN !== destN) {
    throw new Error(`同步校验失败：源 ${srcN} 篇 / 目标 ${destN} 篇`);
  }

  console.log(`✅ 内容同步完成：源 ${srcN} 篇 → ${path.relative(PLUGIN_ROOT, destArticles)}`);
}

module.exports = { syncContent, cpDir };

if (require.main === module) {
  try {
    syncContent(SRC_ROOT, DEST_ARTICLES, { strict: true });
  } catch (e) {
    console.error("❌ 内容同步失败:", e.message);
    process.exit(1);
  }
}
