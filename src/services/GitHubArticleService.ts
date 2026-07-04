/* ────────────── GitHub 文章服务 ────────────── */
import { requestUrl } from "obsidian";
import type { Article, ArticleIndexEntry } from "../types";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_TOKEN,
  INDEX_PATH,
  ARTICLES_PATH,
} from "../constants";
import { parseFrontmatter } from "../utils/yaml";

export class GitHubArticleService {
  /** 从仓库获取文章索引 */
  async fetchIndex(): Promise<ArticleIndexEntry[]> {
    const url = this.buildRawUrl(INDEX_PATH);
    const text = await this.fetchText(url);
    try {
      return JSON.parse(text) as ArticleIndexEntry[];
    } catch {
      throw new Error("索引数据格式异常，请稍后重试");
    }
  }

  /** 获取单篇文章内容 */
  async fetchArticle(entry: ArticleIndexEntry): Promise<Article> {
    const filePath = `${ARTICLES_PATH}/${entry.slug}.md`;
    const url = this.buildRawUrl(filePath);
    const raw = await this.fetchText(url);
    const { frontmatter, body } = parseFrontmatter(raw);
    return { ...entry, ...frontmatter, content: body };
  }

  /* ─── 内部工具 ─── */

  private buildRawUrl(filePath: string): string {
    return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
  }

  private async fetchText(url: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    const resp = await requestUrl({ url, headers });
    if (resp.status !== 200) {
      throw new Error(`HTTP ${resp.status}: ${url}`);
    }
    return resp.text;
  }
}
