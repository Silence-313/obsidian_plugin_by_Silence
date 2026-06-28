import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE_HOMEPAGE = "homepage-view";

interface HomepageSettings {
  userName: string;
}

const DEFAULT_SETTINGS: HomepageSettings = {
  userName: "",
};

function getTimePeriod(hours: number): string {
  if (hours >= 6 && hours < 9) return "早上";
  if (hours >= 9 && hours < 12) return "上午";
  if (hours >= 12 && hours < 14) return "中午";
  if (hours >= 14 && hours < 19) return "下午";
  return "晚上";
}

export default class HomepagePlugin extends Plugin {
  settings: HomepageSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_HOMEPAGE, (leaf) => new HomepageView(leaf, this));

    this.addCommand({
      id: "open-homepage",
      name: "打开首页",
      callback: () => this.openHomepage(),
    });

    this.app.workspace.onLayoutReady(() => {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOMEPAGE);
      if (existing.length === 0) {
        this.openHomepage();
      }
    });

    this.addSettingTab(new HomepageSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_HOMEPAGE);
  }

  async openHomepage() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOMEPAGE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_HOMEPAGE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class HomepageView extends ItemView {
  plugin: HomepagePlugin;
  private intervalId: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HomepagePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HOMEPAGE;
  }

  getDisplayText(): string {
    return "首页";
  }

  getIcon(): string {
    return "home";
  }

  async onOpen() {
    this.render();
    this.intervalId = window.setInterval(() => this.updateTime(), 1000);
  }

  async onClose() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    const now = new Date();
    const period = getTimePeriod(now.getHours());
    const userName = this.plugin.settings.userName;

    container.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
      user-select: none;
    `;

    container.innerHTML = `
      <style>
        #homepage-name-input::placeholder {
          color: var(--text-faint);
          opacity: 1;
        }
      </style>
      <div id="homepage-header" style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 24px;
        border-bottom: 1px solid var(--background-modifier-border);
      ">
        <div id="homepage-greeting" style="
          font-size: 15px;
          color: var(--text-normal);
          letter-spacing: 1px;
          display: flex;
          align-items: baseline;
          gap: 2px;
          min-width: 140px;
        ">
          <span id="homepage-greeting-text">${period}好，</span>
          <input
            id="homepage-name-input"
            type="text"
            placeholder="你的名字"
            value="${userName}"
            style="
              font-size: 15px;
              color: var(--text-normal);
              background: transparent;
              border: none;
              border-bottom: 1px dashed var(--text-faint);
              padding: 0;
              outline: none;
              width: 100px;
              letter-spacing: 1px;
              font-family: inherit;
            "
          />
        </div>
        <div id="homepage-clock" style="
          font-size: 24px;
          font-weight: 300;
          color: var(--text-normal);
          font-variant-numeric: tabular-nums;
        ">${this.formatTime(now)}</div>
        <div id="homepage-date" style="
          font-size: 15px;
          color: var(--text-muted);
          text-align: right;
          min-width: 140px;
        ">${this.formatDate(now)}</div>
      </div>
      <div style="
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: var(--text-faint);
        text-align: center;
        line-height: 1.6;
      ">
        用 <code style="
          background: var(--background-modifier-hover);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
        ">Cmd/Ctrl + Shift + H</code> 随时回到这里
      </div>
    `;

    const input = container.querySelector("#homepage-name-input") as HTMLInputElement;
    input.addEventListener("change", () => this.saveName(input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        input.blur();
      }
    });

    // auto-resize input width to fit content
    const resizeInput = () => {
      const span = document.createElement("span");
      span.style.cssText = `
        font-size: 15px; letter-spacing: 1px; font-family: inherit;
        position: absolute; visibility: hidden; white-space: pre;
      `;
      document.body.appendChild(span);
      span.textContent = input.value || input.placeholder;
      input.style.width = (span.offsetWidth + 4) + "px";
      document.body.removeChild(span);
    };
    input.addEventListener("input", resizeInput);
    resizeInput();
  }

  private updateTime() {
    const now = new Date();
    const clockEl = this.containerEl.querySelector("#homepage-clock");
    const dateEl = this.containerEl.querySelector("#homepage-date");
    if (clockEl) clockEl.textContent = this.formatTime(now);
    if (dateEl) {
      const newDate = this.formatDate(now);
      if (dateEl.textContent !== newDate) {
        dateEl.textContent = newDate;
        // date changed, time period might have changed too
        this.updateGreeting();
      }
    }
  }

  private saveName(name: string) {
    this.plugin.settings.userName = name;
    this.plugin.saveSettings();
  }

  private updateGreeting() {
    const greetingTextEl = this.containerEl.querySelector("#homepage-greeting-text");
    if (!greetingTextEl) return;
    const period = getTimePeriod(new Date().getHours());
    greetingTextEl.textContent = `${period}好，`;
  }

  private formatTime(date: Date): string {
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    const s = date.getSeconds().toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  private formatDate(date: Date): string {
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = weekdays[date.getDay()];
    return `${y}年${m}月${d}日 ${w}`;
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
  }
}
