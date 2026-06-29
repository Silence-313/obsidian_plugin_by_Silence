import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, Modal } from "obsidian";

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

interface HomepageSettings {
  userName: string;
  todos: TodoItem[];
  components: ComponentInfo[];
}

const DEFAULT_COMPONENTS: ComponentInfo[] = [
  { id: "schedule", name: "日程中心", added: true },
];

const DEFAULT_SETTINGS: HomepageSettings = {
  userName: "",
  todos: [],
  components: DEFAULT_COMPONENTS,
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

class HomepageView extends ItemView {
  plugin: HomepagePlugin;
  private intervalId: number | null = null;
  private calendarYear: number;
  private calendarMonth: number;
  private selectedDate: string;
  private cardX = -1;
  private cardY = -1;

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
        min-height: 0;
        position: relative;
        overflow: hidden;
      ">
        <div id="homepage-card-wrapper" style="
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
            <div id="homepage-card-drag-btn" style="
              position: absolute;
              right: 0;
              bottom: 0;
              width: 22px;
              height: 22px;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: grab;
              color: var(--text-faint);
              font-size: 12px;
              background: var(--background-secondary);
              border-radius: 6px 0 0 0;
              border-top: 1px solid var(--background-modifier-border);
              border-left: 1px solid var(--background-modifier-border);
              user-select: none;
              z-index: 2;
            " title="拖动移动">⋮</div>
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
      </div>
    `;

    this.renderSidebar();

    if (this.isComponentAdded("schedule")) {
      this.renderStats();
      this.renderCalendar();
      this.renderTodo();
      this.setupCardDrag(container);
    }

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

  private setupCardDrag(container: HTMLElement) {
    const wrapper = container.querySelector("#homepage-card-wrapper") as HTMLElement;
    const handle = container.querySelector("#homepage-card-drag-btn") as HTMLElement;
    const contentArea = container.querySelector("#homepage-content") as HTMLElement;
    if (!wrapper || !handle || !contentArea) return;

    // center card on first render
    if (this.cardX < 0 || this.cardY < 0) {
      this.cardX = Math.max(0, (contentArea.offsetWidth - 820) / 2);
      this.cardY = Math.max(0, (contentArea.offsetHeight - 420) / 2);
    }
    wrapper.style.left = this.cardX + "px";
    wrapper.style.top = this.cardY + "px";

    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    handle.addEventListener("pointerdown", (e) => {
      handle.setPointerCapture((e as PointerEvent).pointerId);
      startX = e.clientX;
      startY = e.clientY;
      origLeft = wrapper.offsetLeft;
      origTop = wrapper.offsetTop;
      handle.style.cursor = "grabbing";
    });

    handle.addEventListener("pointermove", (e) => {
      if (!handle.hasPointerCapture((e as PointerEvent).pointerId)) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxX = contentArea.offsetWidth - wrapper.offsetWidth;
      const maxY = contentArea.offsetHeight - wrapper.offsetHeight;
      this.cardX = Math.max(0, Math.min(origLeft + dx, maxX));
      this.cardY = Math.max(0, Math.min(origTop + dy, maxY));
      wrapper.style.left = this.cardX + "px";
      wrapper.style.top = this.cardY + "px";
    });

    handle.addEventListener("pointerup", () => {
      handle.style.cursor = "grab";
    });
  }

  private sidebarOpen = false;
  private sidebarSearchQuery = "";

  private renderSidebar() {
    const sidebar = this.containerEl.querySelector("#homepage-sidebar") as HTMLElement;
    if (!sidebar) return;

    const isOpen = this.sidebarOpen;
    sidebar.style.width = isOpen ? "220px" : "28px";
    sidebar.style.minWidth = isOpen ? "220px" : "28px";

    // overlay to block interaction with main content when sidebar is open
    let overlay = this.containerEl.querySelector("#homepage-overlay") as HTMLElement;
    if (isOpen) {
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "homepage-overlay";
        const content = this.containerEl.querySelector("#homepage-content") as HTMLElement;
        content?.appendChild(overlay);
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
    `;
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
  }
}
