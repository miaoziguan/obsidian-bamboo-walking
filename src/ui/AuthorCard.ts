/* ────────────── 作者卡片组件（侧边栏左上角博客式简介） ────────────── */
import { setIcon } from "obsidian";
import {
  PROFILE_NAME,
  PROFILE_BIO,
  PROFILE_LINKS,
  AVATAR_DATA_URI,
  CONTACT_EMAIL,
} from "../constants";

export interface AuthorCardCallbacks {
  openAbout: () => void;
}

export interface AuthorCardRefs {
  authorStatsEl: HTMLElement;
}

/** 纯函数：在 header 容器内创建作者卡片 DOM，返回关键元素引用。 */
export function renderAuthorCard(
  header: HTMLElement,
  callbacks: AuthorCardCallbacks,
): AuthorCardRefs {
  const card = header.createDiv({ cls: "bws-author-card" });

  // 顶部一行：头像 + 名字/副标（刷新按钮已移至下方功能区）
  const top = card.createDiv({ cls: "bws-author-top" });

  // 用专属 wrapper 做圆形裁剪，避免被主题 img 样式覆盖（无需 !important）
  const avatarWrap = top.createDiv({ cls: "bws-author-avatar-wrap" });
  const avatar = avatarWrap.createEl("img", {
    cls: "bws-author-avatar",
    attr: { alt: PROFILE_NAME, loading: "lazy" },
  });
  avatar.src = AVATAR_DATA_URI;

  const idBox = top.createDiv({ cls: "bws-author-idbox" });
  const nameRow = idBox.createDiv({ cls: "bws-author-name-row" });
  nameRow.createDiv({ cls: "bws-author-name", text: PROFILE_NAME });
  const ghUrl = PROFILE_LINKS[0]?.url;
  if (ghUrl) {
    const gh = nameRow.createEl("a", {
      href: ghUrl,
      cls: "bws-author-gh",
      attr: { target: "_blank", rel: "noopener noreferrer", "aria-label": "GitHub", title: "GitHub" },
    });
    const ghIco = gh.createSpan({ cls: "bw-brand-link-ico-wrap" });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- setIcon 是 Obsidian 官方 API
    setIcon(ghIco, "github");
  }
  const handle = PROFILE_LINKS[0]?.url.split("/").pop() ?? "";
  idBox.createDiv({ cls: "bws-author-handle", text: handle ? "@" + handle : "" });

  // 文字信息区：简介
  const info = card.createDiv({ cls: "bws-author-info" });
  info.createDiv({ cls: "bws-author-bio", text: PROFILE_BIO });

  // 作者连接入口：关于 · 投稿（把读者沉淀到作者其他触点）
  const linksRow = card.createDiv({ cls: "bws-author-links" });
  const aboutLink = linksRow.createEl("button", {
    cls: "bws-author-link",
    text: "关于",
    attr: { title: "关于作者与其他平台" },
  });
  aboutLink.addEventListener("click", () => callbacks.openAbout());
  if (CONTACT_EMAIL) {
    linksRow.createSpan({ cls: "bws-author-link-sep", text: "·" });
    const submitLink = linksRow.createEl("button", {
      cls: "bws-author-link",
      text: "投稿",
      attr: { title: "投稿 / 联系作者" },
    });
    // 投稿也走同一弹层（内含投稿说明与邮箱）
    submitLink.addEventListener("click", () => callbacks.openAbout());
  }

  // 全站字数汇总（渐进补全，首屏无统计时隐藏）
  const authorStatsEl = card.createDiv({ cls: "bws-author-stats bws-hidden" });

  return { authorStatsEl };
}
