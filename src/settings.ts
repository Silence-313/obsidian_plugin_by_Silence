import { App, PluginSettingTab, Setting } from "obsidian";
import type HomepagePlugin from "./plugin";

export class HomepageSettingTab extends PluginSettingTab {
  plugin: HomepagePlugin;

  constructor(app: App, plugin: HomepagePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Homepage 设置" });

    new Setting(containerEl)
      .setName("你的名字")
      .setDesc("首页问候中显示的名字")
      .addText((text) =>
        text
          .setPlaceholder("输入你的名字")
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("超级桌面")
      .setDesc("各桌面实例的文件夹在组件内通过设置按钮独立配置");

    // --- Study Mode Section ---
    containerEl.createEl("h3", { text: "学习模式" });

    new Setting(containerEl)
      .setName("默认网址")
      .setDesc("打开学习模式时默认加载的网页地址（留空则显示起始页）")
      .addText((text) =>
        text
          .setPlaceholder("https://www.youtube.com")
          .setValue(this.plugin.settings.studyMode.defaultUrl)
          .onChange(async (value) => {
            this.plugin.settings.studyMode.defaultUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("截图格式")
      .setDesc("截图的图片格式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("png", "PNG")
          .addOption("jpg", "JPEG")
          .setValue(this.plugin.settings.studyMode.screenshotFormat)
          .onChange(async (value) => {
            this.plugin.settings.studyMode.screenshotFormat = value as "png" | "jpg";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("截图质量")
      .setDesc("仅对 JPEG 格式有效 (1-100)")
      .addSlider((slider) =>
        slider
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.studyMode.screenshotQuality)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.studyMode.screenshotQuality = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
