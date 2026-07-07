/* ────────────── 侧边栏：专栏导航 ────────────── */
import { ItemView } from "obsidian";
import type { ArticleIndexEntry, CategoryGroup } from "../types";
import { VIEW_TYPE_SIDEBAR } from "../types";

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
  private onSelect: ((entry: ArticleIndexEntry) => void) | null = null;
  private getContent: ((slug: string) => string | null) | null = null;
  private onRefresh: (() => void) | null = null;
  private isReadFn: ((slug: string) => boolean) | null = null;
  private onReady: (() => void) | null = null;

  getViewType(): string { return VIEW_TYPE_SIDEBAR; }
  getDisplayText(): string { return "竹杖芒鞋"; }
  getIcon(): string { return "book-open"; }

  setOnSelect(cb: (entry: ArticleIndexEntry) => void): void { this.onSelect = cb; }
  setOnRefresh(cb: () => void): void { this.onRefresh = cb; }
  setIsReadFn(fn: (slug: string) => boolean): void { this.isReadFn = fn; }
  setGetContentFn(fn: (slug: string) => string | null): void { this.getContent = fn; }
  setOnReady(cb: () => void): void { this.onReady = cb; }

  /** 持久状态栏：显示最近一次刷新结果 */
  setStatus(msg: string): void {
    this.statusMsg = msg;
    const el = this.containerEl.querySelector(".bws-status");
    if (el) el.textContent = msg;
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
    const tabs = this.containerEl.querySelectorAll(".bws-filter-tab");
    if (tabs[0]) tabs[0].textContent = `全部 ${this.articles.length}`;
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

  async onOpen(): Promise<void> { this.render(); if (this.onReady) this.onReady(); }
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

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bws-sidebar");

    // ── 顶部栏 ──
    const header = contentEl.createDiv({ cls: "bws-header" });
    header.createEl("h2", { text: "竹杖芒鞋", cls: "bws-title" });

    const refreshBtn = header.createEl("button", {
      cls: "bws-btn-refresh",
      attr: { "aria-label": "刷新文章", title: "刷新文章" },
    });
    refreshBtn.setText(this.isRefreshing ? "↻" : "↻");
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

    // ── 持久状态栏 ──
    if (this.statusMsg) {
      contentEl.createDiv({ cls: "bws-status", text: this.statusMsg });
    } else if (this.state === "loading") {
      contentEl.createDiv({ cls: "bws-status", text: "正在检查更新…" });
    }

    // ── 未读 / 全部 切换 ──
    if (this.state === "loaded" || (this.state !== "loading" && this.articles.length > 0)) {
      const unreadCount = this.isReadFn
        ? this.articles.filter((a) => !this.isReadFn!(a.slug)).length
        : this.articles.length;

      const filterBar = contentEl.createDiv({ cls: "bws-filter-tabs" });

      const allTab = filterBar.createEl("button", {
        cls: `bws-filter-tab${this.filter === "all" ? " is-active" : ""}`,
        text: `全部 ${this.articles.length}`,
      });
      allTab.addEventListener("click", () => {
        if (this.filter === "all") return;
        this.filter = "all";
        this.renderList(contentEl);
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
        this.renderList(contentEl);
        unreadTab.addClass("is-active");
        allTab.removeClass("is-active");
      });

      // 排序切换（仅全部模式下显示）
      if (this.filter === "all") {
        const sortBtn = filterBar.createEl("button", {
          cls: "bws-sort-btn",
          attr: { "aria-label": "切换排序", title: this.groupMode === "category" ? "按时间排序" : "按分类排序" },
        });
        sortBtn.setText(this.groupMode === "category" ? "⇅" : "☰");
        sortBtn.addEventListener("click", () => {
          this.groupMode = this.groupMode === "category" ? "time" : "category";
          sortBtn.setText(this.groupMode === "category" ? "⇅" : "☰");
          sortBtn.setAttr("title", this.groupMode === "category" ? "按时间排序" : "按分类排序");
          this.renderList(contentEl);
        });
      }
    }

    // ── 搜索框（带清除按钮） ──
    if (this.state !== "loading" || this.articles.length > 0) {
      const searchWrap = contentEl.createDiv({ cls: "bws-search-wrap" });

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
        this.renderList(contentEl);
        searchInput.focus();
      });

      searchInput.addEventListener("input", (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        if (this.searchQuery) {
          clearBtn.removeClass("bws-hidden");
        } else {
          clearBtn.addClass("bws-hidden");
        }
        if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
        this.searchDebounce = window.setTimeout(() => {
          this.renderList(contentEl);
          this.searchDebounce = null;
        }, 200);
      });
    }

    // ── 内容区 ──
    switch (this.state) {
      case "loading":  this.renderLoading(contentEl); break;
      case "error":    this.renderError(contentEl); break;
      case "empty":    this.renderEmpty(contentEl); break;
      case "loaded":   this.renderList(contentEl); break;
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
    err.createEl("span", { cls: "bws-error-icon", text: "⚠" });
    err.createEl("div", { text: "加载失败", cls: "bws-error-title" });
    err.createEl("div", { text: this.errorMessage || "请检查网络后重试", cls: "bws-error-msg" });
    err.createEl("button", { cls: "bws-btn-retry", text: "↻ 重试" })
      .addEventListener("click", () => { if (this.onRefresh) this.onRefresh(); });
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

  private renderList(contentEl: HTMLElement): void {
    const oldList = contentEl.querySelector(".bws-list");
    const scrollTop = oldList?.scrollTop ?? 0;
    oldList?.remove();

    const listEl = contentEl.createDiv({ cls: "bws-list" });

    if (this.groupMode === "time" && this.filter === "all") {
      this.renderTimeline(listEl);
      listEl.scrollTop = scrollTop;
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

    // 键盘导航
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

  private filteredArticles(): ArticleIndexEntry[] {
    let pool = this.articles;
    if (this.searchQuery) {
      pool = pool.filter((a) =>
        a.title.toLowerCase().includes(this.searchQuery) ||
        a.summary.toLowerCase().includes(this.searchQuery) ||
        a.category.toLowerCase().includes(this.searchQuery) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(this.searchQuery)) ||
        (this.getContent?.(a.slug) ?? "").toLowerCase().includes(this.searchQuery),
      );
    }
    return pool;
  }

  /** 时间线模式：按月份分组 */
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

    const months = new Map<string, ArticleIndexEntry[]>();
    for (const a of pool) {
      const key = a.date.substring(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key)!.push(a);
    }

    const ML: Record<string, string> = {
      "01": "1月", "02": "2月", "03": "3月", "04": "4月",
      "05": "5月", "06": "6月", "07": "7月", "08": "8月",
      "09": "9月", "10": "10月", "11": "11月", "12": "12月",
    };

    const sorted = Array.from(months.entries())
      .sort((a, b) => b[0].localeCompare(a[0]));

    for (const [ym, articles] of sorted) {
      const [year, mm] = ym.split("-");
      const section = listEl.createDiv({ cls: "bws-timeline" });
      section.createDiv({
        cls: "bws-timeline-head",
        text: `${year}年${ML[mm] ?? mm}`,
        attr: { role: "button", tabindex: "0" },   // 与 bws-article 同属性，吃相同默认样式
      });
      for (const a of articles.sort((a, b) => b.date.localeCompare(a.date))) {
        this.renderArticleItem(section, a);
      }
    }
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

  /* ═══════ 文章条目：三行布局（标题 / 日期 / 摘要） ═══════ */
  private renderArticleItem(parent: HTMLElement, article: ArticleIndexEntry): void {
    const isRead = this.isReadFn ? this.isReadFn(article.slug) : false;

    const item = parent.createDiv({
      cls: `bws-article${isRead ? " is-read" : ""}`,
      attr: { "data-slug": article.slug, tabindex: "0", role: "button" },
    });

    if (article.slug === this.selectedSlug) item.addClass("is-active");

    // 第一行：标题
    item.createDiv({ cls: "bws-art-title", text: article.title });

    // 第二行：日期（中文短格式）
    item.createDiv({ cls: "bws-art-date", text: this.formatDate(article.date) });

    // 第三行：摘要（两行截断 + 悬浮提示）
    if (article.summary) {
      item.createDiv({
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
  }

  private groupByCategory(): CategoryGroup[] {
    let pool = this.articles;

    // 未读过滤
    if (this.filter === "unread" && this.isReadFn) {
      pool = pool.filter((a) => !this.isReadFn!(a.slug));
    }

    // 搜索过滤
    if (this.searchQuery) {
      pool = pool.filter((a) =>
        a.title.toLowerCase().includes(this.searchQuery) ||
        a.summary.toLowerCase().includes(this.searchQuery) ||
        a.category.toLowerCase().includes(this.searchQuery) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(this.searchQuery)) ||
        (this.getContent?.(a.slug) ?? "").toLowerCase().includes(this.searchQuery),
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
