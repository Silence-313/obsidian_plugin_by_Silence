import { requestUrl } from "obsidian";
import type HomepageView from "../view";
import type { ChatMessage } from "../types";
import { escapeHtml, loadApiKeyFromKeychain, saveApiKeyToKeychain, deleteApiKeyFromKeychain } from "../utils";
import { AgentOrchestrator } from "../agent";

const WIKI_SCHEMA = `# LLM Wiki Schema

你是知识库维护者。任务是阅读用户笔记，维护结构化 wiki。

## Wiki 结构

- index.md — 知识库目录，按文件夹层级组织，引用概念枢纽
- log.md — 按时间顺序记录所有操作
- overview.md — 知识库总览
- summaries/ — 每篇笔记的摘要
- concepts/ — 文件夹概念枢纽页面 + 跨笔记概念

## 核心规则

### 1. 文件夹层级拓扑
知识图谱连接规则：index → 文件夹 → 内容，单向 DAG，不可成环。
- 每个文件夹对应一个概念枢纽页面（concepts/<文件夹名>.md）
- index.md 连接各文件夹枢纽，不直接连接具体文件
- 文件夹枢纽连接该文件夹下所有源笔记和摘要

### 2. 摘要生成
- 每篇笔记生成一个摘要，存储在 summaries/<文件名>.md
- YAML frontmatter 含 source（源路径）、source-mtime（文件修改时间戳）、date、tags
- 内容包含：关键要点、详细摘要、相关概念
- 「相关概念」中引用所属文件夹枢纽
- 用 source-mtime 比对实现增量更新，跳过未变更文件

### 3. 概念枢纽
- 每个文件夹（≥2 文件）自动创建概念枢纽页面
- 枢纽作为文件夹的内容聚合点和图谱中心节点

### 4. 增量维护
- 维护前先检查 source-mtime，跳过未变更文件
- 只对新增或修改的文件调用 LLM 生成摘要
- 不重复读取已处理过的源文件内容

### 5. 用户笔记只读
- 绝不修改 summaries/、concepts/、index.md 以外的任何文件
- 发现矛盾或不一致记录到 log.md
- 所有页面用中文撰写`;

export class LlmWikiComponent {
  view: HomepageView;
  chatMessages: ChatMessage[] = [];
  isBuilding = false;
  buildProgress = "";
  buildLog: string[] = [];
  showApiKeyConfig = false;
  private _cachedApiKey: string | null = null;
  private _apiKeyLoaded = false;
  private _streamingIdx = -1;
  private _keepInputFocus = false;
  private orchestrator: AgentOrchestrator | null = null;

  constructor(view: HomepageView) {
    this.view = view;
  }

  private get settings() {
    return this.view.plugin.settings.llmWiki;
  }

  private get apiKey(): string {
    if (this._apiKeyLoaded) return this._cachedApiKey ?? "";

    const s = this.settings;
    if (s.apiKeyInKeychain) {
      this._cachedApiKey = loadApiKeyFromKeychain();
      this._apiKeyLoaded = true;
      return this._cachedApiKey ?? "";
    }

    if (s.apiKey) {
      const migrated = saveApiKeyToKeychain(s.apiKey);
      if (migrated) {
        this._cachedApiKey = s.apiKey;
        s.apiKeyInKeychain = true;
        s.apiKey = "";
        this.view.plugin.saveSettings().catch(console.error);
        this._apiKeyLoaded = true;
        return this._cachedApiKey ?? "";
      }
      this._cachedApiKey = s.apiKey;
      this._apiKeyLoaded = true;
      return this._cachedApiKey ?? "";
    }

    this._apiKeyLoaded = true;
    return "";
  }

  private getOrCreateOrchestrator(): AgentOrchestrator | null {
    if (!this.apiKey) return null;
    if (this.orchestrator) return this.orchestrator;

    const app = this.view.plugin.app;
    this.orchestrator = new AgentOrchestrator({
      vault: app.vault,
      wikiFolder: this.settings.wikiFolder,
      getApiKey: () => this.apiKey,
      apiEndpoint: this.settings.apiEndpoint,
      model: this.settings.model,
      getTodos: () => this.view.plugin.settings.todos,
      addTodo: (text, color, date, startTime, endTime) => {
        this.view.addTodo(text, color, date, startTime, endTime);
      },
      deleteTodo: (id) => {
        this.view.deleteTodo(id);
      },
      requestUrl: (opts) => requestUrl({ url: opts.url, method: opts.method }),
    });

    // Initialize in background
    this.orchestrator.initialize().catch(console.error);

    return this.orchestrator;
  }

  static setApiKey(key: string): boolean {
    if (!key) {
      deleteApiKeyFromKeychain();
      return true;
    }
    return saveApiKeyToKeychain(key);
  }

  static hasKeychainKey(): boolean {
    return loadApiKeyFromKeychain() !== null;
  }

  private addBuildLog(msg: string) {
    this.buildLog.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (this.buildLog.length > 100) this.buildLog.shift();
  }

  async render() {
    const card = this.view.containerEl.querySelector("#homepage-llmwiki-card");
    if (!card) return;
    this.closeLinkPopup();
    card.innerHTML = `
      <div style="display:flex;flex-direction:column;width:100%;height:100%;background:var(--background-primary);border-radius:14px;overflow:hidden;">
        <div id="llmwiki-toolbar" style="
          display:flex;align-items:center;justify-content:space-between;
          padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);
          flex-shrink:0;gap:8px;
        ">
          <span style="font-size:14px;font-weight:600;color:var(--text-normal);white-space:nowrap;">🤖 LLM Wiki</span>
          <div style="display:flex;gap:4px;align-items:center;">
            ${this.isBuilding ? `<span style="font-size:10px;color:var(--text-muted);">${escapeHtml(this.buildProgress)}</span>` : ""}
            ${this.settings.lastMaintenance ? `<span style="font-size:10px;color:var(--text-faint);">上次维护: ${escapeHtml(this.settings.lastMaintenance)}</span>` : ""}
            <button id="llmwiki-build-btn" style="
              background:transparent;border:1px solid var(--background-modifier-border);
              border-radius:4px;color:var(--text-muted);cursor:pointer;
              font-size:11px;padding:2px 6px;font-family:inherit;white-space:nowrap;
            " ${this.isBuilding ? "disabled" : ""}>🔄 维护</button>
            <button id="llmwiki-clear-btn" style="
              background:transparent;border:1px solid var(--background-modifier-border);
              border-radius:4px;color:var(--text-muted);cursor:pointer;
              font-size:11px;padding:2px 6px;font-family:inherit;white-space:nowrap;
            ">清空对话</button>
            <button id="llmwiki-settings-btn" style="
              background:${this.apiKey ? "transparent" : "var(--interactive-accent)"};
              border:1px solid ${this.apiKey ? "var(--background-modifier-border)" : "var(--interactive-accent)"};
              border-radius:4px;color:${this.apiKey ? "var(--text-muted)" : "var(--text-on-accent)"};
              cursor:pointer;font-size:11px;padding:2px 6px;font-family:inherit;white-space:nowrap;
            " title="配置 API Key">⚙ ${this.apiKey ? "" : "配置 Key"}</button>
          </div>
        </div>
        <div id="llmwiki-build-log" style="
          display:${this.buildLog.length > 0 ? "block" : "none"};
          max-height:80px;overflow-y:auto;padding:4px 12px;
          font-size:10px;color:var(--text-faint);font-family:monospace;
          border-bottom:1px solid var(--background-modifier-border);
        ">${this.buildLog.map(l => `<div>${escapeHtml(l)}</div>`).join("")}</div>
        ${this.showApiKeyConfig ? `
        <div id="llmwiki-config-panel" style="
          padding:10px 12px;border-bottom:1px solid var(--background-modifier-border);
          background:var(--background-secondary);display:flex;flex-direction:column;gap:8px;
        ">
          <div style="font-size:12px;font-weight:600;color:var(--text-normal);">⚙ 配置 API Key</div>
          <div style="font-size:11px;color:var(--text-muted);">
            Key 保存在 macOS 钥匙串中，不会明文写入配置文件。
          </div>
          <div style="display:flex;gap:6px;">
            <input id="llmwiki-key-input" type="password" placeholder="${this.apiKey ? "••••••••（输入新 Key 替换）" : "sk-..."}"
              style="
                flex:1;padding:6px 10px;border-radius:4px;
                border:1px solid var(--background-modifier-border);
                background:var(--background-primary);color:var(--text-normal);
                font-size:13px;outline:none;font-family:inherit;
              "
            />
          </div>
          <div style="display:flex;gap:6px;justify-content:flex-end;">
            <button id="llmwiki-key-clear-btn" style="
              background:transparent;border:1px solid var(--background-modifier-border);
              border-radius:4px;color:var(--text-muted);cursor:pointer;
              font-size:11px;padding:4px 10px;font-family:inherit;
              display:${this.apiKey ? "inline-block" : "none"};
            ">清除 Key</button>
            <button id="llmwiki-key-cancel-btn" style="
              background:transparent;border:1px solid var(--background-modifier-border);
              border-radius:4px;color:var(--text-muted);cursor:pointer;
              font-size:11px;padding:4px 10px;font-family:inherit;
            ">取消</button>
            <button id="llmwiki-key-save-btn" style="
              background:var(--interactive-accent);border:none;
              border-radius:4px;color:var(--text-on-accent);cursor:pointer;
              font-size:11px;padding:4px 12px;font-family:inherit;
            ">保存</button>
          </div>
        </div>
        ` : ""}
        <div id="llmwiki-chat" style="
          flex:1;overflow-y:auto;padding:12px;
          display:flex;flex-direction:column;gap:10px;
        ">
          <style>
            @keyframes llmwiki-pulse {
              0%, 100% { opacity: 0.4; }
              50% { opacity: 1; }
            }
            .llmwiki-activity {
              animation: llmwiki-pulse 1.5s ease-in-out infinite;
            }
            .llmwiki-popup-btn:hover {
              background: var(--background-modifier-hover) !important;
            }
          </style>
          ${this.chatMessages.filter(m => m.role !== "activity").length === 0 ? `
            <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:13px;text-align:center;line-height:1.8;">
              <div>
                <div style="font-size:32px;margin-bottom:8px;">🤖</div>
                <div>与你的知识库对话</div>
                <div style="font-size:11px;">基于你的笔记、待办和日程构建的 LLM Wiki</div>
                ${!this.apiKey ? `<div style="margin-top:8px;font-size:11px;color:var(--text-error);">⚠ 请先配置 DeepSeek API Key<br><button id="llmwiki-config-key-btn" style="margin-top:6px;padding:4px 12px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit;">⚙ 配置 API Key</button></div>` : ""}
                ${!this.settings.lastMaintenance ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted);">💡 点击"维护"按钮开始构建知识库</div>` : ""}
              </div>
            </div>
          ` : this.chatMessages.map((m, idx) => {
            const isStreaming = this._streamingIdx === idx;
            if (m.role === "activity") {
              return `
              <div class="llmwiki-activity" style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                <div style="
                  width:6px;height:6px;border-radius:50%;flex-shrink:0;
                  background:var(--interactive-accent);
                "></div>
                <span style="font-size:11px;color:var(--text-faint);">${escapeHtml(m.content)}</span>
              </div>`;
            }
            return `
            <div style="display:flex;gap:8px;${m.role === "user" ? "flex-direction:row-reverse;" : ""}">
              <div style="
                width:28px;height:28px;border-radius:50%;flex-shrink:0;
                display:flex;align-items:center;justify-content:center;
                font-size:14px;
                background:${m.role === "user" ? "var(--interactive-accent)" : "var(--background-modifier-hover)"};
              ">${m.role === "user" ? "👤" : "🤖"}</div>
              <div style="display:flex;flex-direction:column;max-width:75%;">
                <div${isStreaming ? ' id="llmwiki-streaming"' : ""} style="
                  padding:8px 12px;border-radius:10px;
                  font-size:13px;line-height:1.5;word-break:break-word;
                  background:${m.role === "user" ? "var(--interactive-accent)" : "var(--background-modifier-hover)"};
                  color:${m.role === "user" ? "var(--text-on-accent)" : "var(--text-normal)"};
                  border-radius:${m.role === "user" ? "10px 10px 4px 10px" : "10px 10px 10px 4px"};
                ">${isStreaming ? escapeHtml(m.content) : this.formatMessage(m.content)}</div>
                ${m.role === "assistant" && !isStreaming ? `
                <button class="llmwiki-copy-btn" data-content="${escapeHtml(m.content).replace(/"/g, "&quot;")}" style="
                  align-self:flex-start;margin-top:2px;
                  padding:2px 8px;border:1px solid var(--background-modifier-border);
                  border-radius:4px;background:transparent;color:var(--text-faint);
                  cursor:pointer;font-size:11px;font-family:inherit;
                ">📋 复制</button>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>
        <div id="llmwiki-input-area" style="
          padding:8px 12px;border-top:1px solid var(--background-modifier-border);
          display:flex;gap:8px;flex-shrink:0;
        ">
          <input id="llmwiki-chat-input" type="text" placeholder="${this.apiKey ? "输入消息..." : "请先配置 API Key..."}"
            ${!this.apiKey ? "disabled" : ""}
            style="
              flex:1;padding:6px 10px;border-radius:6px;
              border:1px solid var(--background-modifier-border);
              background:var(--background-primary);color:var(--text-normal);
              font-size:13px;outline:none;font-family:inherit;
            "
          />
          <button id="llmwiki-send-btn" style="
            padding:6px 14px;border:none;border-radius:6px;
            background:var(--interactive-accent);color:var(--text-on-accent);
            cursor:pointer;font-size:13px;font-family:inherit;
          " ${!this.apiKey ? "disabled" : ""}>发送</button>
        </div>
      </div>
    `;

    this.bindEvents();
    this.scrollChatToBottom();
    if (this._keepInputFocus) {
      this._keepInputFocus = false;
      this.refocusInput();
    }
  }

  private refocusInput() {
    const input = this.view.containerEl.querySelector("#llmwiki-chat-input") as HTMLInputElement;
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }

  private bindEvents() {
    const card = this.view.containerEl.querySelector("#homepage-llmwiki-card");
    if (!card) return;

    const toggleConfig = () => {
      this.showApiKeyConfig = !this.showApiKeyConfig;
      this.render();
    };

    card.querySelector("#llmwiki-build-btn")?.addEventListener("click", () => this.buildWiki());
    card.querySelector("#llmwiki-clear-btn")?.addEventListener("click", () => {
      this.chatMessages = [];
      this.render();
    });
    card.querySelector("#llmwiki-settings-btn")?.addEventListener("click", () => toggleConfig());
    card.querySelector("#llmwiki-config-key-btn")?.addEventListener("click", () => toggleConfig());

    // Config panel buttons
    card.querySelector("#llmwiki-key-save-btn")?.addEventListener("click", async () => {
      const keyInput = card.querySelector("#llmwiki-key-input") as HTMLInputElement;
      if (!keyInput) return;
      const key = keyInput.value.trim();
      if (!key) return;

      const ok = saveApiKeyToKeychain(key);
      if (ok) {
        this.view.plugin.settings.llmWiki.apiKeyInKeychain = true;
        this.view.plugin.settings.llmWiki.apiKey = "";
      } else {
        this.view.plugin.settings.llmWiki.apiKey = key;
        this.view.plugin.settings.llmWiki.apiKeyInKeychain = false;
      }
      await this.view.plugin.saveSettings();
      this._cachedApiKey = key;
      this._apiKeyLoaded = true;
      // Reset orchestrator when key changes
      this.orchestrator = null;
      this.showApiKeyConfig = false;
      this.render();
    });

    card.querySelector("#llmwiki-key-cancel-btn")?.addEventListener("click", () => {
      this.showApiKeyConfig = false;
      this.render();
    });

    card.querySelector("#llmwiki-key-clear-btn")?.addEventListener("click", async () => {
      deleteApiKeyFromKeychain();
      this.view.plugin.settings.llmWiki.apiKeyInKeychain = false;
      this.view.plugin.settings.llmWiki.apiKey = "";
      await this.view.plugin.saveSettings();
      this._cachedApiKey = null;
      this._apiKeyLoaded = true;
      this.orchestrator = null;
      this.showApiKeyConfig = false;
      this.render();
    });

    const keyInputForKeydown = card.querySelector("#llmwiki-key-input") as HTMLInputElement | null;
    keyInputForKeydown?.addEventListener("keydown", ((e: KeyboardEvent) => {
      if (e.key === "Enter") {
        (card.querySelector("#llmwiki-key-save-btn") as HTMLElement)?.click();
      }
    }) as EventListener);

    card.querySelector("#llmwiki-send-btn")?.addEventListener("click", () => this.handleSend());
    const input = card.querySelector("#llmwiki-chat-input") as HTMLInputElement;
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Delegated click for links and copy buttons in chat messages
    const chatEl = card.querySelector("#llmwiki-chat") as HTMLElement;
    chatEl?.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const copyBtn = target.closest(".llmwiki-copy-btn") as HTMLElement | null;
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const content = copyBtn.dataset.content || "";
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.textContent = "✅ 已复制";
          setTimeout(() => { copyBtn.textContent = "📋 复制"; }, 1500);
        }).catch(() => {
          copyBtn.textContent = "❌ 失败";
          setTimeout(() => { copyBtn.textContent = "📋 复制"; }, 1500);
        });
        return;
      }
      const link = (e.target as HTMLElement).closest(".llmwiki-link") as HTMLElement | null;
      if (!link) { this.closeLinkPopup(); return; }
      e.preventDefault();
      e.stopPropagation();
      const url = link.dataset.url || "";
      this.showLinkPopup(link, url);
    });
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".llmwiki-link") || target.closest("#llmwiki-link-popup")) return;
      this.closeLinkPopup();
    });
  }

  private showLinkPopup(anchor: HTMLElement, url: string) {
    this.closeLinkPopup();
    const popup = document.createElement("div");
    popup.id = "llmwiki-link-popup";
    const rect = anchor.getBoundingClientRect();
    popup.style.cssText = `
      position:fixed;z-index:9999;
      left:${rect.left}px;top:${rect.bottom + 4}px;
      background:var(--background-primary);
      border:1px solid var(--background-modifier-border);
      border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.18);
      display:flex;flex-direction:column;padding:4px;
      min-width:150px;
    `;
    popup.innerHTML = `
      <button class="llmwiki-popup-btn" data-action="copy" style="
        padding:6px 12px;border:none;background:transparent;color:var(--text-normal);
        cursor:pointer;text-align:left;border-radius:4px;font-size:13px;font-family:inherit;
        display:flex;align-items:center;gap:8px;
      ">📋 复制链接</button>
      <button class="llmwiki-popup-btn" data-action="open" style="
        padding:6px 12px;border:none;background:transparent;color:var(--text-normal);
        cursor:pointer;text-align:left;border-radius:4px;font-size:13px;font-family:inherit;
        display:flex;align-items:center;gap:8px;
      ">🌐 在浏览器中打开</button>
    `;
    document.body.appendChild(popup);

    popup.querySelector("[data-action=copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      this.closeLinkPopup();
    });
    popup.querySelector("[data-action=open]")?.addEventListener("click", () => {
      window.open(url, "_blank");
      this.closeLinkPopup();
    });

    const popRect = popup.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) popup.style.left = `${window.innerWidth - popRect.width - 8}px`;
    if (popRect.bottom > window.innerHeight - 8) popup.style.top = `${rect.top - popRect.height - 4}px`;
  }

  private closeLinkPopup() {
    const existing = document.getElementById("llmwiki-link-popup");
    if (existing) existing.remove();
  }

  private formatMessage(content: string): string {
    let html = content
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Phase 0: Strip markdown tables — convert to list format
    // Tables render with bugs (content overlaps), so we detect and convert them.
    html = html.replace(/\n(\|[^\n]+\|[\s\S]*?)(?=\n\n|\n(?!\|)|\n*$)/g, (tableBlock) => {
      const lines = tableBlock.trim().split("\n").filter(l => l.trim());
      if (lines.length < 2) return tableBlock; // need at least header + separator

      // Check if it has a separator line (| --- | --- |)
      const hasSeparator = lines.some(l => /^\|[\s:-]+\|/.test(l));
      if (!hasSeparator) return tableBlock;

      // Extract header and data rows
      const dataLines = lines.filter(l => !/^\|[\s:-]+\|/.test(l));
      if (dataLines.length === 0) return tableBlock;

      const headerCells = dataLines[0].split("|").map(c => c.trim()).filter(c => c);
      const rows = dataLines.slice(1).map(line =>
        line.split("|").map(c => c.trim()).filter(c => c)
      );

      if (headerCells.length === 0) return tableBlock;

      // Convert to list format
      const out: string[] = [];
      for (const row of rows) {
        const parts: string[] = [];
        for (let i = 0; i < Math.min(headerCells.length, row.length); i++) {
          parts.push(`**${headerCells[i]}**: ${row[i]}`);
        }
        out.push(`- ${parts.join("，")}`);
      }
      return "\n" + out.join("\n") + "\n";
    });

    // Also strip any remaining separator-only lines (|---|...|) that weren't caught
    html = html.replace(/\n\|[\s:-|]+\|\n/g, "\n");

    // Phase 1: Extract code blocks
    const codeBlocks: string[] = [];
    html = html.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_m, _lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre style="background:var(--background-primary-alt);padding:10px 12px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.5;margin:6px 0;"><code>${code.trim()}</code></pre>`);
      return `%%CODEBLOCK_${idx}%%`;
    });

    // Phase 2: Block-level elements
    const lines = html.split("\n");
    const out: string[] = [];
    let inList = false;
    let listType = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        if (inList) { out.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
        const level = hMatch[1].length;
        const sizes = ["", "18px", "16px", "14px", "13px", "12px", "11px"];
        out.push(`<h${level} style="font-size:${sizes[level]};font-weight:600;margin:8px 0 4px;color:var(--text-normal);">${hMatch[2]}</h${level}>`);
        continue;
      }

      if (/^[-*_]{3,}\s*$/.test(line)) {
        if (inList) { out.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
        out.push('<hr style="border:none;border-top:1px solid var(--background-modifier-border);margin:8px 0;">');
        continue;
      }

      if (line.startsWith("> ")) {
        if (inList) { out.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
        out.push(`<blockquote style="border-left:3px solid var(--interactive-accent);margin:4px 0;padding:2px 10px;color:var(--text-muted);">${line.replace(/^> /, "")}</blockquote>`);
        continue;
      }

      const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
      if (ulMatch) {
        if (!inList || listType !== "ul") {
          if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
          out.push('<ul style="margin:4px 0;padding-left:18px;">');
          inList = true; listType = "ul";
        }
        out.push(`<li style="margin:2px 0;">${ulMatch[2]}</li>`);
        continue;
      }

      const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
      if (olMatch) {
        if (!inList || listType !== "ol") {
          if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
          out.push('<ol style="margin:4px 0;padding-left:18px;">');
          inList = true; listType = "ol";
        }
        out.push(`<li style="margin:2px 0;">${olMatch[2]}</li>`);
        continue;
      }

      if (inList && line.trim() === "") {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
        out.push("<br>");
        continue;
      }
      if (inList && line.trim() !== "") {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }

      if (line.trim() === "") {
        out.push("<br>");
      } else {
        out.push(line);
      }
    }
    if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
    html = out.join("\n");

    // Phase 3: Inline elements
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="llmwiki-link" data-url="$2" style="color:var(--interactive-accent);text-decoration:underline;cursor:pointer;">$1</span>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--background-primary-alt);padding:1px 5px;border-radius:3px;font-size:12px;">$1</code>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Phase 4: Restore code blocks
    html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => codeBlocks[parseInt(idx)]);

    return html;
  }

  // ── Message Handling (delegates to orchestrator) ──────────

  private async handleSend() {
    const input = this.view.containerEl.querySelector("#llmwiki-chat-input") as HTMLInputElement;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    const orch = this.getOrCreateOrchestrator();
    if (!orch) {
      this.chatMessages.push({ role: "assistant", content: "❌ 请先配置 API Key", timestamp: Date.now() });
      this.render();
      return;
    }

    const ts = Date.now();
    this.chatMessages.push({ role: "user", content: text, timestamp: ts });
    this._keepInputFocus = true;
    this.render();

    try {
      // Activity: analyzing
      this.showActivity("正在分析你的问题...");

      // Build chat history for LLM context
      const history = this.chatMessages
        .filter(m => m.role !== "activity")
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      // Add streaming assistant bubble
      this.chatMessages.push({ role: "assistant", content: "", timestamp: Date.now() });
      this._streamingIdx = this.chatMessages.length - 1;
      this.render();

      const { response } = await orch.process(
        text,
        history,
        // onStream: update DOM with markdown rendering
        (content) => {
          const msg = this.chatMessages[this._streamingIdx];
          if (msg) msg.content = content;
          requestAnimationFrame(() => {
            const el = this.view.containerEl.querySelector("#llmwiki-streaming");
            if (el) {
              el.innerHTML = this.formatMessage(content);
              const chat = this.view.containerEl.querySelector("#llmwiki-chat");
              if (chat) chat.scrollTop = chat.scrollHeight;
            }
          });
        },
        // onActivity: show what the orchestrator is doing
        (msg) => {
          this.showActivity(msg);
        },
      );

      // Clear activity, finalize content
      this.clearActivity();
      this._streamingIdx = -1;
      const msg = this.chatMessages[this.chatMessages.length - 1];
      if (msg && msg.role === "assistant") msg.content = response;

      await this.appendChatLog(text, response);
    } catch (e: any) {
      this.clearActivity();
      // Remove empty assistant bubble
      this.chatMessages = this.chatMessages.filter(
        m => !(m.role === "assistant" && m.content === "" && m.timestamp > ts - 1000)
      );
      this.chatMessages.push({ role: "assistant", content: `❌ 错误: ${e.message}`, timestamp: Date.now() });
    }
    this._keepInputFocus = true;
    this.render();
  }

  private showActivity(text: string) {
    this.clearActivity();
    this.chatMessages.push({ role: "activity", content: text, timestamp: Date.now() });
    this._keepInputFocus = true;
    this.render();
  }

  private clearActivity() {
    // Adjust _streamingIdx for messages removed before it
    if (this._streamingIdx >= 0) {
      const removed = this.chatMessages
        .slice(0, this._streamingIdx)
        .filter(m => m.role === "activity").length;
      this._streamingIdx -= removed;
    }
    this.chatMessages = this.chatMessages.filter(m => m.role !== "activity");
  }

  // ── Chat Log Persistence ─────────────────────────────────

  private chatLogPath(): string {
    return `${this.settings.wikiFolder}/chat-log.md`;
  }

  private async appendChatLog(userMsg: string, assistantMsg: string) {
    const vault = this.view.plugin.app.vault;
    const path = this.chatLogPath();
    const now = new Date();
    const ts = now.toISOString();
    const entry = `\n## [${ts}] 用户\n${userMsg}\n\n## [${ts}] Agent\n${assistantMsg}\n`;

    const allFiles = vault.getFiles();
    const logFile = allFiles.find(f => f.path === path);
    if (logFile) {
      await vault.append(logFile, entry);
    } else {
      await this.ensureWikiDir(this.settings.wikiFolder);
      await vault.create(path, `# 对话记录\n\n> 这些对话将在下次知识库维护时被消化，然后清空。\n${entry}`);
    }
  }

  private async readChatLog(): Promise<string> {
    const vault = this.view.plugin.app.vault;
    const path = this.chatLogPath();
    const allFiles = vault.getFiles();
    const logFile = allFiles.find(f => f.path === path);
    if (!logFile) return "";
    try { return await vault.read(logFile); } catch { return ""; }
  }

  private async clearChatLog() {
    const vault = this.view.plugin.app.vault;
    const path = this.chatLogPath();
    const allFiles = vault.getFiles();
    const logFile = allFiles.find(f => f.path === path);
    if (logFile) {
      await vault.modify(logFile, `# 对话记录\n\n> 上次消化时间: ${new Date().toLocaleString("zh-CN")}\n> 等待新对话...\n`);
    }
  }

  // ── Wiki Building ─────────────────────────────────────────

  async buildWiki() {
    if (this.isBuilding) return;
    this.isBuilding = true;
    this.buildLog = [];
    this.buildProgress = "正在扫描笔记...";
    this.addBuildLog("开始维护知识库");
    this.render();

    try {
      const vault = this.view.plugin.app.vault;
      const wikiFolder = this.settings.wikiFolder;
      const allFiles = vault.getFiles();

      const excludeDirs = [".obsidian", ".trash", ".git", wikiFolder, "_attachments", "assets"];
      const noteFiles = allFiles.filter(f => {
        if (f.extension !== "md") return false;
        for (const dir of excludeDirs) {
          if (f.path.startsWith(dir + "/") || f.path === dir) return false;
        }
        return true;
      });

      const chatLog = await this.readChatLog();
      const hasChatLog = chatLog.length > 100;

      await this.ensureWikiDir(`${wikiFolder}/summaries`);
      await this.ensureWikiDir(`${wikiFolder}/concepts`);

      const schemaPath = `${wikiFolder}/SCHEMA.md`;
      if (!allFiles.some(f => f.path === schemaPath)) {
        await vault.create(schemaPath, WIKI_SCHEMA);
        this.addBuildLog("已创建 SCHEMA.md");
      }

      const total = noteFiles.length;
      let processed = 0;

      for (const file of noteFiles) {
        processed++;
        this.buildProgress = `处理笔记 ${processed}/${total}: ${file.name}`;
        this.addBuildLog(`[${processed}/${total}] ${file.path}`);
        this.render();

        try {
          const summaryPath = `${wikiFolder}/summaries/${this.sanitizeFileName(file.name)}`;
          const existingSummaryFile = allFiles.find(f => f.path === summaryPath);

          // Check mtime BEFORE reading full source — skip unchanged files
          if (existingSummaryFile) {
            const frontMatter = await vault.read(existingSummaryFile);
            if (frontMatter.includes(`source-mtime: ${file.stat.mtime}`)) {
              this.addBuildLog(`  跳过(未变更)`);
              continue;
            }
          }

          const content = await vault.read(file);
          if (content.trim().length === 0) {
            this.addBuildLog(`  跳过(空文件)`);
            continue;
          }

          const summary = await this.generateSummary(file.path, content, file.stat.mtime);
          if (existingSummaryFile) {
            await vault.modify(existingSummaryFile, summary);
          } else {
            await vault.create(summaryPath, summary);
          }
          this.addBuildLog(`  ✅ 已生成摘要: ${summaryPath}`);
        } catch (e: any) {
          this.addBuildLog(`  ❌ 失败: ${e.message}`);
        }

        if (processed < total) {
          await this.delay(500);
        }
      }

      // Create topic hub nodes — group summaries by source directory,
      // create concept hub pages that link all related pages together,
      // and update summaries to reference their hub
      this.buildProgress = "创建主题枢纽节点...";
      this.addBuildLog("创建主题枢纽节点 ...");
      this.render();
      await this.createTopicHubs(wikiFolder, noteFiles);
      this.addBuildLog("  ✅ 主题枢纽节点已创建");

      // Generate index
      this.buildProgress = "生成索引...";
      this.addBuildLog("生成 index.md ...");
      this.render();
      const refreshedFiles = vault.getFiles();
      const summaries = refreshedFiles.filter(f =>
        f.path.startsWith(`${wikiFolder}/summaries/`) && f.extension === "md"
      );
      const indexContent = await this.generateIndex(summaries);
      const indexPath = `${wikiFolder}/index.md`;
      const existingIndex = refreshedFiles.find(f => f.path === indexPath);
      if (existingIndex) {
        await vault.modify(existingIndex, indexContent);
      } else {
        await vault.create(indexPath, indexContent);
      }

      // Generate overview
      this.buildProgress = "生成总览...";
      this.addBuildLog("生成 overview.md ...");
      this.render();
      const todoCtx = this.formatTodoData();
      const overviewContent = await this.generateOverview(summaries, noteFiles, todoCtx, chatLog);
      const overviewPath = `${wikiFolder}/overview.md`;
      const existingOverview = refreshedFiles.find(f => f.path === overviewPath);
      if (existingOverview) {
        await vault.modify(existingOverview, overviewContent);
      } else {
        await vault.create(overviewPath, overviewContent);
      }

      // Generate user profile from chat log
      if (hasChatLog) {
        this.buildProgress = "更新用户画像...";
        this.addBuildLog("生成 用户画像.md ...");
        this.render();
        try {
          const profileContent = await this.generateUserProfile(chatLog);
          const profilePath = `${wikiFolder}/concepts/用户画像.md`;
          const refreshedAgain2 = vault.getFiles();
          const existingProfile = refreshedAgain2.find(f => f.path === profilePath);
          if (existingProfile) {
            await vault.modify(existingProfile, profileContent);
          } else {
            await vault.create(profilePath, profileContent);
          }
          this.addBuildLog("  ✅ 已更新用户画像");
        } catch (e: any) {
          this.addBuildLog(`  ⚠ 用户画像失败: ${e.message}`);
        }
      }

      // Update log
      this.addBuildLog("更新 log.md ...");
      await this.appendLog(wikiFolder, `维护完成 — 处理 ${processed} 篇笔记，${summaries.length} 个摘要，${this.view.plugin.settings.todos.length} 条待办${hasChatLog ? "，" + chatLog.split("\n").filter(l => l.startsWith("## [")).length + " 条对话" : ""}`);

      // Clear chat log
      if (hasChatLog) {
        await this.clearChatLog();
        this.addBuildLog("已清空对话记录");
      }

      // Delete temporary todo page
      const todoPagePath = `${wikiFolder}/concepts/待办与日程.md`;
      const finalFiles = vault.getFiles();
      const todoPage = finalFiles.find(f => f.path === todoPagePath);
      if (todoPage) {
        await vault.delete(todoPage);
        this.addBuildLog("已删除临时待办页面");
      }

      // Rebuild vector index for semantic search
      if (this.orchestrator) {
        this.buildProgress = "重建向量索引...";
        this.addBuildLog("重建向量索引...");
        this.render();
        await this.orchestrator.rebuildVectorIndex();
        this.addBuildLog("  ✅ 向量索引已更新");
      }

      // Save last maintenance time
      const now = new Date();
      this.settings.lastMaintenance = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      await this.view.plugin.saveSettings();

      this.buildProgress = "维护完成";
      this.addBuildLog("✅ 知识库维护完成");
    } catch (e: any) {
      this.addBuildLog(`❌ 维护失败: ${e.message}`);
      this.buildProgress = "维护失败";
    } finally {
      this.isBuilding = false;
      this.render();
    }
  }

  private formatTodoData(): string {
    const todos = this.view.plugin.settings.todos;
    if (todos.length === 0) return "";

    const totalCount = todos.length;
    const doneCount = todos.filter(t => t.done).length;
    const pendingCount = totalCount - doneCount;
    const completionRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    const priorityLabels: Record<string, string> = {
      "#e53935": "高", "#fb8c00": "中高", "#fdd835": "中", "#43a047": "低",
    };
    const byPriority: Record<string, { label: string; total: number; done: number }> = {};
    for (const t of todos) {
      const key = t.color || "未知";
      if (!byPriority[key]) byPriority[key] = { label: priorityLabels[key] || "未知", total: 0, done: 0 };
      byPriority[key].total++;
      if (t.done) byPriority[key].done++;
    }

    const dateMap: Record<string, { total: number; done: number; items: string[] }> = {};
    for (const t of todos) {
      if (!dateMap[t.date]) dateMap[t.date] = { total: 0, done: 0, items: [] };
      dateMap[t.date].total++;
      if (t.done) dateMap[t.date].done++;
      dateMap[t.date].items.push(`[${t.done ? "✅" : "⬜"}] ${t.text}${t.startTime ? ` (${t.startTime}${t.endTime ? `-${t.endTime}` : ""})` : ""} [${priorityLabels[t.color] || "?"}]`);
    }

    const sortedDates = Object.keys(dateMap).sort().reverse().slice(0, 30);
    const dateDetails = sortedDates.map(d => {
      const s = dateMap[d];
      const rate = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
      return `### ${d} (${s.done}/${s.total} 完成率 ${rate}%)\n${s.items.map(i => `- ${i}`).join("\n")}`;
    }).join("\n\n");

    const pending = todos.filter(t => !t.done).sort((a, b) => a.date.localeCompare(b.date));
    const pendingList = pending.length > 0
      ? `\n## 未完成待办 (${pending.length} 条)\n${pending.slice(0, 50).map(t => `- [${priorityLabels[t.color] || "?"}] ${t.text} (创建: ${t.date}${t.startTime ? `, ${t.startTime}${t.endTime ? `-${t.endTime}` : ""}` : ""})`).join("\n")}`
      : "";

    return `# 待办与日程数据

## 统计概览
- 总待办数: ${totalCount}
- 已完成: ${doneCount} (${completionRate}%)
- 未完成: ${pendingCount}

## 按优先级统计
${Object.values(byPriority).map(p => `- ${p.label}: ${p.total} 条 (完成 ${p.done}/${p.total})`).join("\n")}

## 最近日期详情
${dateDetails}
${pendingList}`;
  }

  // ── Topic Hub Creation ───────────────────────────────────

  private async createTopicHubs(wikiFolder: string, noteFiles: any[]) {
    const vault = this.view.plugin.app.vault;
    const allFiles = vault.getFiles();

    // Group notes by top-level source directory (e.g. "编译原理/")
    const dirGroups: Map<string, Array<{ path: string; name: string }>> = new Map();
    for (const f of noteFiles) {
      const slashIdx = f.path.indexOf("/");
      if (slashIdx === -1) continue; // root-level files, skip
      const dir = f.path.substring(0, slashIdx);
      if (!dirGroups.has(dir)) dirGroups.set(dir, new Array());
      dirGroups.get(dir)!.push({ path: f.path, name: f.name.replace(/\.md$/, "") });
    }

    for (const [dir, files] of dirGroups) {
      if (files.length < 2) continue; // skip single-file dirs

      const hubName = dir;
      const hubPath = `${wikiFolder}/concepts/${this.sanitizeFileName(hubName)}.md`;

      const summaryPaths = files.map(f =>
        `${wikiFolder}/summaries/${this.sanitizeFileName(f.name + ".md")}`
      );

      // Build source list and summary list for the hub page
      const sourceList = files.map(f => `- [[${f.path}|${f.name}]]`).join("\n");
      const summaryList = summaryPaths.map((sp, i) =>
        `- [[${sp}|${files[i].name} 摘要]]`
      ).join("\n");

      try {
        const hubContent = await this.generateHubPage(hubName, sourceList, summaryList, files.length);
        const existingHub = allFiles.find(f => f.path === hubPath);
        if (existingHub) {
          await vault.modify(existingHub, hubContent);
        } else {
          await vault.create(hubPath, hubContent);
        }
        this.addBuildLog(`  ✅ 枢纽: ${hubName} (${files.length} 个文件)`);

        // Update each summary to reference the hub
        for (const sp of summaryPaths) {
          const sf = allFiles.find(f => f.path === sp);
          if (!sf) continue;
          try {
            let content = await vault.read(sf);
            if (!content.includes(`[[${hubName}]]`)) {
              if (content.includes("## 相关概念")) {
                content = content.replace("## 相关概念", `## 相关概念\n- [[${hubName}]]`);
              } else {
                content += `\n## 相关概念\n- [[${hubName}]]\n`;
              }
              await vault.modify(sf, content);
            }
          } catch { /* skip unmodifiable */ }
        }
      } catch (e: any) {
        this.addBuildLog(`  ⚠ 枢纽 ${hubName} 创建失败: ${e.message}`);
      }
    }
  }

  private async generateHubPage(hubName: string, sourceList: string, summaryList: string, fileCount: number): Promise<string> {
    const today = new Date().toISOString().split("T")[0];
    const systemPrompt = `你是知识库维护者。为"${hubName}"创建概念枢纽页面。

这个页面作为知识图谱的中心枢纽节点，连接 index 和所有 ${hubName} 相关内容。

格式：
---
date: ${today}
tags: [${hubName}, 枢纽]
---

# ${hubName}

## 概述
（2-3句描述 ${hubName} 涵盖的主题范围）

## 源笔记
${sourceList}

## Wiki 摘要
${summaryList}

## 核心概念
（用 [[概念名]] 格式列出该主题下的核心概念，每个概念一行）

规则：
- 所有链接使用 [[完整路径|显示名]] 格式，路径含 .md 后缀
- 中文撰写，简洁
- 只输出页面内容`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `为"${hubName}"主题创建枢纽页面，该主题下有 ${fileCount} 个文件。` },
    ];

    return this.callDeepSeek(messages);
  }

  // ── LLM API helpers (used during buildWiki) ───────────────

  private async generateSummary(filePath: string, content: string, fileMtime: number): Promise<string> {
    const truncated = content.length > 8000 ? content.substring(0, 8000) + "\n...(内容已截断)" : content;
    const systemPrompt = `你是知识库维护者。为以下笔记生成摘要页面。

格式要求：
---
source: ${filePath}
source-mtime: ${fileMtime}
date: ${new Date().toISOString().split("T")[0]}
tags: [标签1, 标签2]
---

# 摘要: ${filePath.split("/").pop()?.replace(/\.md$/, "")}

## 关键要点
- 要点1
- 要点2

## 详细摘要
...

## 相关概念
- 概念1
- 概念2

请用中文撰写，保持简洁。只输出摘要页面内容，不要额外解释。`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `笔记内容:\n\n${truncated}` },
    ];

    return this.callDeepSeek(messages);
  }

  private async generateIndex(summaries: any[]): Promise<string> {
    const sampleSummaries: Array<{ path: string; firstLines: string }> = [];
    for (const f of summaries.slice(0, 20)) {
      try {
        const c = await this.view.plugin.app.vault.read(f);
        sampleSummaries.push({ path: f.path, firstLines: c.substring(0, 500) });
      } catch { /* skip */ }
    }

    // Build folder grouping info for the prompt
    const folderGroups: Map<string, string[]> = new Map();
    for (const s of summaries) {
      try {
        const c = await this.view.plugin.app.vault.read(s);
        const srcMatch = c.match(/^source:\s*(.+)$/m);
        if (srcMatch) {
          const src = srcMatch[1].trim();
          const slashIdx = src.indexOf("/");
          const folder = slashIdx > -1 ? src.substring(0, slashIdx) : "(root)";
          if (!folderGroups.has(folder)) folderGroups.set(folder, []);
          folderGroups.get(folder)!.push(src);
        }
      } catch { /* skip */ }
    }

    // Build concept hub list
    const refreshedAll = this.view.plugin.app.vault.getFiles();
    const conceptFiles = refreshedAll.filter(f =>
      f.path.startsWith(`${this.settings.wikiFolder}/concepts/`) && f.extension === "md"
    );
    const conceptList = conceptFiles.map(c => `- [[${c.path}|${c.name.replace(/\.md$/, "")}]]`).join("\n");

    const folderEntries: string[] = [];
    for (const [folder, files] of folderGroups) {
      const conceptRef = conceptFiles.some(c => c.name.replace(/\.md$/, "") === folder)
        ? `- 概念枢纽: [[${this.settings.wikiFolder}/concepts/${folder}.md|${folder}]]`
        : "";
      const fileItems = [...new Set(files)].sort().map(f =>
        `- [[${f}|${f.split("/").pop()!.replace(/\.md$/, "")}]]`
      ).join("\n");
      folderEntries.push(`### 📁 ${folder}/ (${files.length} 个文件)\n${conceptRef}\n${fileItems}`);
    }

    const systemPrompt = `你是知识库维护者。生成 index.md（知识库目录）。

## 核心规则：文件夹层级拓扑

知识库按文件夹层级组织。图谱连接规则是 index → 文件夹 → 内容，不可成环。

1. 每个文件夹作为独立主题分类
2. 如果有对应的概念枢纽页面（concepts/ 目录下同名文件），用 [[路径|显示名]] 引用它
3. 每个文件夹下列出该文件夹包含的所有笔记（用 [[完整路径|显示名]] 格式）
4. 根目录文件单独列出

格式:
# 知识库目录

## 概述
（一句话描述知识库覆盖的主题范围）

## 主题分类

### 📁 文件夹名/ (N 个文件)
- 概念枢纽: [[llm-wiki/concepts/文件夹名|文件夹名]]
- [[路径/文件名.md|显示名]]
...

### 根目录 (N 个文件)
- [[文件名.md|显示名]]

## 统计
- 总笔记数: X
- 文件夹数: X
- 概念数: X
- 最后更新: ${new Date().toLocaleDateString("zh-CN")}

只输出 index.md 内容。所有 wikilink 路径必须含 .md 后缀。`;

    const folderContext = folderEntries.join("\n\n");
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `文件夹结构:\n\n${folderContext}\n\n概念页面:\n${conceptList}\n\n摘要预览:\n${sampleSummaries.map(s => `### ${s.path}\n${s.firstLines}`).join("\n\n").substring(0, 6000)}` },
    ];

    return this.callDeepSeek(messages);
  }

  private async generateOverview(summaries: any[], noteFiles: any[], todoData: string, chatLog: string): Promise<string> {
    const sampleSummaries: string[] = [];
    for (const f of summaries.slice(0, 15)) {
      try {
        const c = await this.view.plugin.app.vault.read(f);
        sampleSummaries.push(c.substring(0, 600));
      } catch { /* skip */ }
    }

    const hasChatLog = chatLog.length > 100;

    // Build folder summary
    const folderMap = new Map<string, number>();
    for (const f of noteFiles) {
      const slashIdx = f.path.indexOf("/");
      const folder = slashIdx > -1 ? f.path.substring(0, slashIdx) : "(root)";
      folderMap.set(folder, (folderMap.get(folder) || 0) + 1);
    }
    const folderSummary = [...folderMap.entries()].map(([f, c]) => `- 📁 ${f}/ (${c} 篇)`).join("\n");

    const conceptFiles = this.view.plugin.app.vault.getFiles().filter(f =>
      f.path.startsWith(`${this.settings.wikiFolder}/concepts/`) && f.extension === "md"
    );

    const systemPrompt = `你是知识库维护者。生成 overview.md（知识库总览）。

知识库采用文件夹层级拓扑组织：index → 文件夹枢纽 → 内容，单向 DAG。

格式:
# 知识库总览

## 知识领域
（基于文件夹结构和笔记内容，列出主要知识领域）

## 文件结构
${folderSummary}
- 概念枢纽: ${conceptFiles.length} 个

## 笔记概况
- 总笔记数: ${noteFiles.length}
- 总摘要数: ${summaries.length}
${hasChatLog ? "\n## 近期对话洞察\n（从最近的用户对话中提炼关键主题和关注点）" : ""}

## 主题地图
（描述各文件夹/领域之间的关系）

## 更新信息
- 最后维护: ${new Date().toLocaleString("zh-CN")}

中文撰写。只输出 overview.md 内容。`;

    const chatSection = hasChatLog ? `\n\n近期对话记录:\n${chatLog.substring(0, 5000)}` : "";
    const userContent = `摘要内容:\n\n${sampleSummaries.join("\n\n---\n\n").substring(0, 5000)}\n\n${todoData.substring(0, 3000)}${chatSection}`;
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userContent },
    ];

    return this.callDeepSeek(messages);
  }

  private async generateUserProfile(chatLog: string): Promise<string> {
    const wikiFolder = this.settings.wikiFolder;
    const vault = this.view.plugin.app.vault;
    const existingPath = `${wikiFolder}/concepts/用户画像.md`;
    const allFiles = vault.getFiles();
    const existingFile = allFiles.find(f => f.path === existingPath);
    let existingProfile = "";
    if (existingFile) {
      try { existingProfile = await vault.read(existingFile); } catch { /* */ }
    }

    const systemPrompt = `你是用户画像分析师。根据最近的对话记录，更新用户画像。

## 现有画像
${existingProfile || "（尚无画像）"}

## 画像格式
---
date: ${new Date().toISOString().split("T")[0]}
type: profile
---

# 用户画像

## 基本信息
- 称呼/名字
- 角色/职业
- 时区/地点

## 兴趣与关注领域
- 领域1: 说明
- 领域2: 说明

## 工作习惯
- 习惯1
- 习惯2

## 常用工具与技术栈
- 工具1
- 工具2

## 沟通偏好
- 偏好1
- 偏好2

## 近期动态
（根据最近对话提炼）

## 待跟进事项
（用户提到但尚未完成的事情）

## 更新信息
- 最后更新: ${new Date().toLocaleString("zh-CN")}

## 规则
1. 如果现有画像中已有信息，保留并补充新的洞察
2. 从对话中提取隐含信息（用户提到的问题领域、使用习惯等）
3. 不要编造信息，只基于对话内容推断
4. 如果对话中没有某类信息，该栏位写"暂无信息"
5. 用中文撰写
6. 只输出画像页面内容，不要额外解释`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `最近对话记录:\n\n${chatLog.substring(0, 12000)}` },
    ];

    return this.callDeepSeek(messages);
  }

  private async callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
    const endpoint = this.settings.apiEndpoint.replace(/\/$/, "");
    const body = {
      model: this.settings.model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    };

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API 请求失败 (${response.status}): ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "(空响应)";
  }

  private async appendLog(wikiFolder: string, entry: string) {
    const vault = this.view.plugin.app.vault;
    const logPath = `${wikiFolder}/log.md`;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const logEntry = `\n## [${dateStr}] ${entry}\n`;

    const allFiles = vault.getFiles();
    const logFile = allFiles.find(f => f.path === logPath);
    if (logFile) {
      await vault.append(logFile, logEntry);
    } else {
      await vault.create(logPath, `# 操作日志\n\n${logEntry}`);
    }
  }

  private async ensureWikiDir(dirPath: string) {
    const vault = this.view.plugin.app.vault;
    const exists = await vault.adapter.exists(dirPath);
    if (!exists) {
      await vault.adapter.mkdir(dirPath);
    }
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, "-");
  }

  private scrollChatToBottom() {
    requestAnimationFrame(() => {
      const chat = this.view.containerEl.querySelector("#llmwiki-chat");
      if (chat) chat.scrollTop = chat.scrollHeight;
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  cleanup() {
    this.chatMessages = [];
    this.isBuilding = false;
  }
}
