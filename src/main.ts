/* ────────────── 竹杖芒鞋 · 插件入口 ────────────── */
import { App, Modal, Notice, Plugin, Setting } from "obsidian";
import type { Article, ArticleIndexEntry, BambooWalkingSettings } from "./types";
import { DEFAULT_SETTINGS, VIEW_TYPE_READER, VIEW_TYPE_SIDEBAR } from "./types";
import { REFRESH_INTERVAL, DEFAULT_AUTHOR_HANDLES } from "./constants";
import { GitHubArticleService } from "./services/GitHubArticleService";
import { LocalArticleService } from "./services/LocalArticleService";
import { CacheService } from "./services/CacheService";
import { PluginStatsService } from "./services/PluginStatsService";
import { PluginStatsModal } from "./ui/PluginStatsModal";
import { SidebarView } from "./ui/SidebarView";
import { ReaderView } from "./ui/ReaderView";
import { BambooWalkingSettingTab } from "./ui/SettingTab";
import { yamlEscape } from "./utils/yaml";
import { safeFileName } from "./utils/share";

// esbuild define 注入，开发构建=true，生产构建=false
declare const DEV_MODE: boolean;

/**
 * 防御性去重：按「分类 + 规范化标题」合并同一篇文章的重复索引条目
 * （slug 嵌入日期/标题，更新文章时可能生成多条）。保留日期最新的一条。
 * 与内容源 generate-index.js 的去重逻辑保持一致，作为列表层的最后防线。
 */
function dedupeArticles(entries: ArticleIndexEntry[]): ArticleIndexEntry[] {
  const best = new Map<string, ArticleIndexEntry>();
  const kept: ArticleIndexEntry[] = [];
  for (const e of entries) {
    const key = `${e.category}||${(e.title ?? "").trim()}`;
    const prev = best.get(key);
    if (prev === undefined || String(e.date) > String(prev.date)) {
      if (prev !== undefined) {
        const i = kept.indexOf(prev);
        if (i >= 0) kept[i] = e;
      } else {
        kept.push(e);
      }
      best.set(key, e);
    }
  }
  return kept;
}

/** 简单确认弹窗 */
class ConfirmModal extends Modal {
  private onResult: (ok: boolean) => void;

  constructor(app: App, private message: string, onResult: (ok: boolean) => void) {
    super(app);
    this.onResult = onResult;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message, cls: "bw-confirm-msg" });
    const btns = contentEl.createDiv({ cls: "bw-confirm-btns" });
    new Setting(btns)
      .addButton((btn) => btn.setButtonText("覆盖").setCta().onClick(() => { this.onResult(true); this.close(); }))
      .addButton((btn) => btn.setButtonText("取消").onClick(() => { this.onResult(false); this.close(); }));
  }

  onClose(): void { this.contentEl.empty(); }
}
interface ArticleService {
  fetchIndex(): Promise<ArticleIndexEntry[]>;
  fetchArticle(entry: ArticleIndexEntry): Promise<Article>;
}

export default class BambooWalkingPlugin extends Plugin {
  settings!: BambooWalkingSettings;
  cacheService!: CacheService;
  /** 插件态势服务（侧栏卡与详情弹窗共享） */
  pluginStatsService!: PluginStatsService;

  private service!: ArticleService;
  private refreshTimer: number | null = null;
  private firstLaunchTimer: number | null = null;
  private isFirstLaunch = false;
  private currentIndex: ArticleIndexEntry[] = [];
  /** 最近一次刷新发现的新 slug，供侧边栏延迟打开时补注「新」标记 */
  private lastNewSlugs: string[] = [];

  private getSidebarView(): SidebarView | null {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0]?.view as SidebarView ?? null;
  }

  private getReaderView(): ReaderView | null {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_READER)[0]?.view as ReaderView ?? null;
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // 选择文章源
    if (DEV_MODE) {
      this.service = new LocalArticleService("bamboo-column", this.app.vault.adapter);
    } else {
      this.service = new GitHubArticleService();
    }

    this.cacheService = new CacheService(
      async () => (await this.loadData()) as Record<string, unknown> | null,
      (data) => this.saveData(data),
    );
    await this.cacheService.load();

    // 插件态势服务（侧栏卡 + 详情弹窗共享；纯客户端，无需 token）
    this.pluginStatsService = new PluginStatsService(
      this.settings.authorHandles,
      async () => (await this.loadData()) as Record<string, unknown> | null,
      (data) => this.saveData(data),
    );
    await this.pluginStatsService.init();

    // ── 注册视图 ──
    this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => {
      const view = new SidebarView(leaf);
      view.setOnSelect((entry) => { void this.openArticle(entry); });
      view.setOnRefresh(() => { void this.refreshArticles(); });
      view.setIsReadFn((slug) => this.cacheService.isRead(slug));
      view.setGetContentFn((slug) => this.cacheService.getCachedArticle(slug)?.content ?? null);
      view.setGetWordCountFn((slug) => this.cacheService.getWordCount(slug));
      view.setPluginStatsService(this.pluginStatsService);
      view.setOnReady(() => {
        const idx = this.currentIndex.length > 0
          ? this.currentIndex
          : this.cacheService.getIndex();
        if (idx.length > 0) {
          if (this.lastNewSlugs.length > 0) view.setNewSlugs(this.lastNewSlugs);
          view.updateArticles(idx);
        }
      });
      return view;
    });

    this.registerView(VIEW_TYPE_READER, (leaf) => {
      const view = new ReaderView(leaf);
      view.setOnSave(async () => { await this.saveCurrentAsNote(); });
      view.setOnBack(() => this.focusSidebar());
      view.setGetArticles(() => this.cacheService.getIndex());
      view.setSavePathHint(this.settings.savePath);
      view.setOnOpen((slug: string) => {
        const entry = this.cacheService.getIndex().find((e) => e.slug === slug);
        if (entry) void this.openArticle(entry);
      });
      return view;
    });

    // ── 命令 ──
    this.addCommand({ id: "open-column", name: "打开专栏", callback: () => { void this.activateViews(); } });
    this.addCommand({ id: "refresh-articles", name: "刷新文章列表", callback: () => { void this.refreshArticles(); } });
    this.addCommand({ id: "save-as-note", name: "保存当前文章为笔记", callback: () => { void this.saveCurrentAsNote(); } });
    this.addCommand({ id: "view-plugin-stats", name: "查看插件态势", callback: () => {
      new PluginStatsModal(this.app, this.pluginStatsService).open();
    } });

    this.addRibbonIcon("book-open", "竹杖芒鞋", () => { void this.activateViews(); });
    this.addSettingTab(new BambooWalkingSettingTab(this.app, this, this.manifest.version));

    // ── 首次启动：自动打开视图并立即加载文章 ──
    this.isFirstLaunch = !this.cacheService.getIndex().length;
    if (this.isFirstLaunch) {
      // 延迟 500ms 等 workspace 就绪
      this.firstLaunchTimer = window.setTimeout(() => {
        void this.activateViews();
        // 首次启动时阅读器显示品牌引导页
        const readerView = this.getReaderView();
        if (readerView) readerView.renderWelcome(true);
        void this.refreshArticles(true); // 首次启动立即加载文章（静默，避免把全部文章误报为"新"）
      }, 500);
    }

    // ── 加载缓存数据 ──
    this.currentIndex = this.cacheService.getIndex();
    const sidebarView = this.getSidebarView();
    if (sidebarView && this.currentIndex.length > 0) {
      sidebarView.updateArticles(this.currentIndex);
    } else if (sidebarView) {
      sidebarView.setLoading();
    }

    // ── 定时刷新 ──
    if (REFRESH_INTERVAL > 0) {
      this.refreshTimer = window.setInterval(
        () => { void this.refreshArticles(true); },
        REFRESH_INTERVAL,
      );
      if (this.refreshTimer !== null) {
        this.registerInterval(this.refreshTimer);
      }
    }

    // ── 立即拉取 ──
    void this.refreshArticles(true);
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
    }
    if (this.firstLaunchTimer !== null) {
      window.clearTimeout(this.firstLaunchTimer);
    }
  }

  /* ═══════════════════ 配置 ═══════════════════ */

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as { settings?: BambooWalkingSettings } | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
    // 作者手柄由开发者固定，禁止用户修改或旧数据残留覆盖
    this.settings.authorHandles = DEFAULT_AUTHOR_HANDLES;
  }

  async saveSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
    data.settings = this.settings;
    await this.saveData(data);
  }

  /* ═══════════════════ 视图 ═══════════════════ */

  async activateViews(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR).length === 0) {
      const leaf = this.app.workspace.getLeftLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
    }
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_READER).length === 0) {
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE_READER, active: true });
    }
  }

  focusSidebar(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
    if (leaves.length > 0) {
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
    }
  }

  /* ═══════════════════ 文章 ═══════════════════ */

  async refreshArticles(silent = false): Promise<void> {
    const sidebarView = this.getSidebarView();
    if (sidebarView && this.currentIndex.length === 0) {
      sidebarView.setLoading();
    }

    try {
      const rawEntries = await this.service.fetchIndex();
      const entries = dedupeArticles(rawEntries);
      const newSlugs = await this.cacheService.setIndex(entries);
      this.currentIndex = entries;
      this.lastNewSlugs = newSlugs;

      if (sidebarView) {
        // 注入新到达的 slug，让侧边栏条目自动亮起「新」标记（含静默自动刷新）
        if (newSlugs.length > 0) sidebarView.setNewSlugs(newSlugs);
        sidebarView.updateArticles(entries);
      }

      // 常驻状态栏：无论手动/静默刷新都更新「更新于 hh:mm」，让用户随时可见上次同步时间
      sidebarView?.setRefreshStatus(newSlugs.length);
      // Notice 仅在手动刷新时弹出，避免静默自动刷新打扰
      if (!silent) {
        if (newSlugs.length > 0) {
          new Notice(`竹杖芒鞋：发现 ${newSlugs.length} 篇新文章`);
        } else {
          new Notice("竹杖芒鞋：已是最新");
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      console.error("[竹杖芒鞋] 刷新失败:", e);
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (sidebarView && this.currentIndex.length === 0) {
        // 完全无缓存：仍是错误态
        sidebarView.setError(msg);
      } else if (sidebarView) {
        // 有缓存：明确告知用户当前展示的是缓存及其新鲜度，消除困惑
        sidebarView.setStaleStatus(this.cacheService.getLastFetch(), offline);
      }
      if (!silent) {
        new Notice(
          offline
            ? "竹杖芒鞋：当前离线，显示的是本地缓存"
            : `竹杖芒鞋：刷新失败（${msg}），点击刷新按钮重试`,
        );
      }
    }
  }

  async openArticle(entry: ArticleIndexEntry): Promise<void> {
    const sidebarView = this.getSidebarView();
    if (sidebarView) sidebarView.setSelected(entry.slug);

    await this.cacheService.markRead(entry.slug);
    if (sidebarView) {
      sidebarView.refreshReadState();
      // 点开即视为已关注，移除「新」标记
      sidebarView.clearNewSlug(entry.slug);
    }

    let article = this.cacheService.getCachedArticle(entry.slug, entry.hash);
    if (!article) {
      await this.activateViews();
      const readerView = this.getReaderView();
      if (readerView) readerView.showLoading(entry.title);

      try {
        article = await this.service.fetchArticle(entry);
        await this.cacheService.setArticle(entry.slug, article, entry.hash);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "未知错误";
        if (readerView) readerView.showError(msg);
        return;
      }
    }

    await this.activateViews();
    const readerView = this.getReaderView();
    if (readerView) {
      await readerView.showArticle(article);
    }

    // 打开文章后字数已写入缓存，重绘侧边栏以即时显示该篇字数 + 作者区汇总
    if (sidebarView) sidebarView.updateArticles(this.currentIndex);
  }

  async saveCurrentAsNote(): Promise<void> {
    const readerView = this.getReaderView();
    const article: Article | null = readerView?.currentArticle ?? null;

    if (!article) {
      new Notice("竹杖芒鞋：当前没有打开的文章");
      return;
    }

    const { savePath } = this.settings;
    const fileName = safeFileName(article.title);
    const filePath = `${savePath}/${fileName}.md`;

    try {
      if (!(await this.app.vault.adapter.exists(savePath))) {
        await this.app.vault.createFolder(savePath);
      }

      const fm = [
        "---",
        `title: "${yamlEscape(article.title)}"`,
        `date: ${article.date}`,
        `category: "${yamlEscape(article.category)}"`,
        `summary: "${yamlEscape(article.summary)}"`,
        article.tags?.length
          ? `tags: [${article.tags.map((t) => `"${yamlEscape(t)}"`).join(", ")}]`
          : null,
        `source: "竹杖芒鞋"`,
        `copyright: "© 羽鳞君，CC BY-NC-ND 4.0"`,
        "---",
        "",
      ].filter(Boolean).join("\n");

      const fullContent = fm + article.content;

      if (await this.app.vault.adapter.exists(filePath)) {
        // 覆盖确认：仅当文件已存在时询问
        const ok = await new Promise<boolean>((resolve) => {
          const dlg = new ConfirmModal(this.app, `「${article.title}」已存在，是否覆盖？`, resolve);
          dlg.open();
        });
        if (!ok) {
          new Notice("已取消保存");
          return;
        }
        await this.app.vault.adapter.write(filePath, fullContent);
      } else {
        await this.app.vault.create(filePath, fullContent);
      }

      new Notice(`已保存：${filePath}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      new Notice(`保存失败: ${msg}`);
    }
  }
}
