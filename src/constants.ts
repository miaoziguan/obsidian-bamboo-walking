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

/** GitHub PAT（可选，留空即可；仅在你自己的开发环境用） */
export const GITHUB_TOKEN = "";

/** 自动刷新间隔（分钟），0 = 禁用 */
export const REFRESH_INTERVAL = 30;

/** 索引缓存有效期（毫秒） */
export const CACHE_EXPIRY = 30 * 60 * 1000;  // 30 分钟

/** 插件数据缓存键名 */
export const CACHE_KEY = "bamboo-walking-cache";

/** 作者显示名（用于文章头部署名） */
export const AUTHOR_NAME = "竹杖芒鞋";
