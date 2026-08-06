/* ────────────── 留言板服务 ────────────── */
/*
 * 留言板用「内容仓库」的 GitHub Issues 承载，一条留言 = 一个 issue（统一标签）。
 * 插件内调 GitHub 公开 API 拉取并展示；读者想发言则跳转 GitHub Issues 页。
 *
 * 纯客户端、零后端、无需 token。无 token 的 GitHub API 限流 60 次/小时，
 * 因此做本地缓存（默认 5 分钟）应对；任何异常都降级到上次缓存，不影响主功能。
 */

import { requestUrl } from "obsidian";
import {
  MESSAGE_BOARD_API_URL,
  MESSAGE_BOARD_CACHE_MS,
  MESSAGE_BOARD_LABEL,
  MESSAGE_BOARD_REPO,
  MESSAGE_BOARD_OWNER,
} from "../constants";

/** 单条留言 */
export interface MessageBoardEntry {
  /** GitHub issue 编号 */
  number: number;
  /** 留言标题（issue 标题） */
  title: string;
  /** 留言正文（issue body） */
  body: string;
  /** 发言者名字 */
  author: string;
  /** 发言者头像 URL */
  authorAvatar: string;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
  /** 该留言的 GitHub 链接 */
  url: string;
}

/** 拉取结果 */
export interface MessageBoardResult {
  entries: MessageBoardEntry[];
  /** 是否降级缓存（离线/超时/失败，读到的是旧数据） */
  stale: boolean;
  /** 数据来源时间（成功拉取或缓存命中时间） */
  fetchedAt: number;
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
  private cache: { entries: MessageBoardEntry[]; fetchedAt: number } | null = null;

  constructor(private tokenStore?: MessageBoardTokenStore) {}

  /** 读取已保存的 token（读者自己的 GitHub PAT，需 public_repo 权限） */
  getToken(): string {
    return this.tokenStore?.getToken() ?? "";
  }

  /** 保存 token 到插件本地 data */
  setToken(token: string): void {
    this.tokenStore?.setToken(token);
  }

  /**
   * 创建一条留言（GitHub issue）。需要读者自己的 token 认证。
   * @returns 成功返回新 issue 的 URL；失败抛出含信息 Error。
   */
  async createMessage(title: string, body: string): Promise<string> {
    const token = this.getToken().trim();
    if (!token) {
      throw new Error("尚未配置 GitHub Token，请先填写");
    }
    if (!title.trim()) {
      throw new Error("留言标题不能为空");
    }
    const resp = await requestUrl({
      url: `https://api.github.com/repos/${MESSAGE_BOARD_OWNER}/${MESSAGE_BOARD_REPO}/issues`,
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: title.trim(),
        body: body.trim() || undefined,
        labels: [MESSAGE_BOARD_LABEL],
      }),
      throw: false,
    });
    if (resp.status !== 201) {
      // 401/403 = token 无效/无权限；429 = 限流
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

  /**
   * 拉取留言。force=false 时命中 5 分钟本地缓存即返回；
   * 网络失败降级到旧缓存（stale=true），无缓存则返回空。
   */
  async fetchMessages(force = false): Promise<MessageBoardResult> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.fetchedAt < MESSAGE_BOARD_CACHE_MS) {
      return { entries: this.cache.entries, stale: false, fetchedAt: this.cache.fetchedAt };
    }

    try {
      const resp = await requestUrl({
        url: MESSAGE_BOARD_API_URL,
        method: "GET",
        throw: false,
      });
      if (resp.status !== 200) {
        throw new Error(`GitHub API ${resp.status}`);
      }
      const list = resp.json as GitHubIssue[];
      const entries: MessageBoardEntry[] = list
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number ?? 0,
          title: i.title ?? "",
          body: i.body ?? "",
          author: i.user?.login ?? "unknown",
          authorAvatar: i.user?.avatar_url ?? "",
          createdAt: i.created_at ?? "",
          url: i.html_url ?? `https://github.com/${MESSAGE_BOARD_OWNER}/${MESSAGE_BOARD_REPO}/issues/${i.number ?? ""}`,
        }));
      this.cache = { entries, fetchedAt: now };
      return { entries, stale: false, fetchedAt: now };
    } catch {
      // 降级到旧缓存
      if (this.cache) {
        return { entries: this.cache.entries, stale: true, fetchedAt: this.cache.fetchedAt };
      }
      return { entries: [], stale: true, fetchedAt: now };
    }
  }
}
