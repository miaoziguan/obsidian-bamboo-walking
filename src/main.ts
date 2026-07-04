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
  private sidebarView: SidebarView | null = null;
  private readerView: ReaderView | null = null;
  private refreshTimer: number | null = null;
  private firstLaunchTimer: number | null = null;
  private currentIndex: ArticleIndexEntry[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    // 选择文章源
    if (DEV_MODE) {
      this.service = new LocalArticleService("bamboo-column", this.app.vault.adapter);
    } else {
      this.service = new GitHubArticleService();
    }

    this.cacheService = new CacheService(
      () => this.loadData(),
      (data) => this.saveData(data),
      CACHE_EXPIRY,
    );
    await this.cacheService.load();

    // ── 注册视图 ──
    this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => {
      this.sidebarView = new SidebarView(leaf);
      this.sidebarView.setOnSelect((entry) => this.openArticle(entry));
      this.sidebarView.setOnRefresh(() => this.refreshArticles());
      this.sidebarView.setIsReadFn((slug) => this.cacheService.isRead(slug));
      this.sidebarView.setOnReady(() => {
        // 视图就绪时，推送当前已有数据
        const idx = this.currentIndex.length > 0
          ? this.currentIndex
          : this.cacheService.getIndex();
        if (idx.length > 0) {
          this.sidebarView!.updateArticles(idx);
        }
      });
      return this.sidebarView;
    });

    this.registerView(VIEW_TYPE_READER, (leaf) => {
      this.readerView = new ReaderView(leaf);
      this.readerView.setOnSave(async () => { await this.saveCurrentAsNote(); });
      this.readerView.setOnBack(() => this.focusSidebar());
      return this.readerView;
    });

    // ── 命令 ──
    this.addCommand({ id: "open-column", name: "打开专栏", callback: () => this.activateViews() });
    this.addCommand({ id: "refresh-articles", name: "刷新文章列表", callback: () => this.refreshArticles() });
    this.addCommand({ id: "save-as-note", name: "保存当前文章为笔记", callback: () => this.saveCurrentAsNote() });

    this.addRibbonIcon("book-open", "竹杖芒鞋", () => this.activateViews());
    this.addSettingTab(new BambooWalkingSettingTab(this.app, this, this.manifest.version));

    // ── 首次启动：自动打开视图 ──
    const isFirstLaunch = !this.cacheService.getIndex().length;
    if (isFirstLaunch) {
      // 延迟 500ms 等 workspace 就绪
      this.firstLaunchTimer = window.setTimeout(() => {
        this.activateViews();
        new Notice("竹杖芒鞋：点击左侧栏图标开始阅读");
      }, 500);
    }

    // ── 加载缓存数据 ──
    this.currentIndex = this.cacheService.getIndex();
    if (this.sidebarView && this.currentIndex.length > 0) {
      this.sidebarView.updateArticles(this.currentIndex);
    } else if (this.sidebarView) {
      this.sidebarView.setLoading();
    }

    // ── 定时刷新 ──
    if (REFRESH_INTERVAL > 0) {
      this.refreshTimer = window.setInterval(
        () => this.refreshArticles(true),
        REFRESH_INTERVAL * 60 * 1000,
      );
      // Obsidian Plugin.registerInterval 签名为 number，但 TS 环境下 window.setInterval 返回 NodeJS.Timeout，
      // 此处用 as any 绕过类型不匹配（Obsidian 插件社区惯例）
      this.registerInterval(this.refreshTimer as any);
    }

    // ── 立即拉取 ──
    this.refreshArticles(true);
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
    if (this.sidebarView && this.currentIndex.length === 0) {
      this.sidebarView.setLoading();
    }

    try {
      const entries = await this.service.fetchIndex();
      const newSlugs = await this.cacheService.setIndex(entries);
      this.currentIndex = entries;

      if (this.sidebarView) {
        this.sidebarView.updateArticles(entries);
      }

      if (newSlugs.length > 0 && !silent) {
        new Notice(`竹杖芒鞋：发现 ${newSlugs.length} 篇新文章`);
      } else if (!silent) {
        new Notice("竹杖芒鞋：已是最新");
      }
    } catch (e: any) {
      console.error("[竹杖芒鞋] 刷新失败:", e);
      if (this.sidebarView && this.currentIndex.length === 0) {
        this.sidebarView.setError(e.message);
      }
      if (!silent) {
        new Notice(`竹杖芒鞋：刷新失败 - ${e.message}`);
      }
    }
  }

  async openArticle(entry: ArticleIndexEntry): Promise<void> {
    if (this.sidebarView) this.sidebarView.setSelected(entry.slug);

    // 标记为已读
    await this.cacheService.markRead(entry.slug);
    if (this.sidebarView) this.sidebarView.refreshReadState();

    let article = this.cacheService.getCachedArticle(entry.slug);
    if (!article) {
      // 用阅读器内联加载态，不弹 Notice
      await this.activateViews();
      if (this.readerView) this.readerView.showLoading(entry.title);

      try {
        article = await this.service.fetchArticle(entry);
        await this.cacheService.setArticle(entry.slug, article);
      } catch (e: any) {
        if (this.readerView) this.readerView.showError(e.message);
        return;
      }
    }

    await this.activateViews();
    if (this.readerView) {
      await this.readerView.showArticle(article);
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_READER);
      if (leaves.length > 0) this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  async saveCurrentAsNote(): Promise<void> {
    const article: Article | null = this.readerView?.currentArticle ?? null;

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
    } catch (e: any) {
      new Notice(`保存失败: ${e.message}`);
    }
  }
}
