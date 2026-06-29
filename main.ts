import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, Modal, FileSystemAdapter } from "obsidian";

const VIEW_TYPE_HOMEPAGE = "homepage-view";

interface TodoItem {
  id: string;
  text: string;
  color: string;
  done: boolean;
  date: string;
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface ComponentInfo {
  id: string;
  name: string;
  added: boolean;
}

interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HomepageSettings {
  userName: string;
  todos: TodoItem[];
  components: ComponentInfo[];
  cardLayouts: Record<string, CardLayout>;
  desktopFolders: string[];
  desktopNames: string[];
}

const DEFAULT_COMPONENTS: ComponentInfo[] = [
  { id: "schedule", name: "日程中心", added: true },
  { id: "timer", name: "计时器", added: false },
  { id: "desktop", name: "超级桌面", added: false },
];

const DEFAULT_SETTINGS: HomepageSettings = {
  userName: "",
  todos: [],
  components: DEFAULT_COMPONENTS,
  cardLayouts: {},
  desktopFolders: [""],
  desktopNames: [""],
};

const TODO_COLORS = [
  { value: "#e53935", label: "高" },
  { value: "#fb8c00", label: "中高" },
  { value: "#fdd835", label: "中" },
  { value: "#43a047", label: "低" },
];

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
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // merge missing default components into existing settings
    for (const dc of DEFAULT_COMPONENTS) {
      if (!this.settings.components.some(c => c.id === dc.id)) {
        this.settings.components.push({ ...dc });
      }
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class TodoAddModal extends Modal {
  private onAdd: (text: string, color: string, date: string) => void;
  private pickedColor = TODO_COLORS[1].value;
  private dateKey: string;
  private dateStr: string;

  constructor(app: App, dateKey: string, onAdd: (text: string, color: string, date: string) => void) {
    super(app);
    this.dateKey = dateKey;
    this.onAdd = onAdd;
    const [y, m, d] = dateKey.split("-").map(Number);
    this.dateStr = `${y}年${m}月${d}日`;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "添加待办事项" });

    contentEl.createEl("div", { text: `日期：${this.dateStr}` }, el => {
      el.style.cssText = "font-size: 13px; color: var(--text-muted); margin-bottom: 12px;";
    });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: "输入待办事项...",
    });
    input.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      font-size: 14px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px;
      background: var(--background-modifier-hover);
      color: var(--text-normal);
      outline: none;
      font-family: inherit;
      margin-bottom: 16px;
      box-sizing: border-box;
    `;
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.confirm(input);
      if ((e as KeyboardEvent).key === "Escape") this.close();
    });
    input.focus();

    contentEl.createEl("div", { text: "重要程度" }, el => {
      el.style.cssText = "font-size: 13px; color: var(--text-muted); margin-bottom: 8px;";
    });

    const colorRow = contentEl.createEl("div");
    colorRow.style.cssText = "display: flex; gap: 12px; margin-bottom: 20px;";

    TODO_COLORS.forEach((c) => {
      const dot = colorRow.createEl("span");
      dot.style.cssText = `
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: ${c.value};
        cursor: pointer;
        outline: ${this.pickedColor === c.value ? "3px solid var(--text-normal)" : "none"};
        outline-offset: 3px;
        transition: outline 0.1s;
      `;
      dot.title = c.label;
      dot.addEventListener("click", () => {
        this.pickedColor = c.value;
        colorRow.querySelectorAll("span").forEach(s =>
          (s as HTMLElement).style.outline = "none"
        );
        dot.style.outline = "3px solid var(--text-normal)";
      });
    });

    const btnRow = contentEl.createEl("div");
    btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 8px;";

    const cancelBtn = btnRow.createEl("button", { text: "取消" });
    cancelBtn.style.cssText = `
      padding: 6px 16px;
      font-size: 14px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    `;
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = btnRow.createEl("button", { text: "添加" });
    confirmBtn.style.cssText = `
      padding: 6px 16px;
      font-size: 14px;
      border: none;
      border-radius: 4px;
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      cursor: pointer;
    `;
    confirmBtn.addEventListener("click", () => this.confirm(input));
  }

  private confirm(input: HTMLInputElement) {
    const text = input.value.trim();
    if (!text) return;
    this.onAdd(text, this.pickedColor, this.dateKey);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class DesktopFolderModal extends Modal {
  private onSubmit: (path: string) => void;
  private currentPath: string;

  constructor(app: App, currentPath: string, onSubmit: (path: string) => void) {
    super(app);
    this.currentPath = currentPath;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "设置桌面文件夹" });

    contentEl.createEl("div", {
      text: "输入 vault 内的文件夹路径（相对于 vault 根目录），留空表示显示整个 vault 根目录。",
    }, (el) => {
      el.style.cssText = "font-size: 13px; color: var(--text-muted); margin-bottom: 12px;";
    });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: "例如：文档/项目（留空 = vault 根目录）",
      value: this.currentPath,
    });
    input.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      font-size: 14px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px;
      background: var(--background-modifier-hover);
      color: var(--text-normal);
      outline: none;
      font-family: inherit;
      margin-bottom: 16px;
      box-sizing: border-box;
    `;
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.confirm(input.value.trim());
      if ((e as KeyboardEvent).key === "Escape") this.close();
    });
    input.focus();

    const btnRow = contentEl.createEl("div");
    btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 8px;";

    const cancelBtn = btnRow.createEl("button", { text: "取消" });
    cancelBtn.style.cssText = `
      padding: 6px 16px;
      font-size: 14px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    `;
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = btnRow.createEl("button", { text: "确定" });
    confirmBtn.style.cssText = `
      padding: 6px 16px;
      font-size: 14px;
      border: none;
      border-radius: 4px;
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      cursor: pointer;
    `;
    confirmBtn.addEventListener("click", () => this.confirm(input.value.trim()));
  }

  private confirm(path: string) {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    this.onSubmit(normalized);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class HomepageView extends ItemView {
  plugin: HomepagePlugin;
  private intervalId: number | null = null;
  private calendarYear: number;
  private calendarMonth: number;
  private selectedDate: string;
  private timerHours = 0;
  private timerMinutes = 5;
  private timerSeconds = 0;
  private timerRemaining = 0;
  private timerRunning = false;
  private timerFinished = false;
  private timerDisplayMode: "clock" | "digital" = "clock";
  private timerIntervalId: number | null = null;
  private cardResizeObserver: ResizeObserver | null = null;
  private desktopCurrentPaths: string[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: HomepagePlugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth();
    this.selectedDate = formatDateKey(now.getFullYear(), now.getMonth(), now.getDate());
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
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    if (this.cardResizeObserver) {
      this.cardResizeObserver.disconnect();
      this.cardResizeObserver = null;
    }
  }

  private getCardLayout(id: string): CardLayout {
    return this.plugin.settings.cardLayouts[id] || { x: -1, y: -1, width: 0, height: 0 };
  }

  private saveCardLayout(id: string, x: number, y: number, width: number, height: number) {
    this.plugin.settings.cardLayouts[id] = { x, y, width, height };
    this.plugin.saveSettings();
  }

  private isComponentAdded(id: string): boolean {
    return this.plugin.settings.components.some(c => c.id === id && c.added);
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
      <div id="homepage-content" style="
        flex: 1;
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
      ">
        <div id="homepage-card-wrapper" data-component-id="schedule" style="
          position: absolute;
          resize: both;
          overflow: hidden;
          width: 820px;
          height: 420px;
          min-width: 520px;
          min-height: 320px;
          max-width: 100%;
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--background-modifier-border);
          display: ${this.isComponentAdded("schedule") ? "block" : "none"};
        ">
          <div id="homepage-card" style="
            display: flex;
            width: 100%;
            height: 100%;
            background: var(--background-primary);
            overflow: hidden;
            border-radius: 14px;
            position: relative;
          ">
            <div id="homepage-stats" style="
              width: 100px;
              padding: 10px 8px;
              border-right: 1px solid var(--background-modifier-border);
              display: flex;
              flex-direction: column;
              gap: 4px;
              overflow-y: auto;
            "></div>
            <div id="homepage-calendar" style="
              flex: 1;
              padding: 8px 12px;
            "></div>
            <div id="homepage-todo" style="
              width: 260px;
              border-left: 1px solid var(--background-modifier-border);
              padding: 10px 12px;
              overflow-y: auto;
              display: flex;
              flex-direction: column;
              gap: 6px;
            "></div>
          </div>
        </div>
        <div id="homepage-timer-wrapper" data-component-id="timer" style="
          position: absolute;
          resize: both;
          overflow: hidden;
          width: 300px;
          height: 320px;
          min-width: 260px;
          min-height: 280px;
          max-width: 100%;
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--background-modifier-border);
          display: ${this.isComponentAdded("timer") ? "block" : "none"};
        ">
          <div id="homepage-timer-card" style="
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: var(--background-primary);
            overflow: hidden;
            border-radius: 14px;
            position: relative;
            padding: 12px 16px;
            box-sizing: border-box;
            gap: 8px;
          ">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 14px; font-weight: 600; color: var(--text-normal);">⏱ 计时器</span>
              <button id="timer-mode-toggle" style="
                background: transparent;
                border: 1px solid var(--background-modifier-border);
                border-radius: 4px;
                color: var(--text-muted);
                cursor: pointer;
                font-size: 11px;
                padding: 2px 6px;
                font-family: inherit;
              ">${this.timerDisplayMode === "clock" ? "数字" : "表盘"}</button>
            </div>
            <div id="timer-display" style="
              flex: 1;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 0;
            "></div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
              ${this.renderTimerPicker("h", "时", 100, this.timerHours)}
              ${this.renderTimerPicker("m", "分", 60, this.timerMinutes)}
              ${this.renderTimerPicker("s", "秒", 60, this.timerSeconds)}
            </div>
            <div style="display: flex; justify-content: center; gap: 8px;">
              <button id="timer-start-btn" style="
                padding: 4px 14px; font-size: 12px; border: none; border-radius: 4px;
                background: var(--interactive-accent); color: var(--text-on-accent);
                cursor: pointer; font-family: inherit;
              ">开始</button>
              <button id="timer-reset-btn" style="
                padding: 4px 14px; font-size: 12px; border: 1px solid var(--background-modifier-border);
                border-radius: 4px; background: transparent; color: var(--text-muted);
                cursor: pointer; font-family: inherit;
                display: none;
              ">重置</button>
            </div>
          </div>
        </div>
        <div id="homepage-desktop-container" style="display: ${this.isComponentAdded("desktop") ? "contents" : "none"};">
          ${this.plugin.settings.desktopFolders.map((_folder, i) => `
          <div id="homepage-desktop-wrapper-${i}" data-component-id="desktop-${i}" style="
            position: absolute;
            resize: both;
            overflow: hidden;
            width: 640px;
            height: 440px;
            min-width: 320px;
            min-height: 240px;
            max-width: 100%;
            border-radius: 14px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--background-modifier-border);
          ">
            <div style="
              display: flex;
              flex-direction: column;
              width: 100%;
              height: 100%;
              background: var(--background-primary);
              overflow: hidden;
              border-radius: 14px;
              position: relative;
            ">
              <div style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-bottom: 1px solid var(--background-modifier-border);
                gap: 8px;
              ">
                <span style="font-size: 13px; font-weight: 600; color: var(--text-normal); white-space: nowrap;">🖥</span>
                <input
                  id="desktop-name-input-${i}"
                  type="text"
                  placeholder="超级桌面 ${i + 1}"
                  value="${this.escapeHtml(this.plugin.settings.desktopNames[i] ?? "")}"
                  style="
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-normal);
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 4px;
                    padding: 1px 4px;
                    outline: none;
                    width: 80px;
                    font-family: inherit;
                    transition: border-color 0.15s, background 0.15s;
                  "
                  onfocus="this.style.borderColor='var(--interactive-accent)';this.style.background='var(--background-modifier-hover)'"
                  onblur="this.style.borderColor='transparent';this.style.background='transparent'"
                />
                <div style="display: flex; align-items: center; gap: 4px; min-width: 0;">
                  <button id="desktop-back-btn-${i}" style="
                    display: none;
                    background: transparent;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 4px;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 11px;
                    padding: 2px 6px;
                    font-family: inherit;
                    white-space: nowrap;
                  ">← 返回</button>
                  <span id="desktop-path-display-${i}" style="
                    font-size: 11px;
                    color: var(--text-faint);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    max-width: 140px;
                  ">/</span>
                  <button id="desktop-folder-btn-${i}" style="
                    background: transparent;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 4px;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 11px;
                    padding: 2px 6px;
                    font-family: inherit;
                    white-space: nowrap;
                  ">⚙ 设置</button>
                  <button id="desktop-add-btn-${i}" style="
                    background: transparent;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 4px;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 14px;
                    padding: 0px 6px;
                    font-family: inherit;
                    line-height: 1.6;
                  " title="添加一个桌面">+</button>
                  <button id="desktop-close-btn-${i}" style="
                    background: transparent;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 4px;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 14px;
                    padding: 0px 6px;
                    font-family: inherit;
                    line-height: 1.6;
                    display: ${this.plugin.settings.desktopFolders.length > 1 ? "inline-block" : "none"};
                  " title="删除此桌面">×</button>
                </div>
              </div>
              <div id="desktop-grid-${i}" style="
                flex: 1;
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
                gap: 6px;
                padding: 10px 12px;
                overflow-y: auto;
                align-content: start;
              "></div>
            </div>
          </div>
          `).join("")}
        </div>
      </div>
      <div id="homepage-sidebar" style="
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 28px;
        min-width: 28px;
        border-left: 1px solid var(--background-modifier-border);
        display: flex;
        flex-direction: column;
        transition: width 0.25s ease, min-width 0.25s ease;
        overflow: hidden;
        z-index: 10;
        background: var(--background-primary);
      "></div>
    `;

    this.renderSidebar();

    if (this.isComponentAdded("schedule")) {
      this.renderStats();
      this.renderCalendar();
      this.renderTodo();
      this.setupCardPosition(container, "schedule", "#homepage-card-wrapper");
    }

    if (this.isComponentAdded("timer")) {
      this.initTimerDisplay();
      this.setupCardPosition(container, "timer", "#homepage-timer-wrapper");
    }

    if (this.isComponentAdded("desktop")) {
      this.desktopCurrentPaths = this.plugin.settings.desktopFolders.map(f => f);
      for (let i = 0; i < this.plugin.settings.desktopFolders.length; i++) {
        this.initDesktopDisplay(i);
        this.setupCardPosition(container, `desktop-${i}`, `#homepage-desktop-wrapper-${i}`);
      }
    }

    this.observeCardResizes();
    this.expandContentHeight();

    const input = container.querySelector("#homepage-name-input") as HTMLInputElement;
    if (input) {
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
  }

  private isInteractiveTarget(target: HTMLElement): boolean {
    if (target.closest("button, input, select, textarea")) return true;
    if (target.closest(".calendar-day, .todo-check, .todo-delete, .todo-filter-chip, .yesterday-sync-one, .yesterday-sync-all")) return true;
    if (target.closest(".timer-picker-wrap")) return true;
    if (target.closest(".desktop-item")) return true;
    return false;
  }

  private setupCardPosition(container: HTMLElement, componentId: string, wrapperSelector: string) {
    const wrapper = container.querySelector(wrapperSelector) as HTMLElement;
    const contentArea = container.querySelector("#homepage-content") as HTMLElement;
    if (!wrapper || !contentArea) return;

    const layout = this.getCardLayout(componentId);
    const defaultW = wrapper.offsetWidth;
    const defaultH = wrapper.offsetHeight;

    if (layout.width > 0) {
      wrapper.style.width = layout.width + "px";
      wrapper.style.height = layout.height + "px";
    }

    const w = layout.width > 0 ? layout.width : defaultW;
    const h = layout.height > 0 ? layout.height : defaultH;

    let posX = layout.x >= 0 ? layout.x : Math.max(0, (contentArea.offsetWidth - w) / 2);
    let posY = layout.y >= 0 ? layout.y : Math.max(0, (contentArea.offsetHeight - h) / 2);
    wrapper.style.left = posX + "px";
    wrapper.style.top = posY + "px";

    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    let isResizing = false;

    wrapper.addEventListener("pointerdown", (e) => {
      // detect click on the native resize handle (bottom-right ~20px corner)
      const rect = wrapper.getBoundingClientRect();
      if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) {
        isResizing = true;
        return; // let browser handle resize natively, skip drag
      }
      isResizing = false;
      if (this.isInteractiveTarget(e.target as HTMLElement)) return;
      wrapper.setPointerCapture((e as PointerEvent).pointerId);
      wrapper.style.cursor = "grabbing";
      startX = e.clientX; startY = e.clientY;
      origLeft = wrapper.offsetLeft; origTop = wrapper.offsetTop;
    });

    wrapper.addEventListener("pointermove", (e) => {
      if (!wrapper.hasPointerCapture((e as PointerEvent).pointerId)) return;
      const maxX = contentArea.offsetWidth - wrapper.offsetWidth;
      let nx = Math.max(0, Math.min(origLeft + e.clientX - startX, maxX));
      let ny = Math.max(0, origTop + e.clientY - startY);
      const c = this.constrainNoOverlap(nx, ny, wrapper.offsetWidth, wrapper.offsetHeight, this.getOtherCardBounds(wrapperSelector));
      posX = Math.max(0, Math.min(c.x, maxX));
      posY = Math.max(0, c.y);
      wrapper.style.left = posX + "px";
      wrapper.style.top = posY + "px";
      this.expandContentHeight();
    });

    wrapper.addEventListener("pointerup", () => {
      wrapper.style.cursor = "";
      if (isResizing) {
        // restore position — browser may have shifted it during native resize
        const pre = this.plugin.settings.cardLayouts[componentId];
        if (pre) {
          wrapper.style.left = pre.x + "px";
          wrapper.style.top = pre.y + "px";
          this.saveCardLayout(componentId, pre.x, pre.y, wrapper.offsetWidth, wrapper.offsetHeight);
        }
      } else {
        this.saveCardLayout(componentId, posX, posY, wrapper.offsetWidth, wrapper.offsetHeight);
      }
    });
  }

  private observeCardResizes() {
    if (this.cardResizeObserver) this.cardResizeObserver.disconnect();
    this.cardResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.dataset.componentId;
        if (!id) continue;
        const prev = this.plugin.settings.cardLayouts[id];
        if (!prev) continue;
        this.saveCardLayout(id, prev.x, prev.y, entry.contentRect.width, entry.contentRect.height);
      }
    });
    this.containerEl.querySelectorAll('[id$="-wrapper"]').forEach(w => {
      this.cardResizeObserver!.observe(w as HTMLElement);
    });
  }

  private expandContentHeight() {
    const content = this.containerEl.querySelector("#homepage-content") as HTMLElement;
    if (!content) return;
    let maxBottom = content.clientHeight;
    content.querySelectorAll('[id$="-wrapper"]').forEach(w => {
      const el = w as HTMLElement;
      if (el.style.display === "none") return;
      maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight + 60);
    });
    content.style.minHeight = maxBottom + "px";
  }

  private getOtherCardBounds(excludeSelector: string): Array<{ x: number; y: number; w: number; h: number }> {
    const content = this.containerEl.querySelector("#homepage-content") as HTMLElement;
    if (!content) return [];
    const wrappers = content.querySelectorAll('[id$="-wrapper"]');
    const result: Array<{ x: number; y: number; w: number; h: number }> = [];
    wrappers.forEach(w => {
      const el = w as HTMLElement;
      if (el.matches(excludeSelector)) return;
      if (el.style.display === "none") return;
      result.push({
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      });
    });
    return result;
  }

  private constrainNoOverlap(
    x: number, y: number, w: number, h: number,
    others: Array<{ x: number; y: number; w: number; h: number }>,
  ): { x: number; y: number } {
    const GAP = 12;
    let rx = x, ry = y;
    for (const o of others) {
      const ox = rx < o.x + o.w + GAP && rx + w + GAP > o.x;
      const oy = ry < o.y + o.h + GAP && ry + h + GAP > o.y;
      if (!ox || !oy) continue;
      // push to nearest edge with gap
      const pushRight = (o.x + o.w + GAP) - rx;
      const pushLeft = (rx + w + GAP) - o.x;
      const pushDown = (o.y + o.h + GAP) - ry;
      const pushUp = (ry + h + GAP) - o.y;
      if (Math.min(pushRight, pushLeft) < Math.min(pushDown, pushUp)) {
        rx = pushRight < pushLeft ? o.x + o.w + GAP : o.x - w - GAP;
      } else {
        ry = pushDown < pushUp ? o.y + o.h + GAP : o.y - h - GAP;
      }
    }
    return { x: rx, y: ry };
  }

  private timerOutsideClickHandler: ((e: Event) => void) | null = null;

  private initTimerDisplay() {
    // bind events once — only called from render() after DOM creation
    this.updateTimerDisplay();

    // time pickers: click label to toggle scroll, click item to select
    this.containerEl.querySelectorAll(".timer-picker-wrap").forEach(wrap => {
      const el = wrap as HTMLElement;
      const field = el.dataset.field!;
      const label = el.querySelector(".timer-picker-label") as HTMLElement;
      const scroll = el.querySelector(".timer-picker-scroll") as HTMLElement;

      const getVal = () => field === "h" ? this.timerHours : field === "m" ? this.timerMinutes : this.timerSeconds;
      const max = field === "h" ? 99 : 59;

      const isOpen = () => scroll.style.display !== "none";

      const apply = (val: number) => {
        const v = Math.max(0, Math.min(val, max));
        if (field === "h") this.timerHours = v;
        else if (field === "m") this.timerMinutes = v;
        else this.timerSeconds = v;
        this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
        label.textContent = String(v).padStart(2, "0");
        this.updateTimerDisplay();
      };

      const closeAll = () => {
        this.containerEl.querySelectorAll(".timer-picker-scroll").forEach(s => {
          (s as HTMLElement).style.display = "none";
        });
        this.containerEl.querySelectorAll(".timer-picker-label").forEach(l => {
          (l as HTMLElement).style.display = "flex";
        });
      };

      const open = () => {
        closeAll();
        label.style.display = "none";
        scroll.style.display = "block";
        requestAnimationFrame(() => {
          scroll.scrollTop = getVal() * 28;
          this.updateScrollHighlight(scroll);
        });
      };

      label.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isOpen()) { closeAll(); } else { open(); }
      });

      scroll.querySelectorAll("div").forEach(item => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          apply(parseInt((item as HTMLElement).dataset.value!));
          closeAll();
        });
      });
    });

    // remove previous outside-click handler before adding new one
    if (this.timerOutsideClickHandler) {
      this.containerEl.removeEventListener("click", this.timerOutsideClickHandler);
    }
    this.timerOutsideClickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".timer-picker-wrap")) {
        this.containerEl.querySelectorAll(".timer-picker-scroll").forEach(s => {
          (s as HTMLElement).style.display = "none";
        });
        this.containerEl.querySelectorAll(".timer-picker-label").forEach(l => {
          (l as HTMLElement).style.display = "flex";
        });
      }
    };
    this.containerEl.addEventListener("click", this.timerOutsideClickHandler);

    // mode toggle
    const modeToggle = this.containerEl.querySelector("#timer-mode-toggle");
    modeToggle?.addEventListener("click", () => {
      this.timerDisplayMode = this.timerDisplayMode === "clock" ? "digital" : "clock";
      modeToggle.textContent = this.timerDisplayMode === "clock" ? "数字" : "表盘";
      this.updateTimerDisplay();
    });

    // start / pause
    const startBtn = this.containerEl.querySelector("#timer-start-btn");
    startBtn?.addEventListener("click", () => {
      if (this.timerFinished) this.timerFinished = false;
      if (this.timerRunning) {
        this.pauseTimer();
      } else {
        this.startTimer();
      }
    });

    // reset
    this.containerEl.querySelector("#timer-reset-btn")?.addEventListener("click", () => {
      this.timerRunning = false;
      if (this.timerIntervalId !== null) {
        window.clearInterval(this.timerIntervalId);
        this.timerIntervalId = null;
      }
      this.timerFinished = false;
      this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
      this.updateTimerDisplay();
      const startBtn = this.containerEl.querySelector("#timer-start-btn") as HTMLButtonElement;
      if (startBtn) startBtn.textContent = "开始";
      const resetBtn = this.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
      if (resetBtn) resetBtn.style.display = "none";
      this.setPickersEditable(true);
    });
  }

  private updateScrollHighlight(picker: HTMLElement) {
    const idx = Math.round(picker.scrollTop / 28);
    picker.querySelectorAll("div").forEach((d, i) => {
      (d as HTMLElement).style.color = i === idx ? "var(--text-normal)" : "var(--text-muted)";
      (d as HTMLElement).style.fontWeight = i === idx ? "600" : "400";
    });
  }

  private getDisplayTime(): number {
    const total = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
    // paused mid-countdown → show frozen remaining time
    if (!this.timerRunning && this.timerRemaining > 0 && this.timerRemaining < total) {
      return this.timerRemaining;
    }
    // running → show live remaining time
    if (this.timerRunning) {
      return this.timerRemaining;
    }
    // idle or finished → show selected time
    return total;
  }

  private updateTimerDisplay() {
    const display = this.containerEl.querySelector("#timer-display") as HTMLElement;
    if (!display) return;

    const t = this.getDisplayTime();
    const maxTotal = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
    if (this.timerDisplayMode === "clock") {
      display.innerHTML = this.renderClockFace(t, maxTotal);
    } else {
      display.innerHTML = this.renderDigitalDisplay(t, maxTotal);
    }
  }

  private renderClockFace(total: number, maxTotal: number): string {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const fraction = maxTotal > 0 ? total / maxTotal : 0;

    const size = 140;
    const cx = size / 2;
    const cy = size / 2;
    const r = 56;

    // minute hand angle (0-360 based on remaining minutes in current hour)
    const minAngle = ((m * 60 + s) / 3600) * 360;
    // second hand angle
    const secAngle = (s / 60) * 360;

    const minRad = (minAngle - 90) * Math.PI / 180;
    const secRad = (secAngle - 90) * Math.PI / 180;
    const minLen = r * 0.7;
    const secLen = r * 0.85;

    const minX = cx + minLen * Math.cos(minRad);
    const minY = cy + minLen * Math.sin(minRad);
    const secX = cx + secLen * Math.cos(secRad);
    const secY = cy + secLen * Math.sin(secRad);

    const circumference = 2 * Math.PI * r;

    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="var(--background-modifier-border)" stroke-width="4"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="var(--interactive-accent)" stroke-width="4"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${circumference * (1 - fraction)}"
          transform="rotate(-90 ${cx} ${cy})"
          style="transition: stroke-dashoffset 1s linear;"/>
        ${[...Array(12)].map((_, i) => {
          const a = (i * 30 - 90) * Math.PI / 180;
          const x1 = cx + (r - 7) * Math.cos(a);
          const y1 = cy + (r - 7) * Math.sin(a);
          const x2 = cx + (r - 3) * Math.cos(a);
          const y2 = cy + (r - 3) * Math.sin(a);
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round"/>`;
        }).join("")}
        <line x1="${cx}" y1="${cy}" x2="${minX}" y2="${minY}" stroke="var(--text-normal)" stroke-width="2" stroke-linecap="round"/>
        <line x1="${cx}" y1="${cy}" x2="${secX}" y2="${secY}" stroke="var(--interactive-accent)" stroke-width="1" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="2.5" fill="var(--text-normal)"/>
      </svg>
      <div style="
        position: absolute;
        text-align: center;
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 4px;
        font-variant-numeric: tabular-nums;
      ">${timeStr}</div>
    `;
  }

  private renderDigitalDisplay(total: number, maxTotal: number): string {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

    const fraction = maxTotal > 0 ? total / maxTotal : 0;

    return `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
        <span style="
          font-size: 36px;
          font-weight: 300;
          font-variant-numeric: tabular-nums;
          color: ${this.timerFinished ? "var(--interactive-accent)" : "var(--text-normal)"};
          letter-spacing: 2px;
        ">${timeStr}</span>
        <div style="
          width: 120px; height: 3px; border-radius: 2px;
          background: var(--background-modifier-border);
          overflow: hidden;
        ">
          <div style="
            width: ${fraction * 100}%; height: 100%; border-radius: 2px;
            background: var(--interactive-accent);
            transition: width 1s linear;
          "></div>
        </div>
      </div>
    `;
  }

  private renderTimerPicker(field: string, label: string, max: number, cur: number): string {
    const count = max;
    return `
      <div class="timer-picker-wrap" data-field="${field}" style="position: relative; width: 44px; height: 38px;">
        <div class="timer-picker-label" style="
          width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums;
          color: var(--text-normal);
          border: 1px solid var(--background-modifier-border); border-radius: 6px;
          background: var(--background-modifier-hover);
          cursor: pointer; user-select: none;
        ">${String(cur).padStart(2, "0")}</div>
        <div class="timer-picker-scroll" style="
          display: none; position: absolute; top: 0; left: 0;
          width: 100%; height: 84px; overflow-y: auto;
          scroll-snap-type: y mandatory;
          border: 1px solid var(--interactive-accent);
          border-radius: 6px;
          background: var(--background-modifier-hover);
          scrollbar-width: none;
          z-index: 1;
        ">${Array.from({length: count}, (_, i) => `
          <div data-value="${i}" style="
            height: 28px; display: flex; align-items: center; justify-content: center;
            font-size: 14px; font-variant-numeric: tabular-nums;
            color: var(--text-muted);
            scroll-snap-align: center;
            cursor: pointer;
            user-select: none;
          ">${String(i).padStart(2, "0")}</div>
        `).join("")}</div>
      </div>
      <span style="font-size: 12px; color: var(--text-muted);">${label}</span>
    `;
  }

  private setPickersEditable(editable: boolean) {
    this.containerEl.querySelectorAll(".timer-picker-label").forEach(l => {
      const el = l as HTMLElement;
      if (editable) {
        el.style.border = "1px solid var(--background-modifier-border)";
        el.style.background = "var(--background-modifier-hover)";
        el.style.cursor = "pointer";
        el.style.pointerEvents = "auto";
      } else {
        el.style.border = "1px solid transparent";
        el.style.background = "transparent";
        el.style.cursor = "default";
        el.style.pointerEvents = "none";
      }
    });
  }

  private updatePickerTexts() {
    this.containerEl.querySelectorAll(".timer-picker-wrap").forEach(wrap => {
      const el = wrap as HTMLElement;
      const field = el.dataset.field!;
      const label = el.querySelector(".timer-picker-label") as HTMLElement;
      if (!label) return;
      const val = field === "h" ? this.timerHours : field === "m" ? this.timerMinutes : this.timerSeconds;
      label.textContent = String(val).padStart(2, "0");
    });
  }

  private startTimer() {
    // always recalculate from current field values
    this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
    if (this.timerRemaining <= 0) return;

    this.timerRunning = true;
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
    }
    this.timerIntervalId = window.setInterval(() => this.timerTick(), 1000);
    const startBtn = this.containerEl.querySelector("#timer-start-btn") as HTMLButtonElement;
    if (startBtn) startBtn.textContent = "暂停";
    const resetBtn = this.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
    if (resetBtn) resetBtn.style.display = "none";
    this.updatePickerTexts();
    this.setPickersEditable(false);
  }

  private pauseTimer() {
    this.timerRunning = false;
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    const startBtn = this.containerEl.querySelector("#timer-start-btn") as HTMLButtonElement;
    if (startBtn) startBtn.textContent = "开始";
    const resetBtn = this.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
    if (resetBtn) resetBtn.style.display = "inline-block";
    this.setPickersEditable(true);
  }

  private timerTick() {
    if (this.timerRemaining <= 0) {
      this.pauseTimer();
      this.timerFinished = true;
      this.updateTimerDisplay();
      this.showTimerNotification();
      return;
    }
    this.timerRemaining--;
    this.updateTimerDisplay();
  }

  private showTimerNotification() {
    // remove existing notification if any
    const existing = this.containerEl.querySelector("#timer-notification");
    if (existing) existing.remove();

    const content = this.containerEl.querySelector("#homepage-content") as HTMLElement;
    if (!content) return;

    const overlay = document.createElement("div");
    overlay.id = "timer-notification";
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 20;
    `;

    overlay.innerHTML = `
      <div style="
        background: var(--background-primary);
        border-radius: 14px;
        padding: 32px 40px;
        text-align: center;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px var(--background-modifier-border);
      ">
        <div style="font-size: 48px; margin-bottom: 8px;">⏰</div>
        <div style="font-size: 18px; font-weight: 600; color: var(--text-normal); margin-bottom: 6px;">时间到！</div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px;">
          计时器已结束（${this.timerHours}时${this.timerMinutes}分${this.timerSeconds}秒）
        </div>
        <button id="timer-dismiss-btn" style="
          padding: 6px 24px; font-size: 13px; border: none; border-radius: 6px;
          background: var(--interactive-accent); color: var(--text-on-accent);
          cursor: pointer; font-family: inherit;
        ">关闭</button>
      </div>
    `;

    content.appendChild(overlay);

    const dismiss = () => {
      overlay.remove();
      this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
      this.timerFinished = false;
      this.updateTimerDisplay();
      const resetBtn = this.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
      if (resetBtn) resetBtn.style.display = "none";
      this.setPickersEditable(true);
    };

    overlay.querySelector("#timer-dismiss-btn")?.addEventListener("click", dismiss);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
  }

  // ── 超级桌面 ──────────────────────────────────────────

  private getFileIcon(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
      pdf: "📕", doc: "📘", docx: "📘",
      xls: "📗", xlsx: "📗", ppt: "📙", pptx: "📙",
      jpg: "🖼", jpeg: "🖼", png: "🖼", gif: "🖼",
      svg: "🖼", webp: "🖼",
      mp3: "🎵", wav: "🎵", flac: "🎵", aac: "🎵",
      mp4: "🎬", avi: "🎬", mkv: "🎬", mov: "🎬",
      zip: "📦", rar: "📦", "7z": "📦", tar: "📦", gz: "📦",
      md: "📝", txt: "📝",
      js: "💛", ts: "💙", jsx: "💛", tsx: "💙",
      py: "🐍", html: "🌐", css: "🎨", json: "📋",
      canvas: "🗺",
    };
    return map[ext] || "📄";
  }

  private renderDesktopItem(name: string, type: "file" | "folder"): string {
    const icon = type === "folder" ? "📁" : this.getFileIcon(name);
    return `
      <div class="desktop-item" data-path="${this.escapeHtml(name)}" data-type="${type}" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        padding: 6px 4px;
        border-radius: 8px;
        user-select: none;
        transition: background 0.1s;
      " onmouseenter="this.style.background='var(--background-modifier-hover)'" onmouseleave="this.style.background='transparent'">
        <div style="font-size: 32px; line-height: 1; pointer-events: none;">${icon}</div>
        <span style="
          font-size: 10px;
          color: var(--text-normal);
          text-align: center;
          word-break: break-word;
          line-height: 1.3;
          max-width: 80px;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          pointer-events: none;
        ">${this.escapeHtml(name)}</span>
      </div>
    `;
  }

  private async renderDesktopContents(i: number) {
    const grid = this.containerEl.querySelector(`#desktop-grid-${i}`) as HTMLElement;
    const pathDisplay = this.containerEl.querySelector(`#desktop-path-display-${i}`) as HTMLElement;
    const backBtn = this.containerEl.querySelector(`#desktop-back-btn-${i}`) as HTMLElement;
    if (!grid) return;

    const cur = this.desktopCurrentPaths[i] ?? "";
    const root = this.plugin.settings.desktopFolders[i] ?? "";
    if (pathDisplay) pathDisplay.textContent = cur || "/";
    if (backBtn) {
      backBtn.style.display = cur !== root ? "inline-block" : "none";
    }

    grid.innerHTML = `
      <div style="
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100px;
        color: var(--text-muted);
        font-size: 13px;
      ">加载中...</div>
    `;

    try {
      const result = await this.app.vault.adapter.list(cur);
      const folders = [...result.folders].sort((a, b) => a.localeCompare(b));
      const files = [...result.files].sort((a, b) => a.localeCompare(b));

      if (folders.length === 0 && files.length === 0) {
        grid.innerHTML = `
          <div style="
            grid-column: 1 / -1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100px;
            color: var(--text-faint);
            font-size: 13px;
            gap: 6px;
          ">
            <span style="font-size: 36px; opacity: 0.5;">📂</span>
            <span>该文件夹为空</span>
          </div>
        `;
        return;
      }

      grid.innerHTML =
        folders.map((f) => this.renderDesktopItem(f, "folder")).join("") +
        files.map((f) => this.renderDesktopItem(f, "file")).join("");
    } catch {
      grid.innerHTML = `
        <div style="
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100px;
          color: var(--text-error);
          font-size: 13px;
          gap: 6px;
        ">
          <span style="font-size: 36px; opacity: 0.5;">⚠️</span>
          <span>无法访问该文件夹</span>
        </div>
      `;
    }
  }

  private openDesktopFile(i: number, filename: string) {
    const cur = this.desktopCurrentPaths[i] ?? "";
    const relativePath = cur ? `${cur}/${filename}` : filename;
    if (filename.endsWith(".md")) {
      this.app.workspace.openLinkText(relativePath, "", false);
      return;
    }
    try {
      const adapter = this.app.vault.adapter as FileSystemAdapter;
      const basePath = adapter.getBasePath();
      const absolutePath = `${basePath}/${relativePath}`;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { shell } = require("electron");
      shell.openPath(absolutePath);
    } catch {
      // silently fail on non-desktop platforms
    }
  }

  private navigateToDesktopFolder(i: number, subfolder: string) {
    const cur = this.desktopCurrentPaths[i] ?? "";
    this.desktopCurrentPaths[i] = cur ? `${cur}/${subfolder}` : subfolder;
    this.renderDesktopContents(i);
  }

  private navigateDesktopBack(i: number) {
    const cur = this.desktopCurrentPaths[i] ?? "";
    const root = this.plugin.settings.desktopFolders[i] ?? "";
    if (cur === root) return;
    const parts = cur.split("/");
    parts.pop();
    const parent = parts.join("/");
    if (root && !parent.startsWith(root)) {
      this.desktopCurrentPaths[i] = root;
    } else {
      this.desktopCurrentPaths[i] = parent;
    }
    this.renderDesktopContents(i);
  }

  private openDesktopFolderPicker(i: number) {
    const root = this.plugin.settings.desktopFolders[i] ?? "";
    new DesktopFolderModal(this.app, root, (newPath) => {
      this.plugin.settings.desktopFolders[i] = newPath;
      this.plugin.saveSettings();
      this.desktopCurrentPaths[i] = newPath;
      this.renderDesktopContents(i);
    }).open();
  }

  private addDesktopInstance() {
    this.plugin.settings.desktopFolders.push("");
    this.plugin.settings.desktopNames.push("");
    this.plugin.saveSettings();
    this.render();
  }

  private removeDesktopInstance(i: number) {
    if (this.plugin.settings.desktopFolders.length <= 1) return;
    this.plugin.settings.desktopFolders.splice(i, 1);
    this.plugin.settings.desktopNames.splice(i, 1);
    this.plugin.saveSettings();
    this.render();
  }

  private initDesktopDisplay(i: number) {
    this.renderDesktopContents(i);

    const grid = this.containerEl.querySelector(`#desktop-grid-${i}`);
    grid?.addEventListener("dblclick", (e) => {
      const item = (e.target as HTMLElement).closest(".desktop-item") as HTMLElement | null;
      if (!item) return;
      const name = item.dataset.path!;
      const type = item.dataset.type!;
      if (type === "folder") {
        this.navigateToDesktopFolder(i, name);
      } else {
        this.openDesktopFile(i, name);
      }
    });

    this.containerEl.querySelector(`#desktop-back-btn-${i}`)?.addEventListener("click", () => {
      this.navigateDesktopBack(i);
    });

    this.containerEl.querySelector(`#desktop-folder-btn-${i}`)?.addEventListener("click", () => {
      this.openDesktopFolderPicker(i);
    });

    this.containerEl.querySelector(`#desktop-add-btn-${i}`)?.addEventListener("click", () => {
      this.addDesktopInstance();
    });

    this.containerEl.querySelector(`#desktop-close-btn-${i}`)?.addEventListener("click", () => {
      this.removeDesktopInstance(i);
    });

    const nameInput = this.containerEl.querySelector(`#desktop-name-input-${i}`) as HTMLInputElement;
    if (nameInput) {
      nameInput.addEventListener("change", () => {
        this.plugin.settings.desktopNames[i] = nameInput.value.trim();
        this.plugin.saveSettings();
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") nameInput.blur();
      });
      // auto-resize input width to fit content
      const resize = () => {
        const span = document.createElement("span");
        span.style.cssText = "font-size: 13px; font-weight: 600; font-family: inherit; position: absolute; visibility: hidden; white-space: pre;";
        document.body.appendChild(span);
        span.textContent = nameInput.value || nameInput.placeholder;
        nameInput.style.width = (span.offsetWidth + 12) + "px";
        document.body.removeChild(span);
      };
      nameInput.addEventListener("input", resize);
      resize();
    }
  }

  // ── 侧边栏 ──────────────────────────────────────────

  private sidebarOpen = false;
  private sidebarSearchQuery = "";

  private renderSidebar() {
    const sidebar = this.containerEl.querySelector("#homepage-sidebar") as HTMLElement;
    if (!sidebar) return;

    const isOpen = this.sidebarOpen;
    sidebar.style.width = isOpen ? "236px" : "28px";
    sidebar.style.minWidth = isOpen ? "236px" : "28px";

    // pin sidebar below header
    const header = this.containerEl.querySelector("#homepage-header") as HTMLElement;
    sidebar.style.top = header ? header.offsetHeight + "px" : "48px";

    // overlay to block interaction with main content when sidebar is open
    let overlay = this.containerEl.querySelector("#homepage-overlay") as HTMLElement;
    if (isOpen) {
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "homepage-overlay";
        const content = this.containerEl.querySelector("#homepage-content") as HTMLElement;
        content?.appendChild(overlay);
        overlay.addEventListener("click", () => {
          this.sidebarOpen = false;
          this.renderSidebar();
        });
      }
      overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        background: transparent;
        pointer-events: auto;
      `;
    } else if (overlay) {
      overlay.remove();
    }

    sidebar.innerHTML = `
      <div id="sidebar-toggle" style="
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 6px;
        cursor: pointer;
        color: var(--text-muted);
        font-size: 13px;
        white-space: nowrap;
        border-bottom: ${isOpen ? "1px solid var(--background-modifier-border)" : "none"};
        user-select: none;
      ">
        <span style="font-size: 12px;">${isOpen ? "▶" : "◀"}</span>
        ${isOpen ? '<span style="font-size: 13px;">组件列表</span>' : ""}
      </div>
      ${isOpen ? `
        <div style="padding: 10px 10px 0 10px;">
          <input id="sidebar-search" type="text" placeholder="搜索组件..." value="${this.sidebarSearchQuery}" style="
            width: 100%;
            padding: 5px 8px;
            font-size: 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 5px;
            background: var(--background-modifier-hover);
            color: var(--text-normal);
            outline: none;
            font-family: inherit;
            box-sizing: border-box;
          "/>
        </div>
        <div style="
          flex: 1;
          overflow-y: auto;
          padding: 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        ">
          ${this.renderComponentSection("added", "已添加组件")}
          ${this.renderComponentSection("pending", "待添加组件")}
        </div>
      ` : ""}
    `;

    sidebar.querySelector("#sidebar-toggle")?.addEventListener("click", () => {
      this.sidebarOpen = !this.sidebarOpen;
      if (!this.sidebarOpen) this.sidebarSearchQuery = "";
      this.renderSidebar();
    });

    sidebar.querySelector("#sidebar-search")?.addEventListener("input", (e) => {
      this.sidebarSearchQuery = (e.target as HTMLInputElement).value;
      this.renderSidebar();
    });

    if (isOpen) this.bindDragEvents();
  }

  private componentIcon(id: string): string {
    const icons: Record<string, string> = {
      schedule: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="4" y="5" width="20" height="19" rx="2"/><line x1="4" y1="11" x2="24" y2="11"/><line x1="9" y1="2" x2="9" y2="7"/><line x1="19" y1="2" x2="19" y2="7"/><line x1="10" y1="15" x2="18" y2="15"/><line x1="12" y1="19" x2="16" y2="19"/></svg>`,
      timer: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><circle cx="14" cy="15" r="9"/><line x1="14" y1="15" x2="14" y2="9"/><line x1="14" y1="15" x2="17" y2="15"/><line x1="11" y1="3" x2="17" y2="3"/><line x1="14" y1="3" x2="14" y2="6"/></svg>`,
      desktop: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="2" y="3" width="24" height="17" rx="2"/><line x1="8" y1="23" x2="20" y2="23"/><line x1="14" y1="20" x2="14" y2="23"/></svg>`,
    };
    return icons[id] || `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="4" y="4" width="20" height="20" rx="3"/></svg>`;
  }

  private renderComponentSection(zone: "added" | "pending", title: string): string {
    const q = this.sidebarSearchQuery.toLowerCase().trim();
    const comps = this.plugin.settings.components.filter(
      c => c.added === (zone === "added") && (!q || c.name.toLowerCase().includes(q))
    );
    return `
      <div>
        <div style="
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          margin-bottom: 8px;
          letter-spacing: 0.5px;
        ">${title}</div>
        <div class="component-drop-zone" data-zone="${zone}" style="
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-height: ${comps.length === 0 ? "48px" : "0"};
          border-radius: 6px;
          transition: background 0.15s;
          padding: 2px;
        ">
          ${comps.length === 0 ? `
            <div style="
              font-size: 12px;
              color: var(--text-faint);
              text-align: center;
              width: 100%;
              padding: 12px 0;
            ">暂无</div>
          ` : comps.map(c => `
            <div class="component-card" draggable="true" data-id="${c.id}" style="
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 4px;
              width: 64px;
              cursor: grab;
              user-select: none;
            ">
              <div style="
                width: 48px;
                height: 48px;
                border-radius: 8px;
                border: 1.5px solid var(--background-modifier-border);
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-muted);
                background: var(--background-modifier-hover);
              ">${this.componentIcon(c.id)}</div>
              <span style="
                font-size: 11px;
                color: var(--text-muted);
                text-align: center;
                line-height: 1.3;
              ">${c.name}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  private bindDragEvents() {
    const cards = this.containerEl.querySelectorAll(".component-card");
    const zones = this.containerEl.querySelectorAll(".component-drop-zone");

    cards.forEach(card => {
      card.addEventListener("dragstart", (e) => {
        (e as DragEvent).dataTransfer!.setData("text/plain", (card as HTMLElement).dataset.id!);
        (card as HTMLElement).style.opacity = "0.5";
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).style.opacity = "1";
        zones.forEach(z => (z as HTMLElement).style.background = "");
      });
      card.addEventListener("click", () => {
        const id = (card as HTMLElement).dataset.id!;
        const comp = this.plugin.settings.components.find(c => c.id === id);
        if (comp) {
          comp.added = !comp.added;
          this.plugin.saveSettings();
          this.renderSidebar();
          this.render();
        }
      });
    });

    zones.forEach(zone => {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
        (zone as HTMLElement).style.background = "var(--background-modifier-hover)";
      });
      zone.addEventListener("dragleave", () => {
        (zone as HTMLElement).style.background = "";
      });
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        (zone as HTMLElement).style.background = "";
        const id = (e as DragEvent).dataTransfer!.getData("text/plain");
        const targetZone = (zone as HTMLElement).dataset.zone!;
        const comp = this.plugin.settings.components.find(c => c.id === id);
        if (comp && comp.added !== (targetZone === "added")) {
          comp.added = targetZone === "added";
          this.plugin.saveSettings();
          this.renderSidebar();
          this.render(); // re-render main area to show/hide component
        }
      });
    });
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

  private getYesterdayKey(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() - 1);
    return formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private getDateColorStats(dateKey: string) {
    return TODO_COLORS.map(c => {
      const todos = this.plugin.settings.todos.filter(t => t.date === dateKey && t.color === c.value);
      return { color: c.value, label: c.label, total: todos.length, done: todos.filter(t => t.done).length };
    });
  }

  private renderStats() {
    const statsContainer = this.containerEl.querySelector("#homepage-stats");
    if (!statsContainer) return;

    const stats = this.getDateColorStats(this.selectedDate);
    const [, m, d] = this.selectedDate.split("-");

    statsContainer.innerHTML = `
      <div style="font-size: 11px; font-weight: 600; color: var(--text-normal); margin-bottom: 3px;">
        ${Number(m)}月${Number(d)}日
      </div>
      ${stats.map(s => {
        const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
        return `
          <div style="display: flex; flex-direction: column; gap: 1px;">
            <div style="display: flex; align-items: center; gap: 3px;">
              <span style="
                width: 7px; height: 7px; border-radius: 50%; background: ${s.color}; flex-shrink: 0;
              "></span>
              <span style="font-size: 10px; color: var(--text-muted);">${s.label}</span>
              <span style="font-size: 10px; color: var(--text-faint); margin-left: auto;">${s.done}/${s.total}</span>
            </div>
            <div style="
              width: 100%; height: 3px; border-radius: 2px;
              background: var(--background-modifier-border);
              overflow: hidden;
            ">
              <div style="
                width: ${pct}%; height: 100%; border-radius: 2px;
                background: ${s.color};
                transition: width 0.3s;
              "></div>
            </div>
          </div>
        `;
      }).join("")}
      ${(() => {
        const yesterdayKey = this.getYesterdayKey(this.selectedDate);
        const undone = this.plugin.settings.todos.filter(t => t.date === yesterdayKey && !t.done);
        if (undone.length === 0) return "";
        const [, ym, yd] = yesterdayKey.split("-");
        return `
          <div style="margin-top: 12px; border-top: 1px solid var(--background-modifier-border); padding-top: 8px;">
            <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
              <span>昨${Number(ym)}.${Number(yd)}</span>
              <span class="yesterday-sync-all" style="cursor: pointer; color: var(--interactive-accent); font-weight: 400;">全→</span>
            </div>
            ${undone.map(t => `
              <div class="yesterday-item" data-id="${t.id}" style="
                display: flex; align-items: center; gap: 3px;
                padding: 2px 0; font-size: 10px;
              ">
                <span style="
                  width: 5px; height: 5px; border-radius: 50%; background: ${t.color}; flex-shrink: 0;
                "></span>
                <span style="
                  flex: 1; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                ">${this.escapeHtml(t.text)}</span>
                <span class="yesterday-sync-one" style="
                  cursor: pointer; color: var(--text-faint); font-size: 11px; flex-shrink: 0;
                ">→</span>
              </div>
            `).join("")}
          </div>
        `;
      })()}
    `;

    // bind yesterday sync events
    statsContainer.querySelector(".yesterday-sync-all")?.addEventListener("click", () => this.syncAllYesterday());
    statsContainer.querySelectorAll(".yesterday-sync-one").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).parentElement!.dataset.id!;
        this.syncTodoToToday(id);
      });
    });
  }

  private syncTodoToToday(id: string) {
    const todo = this.plugin.settings.todos.find(t => t.id === id);
    if (!todo) return;
    todo.date = this.selectedDate;
    this.plugin.saveSettings();
    this.renderStats();
    this.renderCalendar();
    this.renderTodo();
  }

  private syncAllYesterday() {
    const yesterdayKey = this.getYesterdayKey(this.selectedDate);
    let changed = false;
    for (const todo of this.plugin.settings.todos) {
      if (todo.date === yesterdayKey && !todo.done) {
        todo.date = this.selectedDate;
        changed = true;
      }
    }
    if (!changed) return;
    this.plugin.saveSettings();
    this.renderStats();
    this.renderCalendar();
    this.renderTodo();
  }

  private renderCalendar() {
    const calContainer = this.containerEl.querySelector("#homepage-calendar");
    if (!calContainer) return;
    calContainer.empty();

    const today = new Date();
    const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
    const year = this.calendarYear;
    const month = this.calendarMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekHeaders = ["日", "一", "二", "三", "四", "五", "六"];

    const dateColorMap = new Map<string, Set<string>>();
    for (const t of this.plugin.settings.todos) {
      if (!dateColorMap.has(t.date)) dateColorMap.set(t.date, new Set());
      dateColorMap.get(t.date)!.add(t.color);
    }

    calContainer.innerHTML = `
      <div id="calendar-nav" style="
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 6px;
      ">
        <button id="calendar-prev" style="
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          padding: 2px 6px;
          border-radius: 4px;
          line-height: 1;
        ">◀</button>
        <span style="
          font-size: 14px;
          font-weight: 600;
          color: var(--text-normal);
          min-width: 90px;
          text-align: center;
        ">${year}年${month + 1}月</span>
        <button id="calendar-next" style="
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          padding: 2px 6px;
          border-radius: 4px;
          line-height: 1;
        ">▶</button>
        <button id="calendar-today-btn" style="
          background: transparent;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          padding: 1px 6px;
          line-height: 1.4;
        ">今天</button>
      </div>
      <div id="calendar-grid" style="
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 1px;
        text-align: center;
      ">
        ${weekHeaders.map(w => `
          <div style="
            font-size: 11px;
            color: var(--text-muted);
            padding: 3px 0;
            font-weight: 500;
          ">${w}</div>
        `).join("")}
        ${(() => {
          let cells = "";
          for (let i = 0; i < firstDay; i++) {
            cells += '<div></div>';
          }
          for (let d = 1; d <= daysInMonth; d++) {
            const key = formatDateKey(year, month, d);
            const isToday = key === todayKey;
            const isSelected = key === this.selectedDate;
            const dotColors = dateColorMap.get(key);

            let bg = "transparent";
            let color = "var(--text-normal)";
            let border = "2px solid transparent";

            if (isToday) {
              bg = "var(--interactive-accent)";
              color = "var(--text-on-accent)";
            }
            if (isSelected && !isToday) {
              border = "2px solid var(--interactive-accent)";
            }

            cells += `
              <div class="calendar-day" data-date="${key}" style="
                font-size: 12px;
                color: ${color};
                padding: 3px 0 10px 0;
                border-radius: 5px;
                cursor: pointer;
                background: ${bg};
                border: ${border};
                position: relative;
                transition: background 0.15s;
                box-sizing: border-box;
              ">${d}${dotColors && dotColors.size > 0 ? `
                <span style="
                  position: absolute;
                  bottom: 1px;
                  left: 50%;
                  transform: translateX(-50%);
                  display: flex;
                  gap: 1px;
                ">${TODO_COLORS.filter(c => dotColors.has(c.value)).map(c => `
                  <span style="
                    width: 3px;
                    height: 3px;
                    border-radius: 50%;
                    background: ${c.value};
                  "></span>
                `).join("")}</span>
              ` : ""}</div>
            `;
          }
          return cells;
        })()}
      </div>
    `;

    calContainer.querySelector("#calendar-prev")?.addEventListener("click", () => {
      this.calendarMonth--;
      if (this.calendarMonth < 0) {
        this.calendarMonth = 11;
        this.calendarYear--;
      }
      this.renderCalendar();
    });

    calContainer.querySelector("#calendar-next")?.addEventListener("click", () => {
      this.calendarMonth++;
      if (this.calendarMonth > 11) {
        this.calendarMonth = 0;
        this.calendarYear++;
      }
      this.renderCalendar();
    });

    calContainer.querySelector("#calendar-today-btn")?.addEventListener("click", () => {
      const now = new Date();
      this.selectedDate = formatDateKey(now.getFullYear(), now.getMonth(), now.getDate());
      this.calendarYear = now.getFullYear();
      this.calendarMonth = now.getMonth();
      this.renderStats();
      this.renderCalendar();
      this.renderTodo();
    });

    calContainer.querySelectorAll(".calendar-day").forEach(el => {
      el.addEventListener("click", (e) => {
        this.selectedDate = (e.currentTarget as HTMLElement).dataset.date!;
        this.renderStats();
        this.renderCalendar();
        this.renderTodo();
      });
    });
  }

  private activeFilter: string | null = null;
  private searchQuery = "";

  private renderTodo() {
    const todoContainer = this.containerEl.querySelector("#homepage-todo");
    if (!todoContainer) return;

    const filtered = this.getFilteredTodos();

    todoContainer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 13px; font-weight: 600; color: var(--text-normal); white-space: nowrap;">${(() => {
          const [, m, d] = this.selectedDate.split("-");
          return `${Number(m)}月${Number(d)}日`;
        })()}</span>
        <input id="todo-search" type="text" placeholder="搜索..." value="${this.searchQuery}" style="
          flex: 1;
          min-width: 0;
          background: var(--background-modifier-hover);
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          padding: 3px 6px;
          font-size: 12px;
          color: var(--text-normal);
          outline: none;
          font-family: inherit;
          box-sizing: border-box;
        "/>
        <button id="todo-add-btn" style="
          background: var(--interactive-accent);
          color: var(--text-on-accent);
          border: none;
          border-radius: 4px;
          padding: 1px 8px;
          font-size: 15px;
          line-height: 1.4;
          cursor: pointer;
          flex-shrink: 0;
        ">+</button>
      </div>
      <div id="todo-filters" style="display: flex; gap: 5px; flex-wrap: wrap;">
        ${TODO_COLORS.map(c => `
          <span class="todo-filter-chip" data-color="${c.value}" style="
            display: inline-block;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: ${c.value};
            cursor: pointer;
            opacity: ${this.activeFilter === null || this.activeFilter === c.value ? 1 : 0.3};
            outline: ${this.activeFilter === c.value ? "2px solid var(--text-normal)" : "none"};
            outline-offset: 1px;
          " title="${c.label}"></span>
        `).join("")}
        ${this.activeFilter !== null ? `
          <span id="todo-filter-clear" style="
            font-size: 11px;
            color: var(--text-muted);
            cursor: pointer;
            line-height: 14px;
          ">清除</span>
        ` : ""}
      </div>
      <div id="todo-list" style="display: flex; flex-direction: column; gap: 1px;">
        ${filtered.length === 0 ? `
          <div style="text-align: center; color: var(--text-faint); font-size: 12px; padding: 16px 0;">
            ${this.plugin.settings.todos.length === 0 ? "暂无待办，点击 + 添加" : this.plugin.settings.todos.some(t => t.date === this.selectedDate) ? "无匹配结果" : "该日期暂无待办"}
          </div>
        ` : filtered.map(todo => `
          <div class="todo-item" data-id="${todo.id}" style="
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 4px;
            border-radius: 4px;
            font-size: 12px;
          ">
            <span class="todo-check" style="
              cursor: pointer;
              font-size: 14px;
              color: ${todo.done ? "var(--text-faint)" : todo.color};
              flex-shrink: 0;
            ">${todo.done ? "☑" : "☐"}</span>
            <span style="
              flex: 1;
              color: var(--text-normal);
              text-decoration: ${todo.done ? "line-through" : "none"};
              opacity: ${todo.done ? 0.5 : 1};
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            ">${this.escapeHtml(todo.text)}</span>
            <span class="todo-delete" style="
              cursor: pointer;
              color: var(--text-faint);
              font-size: 13px;
              flex-shrink: 0;
              visibility: hidden;
            ">×</span>
          </div>
        `).join("")}
      </div>
    `;

    this.bindTodoEvents();
  }

  private bindTodoEvents() {
    // Add button
    this.containerEl.querySelector("#todo-add-btn")?.addEventListener("click", () => {
      new TodoAddModal(this.app, this.selectedDate, (text, color, date) => this.addTodo(text, color, date)).open();
    });

    // Search
    this.containerEl.querySelector("#todo-search")?.addEventListener("input", (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.renderTodo();
    });

    // Filter chips
    this.containerEl.querySelectorAll(".todo-filter-chip").forEach(el => {
      el.addEventListener("click", (e) => {
        const color = (e.currentTarget as HTMLElement).dataset.color!;
        this.activeFilter = this.activeFilter === color ? null : color;
        this.renderTodo();
      });
    });

    // Clear filter
    this.containerEl.querySelector("#todo-filter-clear")?.addEventListener("click", () => {
      this.activeFilter = null;
      this.renderTodo();
    });

    // Toggle todo
    this.containerEl.querySelectorAll(".todo-check").forEach(el => {
      el.addEventListener("click", (e) => {
        const id = (e.currentTarget as HTMLElement).parentElement!.dataset.id!;
        this.toggleTodo(id);
      });
    });

    // Delete todo
    this.containerEl.querySelectorAll(".todo-delete").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).parentElement!.dataset.id!;
        this.deleteTodo(id);
      });
    });

    // Hover show delete
    this.containerEl.querySelectorAll(".todo-item").forEach(el => {
      el.addEventListener("mouseenter", () => {
        const del = el.querySelector(".todo-delete") as HTMLElement;
        if (del) del.style.visibility = "visible";
      });
      el.addEventListener("mouseleave", () => {
        const del = el.querySelector(".todo-delete") as HTMLElement;
        if (del) del.style.visibility = "hidden";
      });
    });

  }

  private getFilteredTodos(): TodoItem[] {
    return this.plugin.settings.todos.filter(t => {
      if (t.date !== this.selectedDate) return false;
      if (this.activeFilter && t.color !== this.activeFilter) return false;
      if (this.searchQuery && !t.text.toLowerCase().includes(this.searchQuery.toLowerCase())) return false;
      return true;
    });
  }

  private addTodo(text: string, color: string, date: string) {
    const todo: TodoItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text,
      color,
      done: false,
      date,
    };
    this.plugin.settings.todos.push(todo);
    this.plugin.saveSettings();
    this.renderStats();
    this.renderCalendar();
    this.renderTodo();
  }

  private toggleTodo(id: string) {
    const todo = this.plugin.settings.todos.find(t => t.id === id);
    if (todo) {
      todo.done = !todo.done;
      this.plugin.saveSettings();
      this.renderStats();
      this.renderCalendar();
      this.renderTodo();
    }
  }

  private deleteTodo(id: string) {
    this.plugin.settings.todos = this.plugin.settings.todos.filter(t => t.id !== id);
    this.plugin.saveSettings();
    this.renderStats();
    this.renderCalendar();
    this.renderTodo();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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

    new Setting(containerEl)
      .setName("超级桌面")
      .setDesc("各桌面实例的文件夹在组件内通过设置按钮独立配置");
  }
}
