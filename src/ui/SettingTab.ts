/* ────────────── 插件设置面板 ────────────── */
import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type BambooWalkingPlugin from "../main";

const DEFAULT_SAVE_PATH = "竹杖芒鞋";

export class BambooWalkingSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: BambooWalkingPlugin,
    private pluginVersion: string,
  ) {
    super(app, plugin);
  }

  /**
   * Declarative definitions — used by Obsidian 1.13.0+ for rendering and
   * settings search. Falls back to {@link display} on older versions.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "竹杖芒鞋 · 设置",
        items: [
          {
            name: "保存路径",
            desc: "将文章保存为笔记时，存放在 vault 的哪个文件夹",
            control: {
              type: "text",
              key: "savePath",
              placeholder: DEFAULT_SAVE_PATH,
              defaultValue: DEFAULT_SAVE_PATH,
            },
          },
          {
            name: "清除缓存",
            desc: "清除本地缓存的文章数据，下次打开时重新拉取",
            action: () => {
              void this.plugin.cacheService.clear();
              new Notice("缓存已清除");
            },
          },
        ],
      },
      {
        type: "group",
        heading: "插件态势",
        items: [
          {
            name: "作者手柄",
            desc: `按 GitHub 手柄（插件仓库所有者）自动发现「我的插件」。当前固定为：${this.plugin.settings.authorHandles.join("、")}，由开发者设置，普通用户无需修改。`,
            render: () => {},
          },
        ],
      },
      {
        type: "group",
        heading: `竹杖芒鞋 v${this.pluginVersion}`,
        items: [
          {
            name: "关于",
            desc: "竹杖芒鞋 · 轻胜马",
            render: (setting) => {
              this.buildAboutCard(setting.controlEl);
            },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "savePath") return this.plugin.settings.savePath;
    return undefined;
  }

  setControlValue(key: string, value: unknown): void {
    if (key === "savePath") {
      this.plugin.settings.savePath = String(value).trim() || DEFAULT_SAVE_PATH;
      void this.plugin.saveSettings();
    }
  }

  /** Imperative fallback for Obsidian < 1.13.0 (display is not called on 1.13.0+). */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("竹杖芒鞋 · 设置").setHeading();

    // ── 保存笔记 ──
    new Setting(containerEl)
      .setName("保存路径")
      .setDesc("将文章保存为笔记时，存放在 vault 的哪个文件夹")
      .addText((text) =>
        text
          .setPlaceholder("竹杖芒鞋")
          .setValue(this.plugin.settings.savePath)
          .onChange(async (value) => {
            this.plugin.settings.savePath = value.trim() || "竹杖芒鞋";
            await this.plugin.saveSettings();
          }),
      );

    // ── 缓存 ──
    new Setting(containerEl)
      .setName("清除缓存")
      .setDesc("清除本地缓存的文章数据，下次打开时重新拉取")
      .addButton((btn) =>
        btn.setButtonText("✕ 清除缓存").onClick(async () => {
          await this.plugin.cacheService.clear();
          btn.setButtonText("✓ 已清除");
          window.setTimeout(() => { btn.setButtonText("✕ 清除缓存"); }, 2000);
        }),
      );

    // ── 关于 ──
    new Setting(containerEl).setName(`竹杖芒鞋 v${this.pluginVersion}`).setHeading();
    this.buildAboutCard(containerEl);

    // ── 插件态势 ──
    new Setting(containerEl).setName("插件态势").setHeading();
    this.buildAuthorHandlesInfo(containerEl);
  }

  /** 作者手柄为开发者固定值，普通用户不可修改，仅作只读展示 */
  private buildAuthorHandlesInfo(parent: HTMLElement): void {
    const handles = this.plugin.settings.authorHandles.join("、");
    new Setting(parent)
      .setName("作者手柄（自动发现）")
      .setDesc(
        `按 GitHub 手柄（插件仓库所有者）自动发现「我的插件」。当前固定为：${handles}，由开发者设置，普通用户无需修改。`,
      );
  }

  private buildAboutCard(parent: HTMLElement): void {
    const about = parent.createDiv({ cls: "bw-about-card" });
    about.createEl("p", {
      text: "竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。",
      cls: "bw-about-quote",
    });
    const authorRow = about.createDiv({ cls: "bw-about-author-row" });
    authorRow.createSpan({ text: "作者：羽鳞君", cls: "bw-about-author" });
    const gh = authorRow.createEl("a", {
      href: "https://github.com/miaoziguan",
      cls: "bw-about-author-gh",
      attr: { target: "_blank", rel: "noopener noreferrer", "aria-label": "GitHub", title: "GitHub" },
    });
    const ghIco = gh.createSpan({ cls: "bw-brand-link-ico-wrap" });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- setIcon 是 Obsidian 官方 API
    setIcon(ghIco, "github");
  }
}
