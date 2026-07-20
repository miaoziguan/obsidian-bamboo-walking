/* ────────────── 侧边栏：专栏导航 ────────────── */
import { ItemView, setIcon } from "obsidian";
import type { ArticleIndexEntry, CategoryGroup } from "../types";
import { VIEW_TYPE_SIDEBAR } from "../types";
import {
  PROFILE_NAME,
  PROFILE_BIO,
  PROFILE_LINKS,
  AVATAR_DATA_URI,
  CONTACT_EMAIL,
} from "../constants";
import { AboutModal } from "./AboutModal";
import { StrategyReportModal } from "./StrategyReportModal";
import {
  getStrategyOverview,
  getCultivationRealm,
  getBambooCoinBalance,
} from "../services/BambooReviewBridge";
import { svgIcon } from "./icons";
import { matchArticle } from "../utils/search";
import { formatWordCount } from "../utils/text";

type SidebarState = "loading" | "loaded" | "error" | "empty";

export class SidebarView extends ItemView {
  private articles: ArticleIndexEntry[] = [];
  private selectedSlug: string | null = null;
  private searchQuery = "";
  private collapsedCategories = new Set<string>();
  private state: SidebarState = "loading";
  private errorMessage = "";
  private isRefreshing = false;
  private searchDebounce: number | null = null;
  private filter: "all" | "unread" = "all";
  private groupMode: "category" | "time" = "category";
  private statusMsg = "";
  /** 状态栏语义标记（""/"ok"/"stale"），用于配色 */
  private statusState: "" | "ok" | "stale" = "";
  /** 最近一次成功刷新的时间戳（ms），用于状态栏「更新于 hh:mm」 */
  private lastRefreshAt = 0;
  /** 刷新后新到达的文章 slug 集合，用于「新」标记 */
  private newSlugs = new Set<string>();
  private onSelect: ((entry: ArticleIndexEntry) => void) | null = null;
  private getContent: ((slug: string) => string | null) | null = null;
  /** 正文小写缓存：避免每次击键都重新 getContent + toLowerCase（搜索卡顿主因） */
  private contentCache = new Map<string, string>();
  /** render 时是否在过滤中纳入正文全文（默认 false，仅异步补充阶段置 true） */
  private searchFullText = false;
  private onRefresh: (() => void) | null = null;
  private isReadFn: ((slug: string) => boolean) | null = null;
  private onReady: (() => void) | null = null;
  /** 字数查询回调（由 main 绑定到 CacheService.getWordCount），首屏未读缓存时为 null */
  private getWordCountFn: ((slug: string) => number | undefined) | null = null;
  /** 作者卡片下的全站字数汇总行（只创建一次，后续仅更新文本） */
  private authorStatsEl: HTMLElement | null = null;
  /** 战略复盘极简概览条（左栏常驻，A+B 组合之 A） */
  private strategyMiniEl: HTMLElement | null = null;
  private strategyMiniInfoEl: HTMLElement | null = null;
  private strategyMiniCultEl: HTMLElement | null = null;
  private strategyMiniLoading = false;

  getViewType(): string { return VIEW_TYPE_SIDEBAR; }
  getDisplayText(): string { return "竹杖芒鞋"; }
  getIcon(): string { return "book-open"; }

  setOnSelect(cb: (entry: ArticleIndexEntry) => void): void { this.onSelect = cb; }
  setOnRefresh(cb: () => void): void { this.onRefresh = cb; }
  setIsReadFn(fn: (slug: string) => boolean): void { this.isReadFn = fn; }
  setGetContentFn(fn: (slug: string) => string | null): void { this.getContent = fn; }
  setOnReady(cb: () => void): void { this.onReady = cb; }
  setGetWordCountFn(fn: (slug: string) => number | undefined): void { this.getWordCountFn = fn; }

  /** 持久状态栏：显示最近一次刷新结果。
   *  @param state 可选状态标记，用于 CSS 区分正常/陈旧（离线或刷新失败）配色 */
  setStatus(msg: string, state?: "ok" | "stale"): void {
    this.statusMsg = msg;
    this.statusState = state ?? "";
    const el = this.containerEl.querySelector<HTMLElement>(".bws-status");
    if (el) {
      el.textContent = msg;
      if (this.statusState) el.setAttribute("data-state", this.statusState);
      else el.removeAttribute("data-state");
    }
  }

  /** 刷新成功后设置常驻状态栏：「N 篇新 · 更新于 hh:mm」或「已是最新 · 更新于 hh:mm」 */
  setRefreshStatus(newCount: number): void {
    this.lastRefreshAt = Date.now();
    const time = this.formatClock(this.lastRefreshAt);
    const head = newCount > 0 ? `发现 ${newCount} 篇新文章` : "已是最新";
    this.setStatus(`${head} · 更新于 ${time}`, "ok");
  }

  /** 刷新失败 / 离线时的常驻提示：说明当前展示的是缓存及其新鲜度。
   *  @param lastFetchTs 最近一次成功拉取时间戳（ms），0 表示无有效缓存时间
   *  @param offline 是否处于离线（无网络）状态 */
  setStaleStatus(lastFetchTs: number, offline: boolean): void {
    const rel = lastFetchTs > 0 ? this.formatRelative(lastFetchTs) : "";
    let msg: string;
    if (offline) {
      msg = rel ? `离线 · 显示的是 ${rel}的缓存` : "离线 · 显示的是本地缓存";
    } else {
      msg = rel ? `刷新失败 · 显示的是 ${rel}的缓存` : "刷新失败 · 显示的是本地缓存";
    }
    this.setStatus(msg, "stale");
  }

  /** 时间戳 → hh:mm（补零） */
  private formatClock(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  /** 时间戳 → 相对时间（「刚刚」「x 分钟前」「x 小时前」「x 天前」；更久则回退到日期） */
  private formatRelative(ts: number): string {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  /** 注入本次刷新新到达的文章，用于「新」标记。clear=true 时清空（如用户已阅读后）
   *  仅更新集合，重绘由后续 updateArticles()/render() 负责，避免重复渲染 */
  setNewSlugs(slugs: Iterable<string>, clear = false): void {
    if (clear) {
      this.newSlugs.clear();
    } else {
      for (const s of slugs) this.newSlugs.add(s);
    }
  }

  /** 移除单个 slug 的「新」标记（用户点开即视为已关注） */
  clearNewSlug(slug: string): void {
    if (this.newSlugs.delete(slug)) {
      const el = this.containerEl.querySelector(`.bws-article[data-slug="${CSS.escape(slug)}"]`);
      el?.classList.remove("bws-is-new");
      const badge = el?.querySelector(".bws-new-badge");
      badge?.remove();
      this.updateUnreadCount();
    }
  }

  setLoading(): void {
    if (this.articles.length === 0) { this.state = "loading"; this.render(); }
  }

  setError(msg: string): void {
    this.state = "error"; this.errorMessage = msg;
    this.isRefreshing = false; this.render();
  }

  updateArticles(articles: ArticleIndexEntry[]): void {
    this.articles = articles; this.isRefreshing = false;
    this.state = articles.length > 0 ? "loaded" : "empty"; this.render();
    this.refreshWordStats();
  }

  /** 刷新作者区全站字数汇总：累加已缓存文章的 wordCount，未统计时隐藏。 */
  private refreshWordStats(): void {
    if (!this.authorStatsEl || !this.getWordCountFn) return;
    let total = 0;
    let counted = 0;
    for (const a of this.articles) {
      const wc = this.getWordCountFn(a.slug);
      if (typeof wc === "number") { total += wc; counted++; }
    }
    if (counted > 0) {
      this.authorStatsEl.setText(`已撰写 ${formatWordCount(total)} · ${counted}/${this.articles.length} 篇`);
      this.authorStatsEl.removeClass("bws-hidden");
    } else {
      this.authorStatsEl.addClass("bws-hidden");
    }
  }

  refreshReadState(): void {
    if (this.filter === "unread") {
      // 未读模式下重新渲染，让已读文章消失 + 更新计数
      this.render();
      return;
    }
    // 全部模式下轻量更新 CSS 类
    const list = this.containerEl.querySelector(".bws-list");
    if (!list || !this.isReadFn) return;
    list.querySelectorAll(".bws-article").forEach((el) => {
      const slug = el.getAttribute("data-slug");
      if (slug) el.classList.toggle("is-read", this.isReadFn!(slug));
    });
    // 更新 tab 上的未读计数
    this.updateUnreadCount();
  }

  private updateUnreadCount(): void {
    if (!this.isReadFn) return;
    const unreadCount = this.articles.filter((a) => !this.isReadFn!(a.slug)).length;
    const newCount = this.articles.filter((a) => this.newSlugs.has(a.slug)).length;
    const tabs = this.containerEl.querySelectorAll(".bws-filter-tab");
    if (tabs[0]) tabs[0].textContent = newCount > 0 ? `全部 ${this.articles.length} · ${newCount} 新` : `全部 ${this.articles.length}`;
    if (tabs[1]) tabs[1].textContent = `未读 ${unreadCount}`;
  }

  setSelected(slug: string | null): void {
    this.selectedSlug = slug;
    const list = this.containerEl.querySelector(".bws-list");
    if (list) {
      list.querySelectorAll(".bws-article").forEach((el) => {
        el.classList.toggle("is-active", el.getAttribute("data-slug") === slug);
      });
    }
  }

  async onOpen(): Promise<void> {
    // 恢复上次的分组偏好（分类 / 时间）
    // loadLocalStorage 返回 unknown，显式收窄为 string | null 以消除 unsafe assignment
    const saved = this.app.loadLocalStorage("bw-group-mode") as string | null;
    if (saved === "time" || saved === "category") {
      this.groupMode = saved;
    }
    this.render();
    if (this.onReady) this.onReady();
  }

  /** 切换分组模式并持久化 */
  private setGroupMode(mode: "category" | "time"): void {
    if (this.groupMode === mode) return;
    this.groupMode = mode;
    this.app.saveLocalStorage("bw-group-mode", mode);
    this.render();
  }
  async onClose(): Promise<void> {
    if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
  }

  /* ═══════ 日期格式化：中文短格式 + 相对时间 ═══════ */
  private formatDate(isoDate: string): string {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    // 相对时间
    if (diffDays === 0) return "今天";
    if (diffDays === 1) return "昨天";
    if (diffDays === 2) return "前天";
    if (diffDays > 2 && diffDays < 7) return `${diffDays}天前`;
    if (diffDays >= 7 && diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    if (diffDays >= 30 && diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;

    // 同一年省掉年份
    const month = d.getMonth() + 1;
    const day = d.getDate();
    if (d.getFullYear() === now.getFullYear()) {
      return `${month}月${day}日`;
    }
    return `${d.getFullYear()}年${month}月${day}日`;
  }

  /* ═══════ 渲染 ═══════ */

  /** 全量初始化（仅 onOpen 时调用一次），品牌区只创建一次 */
  private initLayout(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bws-sidebar");

    // 品牌区：只创建一次，后续不重建
    const header = contentEl.createDiv({ cls: "bws-header" });
    this.renderAuthorCard(header);

    // 持久状态栏容器（占位，后续仅更新文本）
    contentEl.createDiv({ cls: "bws-status" });

    // 列表容器：后续 render() 只重建这部分
    contentEl.createDiv({ cls: "bws-body" });
  }

  private render(): void {
    const { contentEl } = this;

    // 首次渲染走全量初始化
    if (!contentEl.querySelector(".bws-header")) {
      this.initLayout();
    }

    // 更新状态栏文字（不重建 DOM）
    const statusEl = contentEl.querySelector<HTMLElement>(".bws-status");
    if (statusEl) {
      if (this.statusMsg) {
        statusEl.textContent = this.statusMsg;
        statusEl.classList.remove("bws-hidden");
        if (this.statusState) statusEl.setAttribute("data-state", this.statusState);
        else statusEl.removeAttribute("data-state");
      } else if (this.state === "loading") {
        statusEl.textContent = "正在检查更新…";
        statusEl.classList.remove("bws-hidden");
        statusEl.removeAttribute("data-state");
      } else {
        statusEl.classList.add("bws-hidden");
      }
    }

    // 列表区：清空重建
    const bodyEl = contentEl.querySelector<HTMLElement>(".bws-body");
    if (!bodyEl) return;
    bodyEl.empty();

    // ── 未读 / 全部 切换 ──
    if (this.state === "loaded" || (this.state !== "loading" && this.articles.length > 0)) {
      const unreadCount = this.isReadFn
        ? this.articles.filter((a) => !this.isReadFn!(a.slug)).length
        : this.articles.length;
      const newCount = this.articles.filter((a) => this.newSlugs.has(a.slug)).length;

      const filterBar = bodyEl.createDiv({ cls: "bws-filter-tabs" });

      const allTab = filterBar.createEl("button", {
        cls: `bws-filter-tab${this.filter === "all" ? " is-active" : ""}`,
        text: newCount > 0 ? `全部 ${this.articles.length} · ${newCount} 新` : `全部 ${this.articles.length}`,
      });
      allTab.addEventListener("click", () => {
        if (this.filter === "all") return;
        this.filter = "all";
        this.render();
        allTab.addClass("is-active");
        unreadTab.removeClass("is-active");
      });

      const unreadTab = filterBar.createEl("button", {
        cls: `bws-filter-tab${this.filter === "unread" ? " is-active" : ""}`,
        text: `未读 ${unreadCount}`,
      });
      unreadTab.addEventListener("click", () => {
        if (this.filter === "unread") return;
        this.filter = "unread";
        this.render();
        unreadTab.addClass("is-active");
        allTab.removeClass("is-active");
      });

      // 刷新按钮
      const refreshBtn = filterBar.createEl("button", {
        cls: "bws-btn-refresh bws-btn-refresh--inline",
        attr: { "aria-label": "刷新文章", title: "刷新文章" },
      });
      setIcon(refreshBtn.createSpan({ cls: "bws-btn-icon" }), "refresh-cw");
      if (this.isRefreshing) {
        refreshBtn.addClass("bws-spin");
        refreshBtn.disabled = true;
      }
      refreshBtn.addEventListener("click", () => {
        if (this.isRefreshing || !this.onRefresh) return;
        this.isRefreshing = true;
        refreshBtn.disabled = true;
        refreshBtn.addClass("bws-spin");
        this.onRefresh();
      });

      // ── 分组切换：分类 / 时间（平级双入口，永久可见，记忆选择） ──
      const groupBar = bodyEl.createDiv({ cls: "bws-group-tabs" });
      const catTab = groupBar.createEl("button", {
        cls: `bws-group-tab${this.groupMode === "category" ? " is-active" : ""}`,
        text: "分类",
        attr: { title: "按分类浏览" },
      });
      catTab.addEventListener("click", () => this.setGroupMode("category"));
      // 精致竖条分隔符
      groupBar.createSpan({ cls: "bws-group-sep", text: "|" });
      const timeTab = groupBar.createEl("button", {
        cls: `bws-group-tab${this.groupMode === "time" ? " is-active" : ""}`,
        text: "时间线",
        attr: { title: "按时间浏览" },
      });
      timeTab.addEventListener("click", () => this.setGroupMode("time"));
    }

    // ── 搜索框（带清除按钮） ──
    if (this.state !== "loading" || this.articles.length > 0) {
      const searchWrap = bodyEl.createDiv({ cls: "bws-search-wrap" });

      const searchInput = searchWrap.createEl("input", {
        type: "text", placeholder: "搜索文章…", cls: "bws-search",
      });
      searchInput.value = this.searchQuery;

      const clearBtn = searchWrap.createEl("button", {
        cls: "bws-search-clear",
        attr: { "aria-label": "清除搜索", title: "清除" },
      });
      clearBtn.setText("×");
      if (!this.searchQuery) clearBtn.addClass("bws-hidden");

      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        this.searchQuery = "";
        clearBtn.addClass("bws-hidden");
        this.setSearchMeta("hidden");
        this.searchFullText = false;
        this.renderListRegion();
        searchInput.focus();
      });

      searchInput.addEventListener("input", (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        if (this.searchQuery) {
          clearBtn.removeClass("bws-hidden");
          // 输入即时反馈：先显示「搜索中…」，节流后再出结果
          this.setSearchMeta("searching");
        } else {
          clearBtn.addClass("bws-hidden");
          this.setSearchMeta("hidden");
        }
        if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
        this.searchDebounce = window.setTimeout(() => {
          this.searchDebounce = null;
          // 1) 只局部重建列表区（保留搜索框 DOM 与焦点），轻量字段即时出结果
          this.searchFullText = false;
          this.renderListRegion();
          this.updateSearchMeta(false);
          // 2) 再异步补扫正文全文，命中数变了才补充列表 + 更新计数
          window.setTimeout(() => this.applyFullTextResults(), 0);
        }, 200);
      });

      // 搜索结果计数条（仅有搜索词时显示）
      bodyEl.createDiv({ cls: `bws-search-meta${this.searchQuery ? "" : " bws-hidden"}` });
      if (this.searchQuery) {
        const count = this.searchResultCount();
        if (count > 0) {
          this.setSearchMeta("ok", `${count} 篇匹配`);
        } else {
          this.setSearchMeta("no-result");
        }
      }
    }

    // ── 内容区（独立容器，搜索时只重建这块，保留搜索框焦点） ──
    bodyEl.createDiv({ cls: "bws-list-region" });
    this.renderListRegion();
  }

  /** 只重建列表区（不动头部/搜索框），供搜索时局部刷新，避免焦点丢失 */
  private renderListRegion(): void {
    const region = this.contentEl.querySelector<HTMLElement>(".bws-list-region");
    if (!region) return;
    // 保留滚动位置：empty 前存下，renderList 内会用同名 .bws-list 恢复
    const prevScroll = region.querySelector<HTMLElement>(".bws-list")?.scrollTop ?? 0;
    region.empty();
    switch (this.state) {
      case "loading":  this.renderLoading(region); break;
      case "error":    this.renderError(region); break;
      case "empty":    this.renderEmpty(region); break;
      case "loaded":   this.renderList(region, prevScroll); break;
    }
  }

  /* ═══════ 作者卡片（左上角博客式简介）═══════ */

  private renderAuthorCard(header: HTMLElement): void {
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
    aboutLink.addEventListener("click", () => new AboutModal(this.app).open());
    if (CONTACT_EMAIL) {
      linksRow.createSpan({ cls: "bws-author-link-sep", text: "·" });
      const submitLink = linksRow.createEl("button", {
        cls: "bws-author-link",
        text: "投稿",
        attr: { title: "投稿 / 联系作者" },
      });
      // 投稿也走同一弹层（内含投稿说明与邮箱）
      submitLink.addEventListener("click", () => new AboutModal(this.app).open());
    }

    // 全站字数汇总（渐进补全，首屏无统计时隐藏）
    this.authorStatsEl = card.createDiv({ cls: "bws-author-stats bws-hidden" });

    // 战略复盘极简概览（A+B 组合：左栏常驻条，点开看完整抽屉）
    this.renderStrategyMini(header);
  }

  /** 左栏竹林概览卡：头部(标题+重算) / 健康预警行 / 境界竹币行，点击打开完整抽屉 */
  private renderStrategyMini(parent: HTMLElement): void {
    const card = parent.createDiv({ cls: "bws-strategy-mini" });
    this.strategyMiniEl = card;

    const head = card.createDiv({ cls: "bws-strategy-mini-head" });
    const left = head.createDiv({ cls: "bws-strategy-mini-left" });
    const label = left.createDiv({ cls: "bws-strategy-mini-label" });
    label.appendChild(svgIcon("chart", "bws-strategy-mini-ico"));
    label.append(" 战略复盘");

    this.strategyMiniInfoEl = left.createDiv({
      cls: "bws-strategy-mini-info",
      text: "载入中…",
    });

    const refresh = head.createEl("button", {
      cls: "bws-strategy-mini-refresh",
      attr: { "aria-label": "重新核算战略复盘", title: "重新核算" },
    });
    refresh.appendChild(svgIcon("refresh"));
    refresh.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.strategyMiniLoading) return;
      void this.refreshStrategyMini();
    });

    card.addEventListener("click", () => {
      if (this.strategyMiniEl?.classList.contains("is-disabled")) return;
      new StrategyReportModal(this.app).open();
    });

    void this.refreshStrategyMini();

    // 修行境界 · 竹币 行（卡片内第二行，与战略复盘总览解耦、独立降级）
    const cult = card.createDiv({ cls: "bws-strategy-mini-cult bws-hidden" });
    this.strategyMiniCultEl = cult;
    void this.refreshCultivation();
  }

  /** 拉取并刷新极简条上的数字（实时核算，零缓存） */
  private async refreshStrategyMini(): Promise<void> {
    const info = this.strategyMiniInfoEl;
    if (!info) return;
    this.strategyMiniLoading = true;
    info.textContent = "核算中…";
    try {
      const data = await getStrategyOverview(this.app);
      if (!data) {
        info.textContent = "未启用竹林";
        this.strategyMiniEl?.classList.add("is-disabled");
        return;
      }
      // 优先消费竹林返回的权威整体健康分；旧版竹林未提供 health 时回退到本地二次平均
      const score =
        data.health && typeof data.health.avgScore === "number"
          ? data.health.avgScore
          : data.goals.length > 0
            ? Math.round(
                data.goals.reduce((s, g) => s + g.score, 0) / data.goals.length,
              )
            : 0;
      const alerts =
        data.overview.urgentGoals.length +
        data.overview.overdueGoals.length +
        data.overview.stagnantGoals.length;
      info.textContent = "";
      info.append("健康 ");
      info.createEl("strong", { cls: "bws-stat-num", text: String(score) });
      info.append(" · 预警 ");
      info.createEl("strong", { cls: "bws-stat-num", text: String(alerts) });
      this.strategyMiniEl?.classList.remove("is-disabled");
    } catch {
      info.textContent = "读取失败";
    } finally {
      this.strategyMiniLoading = false;
      // 境界 / 竹币独立于战略复盘总览，始终一并刷新
      void this.refreshCultivation();
    }
  }

  /** 拉取并刷新境界 / 竹币常驻行（与战略复盘总览解耦，独立降级） */
  private async refreshCultivation(): Promise<void> {
    const el = this.strategyMiniCultEl;
    if (!el) return;
    try {
      const [realm, balance] = await Promise.all([
        getCultivationRealm(this.app),
        getBambooCoinBalance(this.app),
      ]);
      if (realm == null && balance == null) {
        el.classList.add("bws-hidden");
        return;
      }
      el.classList.remove("bws-hidden");
      el.textContent = "";
      if (realm) {
        const item = el.createSpan({ cls: "bws-cult-item bws-cult-realm" });
        item.createSpan({ cls: "bws-cult-val", text: `${realm.realm}·第${realm.layer}层` });
      }
      if (balance != null) {
        const item = el.createSpan({ cls: "bws-cult-item bws-cult-coin" });
        item.createSpan({ cls: "bws-cult-val", text: `竹币 ${balance}` });
      }
    } catch {
      // 读取失败（如竹林插件异常）→ 隐藏境界/竹币行，不阻塞战略复盘
      el.classList.add("bws-hidden");
    }
  }

  private renderLoading(c: HTMLElement): void {
    const wrap = c.createDiv({ cls: "bws-list" });
    const sk = wrap.createDiv({ cls: "bws-skeleton" });
    for (let i = 0; i < 5; i++) {
      const item = sk.createDiv({ cls: "bws-sk-item" });
      item.createDiv({ cls: "bws-sk-line bws-sk-line-long" });
      item.createDiv({ cls: "bws-sk-line bws-sk-line-short" });
    }
  }

  private renderError(c: HTMLElement): void {
    const wrap = c.createDiv({ cls: "bws-list" });
    const err = wrap.createDiv({ cls: "bws-error" });
    setIcon(err.createSpan({ cls: "bws-error-icon" }), "alert-triangle");
    err.createDiv({ text: "加载失败", cls: "bws-error-title" });
    err.createDiv({ text: this.errorMessage || "请检查网络后重试", cls: "bws-error-msg" });
    const retryBtn = err.createEl("button", { cls: "bws-btn-retry" });
    setIcon(retryBtn.createSpan({ cls: "bws-btn-icon" }), "rotate-cw");
    retryBtn.createSpan({ text: "重试" });
    retryBtn.addEventListener("click", () => { if (this.onRefresh) this.onRefresh(); });
  }

  private renderEmpty(c: HTMLElement): void {
    const wrap = c.createDiv({ cls: "bws-list" });
    const empty = wrap.createDiv({ cls: "bws-empty" });
    empty.createSpan({ text: "暂无文章" });
    empty.createEl("br");
    empty.createEl("small", {
      text: "专栏刚刚起步，作者正在筹备文章，敬请期待",
      cls: "bws-empty-hint",
    });
  }

  private renderList(contentEl: HTMLElement, prevScroll?: number): void {
    const oldList = contentEl.querySelector(".bws-list");
    const scrollTop = prevScroll ?? oldList?.scrollTop ?? 0;
    oldList?.remove();

    const listEl = contentEl.createDiv({ cls: "bws-list" });

    if (this.groupMode === "time") {
      this.renderTimeline(listEl);
      listEl.scrollTop = scrollTop;
      this.bindKeyboardNavigation(listEl);
      return;
    }

    const groups = this.groupByCategory();

    if (groups.length === 0) {
      const empty = listEl.createDiv({ cls: "bws-empty" });
      if (this.searchQuery) {
        empty.createSpan({ text: "没有匹配的文章" });
        empty.createEl("br");
        empty.createEl("small", { text: `搜索词：${this.searchQuery}`, cls: "bws-empty-hint" });
      } else if (this.filter === "unread") {
        empty.createSpan({ text: "所有文章都已读" });
        empty.createEl("br");
        empty.createEl("small", { text: "切换到「全部」查看完整列表", cls: "bws-empty-hint" });
      }
      return;
    }

    for (const group of groups) this.renderCategory(listEl, group);
    listEl.scrollTop = scrollTop;

    // 键盘导航（分类与时间线两种模式都需要）
    this.bindKeyboardNavigation(listEl);
  }

  /** 绑定列表键盘导航：↑/↓ 移动焦点，Enter 打开 */
  private bindKeyboardNavigation(listEl: HTMLElement): void {
    listEl.addEventListener("keydown", (e: KeyboardEvent) => {
      const items = Array.from(listEl.querySelectorAll<HTMLElement>(".bws-article"));
      if (items.length === 0) return;
      const focused = listEl.querySelector<HTMLElement>(".bws-article:focus, .bws-article.is-active");
      let idx = focused ? items.indexOf(focused) : -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = Math.min(idx + 1, items.length - 1);
        items[idx].focus();
        items[idx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = Math.max(idx - 1, 0);
        items[idx].focus();
        items[idx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && focused) {
        focused.click();
      }
    });
  }

  /* ═══════ 时间线模式（内部排序用，无独立 tab） ═══════ */

  /** 过滤后的文章列表。
   *  includeFullText=false（默认）：搜索时只按轻量字段即时匹配，保证击键流畅；
   *  includeFullText=true：额外纳入正文全文命中，用于异步补充，避免输入时阻塞主线程。 */
  private filteredArticles(includeFullText = this.searchFullText): ArticleIndexEntry[] {
    let pool = this.articles;
    // 未读过滤（让时间线在「未读」tab 下同样生效）
    if (this.filter === "unread" && this.isReadFn) {
      pool = pool.filter((a) => !this.isReadFn!(a.slug));
    }
    if (this.searchQuery) {
      const q = this.searchQuery;
      pool = pool.filter((a) =>
        matchArticle(q, a, {
          fullText: includeFullText,
          getContent: (s) => this.cachedContent(s),
        }),
      );
    }
    return pool;
  }

  /** 当前搜索词命中的文章数（受未读过滤影响，与列表实际展示一致） */
  private searchResultCount(includeFullText = false): number {
    let pool = this.articles;
    if (this.filter === "unread" && this.isReadFn) {
      pool = pool.filter((a) => !this.isReadFn!(a.slug));
    }
    if (!this.searchQuery) return pool.length;
    const q = this.searchQuery;
    return pool.filter((a) =>
      matchArticle(q, a, {
        fullText: includeFullText,
        getContent: (s) => this.cachedContent(s),
      }),
    ).length;
  }

  /** 更新搜索计数条文案（不触碰列表 DOM），includeFullText 决定口径 */
  private updateSearchMeta(includeFullText: boolean): void {
    if (!this.searchQuery) { this.setSearchMeta("hidden"); return; }
    const count = this.searchResultCount(includeFullText);
    if (count > 0) {
      this.setSearchMeta("ok", `${count} 篇匹配`);
    } else {
      this.setSearchMeta("no-result");
    }
  }

  /** 异步补扫正文全文：在输入节流之后于宏任务执行，不阻塞击键。
   *  轻量字段结果已即时渲染；这里再纳入正文命中并局部刷新列表 + 更新计数（不动搜索框）。 */
  private applyFullTextResults(): void {
    if (!this.searchQuery || this.searchDebounce !== null) return;
    const full = this.filteredArticles(true).length;
    const light = this.filteredArticles(false).length;
    if (full !== light) {
      // 正文有额外命中：局部重建列表区（含全文），保留搜索框焦点
      this.searchFullText = true;
      this.renderListRegion();
      this.searchFullText = false;
    }
    this.updateSearchMeta(true);
  }

  /** 搜索计数条状态：hidden=隐藏 / searching=搜索中 / ok=有结果 / no-result=无结果 */
  private setSearchMeta(state: "hidden" | "searching" | "ok" | "no-result", text?: string): void {
    const el = this.containerEl.querySelector<HTMLElement>(".bws-search-meta");
    if (!el) return;
    if (state === "hidden") {
      el.addClass("bws-hidden");
      el.textContent = "";
      el.removeAttribute("data-state");
      return;
    }
    el.removeClass("bws-hidden");
    if (state === "searching") {
      el.textContent = "搜索中…";
      el.setAttribute("data-state", "searching");
    } else if (state === "no-result") {
      el.textContent = "没有匹配的文章";
      el.setAttribute("data-state", "empty");
    } else {
      el.textContent = text ?? "";
      el.setAttribute("data-state", "ok");
    }
  }

  /** 取某 slug 的正文（小写），带缓存，避免每次击键重复读取+转换 */
  private cachedContent(slug: string): string {
    let c = this.contentCache.get(slug);
    if (c === undefined) {
      c = (this.getContent?.(slug) ?? "").toLowerCase();
      this.contentCache.set(slug, c);
    }
    return c;
  }

  /** 时间线模式：相对时间桶（本季 / 今年 / 更早）→ 月份 → 周 */
  private renderTimeline(listEl: HTMLElement): void {
    const pool = this.filteredArticles();
    if (pool.length === 0) {
      const empty = listEl.createDiv({ cls: "bws-empty" });
      empty.createSpan({ text: "没有匹配的文章" });
      if (this.searchQuery) {
        empty.createEl("br");
        empty.createEl("small", { text: `搜索词：${this.searchQuery}`, cls: "bws-empty-hint" });
      }
      return;
    }

    const buckets = this.bucketByRelative(pool);

    for (const bkt of buckets) {
      const bucketEl = listEl.createDiv({ cls: "bws-timeline-bucket" });
      bucketEl.createDiv({
        cls: "bws-timeline-bucket-head",
        text: bkt.label,
        attr: { role: "button", tabindex: "0" },
      });

      const months = this.groupByMonth(bkt.articles);
      for (const [ym, mArts] of months) {
        const [year, mm] = ym.split("-");
        const monthEl = bucketEl.createDiv({ cls: "bws-timeline-month" });
        monthEl.createDiv({
          cls: "bws-timeline-head",
          text: `${year}年${mm}月`,
          attr: { role: "button", tabindex: "0" },
        });

        const weeks = this.groupByWeek(mArts);
        for (const wk of weeks) {
          const wkEl = monthEl.createDiv({ cls: "bws-timeline-week" });
          const wHead = wkEl.createDiv({
            cls: "bws-timeline-week-head",
            attr: { role: "button", tabindex: "0" },
          });
          wHead.createSpan({ cls: "bws-arrow", text: "▾" });
          wHead.createSpan({ cls: "bws-week-label", text: wk.label });
          // 周子层默认展开，点击周头可折叠
          wHead.addEventListener("click", () => wkEl.classList.toggle("bws-collapsed"));

          const wkItems = wkEl.createDiv({ cls: "bws-timeline-week-items" });
          for (const a of wk.articles.sort((a, b) => b.date.localeCompare(a.date))) {
            this.renderArticleItem(wkItems, a);
          }
        }
      }
    }
  }

  /** 把文章按「本季 / 今年 / 更早」分到三个相对桶 */
  private bucketByRelative(pool: ArticleIndexEntry[]): {
    key: string; label: string; articles: ArticleIndexEntry[];
  }[] {
    const now = new Date();
    const y = now.getFullYear();
    const q = Math.floor(now.getMonth() / 3); // 0..3
    const qStart = new Date(y, q * 3, 1);
    const qEnd = new Date(y, q * 3 + 3, 0); // 季末当天

    const buckets: Record<string, ArticleIndexEntry[]> = {
      quarter: [], year: [], older: [],
    };

    for (const a of pool) {
      const d = new Date(a.date);
      if (isNaN(d.getTime())) { buckets.older.push(a); continue; }
      if (d >= qStart && d <= qEnd) buckets.quarter.push(a);
      else if (d.getFullYear() === y) buckets.year.push(a);
      else buckets.older.push(a);
    }

    const labels: Record<string, string> = {
      quarter: `本季 · ${y} Q${q + 1}`,
      year: `今年 · ${y}`,
      older: "更早",
    };
    return ["quarter", "year", "older"]
      .filter((k) => buckets[k].length > 0)
      .map((k) => ({
        key: k,
        label: labels[k],
        articles: buckets[k].sort((a, b) => b.date.localeCompare(a.date)),
      }));
  }

  /** 按 YYYY-MM 分组并倒序 */
  private groupByMonth(articles: ArticleIndexEntry[]): [string, ArticleIndexEntry[]][] {
    const m = new Map<string, ArticleIndexEntry[]>();
    for (const a of articles) {
      const key = a.date.substring(0, 7);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }

  /** 按自然周（周一为界）拆分，标题形如「第3周 · 7/7–7/11」 */
  private groupByWeek(articles: ArticleIndexEntry[]): {
    label: string; articles: ArticleIndexEntry[];
  }[] {
    const m = new Map<string, ArticleIndexEntry[]>();
    const meta = new Map<string, { start: Date; end: Date }>();

    for (const a of articles) {
      const d = new Date(a.date);
      if (isNaN(d.getTime())) continue;
      // 以周一为周起点
      const day = d.getDay(); // 0=周日
      const diff = (day === 0 ? 6 : day - 1);
      const monday = new Date(d);
      monday.setDate(d.getDate() - diff);
      const key = monday.toISOString().slice(0, 10);
      if (!m.has(key)) {
        m.set(key, []);
        const end = new Date(monday);
        end.setDate(monday.getDate() + 6);
        meta.set(key, { start: monday, end });
      }
      m.get(key)!.push(a);
    }

    return Array.from(m.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // 周倒序
      .map(([k, arts]) => {
        const { start, end } = meta.get(k)!;
        const fmt = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}`;
        const ordinal = this.weekOrdinal(start);
        return {
          label: `第${ordinal}周 · ${fmt(start)}–${fmt(end)}`,
          articles: arts,
        };
      });
  }

  /** 计算某日期在其年份中的第几周（ISO 周数近似） */
  private weekOrdinal(monday: Date): number {
    const d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  }

  private renderCategory(parent: HTMLElement, group: CategoryGroup): void {
    const section = parent.createDiv({ cls: "bws-category" });
    const isCollapsed = this.collapsedCategories.has(group.name);
    if (isCollapsed) section.addClass("bws-collapsed");

    const title = section.createDiv({ cls: "bws-cat-title" });
    title.createSpan({ cls: "bws-arrow", text: "▾" });
    const nameSpan = title.createSpan({ text: group.name });
    nameSpan.addClass("bws-cat-name");
    // #5: 分类计数用 badge
    title.createSpan({ cls: "bws-cat-count", text: `${group.articles.length}` });

    title.addEventListener("click", () => {
      if (this.collapsedCategories.has(group.name)) {
        this.collapsedCategories.delete(group.name);
      } else {
        this.collapsedCategories.add(group.name);
      }
      section.classList.toggle("bws-collapsed", this.collapsedCategories.has(group.name));
    });

    const items = section.createDiv({ cls: "bws-cat-items" });
    for (const article of group.articles) this.renderArticleItem(items, article);
  }

  /* ═══════ 文章条目：左侧封面缩略图 + 右侧三行文字 ═══════ */
  private renderArticleItem(parent: HTMLElement, article: ArticleIndexEntry): void {
    try {
      const isRead = this.isReadFn ? this.isReadFn(article.slug) : false;

      const item = parent.createDiv({
        cls: `bws-article${isRead ? " is-read" : ""}${this.newSlugs.has(article.slug) ? " bws-is-new" : ""}`,
        attr: { "data-slug": article.slug, tabindex: "0", role: "button" },
      });

      if (article.slug === this.selectedSlug) item.addClass("is-active");

      // 封面缩略图（若有）
      if (article.cover) {
        item.addClass("bws-has-cover");
        const coverEl = item.createDiv({ cls: "bws-art-cover" });
        coverEl.createEl("img", {
          cls: "bws-art-cover-img",
          attr: { src: article.cover, alt: article.title, loading: "lazy" },
        });
        coverEl.addEventListener("error", () => coverEl.remove());
      }

      const bodyEl = item.createDiv({ cls: "bws-art-body" });

      // 第一行：标题行（标题 + 「新」徽章，flex 同行）
      const titleRow = bodyEl.createDiv({ cls: "bws-art-title-row" });
      titleRow.createDiv({ cls: "bws-art-title", text: article.title });
      if (this.newSlugs.has(article.slug)) {
        titleRow.createSpan({ cls: "bws-new-badge", text: "新" });
      }

      // 第二行：日期（中文短格式）
      bodyEl.createDiv({ cls: "bws-art-date", text: this.formatDate(article.date) });

      // 字数（打开文章后才有缓存，缺则省略，渐进补全）
      if (this.getWordCountFn) {
        const wc = this.getWordCountFn(article.slug);
        if (typeof wc === "number") {
          bodyEl.createDiv({ cls: "bws-art-words", text: formatWordCount(wc) });
        }
      }

      // 第三行：摘要（两行截断 + 悬浮提示）
      if (article.summary) {
        bodyEl.createDiv({
          cls: "bws-art-summary",
          text: article.summary,
          attr: { title: article.summary },
        });
      }

      const handleSelect = () => { if (this.onSelect) this.onSelect(article); };
      item.addEventListener("click", handleSelect);
      item.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(); }
      });
    } catch (err) {
      const errEl = parent.createDiv({ cls: "bws-article bws-article-error" });
      errEl.createDiv({ cls: "bws-art-title", text: `渲染错误: ${article.title}` });
      errEl.createDiv({ cls: "bws-art-date", text: String(err) });
    }
  }

  private groupByCategory(): CategoryGroup[] {
    let pool = this.articles;

    // 未读过滤
    if (this.filter === "unread" && this.isReadFn) {
      pool = pool.filter((a) => !this.isReadFn!(a.slug));
    }

    // 搜索过滤（分类模式使用全文匹配，与统一语义一致）
    if (this.searchQuery) {
      pool = pool.filter((a) =>
        matchArticle(this.searchQuery, a, {
          fullText: true,
          getContent: (s) => this.cachedContent(s),
        }),
      );
    }

    const map = new Map<string, ArticleIndexEntry[]>();
    for (const article of pool) {
      const cat = article.category || "未分类";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(article);
    }

    return Array.from(map.entries())
      .map(([name, articles]) => ({
        name,
        articles: articles.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      }))
      .sort((a, b) => {
        const ad = Math.max(...a.articles.map((x) => new Date(x.date).getTime()));
        const bd = Math.max(...b.articles.map((x) => new Date(x.date).getTime()));
        return bd - ad;
      });
  }
}
