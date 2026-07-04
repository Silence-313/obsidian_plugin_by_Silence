import type HomepageView from "../view";
import type { AppLauncherItem } from "../types";
import { escapeHtml } from "../utils";

export class AppLauncherComponent {
  private view: HomepageView;
  activeAppId: string | null = null;

  constructor(view: HomepageView) {
    this.view = view;
  }

  getApps(): AppLauncherItem[] {
    return this.view.plugin.settings.appLauncher.apps;
  }

  launchAndDock(app: AppLauncherItem) {
    // 1. Launch the app
    try {
      const { exec } = require("child_process");
      exec(app.command, (err: Error | null) => {
        if (err) {
          console.error("[AppLauncher] 启动失败:", err.message);
          return;
        }
        // 2. After a short delay for the window to appear, position it
        setTimeout(() => this.positionAppWindow(app), 600);
      });
    } catch (e) {
      console.error("[AppLauncher] 无法执行命令:", e);
    }

    this.activeAppId = app.id;
    this.render();
  }

  positionAppWindow(app: AppLauncherItem) {
    const wrapper = this.view.containerEl.querySelector("#homepage-applauncher-wrapper") as HTMLElement;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    // Screen coordinates: viewport offset + window position
    const sx = Math.round(rect.left + (window as any).screenX);
    const sy = Math.round(rect.top + (window as any).screenY);
    const sw = Math.round(rect.width);
    const sh = Math.round(rect.height);

    const escapedName = app.appName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const script = `
      tell application "System Events"
        tell process "${escapedName}"
          try
            set position of window 1 to {${sx}, ${sy}}
            set size of window 1 to {${sw}, ${sh}}
          end try
        end tell
      end tell
      tell application "${escapedName}"
        activate
      end tell
    `;

    try {
      const { exec } = require("child_process");
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err: Error | null) => {
        if (err) {
          console.error("[AppLauncher] 窗口定位失败:", err.message);
        }
      });
    } catch (e) {
      console.error("[AppLauncher] osascript 执行失败:", e);
    }
  }

  refocusApp(app: AppLauncherItem) {
    this.positionAppWindow(app);
  }

  closeApp(app: AppLauncherItem) {
    const name = app.appName;
    if (!name) {
      console.error("[AppLauncher] appName is missing for", app.id);
      this.activeAppId = null;
      this.render();
      return;
    }

    // AppleScript: try quit first, fallback to Cmd+Q
    const script = [
      `try`,
      `  tell application "${name.replace(/"/g, '\\"')}" to quit`,
      `on error`,
      `  try`,
      `    tell application "${name.replace(/"/g, '\\"')}" to activate`,
      `    delay 0.3`,
      `    tell application "System Events"`,
      `      tell process "${name.replace(/"/g, '\\"')}"`,
      `        keystroke "q" using command down`,
      `      end tell`,
      `    end tell`,
      `  end try`,
      `end try`,
    ].join("\n");

    try {
      const { exec } = require("child_process");
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          console.error("[AppLauncher] 关闭失败:", stderr || err.message);
        }
      });
    } catch (e) {
      console.error("[AppLauncher] osascript 执行失败:", e);
    }

    this.activeAppId = null;
    this.render();
  }

  async addApp(name: string, icon: string, appName: string, command: string) {
    const id = "app-" + Date.now();
    const apps = this.view.plugin.settings.appLauncher.apps;
    apps.push({ id, name, icon, appName, command });
    await this.view.plugin.saveSettings();
    this.render();
  }

  async removeApp(id: string) {
    if (this.activeAppId === id) this.activeAppId = null;
    const settings = this.view.plugin.settings.appLauncher;
    settings.apps = settings.apps.filter(a => a.id !== id);
    await this.view.plugin.saveSettings();
    this.render();
  }

  render() {
    const card = this.view.containerEl.querySelector("#homepage-applauncher-card") as HTMLElement;
    if (!card) return;

    const apps = this.getApps();
    const activeApp = apps.find(a => a.id === this.activeAppId);

    card.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: var(--background-primary);
        overflow: hidden;
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-bottom: 1px solid var(--background-modifier-border);
          flex-shrink: 0;
        ">
          <span style="font-size: 14px; font-weight: 600; color: var(--text-normal);">🚀 应用启动器</span>
          <div style="display: flex; gap: 6px;">
            ${activeApp ? `
              <button id="applauncher-refocus-btn" style="
                background: transparent;
                border: 1px solid var(--interactive-accent);
                color: var(--interactive-accent);
                border-radius: 4px;
                padding: 2px 8px;
                font-size: 11px;
                cursor: pointer;
                font-family: inherit;
              " title="重新对齐窗口">📍 对齐</button>
              <button id="applauncher-close-btn" style="
                background: transparent;
                border: 1px solid var(--background-modifier-border);
                color: var(--text-muted);
                border-radius: 4px;
                padding: 2px 8px;
                font-size: 11px;
                cursor: pointer;
                font-family: inherit;
              " title="关闭应用">✕ 关闭</button>
            ` : ""}
            <button id="applauncher-add-btn" style="
              background: var(--interactive-accent);
              color: var(--text-on-accent);
              border: none;
              border-radius: 4px;
              padding: 2px 10px;
              font-size: 12px;
              cursor: pointer;
              font-family: inherit;
            ">+ 添加</button>
          </div>
        </div>
        ${activeApp ? `
          <div id="applauncher-overlay" style="
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            background: var(--background-secondary);
            position: relative;
          ">
            <div style="
              font-size: 64px;
              line-height: 1;
              opacity: 0.6;
            ">${escapeHtml(activeApp.icon)}</div>
            <div style="
              font-size: 14px;
              color: var(--text-muted);
              text-align: center;
            ">${escapeHtml(activeApp.name)} 已在此区域运行</div>
            <div style="
              font-size: 11px;
              color: var(--text-faint);
              text-align: center;
              max-width: 320px;
              line-height: 1.5;
            ">窗口已对齐到卡片位置。拖动卡片后点击「📍 对齐」重新同步。切换应用后点击「✕ 关闭」停止。</div>
          </div>
        ` : `
          <div id="applauncher-grid" style="
            flex: 1;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
            gap: 8px;
            padding: 12px;
            overflow-y: auto;
            align-content: start;
          ">
            ${apps.map(app => `
              <div class="applauncher-item" data-id="${escapeHtml(app.id)}" style="
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                padding: 8px 4px;
                border-radius: 10px;
                cursor: pointer;
                user-select: none;
                transition: background 0.15s;
                position: relative;
              " onmouseenter="this.style.background='var(--background-modifier-hover)'" onmouseleave="this.style.background='transparent'">
                <div style="font-size: 36px; line-height: 1; pointer-events: none;">${escapeHtml(app.icon)}</div>
                <span style="
                  font-size: 10px;
                  color: var(--text-normal);
                  text-align: center;
                  line-height: 1.3;
                  word-break: break-word;
                  pointer-events: none;
                ">${escapeHtml(app.name)}</span>
                <button class="applauncher-remove-btn" data-id="${escapeHtml(app.id)}" style="
                  position: absolute;
                  top: 0;
                  right: 2px;
                  background: transparent;
                  border: none;
                  color: var(--text-faint);
                  cursor: pointer;
                  font-size: 12px;
                  padding: 0 2px;
                  line-height: 1;
                  display: none;
                  font-family: inherit;
                " title="移除">×</button>
              </div>
            `).join("")}
          </div>
        `}
      </div>
      <div id="applauncher-add-form" style="
        display: none;
        border-top: 1px solid var(--background-modifier-border);
        padding: 10px 14px;
        flex-shrink: 0;
      ">
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <input id="applauncher-input-name" type="text" placeholder="应用名称" style="
            padding: 4px 8px; font-size: 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px; background: var(--background-primary);
            color: var(--text-normal); font-family: inherit;
          "/>
          <input id="applauncher-input-icon" type="text" placeholder="图标 (emoji)" style="
            padding: 4px 8px; font-size: 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px; background: var(--background-primary);
            color: var(--text-normal); font-family: inherit;
          "/>
          <input id="applauncher-input-appname" type="text" placeholder="应用 AppleScript 名称，如 Safari" style="
            padding: 4px 8px; font-size: 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px; background: var(--background-primary);
            color: var(--text-normal); font-family: inherit;
          "/>
          <input id="applauncher-input-command" type="text" placeholder="启动命令，如: open -a 'Safari'" style="
            padding: 4px 8px; font-size: 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px; background: var(--background-primary);
            color: var(--text-normal); font-family: inherit;
          "/>
          <div style="display: flex; gap: 6px;">
            <button id="applauncher-confirm-add" style="
              padding: 3px 12px; font-size: 12px;
              background: var(--interactive-accent); color: var(--text-on-accent);
              border: none; border-radius: 4px; cursor: pointer; font-family: inherit;
            ">确认</button>
            <button id="applauncher-cancel-add" style="
              padding: 3px 12px; font-size: 12px;
              background: transparent; border: 1px solid var(--background-modifier-border);
              border-radius: 4px; color: var(--text-muted);
              cursor: pointer; font-family: inherit;
            ">取消</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    const card = this.view.containerEl.querySelector("#homepage-applauncher-card") as HTMLElement;
    if (!card) return;

    const apps = this.getApps();

    // Launch and dock app on click
    card.querySelectorAll(".applauncher-item").forEach(el => {
      el.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("applauncher-remove-btn")) return;
        const id = el.getAttribute("data-id");
        if (!id) return;
        const app = apps.find(a => a.id === id);
        if (app) this.launchAndDock(app);
      });

      el.addEventListener("mouseenter", () => {
        const btn = el.querySelector(".applauncher-remove-btn") as HTMLElement;
        if (btn) btn.style.display = "block";
      });
      el.addEventListener("mouseleave", () => {
        const btn = el.querySelector(".applauncher-remove-btn") as HTMLElement;
        if (btn) btn.style.display = "none";
      });
    });

    // Remove app
    card.querySelectorAll(".applauncher-remove-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        if (id) this.removeApp(id);
      });
    });

    // Refocus active app
    const refocusBtn = card.querySelector("#applauncher-refocus-btn") as HTMLElement;
    refocusBtn?.addEventListener("click", () => {
      const active = apps.find(a => a.id === this.activeAppId);
      if (active) this.refocusApp(active);
    });

    // Close active app
    const closeBtn = card.querySelector("#applauncher-close-btn") as HTMLElement;
    closeBtn?.addEventListener("click", () => {
      console.log("[AppLauncher] close button clicked, activeAppId:", this.activeAppId);
      const active = apps.find(a => a.id === this.activeAppId);
      console.log("[AppLauncher] found active app:", active?.name);
      if (active) this.closeApp(active);
    });

    // Show add form
    const addBtn = card.querySelector("#applauncher-add-btn") as HTMLElement;
    const addForm = card.querySelector("#applauncher-add-form") as HTMLElement;
    if (addBtn && addForm) {
      addBtn.addEventListener("click", () => {
        addForm.style.display = "block";
        addBtn.style.display = "none";
        const input = card.querySelector("#applauncher-input-name") as HTMLInputElement;
        input?.focus();
      });
    }

    // Confirm add
    const confirmBtn = card.querySelector("#applauncher-confirm-add") as HTMLElement;
    confirmBtn?.addEventListener("click", () => {
      const nameInput = card.querySelector("#applauncher-input-name") as HTMLInputElement;
      const iconInput = card.querySelector("#applauncher-input-icon") as HTMLInputElement;
      const appNameInput = card.querySelector("#applauncher-input-appname") as HTMLInputElement;
      const cmdInput = card.querySelector("#applauncher-input-command") as HTMLInputElement;
      const name = nameInput?.value.trim();
      const icon = iconInput?.value.trim() || "📦";
      const appName = appNameInput?.value.trim();
      const command = cmdInput?.value.trim();
      if (name && appName && command) {
        this.addApp(name, icon, appName, command);
      }
    });

    // Cancel add
    const cancelBtn = card.querySelector("#applauncher-cancel-add") as HTMLElement;
    cancelBtn?.addEventListener("click", () => this.hideAddForm());

    // Enter/Escape in form inputs
    card.querySelectorAll("#applauncher-input-name, #applauncher-input-icon, #applauncher-input-appname, #applauncher-input-command").forEach(input => {
      input.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") confirmBtn?.click();
        if ((e as KeyboardEvent).key === "Escape") this.hideAddForm();
      });
    });
  }

  private hideAddForm() {
    const card = this.view.containerEl.querySelector("#homepage-applauncher-card") as HTMLElement;
    if (!card) return;
    const addForm = card.querySelector("#applauncher-add-form") as HTMLElement;
    const addBtn = card.querySelector("#applauncher-add-btn") as HTMLElement;
    if (addForm) addForm.style.display = "none";
    if (addBtn) addBtn.style.display = "inline-block";
  }
}
