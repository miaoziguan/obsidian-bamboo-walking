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

const FETCH_TIMEOUT = 8000;

export class GitHubArticleService {
  async fetchIndex(): Promise<ArticleIndexEntry[]> {
    const url = this.buildUrl(INDEX_PATH);
    const text = await this.fetchText(url);
    try {
      return JSON.parse(text) as ArticleIndexEntry[];
    } catch {
      throw new Error("索引数据格式异常，请稍后重试");
    }
  }

  async fetchArticle(entry: ArticleIndexEntry): Promise<Article> {
    const url = this.buildUrl(`${ARTICLES_PATH}/${entry.slug}.md`);
    const raw = await this.fetchText(url);
    const { frontmatter, body } = parseFrontmatter(raw);
    return { ...entry, ...frontmatter, content: body };
  }

  private buildUrl(filePath: string): string {
    return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
  }

  private async fetchText(url: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("请求超时")), FETCH_TIMEOUT),
    );

    const req = requestUrl({ url, headers }).then((resp) => {
      if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
      return resp.text;
    });

    return Promise.race([req, timeout]);
  }
}
