import { ItemView, WorkspaceLeaf } from "obsidian";
import type HomepagePlugin from "./plugin";
import type { TodoItem, CardLayout } from "./types";
import { VIEW_TYPE_HOMEPAGE, VIEW_TYPE_STUDY } from "./constants";
import { getTimePeriod, escapeHtml, formatTime, formatDate, formatDateKey } from "./utils";
import { ScheduleComponent } from "./components/schedule";
import { TimerComponent } from "./components/timer";
import { DesktopComponent } from "./components/desktop";
import { SidebarComponent } from "./components/sidebar";
import { TodoListComponent } from "./components/todolist";
import { LlmWikiComponent } from "./components/llmwiki";
import { WikiGraphComponent } from "./components/wiki-graph";
import { AppLauncherComponent } from "./components/app-launcher";


export default class HomepageView extends ItemView {
  plugin: HomepagePlugin;
  private intervalId: number | null = null;
  private cardResizeObserver: ResizeObserver | null = null;
  private resizeSaveTimers = new Map<string, number>();

  schedule: ScheduleComponent;
  timer: TimerComponent;
  desktop: DesktopComponent;
  sidebar: SidebarComponent;
  todolist: TodoListComponent;
  llmwiki: LlmWikiComponent;
  wikigraph: WikiGraphComponent;
  applauncher: AppLauncherComponent;

  constructor(leaf: WorkspaceLeaf, plugin: HomepagePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.schedule = new ScheduleComponent(this);
    this.timer = new TimerComponent(this);
    this.desktop = new DesktopComponent(this);
    this.sidebar = new SidebarComponent(this);
    this.todolist = new TodoListComponent(this);
    this.llmwiki = new LlmWikiComponent(this);
    this.wikigraph = new WikiGraphComponent(this);
    this.applauncher = new AppLauncherComponent(this);
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
    this.timer.cleanup();
    this.wikigraph.cleanup();
    if (this.cardResizeObserver) {
      this.cardResizeObserver.disconnect();
      this.cardResizeObserver = null;
    }
  }

  getCardLayout(id: string): CardLayout {
    return this.plugin.settings.cardLayouts[id] || { x: -1, y: -1, width: 0, height: 0 };
  }

  private saveCardLayout(id: string, x: number, y: number, width: number, height: number) {
    this.plugin.settings.cardLayouts[id] = { x, y, width, height };
    this.plugin.saveSettings().catch(console.error);
  }

  isComponentAdded(id: string): boolean {
    return this.plugin.settings.components.some(c => c.id === id && c.added);
  }

  render() {
    const container = this.contentEl as HTMLElement;
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
            value="${escapeHtml(userName)}"
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
        ">${formatTime(now)}</div>
        <div id="homepage-date" style="
          font-size: 15px;
          color: var(--text-muted);
          text-align: right;
          min-width: 140px;
        ">${formatDate(now)}</div>
      </div>
      <div id="homepage-content" style="
        flex: 1;
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
      ">
        <div id="homepage-card-wrapper" data-component-id="schedule" data-component-wrapper="true" style="
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
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: var(--background-primary);
            overflow: hidden;
            border-radius: 14px;
            position: relative;
          ">
            <div id="homepage-schedule-header" style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 6px 12px;
              border-bottom: 1px solid var(--background-modifier-border);
              flex-shrink: 0;
            ">
              <span style="font-size: 13px; font-weight: 600; color: var(--text-normal);">📅 日程中心</span>
              <button id="schedule-refresh-btn" style="
                background: transparent;
                border: 1px solid var(--background-modifier-border);
                border-radius: 4px;
                color: var(--text-muted);
                cursor: pointer;
                font-size: 11px;
                padding: 2px 8px;
                font-family: inherit;
              ">🔄 刷新</button>
            </div>
            <div style="display: flex; flex: 1; min-height: 0;">
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
        </div>
        <div id="homepage-timer-wrapper" data-component-id="timer" data-component-wrapper="true" style="
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
              ">${this.timer.timerDisplayMode === "clock" ? "数字" : "表盘"}</button>
            </div>
            <div id="timer-display" style="
              flex: 1;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 0;
            "></div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
              ${this.timer.renderPicker("h", "时", 100, this.timer.timerHours)}
              ${this.timer.renderPicker("m", "分", 60, this.timer.timerMinutes)}
              ${this.timer.renderPicker("s", "秒", 60, this.timer.timerSeconds)}
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
          <div id="homepage-desktop-wrapper-${i}" data-component-id="desktop-${i}" data-component-wrapper="true" style="
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
                  value="${escapeHtml(this.plugin.settings.desktopNames[i] ?? "")}"
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
                  <button id="desktop-newfolder-btn-${i}" style="
                    background: transparent;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 4px;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 11px;
                    padding: 2px 6px;
                    font-family: inherit;
                    white-space: nowrap;
                  " title="新建文件夹">📁+</button>
                  <button id="desktop-newfile-btn-${i}" style="
                    background: transparent;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 4px;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 11px;
                    padding: 2px 6px;
                    font-family: inherit;
                    white-space: nowrap;
                  " title="新建 Markdown 文件">📝+</button>
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
        <div id="homepage-todolist-wrapper" data-component-id="todolist" data-component-wrapper="true" style="
          position: absolute;
          resize: both;
          overflow: hidden;
          width: 380px;
          height: 420px;
          min-width: 320px;
          min-height: 280px;
          max-width: 100%;
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--background-modifier-border);
          display: ${this.isComponentAdded("todolist") && !this.isComponentAdded("schedule") ? "block" : "none"};
        ">
          <div style="
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: var(--background-primary);
            overflow: hidden;
            border-radius: 14px;
          ">
            <div id="homepage-todolist-header" style="
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 10px 12px;
              border-bottom: 1px solid var(--background-modifier-border);
              flex-shrink: 0;
            ">
              <span style="font-size: 14px; font-weight: 600; color: var(--text-normal);">待办列表</span>
              <div style="display: flex; gap: 4px; flex: 1;">
                ${(["today","week","month"] as const).map(m => {
                  const labels: Record<string, string> = { today: "今天", week: "本周", month: "本月" };
                  return `<button class="todolist-tab" data-mode="${m}" style="
                    padding: 2px 8px;
                    font-size: 11px;
                    border-radius: 4px;
                    border: 1px solid var(--background-modifier-border);
                    background: ${this.todolist.mode === m ? "var(--interactive-accent)" : "transparent"};
                    color: ${this.todolist.mode === m ? "var(--text-on-accent)" : "var(--text-muted)"};
                    cursor: pointer;
                    font-family: inherit;
                  ">${labels[m]}</button>`;
                }).join("")}
              </div>
              <button id="todolist-refresh-btn" style="
                background: transparent;
                border: 1px solid var(--background-modifier-border);
                border-radius: 4px;
                color: var(--text-muted);
                cursor: pointer;
                font-size: 11px;
                padding: 2px 6px;
                flex-shrink: 0;
                font-family: inherit;
              " title="刷新">🔄</button>
              <button class="todolist-add" style="
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
            <div id="homepage-todolist-content" style="
              flex: 1;
              overflow-y: auto;
              padding: 8px 12px;
            "></div>
          </div>
        </div>
        <div id="homepage-llmwiki-wrapper" data-component-id="llmwiki" data-component-wrapper="true" style="
          position: absolute;
          resize: both;
          overflow: hidden;
          width: 500px;
          height: 500px;
          min-width: 360px;
          min-height: 360px;
          max-width: 100%;
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--background-modifier-border);
          display: ${this.isComponentAdded("llmwiki") ? "block" : "none"};
        ">
          <div id="homepage-llmwiki-card" style="
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: var(--background-primary);
            overflow: hidden;
            border-radius: 14px;
            position: relative;
          "></div>
        </div>
        <div id="homepage-wikigraph-wrapper" data-component-id="wikigraph" data-component-wrapper="true" style="
          position: absolute;
          resize: both;
          overflow: hidden;
          width: 600px;
          height: 500px;
          min-width: 400px;
          min-height: 360px;
          max-width: 100%;
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--background-modifier-border);
          display: ${this.isComponentAdded("wikigraph") ? "block" : "none"};
        ">
          <div id="homepage-wikigraph-card" style="
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: var(--background-primary);
            overflow: hidden;
            border-radius: 14px;
            position: relative;
          "></div>
        </div>
        <div id="homepage-applauncher-wrapper" data-component-id="applauncher" data-component-wrapper="true" style="
          position: absolute;
          resize: both;
          overflow: hidden;
          width: 560px;
          height: 420px;
          min-width: 320px;
          min-height: 280px;
          max-width: 100%;
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--background-modifier-border);
          display: ${this.isComponentAdded("applauncher") ? "block" : "none"};
        ">
          <div id="homepage-applauncher-card" style="
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: var(--background-primary);
            overflow: hidden;
            border-radius: 14px;
            position: relative;
          "></div>
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

    this.sidebar.render();

    if (this.isComponentAdded("schedule")) {
      this.schedule.renderStats();
      this.schedule.renderCalendar();
      if (this.isComponentAdded("todolist")) {
        this.todolist.renderEmbedded();
      } else {
        this.schedule.renderTodo();
      }
      this.setupCardPosition(container, "schedule", "#homepage-card-wrapper");

      // Refresh button
      const scheduleRefreshBtn = container.querySelector("#schedule-refresh-btn");
      scheduleRefreshBtn?.addEventListener("click", () => {
        this.schedule.renderStats();
        this.schedule.renderCalendar();
        if (this.isComponentAdded("todolist")) {
          this.todolist.renderEmbedded();
        } else {
          this.schedule.renderTodo();
        }
      });
    }

    if (this.isComponentAdded("timer")) {
      this.timer.init();
      this.setupCardPosition(container, "timer", "#homepage-timer-wrapper");
    }

    if (this.isComponentAdded("desktop")) {
      this.desktop.currentPaths = this.plugin.settings.desktopFolders.map(f => f);
      for (let i = 0; i < this.plugin.settings.desktopFolders.length; i++) {
        this.desktop.init(i);
        this.setupCardPosition(container, `desktop-${i}`, `#homepage-desktop-wrapper-${i}`);
      }
    }

    if (this.isComponentAdded("todolist") && !this.isComponentAdded("schedule")) {
      this.todolist.renderStandalone();
      this.setupCardPosition(container, "todolist", "#homepage-todolist-wrapper");

      // Refresh button
      const todolistRefreshBtn = container.querySelector("#todolist-refresh-btn");
      todolistRefreshBtn?.addEventListener("click", () => {
        this.todolist.refresh();
      });
    }

    if (this.isComponentAdded("llmwiki")) {
      this.llmwiki.render();
      this.setupCardPosition(container, "llmwiki", "#homepage-llmwiki-wrapper");
    }

    if (this.isComponentAdded("wikigraph")) {
      this.wikigraph.render();
      this.setupCardPosition(container, "wikigraph", "#homepage-wikigraph-wrapper");
    }

    if (this.isComponentAdded("applauncher")) {
      this.applauncher.render();
      this.setupCardPosition(container, "applauncher", "#homepage-applauncher-wrapper");
    }

    if (!this.isComponentAdded("study")) {
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_STUDY);
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

      input.addEventListener("input", () => this.autoResizeInput(input, 4));
      this.autoResizeInput(input, 4);
    }
  }

  // ── Shared card system ──────────────────────────────────

  isInteractiveTarget(target: HTMLElement): boolean {
    if (target.closest("button, input, select, textarea")) return true;
    if (target.closest("canvas, .llmwiki-link")) return true;
    if (target.closest(".calendar-day, .todo-check, .todo-delete, .todo-filter-chip, .yesterday-sync-one, .yesterday-sync-all")) return true;
    if (target.closest(".timer-picker-wrap")) return true;
    if (target.closest(".desktop-item")) return true;
    if (target.closest(".todolist-tab, .todolist-check, .todolist-delete, .todolist-add, .todolist-gantt-bar")) return true;
    if (target.closest(".applauncher-item")) return true;
    return false;
  }

  autoResizeInput(input: HTMLInputElement, extraPx: number = 6): void {
    const span = document.createElement("span");
    const cs = getComputedStyle(input);
    span.style.cssText = `
      font: ${cs.font};
      letter-spacing: ${cs.letterSpacing};
      position: absolute; visibility: hidden; white-space: pre;
    `;
    document.body.appendChild(span);
    span.textContent = input.value || input.placeholder;
    input.style.width = (span.offsetWidth + extraPx) + "px";
    document.body.removeChild(span);
  }

  setupHoverDeleteButton(itemSelector: string, deleteSelector: string): void {
    this.containerEl.querySelectorAll(itemSelector).forEach(el => {
      el.addEventListener("mouseenter", () => {
        const del = el.querySelector(deleteSelector) as HTMLElement;
        if (del) del.style.visibility = "visible";
      });
      el.addEventListener("mouseleave", () => {
        const del = el.querySelector(deleteSelector) as HTMLElement;
        if (del) del.style.visibility = "hidden";
      });
    });
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

    if (layout.x < 0) {
      const maxX = contentArea.offsetWidth - w;
      const others = this.getOtherCardBounds(wrapperSelector);
      let cx = posX, cy = posY;
      for (let iter = 0; iter < 5; iter++) {
        const c = this.constrainNoOverlap(cx, cy, w, h, others);
        cx = Math.max(0, Math.min(c.x, maxX));
        cy = Math.max(0, c.y);
        if (cx === c.x && cy === c.y) break;
      }
      posX = cx;
      posY = cy;
      wrapper.style.left = posX + "px";
      wrapper.style.top = posY + "px";
    }

    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    let isResizing = false;

    wrapper.addEventListener("pointerdown", (e) => {
      isResizing = false;
      const rect = wrapper.getBoundingClientRect();
      if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) {
        isResizing = true;
        return;
      }
      if (this.isInteractiveTarget(e.target as HTMLElement)) return;
      wrapper.setPointerCapture((e as PointerEvent).pointerId);
      wrapper.style.cursor = "grabbing";
      startX = e.clientX; startY = e.clientY;
      origLeft = wrapper.offsetLeft; origTop = wrapper.offsetTop;
    });

    wrapper.addEventListener("pointermove", (e) => {
      if (!wrapper.hasPointerCapture((e as PointerEvent).pointerId)) return;
      const maxX = contentArea.offsetWidth - wrapper.offsetWidth;
      const nx = Math.max(0, Math.min(origLeft + e.clientX - startX, maxX));
      const ny = Math.max(0, origTop + e.clientY - startY);
      const others = this.getOtherCardBounds(wrapperSelector);
      let cx = nx, cy = ny;
      for (let iter = 0; iter < 5; iter++) {
        const c = this.constrainNoOverlap(cx, cy, wrapper.offsetWidth, wrapper.offsetHeight, others);
        cx = Math.max(0, Math.min(c.x, maxX));
        cy = Math.max(0, c.y);
        if (cx === c.x && cy === c.y) break;
      }
      posX = cx;
      posY = cy;
      wrapper.style.left = posX + "px";
      wrapper.style.top = posY + "px";
      this.expandContentHeight();
    });

    wrapper.addEventListener("pointerup", () => {
      wrapper.style.cursor = "";
      if (isResizing) {
        const pre = this.plugin.settings.cardLayouts[componentId];
        if (pre) {
          wrapper.style.left = pre.x + "px";
          wrapper.style.top = pre.y + "px";
          this.saveCardLayout(componentId, pre.x, pre.y, wrapper.offsetWidth, wrapper.offsetHeight);
        }
      } else {
        this.saveCardLayout(componentId, posX, posY, wrapper.offsetWidth, wrapper.offsetHeight);
      }
      isResizing = false;
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
        const existing = this.resizeSaveTimers.get(id);
        if (existing) window.clearTimeout(existing);
        this.resizeSaveTimers.set(id, window.setTimeout(() => {
          this.resizeSaveTimers.delete(id);
          this.saveCardLayout(id, prev.x, prev.y, entry.contentRect.width, entry.contentRect.height);
        }, 200));
      }
    });
    this.containerEl.querySelectorAll('[data-component-wrapper]').forEach(w => {
      this.cardResizeObserver!.observe(w as HTMLElement);
    });
  }

  private expandContentHeight() {
    const content = this.containerEl.querySelector("#homepage-content") as HTMLElement;
    if (!content) return;
    let maxBottom = content.clientHeight;
    content.querySelectorAll('[data-component-wrapper]').forEach(w => {
      const el = w as HTMLElement;
      if (el.style.display === "none") return;
      maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight + 60);
    });
    content.style.minHeight = maxBottom + "px";
  }

  private getOtherCardBounds(excludeSelector: string): Array<{ x: number; y: number; w: number; h: number }> {
    const content = this.containerEl.querySelector("#homepage-content") as HTMLElement;
    if (!content) return [];
    const wrappers = content.querySelectorAll('[data-component-wrapper]');
    const result: Array<{ x: number; y: number; w: number; h: number }> = [];
    wrappers.forEach(w => {
      const el = w as HTMLElement;
      if (el.matches(excludeSelector)) return;
      if (el.style.display === "none") return;
      if (!el.style.left) return;
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
    for (let iter = 0; iter < 10; iter++) {
      let moved = false;
      for (const o of others) {
        const ox = rx < o.x + o.w + GAP && rx + w + GAP > o.x;
        const oy = ry < o.y + o.h + GAP && ry + h + GAP > o.y;
        if (!ox || !oy) continue;
        const pushRight = (o.x + o.w + GAP) - rx;
        const pushLeft = (rx + w + GAP) - o.x;
        const pushDown = (o.y + o.h + GAP) - ry;
        const pushUp = (ry + h + GAP) - o.y;
        if (Math.min(pushRight, pushLeft) < Math.min(pushDown, pushUp)) {
          rx = pushRight < pushLeft ? o.x + o.w + GAP : o.x - w - GAP;
        } else {
          ry = pushDown < pushUp ? o.y + o.h + GAP : o.y - h - GAP;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return { x: rx, y: ry };
  }

  // ── Header / time ──────────────────────────────────────

  private updateTime() {
    const now = new Date();
    const clockEl = this.containerEl.querySelector("#homepage-clock");
    const dateEl = this.containerEl.querySelector("#homepage-date");
    if (clockEl) clockEl.textContent = formatTime(now);
    if (dateEl) {
      const newDate = formatDate(now);
      if (dateEl.textContent !== newDate) {
        dateEl.textContent = newDate;
        this.updateGreeting();
      }
    }
  }

  private saveName(name: string) {
    this.plugin.settings.userName = name;
    this.plugin.saveSettings().catch(console.error);
  }

  private updateGreeting() {
    const greetingTextEl = this.containerEl.querySelector("#homepage-greeting-text");
    if (!greetingTextEl) return;
    const period = getTimePeriod(new Date().getHours());
    greetingTextEl.textContent = `${period}好，`;
  }

  // ── Coordinator methods ─────────────────────────────────

  addTodo(text: string, color: string, date: string, startTime: string, endTime: string) {
    const todo: TodoItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text,
      color,
      done: false,
      date,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
    };
    this.plugin.settings.todos.push(todo);
    this.plugin.saveSettings().catch(console.error);
    this.schedule.renderStats();
    this.schedule.renderCalendar();
    this.schedule.renderTodo();
    if (this.isComponentAdded("todolist")) this.todolist.refresh();
  }

  toggleTodo(id: string) {
    const todo = this.plugin.settings.todos.find(t => t.id === id);
    if (todo) {
      todo.done = !todo.done;
      this.plugin.saveSettings().catch(console.error);
      this.schedule.renderStats();
      this.schedule.renderCalendar();
      this.schedule.renderTodo();
      if (this.isComponentAdded("todolist")) this.todolist.refresh();
    }
  }

  deleteTodo(id: string) {
    this.plugin.settings.todos = this.plugin.settings.todos.filter(t => t.id !== id);
    this.plugin.saveSettings().catch(console.error);
    this.schedule.renderStats();
    this.schedule.renderCalendar();
    this.schedule.renderTodo();
    if (this.isComponentAdded("todolist")) this.todolist.refresh();
  }

  syncTodoToToday(id: string) {
    const todo = this.plugin.settings.todos.find(t => t.id === id);
    if (!todo) return;
    todo.date = this.schedule.selectedDate;
    this.plugin.saveSettings().catch(console.error);
    this.schedule.renderStats();
    this.schedule.renderCalendar();
    this.schedule.renderTodo();
    if (this.isComponentAdded("todolist")) this.todolist.refresh();
  }

  syncAllYesterday() {
    const yesterdayKey = this.schedule.getYesterdayKey(this.schedule.selectedDate);
    let changed = false;
    for (const todo of this.plugin.settings.todos) {
      if (todo.date === yesterdayKey && !todo.done) {
        todo.date = this.schedule.selectedDate;
        changed = true;
      }
    }
    if (!changed) return;
    this.plugin.saveSettings().catch(console.error);
    this.schedule.renderStats();
    this.schedule.renderCalendar();
    this.schedule.renderTodo();
    if (this.isComponentAdded("todolist")) this.todolist.refresh();
  }
}
