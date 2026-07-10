/* ────────────── 竹杖芒鞋 · 作者常量 ────────────── */
/*
 * 这些是你（作者）的固定配置，读者不需要感知。
 * 换仓库/换分支时改这里的值，重新构建发布即可。
 *
 * DEV_MODE 不在此文件——由 esbuild define 注入，
 * 开发构建自动为 true，生产构建自动为 false。
 */

/** 内容仓库 owner（GitHub 用户名或组织名） */
export const GITHUB_OWNER = "miaoziguan";

/** 内容仓库名称 */
export const GITHUB_REPO = "bamboo-column";

/** 内容分支 */
export const GITHUB_BRANCH = "main";

/** 索引文件在仓库中的路径 */
export const INDEX_PATH = "articles/index.json";

/** 文章 .md 文件在仓库中的根目录 */
export const ARTICLES_PATH = "articles";

/** 自动刷新间隔（分钟），0 = 禁用 */
export const REFRESH_INTERVAL = 30;

/** 插件数据缓存键名 */
export const CACHE_KEY = "bamboo-walking-cache";

/** 作者显示名（用于文章头部署名） */
export const AUTHOR_NAME = "竹杖芒鞋";

/* ────────────── 作者卡片（侧边栏左上角博客式简介） ────────────── */
/* 固定写死，非读者可配置项。换头像/简介改这里 + 替换插件根目录 avatar.png */

/** 作者卡片显示名 */
export const PROFILE_NAME = "羽鳞君";

/** 作者头像文件名（位于插件根目录，与 main.js / manifest.json 同级） */
export const PROFILE_AVATAR = "avatar.png";

/** 作者简介 */
export const PROFILE_BIO =
  "竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。欢迎来到喵字馆创始人羽鳞君的Obsidian后室。";

/** 作者社交/链接 */
export const PROFILE_LINKS: { label: string; url: string }[] = [
  { label: "GitHub", url: "https://github.com/miaoziguan" },
];
