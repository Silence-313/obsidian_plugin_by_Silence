import { App, Modal } from "obsidian";
import { TODO_COLORS } from "./constants";

export class TodoAddModal extends Modal {
  private onAdd: (text: string, color: string, date: string, startTime: string, endTime: string) => void;
  private pickedColor = TODO_COLORS[1].value;
  private dateKey: string;
  private dateStr: string;
  private startTime = "";
  private endTime = "";

  constructor(app: App, dateKey: string, onAdd: (text: string, color: string, date: string, startTime: string, endTime: string) => void) {
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
      if (e.key === "Enter") this.confirm(input);
      if (e.key === "Escape") this.close();
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

    // Time inputs
    contentEl.createEl("div", { text: "时间段（可选）" }, el => {
      el.style.cssText = "font-size: 13px; color: var(--text-muted); margin-bottom: 8px;";
    });

    const timeRow = contentEl.createEl("div");
    timeRow.style.cssText = "display: flex; gap: 12px; margin-bottom: 20px; align-items: center;";

    const startInput = timeRow.createEl("input", { type: "time" });
    startInput.style.cssText = `
      padding: 4px 8px;
      font-size: 13px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      background: var(--background-modifier-hover);
      color: var(--text-normal);
      outline: none;
      font-family: inherit;
    `;
    startInput.addEventListener("input", () => { this.startTime = startInput.value; });

    timeRow.createEl("span", { text: "—" }, el => {
      el.style.cssText = "font-size: 13px; color: var(--text-muted);";
    });

    const endInput = timeRow.createEl("input", { type: "time" });
    endInput.style.cssText = `
      padding: 4px 8px;
      font-size: 13px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      background: var(--background-modifier-hover);
      color: var(--text-normal);
      outline: none;
      font-family: inherit;
    `;
    endInput.addEventListener("input", () => { this.endTime = endInput.value; });

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
    this.onAdd(text, this.pickedColor, this.dateKey, this.startTime, this.endTime);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class NamePromptModal extends Modal {
  private onSubmit: (name: string) => void;
  private title: string;
  private placeholder: string;

  constructor(app: App, title: string, placeholder: string, onSubmit: (name: string) => void) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: this.title });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: this.placeholder,
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
      if (e.key === "Enter") this.confirm(input.value.trim());
      if (e.key === "Escape") this.close();
    });
    input.focus();

    const btnRow = contentEl.createEl("div");
    btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 8px;";

    btnRow.createEl("button", { text: "取消" }, el => {
      el.style.cssText = "padding:6px 16px; font-size:14px; border:1px solid var(--background-modifier-border); border-radius:4px; background:transparent; color:var(--text-muted); cursor:pointer;";
      el.addEventListener("click", () => this.close());
    });

    btnRow.createEl("button", { text: "确定" }, el => {
      el.style.cssText = "padding:6px 16px; font-size:14px; border:none; border-radius:4px; background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer;";
      el.addEventListener("click", () => this.confirm(input.value.trim()));
    });
  }

  private confirm(name: string) {
    if (!name) return;
    this.onSubmit(name);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class DesktopFolderModal extends Modal {
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
      if (e.key === "Enter") this.confirm(input.value.trim());
      if (e.key === "Escape") this.close();
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
