/* ────────────── 留言板服务 ────────────── */
/*
 * 留言板与文章评论都用「内容仓库」的 GitHub Issues 承载，一条留言/评论 = 一个 issue。
 *  - 全局留言：标签「留言板」
 *  - 文章评论：标签「评论」，body 首行带 slug 元数据（slug: xxx）关联文章
 * 插件内调 GitHub 公开 API 拉取并展示；读者想发言则填自己的 token 在插件内创建。
 *
 * 纯客户端、零后端。无 token 的 GitHub API 限流 60 次/小时，
 * 按标签分开做本地缓存（默认 5 分钟）应对；任何异常都降级到上次缓存。
 */

import { requestUrl } from "obsidian";
import {
  MESSAGE_BOARD_CACHE_MS,
  MESSAGE_BOARD_LABEL,
  MESSAGE_COMMENT_LABEL,
  MESSAGE_SLUG_KEY,
  MESSAGE_BOARD_REPO,
  MESSAGE_BOARD_OWNER,
} from "../constants";

/** 单条留言/评论 */
export interface MessageBoardEntry {
  /** GitHub issue 编号 */
  number: number;
  /** 标题（issue 标题） */
  title: string;
  /** 正文（issue body，已剥离 slug 元数据） */
  body: string;
  /** 发言者名字 */
  author: string;
  /** 发言者头像 URL */
  authorAvatar: string;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
  /** 该条目的 GitHub 链接 */
  url: string;
  /** 关联的文章 slug（文章评论才有；全局留言为空） */
  slug?: string;
}

/** 拉取结果 */
export interface MessageBoardResult {
  entries: MessageBoardEntry[];
  /** 是否降级缓存（离线/超时/失败，读到的是旧数据） */
  stale: boolean;
  /** 数据来源时间 */
  fetchedAt: number;
}

/** 创建留言/评论的参数 */
export interface CreateMessageOptions {
  /** 关联文章 slug：传入则创建「文章评论」（评论标签 + body 带 slug）；省略则创建「全局留言」（留言板标签） */
  slug?: string;
}

/** GitHub Issues API 单条结构（仅取用字段） */
interface GitHubIssue {
  number?: number;
  title?: string;
  body?: string | null;
  user?: { login?: string; avatar_url?: string } | null;
  created_at?: string;
  html_url?: string;
  pull_request?: unknown;
}

export interface MessageBoardTokenStore {
  getToken: () => string;
  setToken: (token: string) => void;
}

export class MessageBoardService {
  /** 按标签分开的缓存：label -> { entries, fetchedAt } */
  private caches = new Map<string, { entries: MessageBoardEntry[]; fetchedAt: number }>();

  constructor(private tokenStore?: MessageBoardTokenStore) {}

  /** 读取已保存的 token（读者自己的 GitHub PAT，需 public_repo 权限） */
  getToken(): string {
    return this.tokenStore?.getToken() ?? "";
  }

  /** 保存 token 到插件本地 data */
  setToken(token: string): void {
    this.tokenStore?.setToken(token);
  }

  /** 依据标签构造拉取 URL（一次只拉一个标签，对限流友好） */
  private buildApiUrl(label: string): string {
    return (
      `https://api.github.com/repos/${MESSAGE_BOARD_OWNER}/${MESSAGE_BOARD_REPO}/issues` +
      `?state=all&labels=${encodeURIComponent(label)}&sort=updated&direction=desc&per_page=100`
    );
  }

  /** 解析 issue body 里的 slug 元数据：取 frontmatter 格式的 slug: xxx，并返回剥离后的正文 */
  private parseSlug(body: string): { slug?: string; content: string } {
    const firstLine = body.split("\n")[0]?.trim() ?? "";
    if (firstLine.startsWith(`${MESSAGE_SLUG_KEY}:`)) {
      const slug = firstLine.slice(MESSAGE_SLUG_KEY.length + 1).trim();
      const rest = body.split("\n").slice(1).join("\n").replace(/^\s*-+\s*\n?/, "").trim();
      return { slug: slug || undefined, content: rest };
    }
    return { slug: undefined, content: body.trim() };
  }

  /**
   * 拉取指定标签的留言/评论。force=false 时命中 5 分钟本地缓存即返回；
   * 网络失败降级到旧缓存（stale=true），无缓存则返回空。
   * @param label 要拉取的标签（MESSAGE_BOARD_LABEL=全局留言 / MESSAGE_COMMENT_LABEL=文章评论）
   */
  async fetchMessages(label: string, force = false): Promise<MessageBoardResult> {
    const now = Date.now();
    const cached = this.caches.get(label);
    if (!force && cached && now - cached.fetchedAt < MESSAGE_BOARD_CACHE_MS) {
      return { entries: cached.entries, stale: false, fetchedAt: cached.fetchedAt };
    }

    try {
      const resp = await requestUrl({
        url: this.buildApiUrl(label),
        method: "GET",
        throw: false,
      });
      if (resp.status !== 200) {
        throw new Error(`GitHub API ${resp.status}`);
      }
      const list = resp.json as GitHubIssue[];
      const entries: MessageBoardEntry[] = list
        .filter((i) => !i.pull_request)
        .map((i) => {
          const rawBody = i.body ?? "";
          const { slug, content } = this.parseSlug(rawBody);
          return {
            number: i.number ?? 0,
            title: i.title ?? "",
            body: content,
            author: i.user?.login ?? "unknown",
            authorAvatar: i.user?.avatar_url ?? "",
            createdAt: i.created_at ?? "",
            url: i.html_url ?? `https://github.com/${MESSAGE_BOARD_OWNER}/${MESSAGE_BOARD_REPO}/issues/${i.number ?? ""}`,
            ...(slug ? { slug } : {}),
          };
        });
      this.caches.set(label, { entries, fetchedAt: now });
      return { entries, stale: false, fetchedAt: now };
    } catch {
      // 降级到旧缓存
      if (cached) {
        return { entries: cached.entries, stale: true, fetchedAt: cached.fetchedAt };
      }
      return { entries: [], stale: true, fetchedAt: now };
    }
  }

  /** 按文章 slug 过滤评论（在已拉取的「评论」条目上过滤，无需额外请求） */
  filterBySlug(entries: MessageBoardEntry[], slug: string): MessageBoardEntry[] {
    return entries.filter((e) => e.slug === slug);
  }

  /**
   * 创建一条留言或文章评论（GitHub issue）。需要读者自己的 token 认证。
   * opts.slug 传入则创建文章评论（评论标签 + body 带 slug），否则创建全局留言（留言板标签）。
   * @returns 成功返回新 issue 的 URL；失败抛出含信息 Error。
   */
  async createMessage(title: string, body: string, opts?: CreateMessageOptions): Promise<string> {
    const token = this.getToken().trim();
    if (!token) {
      throw new Error("尚未配置 GitHub Token，请先填写");
    }
    if (!title.trim()) {
      throw new Error("标题不能为空");
    }
    const label = opts?.slug ? MESSAGE_COMMENT_LABEL : MESSAGE_BOARD_LABEL;
    // 文章评论：body 首行插入 slug 元数据；全局留言：纯内容
    const issueBody = opts?.slug
      ? `${MESSAGE_SLUG_KEY}: ${opts.slug}\n---\n${body.trim()}`
      : body.trim();

    const resp = await requestUrl({
      url: `https://api.github.com/repos/${MESSAGE_BOARD_OWNER}/${MESSAGE_BOARD_REPO}/issues`,
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: title.trim(),
        body: issueBody || undefined,
        labels: [label],
      }),
      throw: false,
    });
    if (resp.status !== 201) {
      const hint =
        resp.status === 401 || resp.status === 403
          ? "Token 无效或无 public_repo 权限，请检查"
          : resp.status === 429
            ? "GitHub 请求过于频繁，请稍后再试"
            : `创建失败（GitHub ${resp.status}）`;
      throw new Error(hint);
    }
    const data = resp.json as { html_url?: string };
    return data.html_url ?? `https://github.com/${MESSAGE_BOARD_OWNER}/${MESSAGE_BOARD_REPO}/issues`;
  }
}
