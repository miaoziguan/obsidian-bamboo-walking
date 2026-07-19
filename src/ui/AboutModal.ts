/* ────────────── 关于 / 投稿 / 其他平台 弹层 ────────────── */
import { App, Modal, Notice, setIcon } from "obsidian";
import {
  PROFILE_NAME,
  AVATAR_DATA_URI,
  ABOUT_TEXT,
  CONTACT_EMAIL,
  CONTACT_WECHAT,
  SUBMIT_TEXT,
  PROFILE_PLATFORMS,
} from "../constants";


/** 作者「关于」弹层：介绍 + 其他平台 + 投稿方式，把读者沉淀到作者其他触点 */
export class AboutModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("bw-about-modal");
    contentEl.empty();

    // ── 头部：头像 + 名字 ──
    const head = contentEl.createDiv({ cls: "bw-about-head" });
    const avatarWrap = head.createDiv({ cls: "bw-about-avatar-wrap" });
    const avatar = avatarWrap.createEl("img", {
      cls: "bw-about-avatar",
      attr: { alt: PROFILE_NAME, loading: "lazy" },
    });
    avatar.src = AVATAR_DATA_URI;
    const nameBox = head.createDiv({ cls: "bw-about-namebox" });
    nameBox.createDiv({ cls: "bw-about-name", text: PROFILE_NAME });
    nameBox.createDiv({ cls: "bw-about-sub", text: "竹杖芒鞋 · 个人写作专栏" });

    // ── 介绍 ──
    const intro = contentEl.createDiv({ cls: "bw-about-intro" });
    for (const line of ABOUT_TEXT.split("\n")) {
      if (line.trim()) intro.createEl("p", { text: line });
    }

    // ── 其他平台 ──
    if (PROFILE_PLATFORMS.length > 0) {
      const sec = contentEl.createDiv({ cls: "bw-about-section" });
      sec.createDiv({ cls: "bw-about-section-title", text: "其他平台" });
      const list = sec.createDiv({ cls: "bw-about-links" });
      for (const p of PROFILE_PLATFORMS) {
        const a = list.createEl("a", {
          cls: "bw-about-link",
          href: p.url,
          attr: { target: "_blank", rel: "noopener noreferrer" },
        });
        // GitHub 显示图标，其余显示文字标签
        if (/github\.com/i.test(p.url)) {
          const ico = a.createSpan({ cls: "bw-about-link-ico" });
          setIcon(ico, "github");
        }
        a.createSpan({ text: p.label });
      }
    }

    // ── 投稿 / 联系 ──
    if (CONTACT_EMAIL) {
      const sec = contentEl.createDiv({ cls: "bw-about-section" });
      sec.createDiv({ cls: "bw-about-section-title", text: "投稿 · 联系" });
      sec.createEl("p", { cls: "bw-about-submit-text", text: SUBMIT_TEXT });

      const cards = sec.createDiv({ cls: "bw-about-contact-cards" });

      // 邮箱卡片
      const mailCard = cards.createDiv({ cls: "bw-about-contact-card" });
      mailCard.createDiv({ cls: "bw-about-contact-label", text: "邮箱" });
      const mailRow = mailCard.createDiv({ cls: "bw-about-contact-row" });
      mailRow.createEl("a", {
        cls: "bw-about-contact-value",
        href: `mailto:${CONTACT_EMAIL}`,
        text: CONTACT_EMAIL,
        attr: { title: "点击用邮件客户端发信" },
      });
      const copyMail = mailRow.createEl("button", {
        cls: "bw-about-copy-btn",
        attr: { title: "复制邮箱地址", "aria-label": "复制邮箱地址" },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- setIcon 是 Obsidian 官方 API
      setIcon(copyMail, "copy");
      copyMail.addEventListener("click", () => {
        // 仅在用户主动点击时写入剪贴板（本插件内容），从不读取剪贴板
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- navigator.clipboard 是浏览器标准 API
        void navigator.clipboard.writeText(CONTACT_EMAIL).then(
          () => new Notice("已复制邮箱地址"),
          () => new Notice("复制失败，请手动选择"),
        );
      });

      // 微信卡片（若有）
      if (CONTACT_WECHAT) {
        const wxCard = cards.createDiv({ cls: "bw-about-contact-card" });
        wxCard.createDiv({ cls: "bw-about-contact-label", text: "微信" });
        const wxRow = wxCard.createDiv({ cls: "bw-about-contact-row" });
        wxRow.createDiv({
          cls: "bw-about-contact-value",
          text: CONTACT_WECHAT,
        });
        const copyWx = wxRow.createEl("button", {
          cls: "bw-about-copy-btn",
          attr: { title: "复制微信号", "aria-label": "复制微信号" },
        });
        setIcon(copyWx, "copy");
        copyWx.addEventListener("click", () => {
          // 仅在用户主动点击时写入剪贴板（本插件内容），从不读取剪贴板
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- navigator.clipboard 是浏览器标准 API
          void navigator.clipboard.writeText(CONTACT_WECHAT).then(
            () => new Notice("已复制微信号"),
            () => new Notice("复制失败，请手动选择"),
          );
        });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
