import { FileSystemAdapter } from "obsidian";
import type HomepageView from "../view";
import { escapeHtml } from "../utils";
import { DesktopFolderModal } from "../modals";

export class DesktopComponent {
  private view: HomepageView;
  currentPaths: string[] = [];

  constructor(view: HomepageView) {
    this.view = view;
  }

  getFileIcon(filename: string): string {
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

  renderItem(name: string, type: "file" | "folder"): string {
    const icon = type === "folder" ? "📁" : this.getFileIcon(name);
    return `
      <div class="desktop-item" data-path="${escapeHtml(name)}" data-type="${type}" style="
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
        ">${escapeHtml(name)}</span>
      </div>
    `;
  }

  async renderContents(i: number) {
    const grid = this.view.containerEl.querySelector(`#desktop-grid-${i}`) as HTMLElement;
    const pathDisplay = this.view.containerEl.querySelector(`#desktop-path-display-${i}`) as HTMLElement;
    const backBtn = this.view.containerEl.querySelector(`#desktop-back-btn-${i}`) as HTMLElement;
    if (!grid) return;

    const cur = this.currentPaths[i] ?? "";
    const root = this.view.plugin.settings.desktopFolders[i] ?? "";
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
      if (!this.view.app.vault.adapter) return;
      const result = await this.view.app.vault.adapter.list(cur);
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
        folders.map((f) => this.renderItem(f, "folder")).join("") +
        files.map((f) => this.renderItem(f, "file")).join("");
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

  private openFile(i: number, filename: string) {
    const cur = this.currentPaths[i] ?? "";
    const relativePath = cur ? `${cur}/${filename}` : filename;
    if (filename.endsWith(".md")) {
      this.view.app.workspace.openLinkText(relativePath, "", false);
      return;
    }
    try {
      const adapter = this.view.app.vault.adapter as FileSystemAdapter;
      const basePath = adapter.getBasePath();
      const absolutePath = `${basePath}/${relativePath}`;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      if (typeof require !== "undefined") {
        const { shell } = require("electron");
        shell.openPath(absolutePath);
      }
    } catch {
      // silently fail on non-desktop platforms
    }
  }

  private navigateToFolder(i: number, subfolder: string) {
    const cur = this.currentPaths[i] ?? "";
    this.currentPaths[i] = cur ? `${cur}/${subfolder}` : subfolder;
    this.renderContents(i);
  }

  private navigateBack(i: number) {
    const cur = this.currentPaths[i] ?? "";
    const root = this.view.plugin.settings.desktopFolders[i] ?? "";
    if (cur === root) return;
    const parts = cur.split("/");
    parts.pop();
    const parent = parts.join("/");
    if (root && !parent.startsWith(root)) {
      this.currentPaths[i] = root;
    } else {
      this.currentPaths[i] = parent;
    }
    this.renderContents(i);
  }

  private openFolderPicker(i: number) {
    const root = this.view.plugin.settings.desktopFolders[i] ?? "";
    new DesktopFolderModal(this.view.app, root, (newPath) => {
      this.view.plugin.settings.desktopFolders[i] = newPath;
      this.view.plugin.saveSettings().catch(console.error);
      this.currentPaths[i] = newPath;
      this.renderContents(i);
    }).open();
  }

  private createFolder(i: number) {
    this.insertInlineEditor(i, "folder", "📁", "新建文件夹", async (name) => {
      const cur = this.currentPaths[i] ?? "";
      const path = cur ? `${cur}/${name}` : name;
      await this.view.app.vault.createFolder(path);
    });
  }

  private createFile(i: number) {
    this.insertInlineEditor(i, "file", "📝", "新建文件.md", async (name) => {
      const cur = this.currentPaths[i] ?? "";
      const filename = name.endsWith(".md") ? name : `${name}.md`;
      const path = cur ? `${cur}/${filename}` : filename;
      await this.view.app.vault.create(path, "");
    });
  }

  private insertInlineEditor(i: number, _type: "file" | "folder", icon: string, placeholder: string, onCreate: (name: string) => Promise<void>) {
    const grid = this.view.containerEl.querySelector(`#desktop-grid-${i}`) as HTMLElement;
    if (!grid) return;

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px; border-radius: 8px; background: var(--background-modifier-hover);";

    const iconEl = document.createElement("div");
    iconEl.style.cssText = "font-size: 32px; line-height: 1; pointer-events: none;";
    iconEl.textContent = icon;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.style.cssText = `
      font-size: 11px;
      text-align: center;
      width: 80px;
      padding: 2px 4px;
      border: 1px solid var(--interactive-accent);
      border-radius: 4px;
      background: var(--background-primary);
      color: var(--text-normal);
      outline: none;
      font-family: inherit;
      box-sizing: border-box;
    `;

    const done = async () => {
      const name = input.value.trim();
      wrapper.remove();
      if (!name) return;
      try {
        await onCreate(name);
        this.renderContents(i);
      } catch (e) {
        console.error("创建失败：", e);
      }
    };

    const cancel = () => {
      wrapper.remove();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", () => {
      // delay to allow click on other elements to register first
      setTimeout(() => {
        if (wrapper.isConnected) cancel();
      }, 150);
    });

    wrapper.appendChild(iconEl);
    wrapper.appendChild(input);
    grid.prepend(wrapper);

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  private showContextMenu(x: number, y: number, i: number, name: string, type: "file" | "folder") {
    this.removeContextMenu();

    const menu = document.createElement("div");
    menu.id = "desktop-context-menu";
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      z-index: 1000;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.16);
      padding: 4px;
      min-width: 140px;
      font-family: inherit;
      font-size: 13px;
    `;

    const deleteBtn = document.createElement("div");
    deleteBtn.textContent = `删除${type === "folder" ? "文件夹" : "文件"}`;
    deleteBtn.style.cssText = `
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-error);
      user-select: none;
    `;
    deleteBtn.addEventListener("mouseenter", () => {
      deleteBtn.style.background = "var(--background-modifier-hover)";
    });
    deleteBtn.addEventListener("mouseleave", () => {
      deleteBtn.style.background = "transparent";
    });
    deleteBtn.addEventListener("click", () => {
      this.removeContextMenu();
      this.deleteItem(i, name);
    });

    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);

    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        this.removeContextMenu();
        document.removeEventListener("click", close, true);
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener("click", close, true);
    });
  }

  private removeContextMenu() {
    const existing = document.querySelector("#desktop-context-menu");
    if (existing) existing.remove();
  }

  private async deleteItem(i: number, name: string) {
    const cur = this.currentPaths[i] ?? "";
    const relativePath = cur ? `${cur}/${name}` : name;
    try {
      const file = this.view.app.vault.getAbstractFileByPath(relativePath);
      if (file) {
        await this.view.app.vault.trash(file, true);
        this.renderContents(i);
      }
    } catch (e) {
      console.error("删除失败：", e);
    }
  }

  addInstance() {
    this.view.plugin.settings.desktopFolders.push("");
    this.view.plugin.settings.desktopNames.push("");
    this.view.plugin.saveSettings().catch(console.error);
    this.view.render();
  }

  removeInstance(i: number) {
    if (this.view.plugin.settings.desktopFolders.length <= 1) return;
    this.view.plugin.settings.desktopFolders.splice(i, 1);
    this.view.plugin.settings.desktopNames.splice(i, 1);
    this.view.plugin.saveSettings().catch(console.error);
    this.view.render();
  }

  init(i: number) {
    this.renderContents(i);

    const grid = this.view.containerEl.querySelector(`#desktop-grid-${i}`);
    grid?.addEventListener("dblclick", (e) => {
      const item = (e.target as HTMLElement).closest(".desktop-item") as HTMLElement | null;
      if (!item) return;
      const name = item.dataset.path!;
      const type = item.dataset.type!;
      if (type === "folder") {
        this.navigateToFolder(i, name);
      } else {
        this.openFile(i, name);
      }
    });

    grid?.addEventListener("contextmenu", (e: Event) => {
      const item = (e.target as HTMLElement).closest(".desktop-item") as HTMLElement | null;
      if (!item) return;
      e.preventDefault();
      const me = e as PointerEvent;
      const name = item.dataset.path!;
      const type = item.dataset.type as "file" | "folder";
      this.showContextMenu(me.clientX, me.clientY, i, name, type);
    });

    this.view.containerEl.querySelector(`#desktop-back-btn-${i}`)?.addEventListener("click", () => {
      this.navigateBack(i);
    });

    this.view.containerEl.querySelector(`#desktop-folder-btn-${i}`)?.addEventListener("click", () => {
      this.openFolderPicker(i);
    });

    this.view.containerEl.querySelector(`#desktop-newfolder-btn-${i}`)?.addEventListener("click", () => {
      this.createFolder(i);
    });

    this.view.containerEl.querySelector(`#desktop-newfile-btn-${i}`)?.addEventListener("click", () => {
      this.createFile(i);
    });

    this.view.containerEl.querySelector(`#desktop-add-btn-${i}`)?.addEventListener("click", () => {
      this.addInstance();
    });

    this.view.containerEl.querySelector(`#desktop-close-btn-${i}`)?.addEventListener("click", () => {
      this.removeInstance(i);
    });

    const nameInput = this.view.containerEl.querySelector(`#desktop-name-input-${i}`) as HTMLInputElement;
    if (nameInput) {
      nameInput.addEventListener("change", () => {
        this.view.plugin.settings.desktopNames[i] = nameInput.value.trim();
        this.view.plugin.saveSettings().catch(console.error);
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") nameInput.blur();
      });
      nameInput.addEventListener("input", () => this.view.autoResizeInput(nameInput, 12));
      this.view.autoResizeInput(nameInput, 12);
    }
  }
}
