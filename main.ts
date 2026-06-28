import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";

interface HomepageSettings {
  homepagePath: string;
}

const DEFAULT_SETTINGS: HomepageSettings = {
  homepagePath: "Homepage.md",
};

function isMarkdownView(leaf: WorkspaceLeaf): boolean {
  return leaf.view?.getViewType() === "markdown";
}

export default class HomepagePlugin extends Plugin {
  settings: HomepageSettings = DEFAULT_SETTINGS;
  private layoutReady = false;

  async onload() {
    await this.loadSettings();

    // 用户手动打开首页的命令
    this.addCommand({
      id: "open-homepage",
      name: "打开首页",
      callback: () => this.openHomepage(),
    });

    // 布局就绪后，如果没有恢复的叶子，自动打开首页
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      const openLeaves = this.app.workspace.getLeavesOfType("markdown").filter(isMarkdownView);
      if (openLeaves.length === 0) {
        this.openHomepage();
      }
    });

    this.addSettingTab(new HomepageSettingTab(this.app, this));
  }

  onunload() {}

  async openHomepage() {
    const path = this.settings.homepagePath;
    let file = this.app.vault.getAbstractFileByPath(path);

    if (!file) {
      file = await this.app.vault.create(
        path,
        "# 欢迎使用 Obsidian\n\n这是你的首页。点击左侧编辑按钮，自由修改这里的内容。\n\n你可以添加任务列表、笔记链接、图片、或其他任何 Markdown 内容。\n\n---\n\n> 用 `Cmd/Ctrl + Shift + H` 随时回到这里。"
      );
    }

    if (file instanceof TFile) {
      await this.app.workspace.openLinkText(file.path, "", false);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class HomepageSettingTab extends PluginSettingTab {
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
      .setName("首页文件路径")
      .setDesc("相对于 vault 根目录的 Markdown 文件路径，例如 Homepage.md 或 folder/Welcome.md")
      .addText((text) =>
        text
          .setPlaceholder("Homepage.md")
          .setValue(this.plugin.settings.homepagePath)
          .onChange(async (value) => {
            this.plugin.settings.homepagePath = value.trim() || "Homepage.md";
            await this.plugin.saveSettings();
          })
      );
  }
}
