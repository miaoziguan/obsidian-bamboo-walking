/* ────────────── 本地文章服务（测试用） ────────────── */
import type { Article, ArticleIndexEntry } from "../types";
import { parseFrontmatter } from "../utils/yaml";

/**
 * 从 vault 本地目录读取文章，用于在没有 GitHub 仓库时测试插件。
 * 读取 vault 根目录下的 bamboo-column/ 文件夹：
 *   bamboo-column/index.json          → 索引
 *   bamboo-column/{slug}.md           → 文章正文
 */
export class LocalArticleService {
  constructor(
    private basePath: string,
    private adapter: {
      exists: (path: string) => Promise<boolean>;
      read: (path: string) => Promise<string>;
    },
  ) {}

  async fetchIndex(): Promise<ArticleIndexEntry[]> {
    const indexPath = `${this.basePath}/index.json`;
    const exists = await this.adapter.exists(indexPath);
    if (!exists) return [];
    const text = await this.adapter.read(indexPath);
    return JSON.parse(text) as ArticleIndexEntry[];
  }

  async fetchArticle(entry: ArticleIndexEntry): Promise<Article> {
    const filePath = `${this.basePath}/${entry.slug}.md`;
    const raw = await this.adapter.read(filePath);
    const { frontmatter, body } = parseFrontmatter(raw);
    // index.json 优先，frontmatter 仅作后备
    return { ...frontmatter, ...entry, content: body };
  }
}
