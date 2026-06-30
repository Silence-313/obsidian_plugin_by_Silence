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

    this.view.containerEl.querySelector(`#desktop-back-btn-${i}`)?.addEventListener("click", () => {
      this.navigateBack(i);
    });

    this.view.containerEl.querySelector(`#desktop-folder-btn-${i}`)?.addEventListener("click", () => {
      this.openFolderPicker(i);
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
