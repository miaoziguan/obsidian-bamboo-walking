/* ────────────── 竹杖芒鞋 · 插件入口 ────────────── */
import { Notice, Plugin } from "obsidian";
import type { Article, ArticleIndexEntry, BambooWalkingSettings } from "./types";
import { DEFAULT_SETTINGS, VIEW_TYPE_READER, VIEW_TYPE_SIDEBAR } from "./types";
import { REFRESH_INTERVAL, CACHE_EXPIRY } from "./constants";
import { GitHubArticleService } from "./services/GitHubArticleService";
import { LocalArticleService } from "./services/LocalArticleService";
import { CacheService } from "./services/CacheService";
import { SidebarView } from "./ui/SidebarView";
import { ReaderView } from "./ui/ReaderView";
import { BambooWalkingSettingTab } from "./ui/SettingTab";
import { yamlEscape } from "./utils/yaml";

// esbuild define 注入，开发构建=true，生产构建=false
declare const DEV_MODE: boolean;

interface ArticleService {
  fetchIndex(): Promise<ArticleIndexEntry[]>;
  fetchArticle(entry: ArticleIndexEntry): Promise<Article>;
}

export default class BambooWalkingPlugin extends Plugin {
  settings!: BambooWalkingSettings;
  cacheService!: CacheService;

  private service!: ArticleService;
  private refreshTimer: number | null = null;
  private firstLaunchTimer: number | null = null;
  private currentIndex: ArticleIndexEntry[] = [];

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
      async () => (await this.loadData()) ?? null,
      (data) => this.saveData(data),
      CACHE_EXPIRY,
    );
    await this.cacheService.load();

    // ── 注册视图 ──
    this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => {
      const view = new SidebarView(leaf);
      view.setOnSelect((entry) => { void this.openArticle(entry); });
      view.setOnRefresh(() => { void this.refreshArticles(); });
      view.setIsReadFn((slug) => this.cacheService.isRead(slug));
      view.setOnReady(() => {
        const idx = this.currentIndex.length > 0
          ? this.currentIndex
          : this.cacheService.getIndex();
        if (idx.length > 0) {
          view.updateArticles(idx);
        }
      });
      return view;
    });

    this.registerView(VIEW_TYPE_READER, (leaf) => {
      const view = new ReaderView(leaf);
      view.setOnSave(async () => { await this.saveCurrentAsNote(); });
      view.setOnBack(() => this.focusSidebar());
      return view;
    });

    // ── 命令 ──
    this.addCommand({ id: "open-column", name: "打开专栏", callback: () => { void this.activateViews(); } });
    this.addCommand({ id: "refresh-articles", name: "刷新文章列表", callback: () => { void this.refreshArticles(); } });
    this.addCommand({ id: "save-as-note", name: "保存当前文章为笔记", callback: () => { void this.saveCurrentAsNote(); } });

    this.addRibbonIcon("book-open", "竹杖芒鞋", () => { void this.activateViews(); });
    this.addSettingTab(new BambooWalkingSettingTab(this.app, this, this.manifest.version));

    // ── 首次启动：自动打开视图 ──
    const isFirstLaunch = !this.cacheService.getIndex().length;
    if (isFirstLaunch) {
      // 延迟 500ms 等 workspace 就绪
      this.firstLaunchTimer = window.setTimeout(() => {
        void this.activateViews();
        new Notice("竹杖芒鞋：点击左侧栏图标开始阅读");
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
        REFRESH_INTERVAL * 60 * 1000,
      );
      this.registerInterval(this.refreshTimer as unknown as number);
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
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
  }

  async saveSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
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
    if (leaves.length > 0) this.app.workspace.revealLeaf(leaves[0]);
  }

  /* ═══════════════════ 文章 ═══════════════════ */

  async refreshArticles(silent = false): Promise<void> {
    const sidebarView = this.getSidebarView();
    if (sidebarView && this.currentIndex.length === 0) {
      sidebarView.setLoading();
    }

    try {
      const entries = await this.service.fetchIndex();
      const newSlugs = await this.cacheService.setIndex(entries);
      this.currentIndex = entries;

      if (sidebarView) {
        sidebarView.updateArticles(entries);
      }

      if (newSlugs.length > 0 && !silent) {
        new Notice(`竹杖芒鞋：发现 ${newSlugs.length} 篇新文章`);
      } else if (!silent) {
        new Notice("竹杖芒鞋：已是最新");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      console.error("[竹杖芒鞋] 刷新失败:", e);
      if (sidebarView && this.currentIndex.length === 0) {
        sidebarView.setError(msg);
      }
      if (!silent) {
        new Notice(`竹杖芒鞋：刷新失败 - ${msg}`);
      }
    }
  }

  async openArticle(entry: ArticleIndexEntry): Promise<void> {
    const sidebarView = this.getSidebarView();
    if (sidebarView) sidebarView.setSelected(entry.slug);

    await this.cacheService.markRead(entry.slug);
    if (sidebarView) sidebarView.refreshReadState();

    let article = this.cacheService.getCachedArticle(entry.slug);
    if (!article) {
      await this.activateViews();
      const readerView = this.getReaderView();
      if (readerView) readerView.showLoading(entry.title);

      try {
        article = await this.service.fetchArticle(entry);
        await this.cacheService.setArticle(entry.slug, article);
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
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_READER);
      if (leaves.length > 0) this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  async saveCurrentAsNote(): Promise<void> {
    const readerView = this.getReaderView();
    const article: Article | null = readerView?.currentArticle ?? null;

    if (!article) {
      new Notice("竹杖芒鞋：当前没有打开的文章");
      return;
    }

    const { savePath } = this.settings;
    const filePath = `${savePath}/${article.title}.md`;

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
