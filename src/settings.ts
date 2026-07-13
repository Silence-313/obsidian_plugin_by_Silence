import { App, PluginSettingTab, Setting } from "obsidian";
import type HomepagePlugin from "./plugin";
import { loadApiKeyFromKeychain, saveApiKeyToKeychain, deleteApiKeyFromKeychain } from "./utils";

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

    // --- LLM Wiki Section ---
    containerEl.createEl("h3", { text: "LLM Wiki" });

    // Show masked placeholder if key is in Keychain, otherwise show plaintext or empty
    const keyInKeychain = this.plugin.settings.llmWiki.apiKeyInKeychain;
    const displayValue = keyInKeychain ? "••••••••" : (this.plugin.settings.llmWiki.apiKey || "");

    const apiKeySetting = new Setting(containerEl)
      .setName("DeepSeek API Key")
      .setDesc(keyInKeychain
        ? "密钥已存储在 macOS 钥匙串中。输入新密钥即可替换。"
        : "用于调用 DeepSeek API 的密钥。保存在 macOS 钥匙串中。")
      .addText((text) => {
        text
          .setPlaceholder(keyInKeychain ? "••••••••" : "sk-...")
          .setValue(displayValue);
        // When showing masked value, clear on focus so user can type new key
        if (keyInKeychain) {
          text.inputEl.type = "password";
          text.inputEl.addEventListener("focus", () => {
            if (text.getValue() === "••••••••") {
              text.setValue("");
              text.inputEl.type = "text";
            }
          });
          text.inputEl.addEventListener("blur", () => {
            if (!text.getValue()) {
              text.setValue("••••••••");
              text.inputEl.type = "password";
            }
          });
        }
        text.onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed && trimmed !== "••••••••") {
            // Save to Keychain
            const ok = saveApiKeyToKeychain(trimmed);
            if (ok) {
              this.plugin.settings.llmWiki.apiKeyInKeychain = true;
              this.plugin.settings.llmWiki.apiKey = "";
              text.inputEl.type = "password";
              text.setValue("••••••••");
            } else {
              // Keychain unavailable, fall back to plaintext
              this.plugin.settings.llmWiki.apiKey = trimmed;
              this.plugin.settings.llmWiki.apiKeyInKeychain = false;
            }
          } else if (!trimmed) {
            // User cleared the key
            deleteApiKeyFromKeychain();
            this.plugin.settings.llmWiki.apiKeyInKeychain = false;
            this.plugin.settings.llmWiki.apiKey = "";
          }
          await this.plugin.saveSettings();
        });
        return text;
      });

    new Setting(containerEl)
      .setName("API 端点")
      .setDesc("DeepSeek API 的 base URL")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com/v1")
          .setValue(this.plugin.settings.llmWiki.apiEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.llmWiki.apiEndpoint = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("模型")
      .setDesc("使用的 DeepSeek 模型")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("deepseek-chat", "DeepSeek Chat (V3)")
          .addOption("deepseek-reasoner", "DeepSeek Reasoner (R1)")
          .setValue(this.plugin.settings.llmWiki.model)
          .onChange(async (value) => {
            this.plugin.settings.llmWiki.model = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Wiki 目录")
      .setDesc("知识库文件在 vault 中的存放路径")
      .addText((text) =>
        text
          .setPlaceholder("llm-wiki")
          .setValue(this.plugin.settings.llmWiki.wikiFolder)
          .onChange(async (value) => {
            this.plugin.settings.llmWiki.wikiFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("每日自动维护")
      .setDesc("每天下午 13:00 自动维护知识库")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.llmWiki.autoMaintain)
          .onChange(async (value) => {
            this.plugin.settings.llmWiki.autoMaintain = value;
            await this.plugin.saveSettings();
          })
      );

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

    // --- Inline Predict Section ---
    containerEl.createEl("h3", { text: "内联预测" });

    new Setting(containerEl)
      .setName("启用方式")
      .setDesc("在首页侧边栏中，将「内联预测」组件拖入「已添加组件」即可开启。预测仅在编辑器中生效，不会在首页渲染卡片。");

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("星火 Spark Lite API Key，格式为 apiKey:apiSecret（用冒号拼接）")
      .addText((text) =>
        text
          .setPlaceholder("d2f787c2...:MDIxZGFk...")
          .setValue(this.plugin.settings.inlinePredict.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.inlinePredict.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("延迟 (ms)")
      .setDesc("停止输入后多久触发预测，范围 200-2000ms")
      .addSlider((slider) =>
        slider
          .setLimits(200, 2000, 50)
          .setValue(this.plugin.settings.inlinePredict.debounceMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.inlinePredict.debounceMs = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("上下文长度")
      .setDesc("发送给 AI 的光标前文字数量，范围 200-4000")
      .addSlider((slider) =>
        slider
          .setLimits(200, 4000, 100)
          .setValue(this.plugin.settings.inlinePredict.contextChars)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.inlinePredict.contextChars = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Note Assistant Section ---
    containerEl.createEl("h3", { text: "笔记助手" });

    new Setting(containerEl)
      .setName("启用方式")
      .setDesc("在首页侧边栏中，将「笔记助手」组件拖入「已添加组件」即可开启。当编辑 Markdown 笔记时，助手会以悬浮窗形式自动出现。");

    new Setting(containerEl)
      .setName("默认同步笔记内容")
      .setDesc("开启后，每次提问时自动将当前编辑的笔记内容附在问题后面作为上下文。可在浮窗中随时切换。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.noteAssistant.syncNoteContent)
          .onChange(async (value) => {
            this.plugin.settings.noteAssistant.syncNoteContent = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("复用 LLM Wiki 的 DeepSeek API Key，无需单独配置。");
  }
}
