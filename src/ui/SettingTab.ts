/* ────────────── 插件设置面板 ────────────── */
import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type BambooWalkingPlugin from "../main";

export class BambooWalkingSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: BambooWalkingPlugin,
    private pluginVersion: string,
  ) {
    super(app, plugin);
  }

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
    const about = containerEl.createDiv({ cls: "bw-about-card" });
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
