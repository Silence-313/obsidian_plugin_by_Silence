// ── Note Assistant Component ─────────────────────────────────
// Floating chat window for discussing notes with AI Agent.
// Appears as a position:fixed overlay when editing markdown files.
// Supports drag-to-move, resize, minimize-to-FAB, and note content syncing.

import { requestUrl } from "obsidian";
import type HomepagePlugin from "../plugin";
import type { ChatMessage } from "../types";
import { escapeHtml, loadApiKeyFromKeychain, saveApiKeyToKeychain } from "../utils";
import { AgentOrchestrator } from "../agent";

export class NoteAssistantComponent {
  plugin: HomepagePlugin;
  chatMessages: ChatMessage[] = [];
  private orchestrator: AgentOrchestrator | null = null;
  private _streamingIdx = -1;

  // DOM refs
  private floatEl: HTMLElement | null = null;
  private fabEl: HTMLElement | null = null;

  // Drag state
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private floatStartX = 0;
  private floatStartY = 0;

  // FAB drag state
  private fabDragging = false;
  private fabDragStartX = 0;
  private fabDragStartY = 0;
  private fabStartLeft = 0;
  private fabStartTop = 0;

  // FAB position (right/bottom when floating)
  private fabRight = 20;
  private fabBottom = 60;

  // Default position & size — bottom-right corner
  private floatX = window.innerWidth - 500;
  private floatY = window.innerHeight - 560;
  private floatW = 480;
  private floatH = 500;

  // Visibility
  private _visible = false;
  private _minimized = false;
  private _destroyed = false;

  private resizeObserver: ResizeObserver | null = null;
  private currentNoteName = "";

  constructor(plugin: HomepagePlugin) {
    this.plugin = plugin;
    // Initialize position based on window size
    this.floatX = Math.max(0, window.innerWidth - 500);
    this.floatY = Math.max(0, window.innerHeight - 560);
  }

  // ── Public API ──────────────────────────────────────────────

  isVisible(): boolean {
    return this._visible;
  }

  isMinimized(): boolean {
    return this._minimized;
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  show() {
    if (this._destroyed || this._visible) return;
    this._visible = true;
    this.createFloat();
    this.render();
  }

  hide() {
    this.removeFloatDOM();
    this.removeFabDOM();
    this._visible = false;
    this._minimized = false;
  }

  minimize() {
    if (!this._visible || this._minimized) return;
    // Save current float position before removing
    if (this.floatEl) {
      this.floatX = this.floatEl.offsetLeft;
      this.floatY = this.floatEl.offsetTop;
      this.floatW = this.floatEl.offsetWidth;
      this.floatH = this.floatEl.offsetHeight;
    }
    this.removeFloatDOM();
    this._minimized = true;
    // Place FAB so its center aligns with the float window's bottom-right corner
    const fabCenterX = this.floatX + this.floatW;
    const fabCenterY = this.floatY + this.floatH;
    this.fabRight = Math.max(4, window.innerWidth - fabCenterX - 22);
    this.fabBottom = Math.max(4, window.innerHeight - fabCenterY - 22);
    this.createFab();
  }

  restore() {
    if (this._visible && !this._minimized) {
      this.render();
      return;
    }
    // Calculate float position so its bottom-right corner aligns with FAB center
    const fabCenterX = window.innerWidth - this.fabRight - 22;
    const fabCenterY = window.innerHeight - this.fabBottom - 22;
    this.floatX = Math.max(0, fabCenterX - this.floatW);
    this.floatY = Math.max(0, fabCenterY - this.floatH);
    // Clamp to keep window fully on screen
    if (this.floatX + this.floatW > window.innerWidth) {
      this.floatX = Math.max(0, window.innerWidth - this.floatW);
    }
    if (this.floatY + this.floatH > window.innerHeight) {
      this.floatY = Math.max(0, window.innerHeight - this.floatH);
    }

    this._minimized = false;
    this.removeFabDOM();
    this._visible = true;
    this.createFloat();
    this.render();
  }

  destroy() {
    this.removeFloatDOM();
    this.removeFabDOM();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.orchestrator = null;
    this._destroyed = true;
    this._visible = false;
    this._minimized = false;
  }

  updateNoteInfo(name: string) {
    this.currentNoteName = name;
    const el = document.querySelector("#na-note-name");
    if (el) {
      el.textContent = name ? `当前: ${name}` : "无活跃笔记";
    }
  }

  toggleSync() {
    this.plugin.settings.noteAssistant.syncNoteContent =
      !this.plugin.settings.noteAssistant.syncNoteContent;
    this.plugin.saveSettings().catch(console.error);
    this.updateSyncButton();
  }

  // ── API Key ─────────────────────────────────────────────────

  private _cachedApiKey: string | null = null;
  private _apiKeyLoaded = false;

  private get apiKey(): string {
    if (this._apiKeyLoaded) return this._cachedApiKey ?? "";

    // 1. Try Keychain first
    const keychainKey = loadApiKeyFromKeychain();
    if (keychainKey) {
      this._cachedApiKey = keychainKey;
      this._apiKeyLoaded = true;
      return this._cachedApiKey;
    }

    // 2. Fall back to plaintext settings (not yet migrated to Keychain)
    const s = this.plugin.settings.llmWiki;
    if (s.apiKey) {
      // Attempt migration to Keychain
      const migrated = saveApiKeyToKeychain(s.apiKey);
      if (migrated) {
        this._cachedApiKey = s.apiKey;
        s.apiKeyInKeychain = true;
        s.apiKey = "";
        this.plugin.saveSettings().catch(console.error);
        this._apiKeyLoaded = true;
        return this._cachedApiKey;
      }
      // Keychain unavailable, use plaintext
      this._cachedApiKey = s.apiKey;
      this._apiKeyLoaded = true;
      return this._cachedApiKey;
    }

    this._apiKeyLoaded = true;
    return "";
  }

  /** Reset cached key so next access re-reads from Keychain/settings. */
  resetApiKey() {
    this._cachedApiKey = null;
    this._apiKeyLoaded = false;
    this.orchestrator = null;
  }

  private get settings() {
    return this.plugin.settings.noteAssistant;
  }

  // ── Orchestrator ────────────────────────────────────────────

  private getOrCreateOrchestrator(): AgentOrchestrator | null {
    if (!this.apiKey) return null;
    if (this.orchestrator) return this.orchestrator;

    const app = this.plugin.app;
    this.orchestrator = new AgentOrchestrator({
      vault: app.vault,
      wikiFolder: this.plugin.settings.llmWiki.wikiFolder,
      getApiKey: () => this.apiKey,
      apiEndpoint: this.plugin.settings.llmWiki.apiEndpoint,
      model: this.plugin.settings.llmWiki.model,
      getTodos: () => this.plugin.settings.todos,
      addTodo: (text, color, date, startTime, endTime) => {
        const homeLeaves = this.plugin.app.workspace.getLeavesOfType("homepage-view");
        if (homeLeaves.length > 0) {
          const homeView = homeLeaves[0].view as any;
          homeView.addTodo?.(text, color, date, startTime, endTime);
        }
      },
      deleteTodo: (id) => {
        const homeLeaves = this.plugin.app.workspace.getLeavesOfType("homepage-view");
        if (homeLeaves.length > 0) {
          const homeView = homeLeaves[0].view as any;
          homeView.deleteTodo?.(id);
        }
      },
      requestUrl: (opts) => requestUrl({ url: opts.url, method: opts.method }),

      // ── Note editing callbacks ──────────────────────────
      getActiveNoteContent: () => this.getActiveNoteContentSync(),
      insertIntoNote: (text) => {
        const mdView = this.getActiveMarkdownView();
        if (mdView) {
          mdView.editor.replaceSelection(text);
          return true;
        }
        return false;
      },
      replaceInNote: (oldText, newText) => {
        const mdView = this.getActiveMarkdownView();
        if (!mdView) return false;
        const content = mdView.editor.getValue();
        if (content.includes(oldText)) {
          const newContent = content.replace(oldText, newText);
          mdView.editor.setValue(newContent);
          return true;
        }
        return false;
      },
      appendToNote: (text) => {
        const mdView = this.getActiveMarkdownView();
        if (!mdView) return false;
        const content = mdView.editor.getValue();
        mdView.editor.setValue(content + "\n" + text);
        return true;
      },
      getNoteSelection: () => {
        const mdView = this.getActiveMarkdownView();
        return mdView?.editor.getSelection() ?? "";
      },
    });

    this.orchestrator.initialize().catch(console.error);
    return this.orchestrator;
  }

  private getActiveMarkdownView() {
    const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    if (leaves.length === 0) return null;
    const activeLeaf = this.plugin.app.workspace.activeLeaf;
    if (activeLeaf?.view?.getViewType() === "markdown") {
      return activeLeaf.view as any;
    }
    return leaves[0].view as any;
  }

  private getActiveNoteContentSync(): string {
    const mdView = this.getActiveMarkdownView();
    if (!mdView) return "";
    try {
      let content = mdView.editor.getValue();
      if (content.length > 4000) {
        content = content.slice(0, 4000);
      }
      return content;
    } catch {
      return "";
    }
  }

  // ── DOM Creation ────────────────────────────────────────────

  private createFloat() {
    if (this.floatEl) return;
    this.floatEl = document.createElement("div");
    this.floatEl.id = "note-assistant-float";
    this.floatEl.style.cssText = `
      position: fixed; z-index: 1000;
      width: ${this.floatW}px; height: ${this.floatH}px;
      min-width: 320px; min-height: 300px;
      max-width: 95vw; max-height: 90vh;
      left: ${this.floatX}px; top: ${this.floatY}px;
      border-radius: 12px; resize: both; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px var(--background-modifier-border);
      background: var(--background-primary);
      display: flex; flex-direction: column;
    `;
    document.body.appendChild(this.floatEl);

    // Observe resize (from CSS resize handle) to save dimensions
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.floatW = entry.contentRect.width;
        this.floatH = entry.contentRect.height;
      }
    });
    this.resizeObserver.observe(this.floatEl);
  }

  private removeFloatDOM() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.floatEl) {
      // Save position before removing
      this.floatX = this.floatEl.offsetLeft;
      this.floatY = this.floatEl.offsetTop;
      this.floatEl.remove();
      this.floatEl = null;
    }
  }

  private createFab() {
    if (this.fabEl) return;
    this.fabEl = document.createElement("div");
    this.fabEl.id = "note-assistant-fab";
    this.fabEl.style.cssText = `
      position: fixed; z-index: 1000;
      right: ${this.fabRight}px; bottom: ${this.fabBottom}px;
      width: 44px; height: 44px; border-radius: 50%;
      background: var(--interactive-accent); color: var(--text-on-accent);
      box-shadow: 0 4px 16px rgba(0,0,0,0.24);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; font-size: 20px;
      transition: transform 0.15s;
      user-select: none;
    `;
    this.fabEl.textContent = "💬";
    // Click to restore
    this.fabEl.addEventListener("click", (e) => {
      // Only restore if we didn't just drag (small movement threshold)
      if (!this.fabDragging) {
        this.restore();
      }
    });
    // Hover scale effect
    this.fabEl.addEventListener("mouseenter", () => {
      if (this.fabEl) this.fabEl.style.transform = "scale(1.1)";
    });
    this.fabEl.addEventListener("mouseleave", () => {
      if (this.fabEl && !this.fabDragging) this.fabEl.style.transform = "";
    });

    // Drag support
    this.setupFabDrag(this.fabEl);

    document.body.appendChild(this.fabEl);
  }

  private setupFabDrag(el: HTMLElement) {
    let moved = false;
    el.addEventListener("pointerdown", (e) => {
      this.fabDragging = true;
      moved = false;
      this.fabDragStartX = e.clientX;
      this.fabDragStartY = e.clientY;
      this.fabStartLeft = el.getBoundingClientRect().left;
      this.fabStartTop = el.getBoundingClientRect().top;
      el.setPointerCapture(e.pointerId);
      el.style.transition = "none";
      el.style.cursor = "grabbing";
    });

    el.addEventListener("pointermove", (e) => {
      if (!this.fabDragging) return;
      const dx = e.clientX - this.fabDragStartX;
      const dy = e.clientY - this.fabDragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      const left = Math.max(0, Math.min(window.innerWidth - 44, this.fabStartLeft + dx));
      const top = Math.max(0, Math.min(window.innerHeight - 44, this.fabStartTop + dy));
      el.style.left = left + "px";
      el.style.top = top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });

    const endDrag = () => {
      if (!this.fabDragging) return;
      this.fabDragging = false;
      el.style.transition = "transform 0.15s";
      el.style.cursor = "pointer";
      const rect = el.getBoundingClientRect();
      // Save position as right/bottom offsets for consistency
      this.fabRight = window.innerWidth - rect.right;
      this.fabBottom = window.innerHeight - rect.bottom;
      el.style.left = "auto";
      el.style.top = "auto";
      el.style.right = this.fabRight + "px";
      el.style.bottom = this.fabBottom + "px";
    };

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    // Prevent click after drag
    el.addEventListener("click", (e) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  private removeFabDOM() {
    if (this.fabEl) {
      this.fabEl.remove();
      this.fabEl = null;
    }
  }

  // ── Rendering ────────────────────────────────────────────────

  render() {
    if (!this.floatEl) return;
    const syncOn = this.plugin.settings.noteAssistant.syncNoteContent;
    const hasKey = !!this.apiKey;
    const hasMessages = this.chatMessages.filter(m => m.role !== "activity").length > 0;

    this.floatEl.innerHTML = `
      <style>
        @keyframes na-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .na-activity {
          animation: na-pulse 1.5s ease-in-out infinite;
        }
        #na-header button {
          background: transparent;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          padding: 2px 6px;
          font-family: inherit;
          white-space: nowrap;
          line-height: 1.4;
        }
        #na-header button:hover {
          background: var(--background-modifier-hover);
        }
        #na-sync-btn.active {
          color: #43a047;
          border-color: #43a047;
        }
        #na-chat-input::placeholder {
          color: var(--text-faint);
          opacity: 1;
        }
      </style>
      <!-- Header (drag handle) -->
      <div id="na-header" style="
        display: flex; align-items: center; gap: 6px;
        padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border);
        cursor: grab; flex-shrink: 0; user-select: none;
      ">
        <span style="font-size: 13px; font-weight: 600; color: var(--text-normal); white-space: nowrap;">🤖 笔记助手</span>
        <span id="na-note-name" style="
          font-size: 11px; color: var(--text-faint);
          max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          flex: 1;
        ">${this.currentNoteName ? `当前: ${escapeHtml(this.currentNoteName)}` : "无活跃笔记"}</span>
        <button id="na-sync-btn" class="${syncOn ? "active" : ""}" title="切换笔记内容同步">📄 ${syncOn ? "同步" : "不同步"}</button>
        <button id="na-clear-btn" title="清空对话">🗑</button>
        <button id="na-min-btn" title="最小化">—</button>
      </div>
      <!-- Chat area -->
      <div id="na-chat" style="
        flex: 1; overflow-y: auto; padding: 10px 12px;
        display: flex; flex-direction: column; gap: 10px;
      ">
        ${!hasMessages ? `
        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:13px;text-align:center;line-height:1.8;">
          <div>
            <div style="font-size:36px;margin-bottom:8px;">💡</div>
            <div>向我提问关于当前笔记的问题</div>
            ${!hasKey ? `<div style="margin-top:8px;font-size:11px;color:var(--text-error);">⚠ 请先在 LLM Wiki 中配置 API Key</div>` : ""}
          </div>
        </div>
        ` : this.chatMessages.map((m, idx) => {
          const isStreaming = this._streamingIdx === idx;
          if (m.role === "activity") {
            return `
            <div class="na-activity" style="display:flex;align-items:center;gap:8px;padding:4px 0;">
              <div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:var(--interactive-accent);"></div>
              <span style="font-size:11px;color:var(--text-faint);">${escapeHtml(m.content)}</span>
            </div>`;
          }
          return `
          <div style="display:flex;gap:8px;${m.role === "user" ? "flex-direction:row-reverse;" : ""}">
            <div style="
              width:28px;height:28px;border-radius:50%;flex-shrink:0;
              display:flex;align-items:center;justify-content:center;font-size:14px;
              background:${m.role === "user" ? "var(--interactive-accent)" : "var(--background-modifier-hover)"};
            ">${m.role === "user" ? "👤" : "🤖"}</div>
            <div style="display:flex;flex-direction:column;max-width:75%;">
              <div${isStreaming ? ' id="na-streaming"' : ""} style="
                padding:8px 12px;border-radius:10px;
                font-size:13px;line-height:1.5;word-break:break-word;
                background:${m.role === "user" ? "var(--interactive-accent)" : "var(--background-modifier-hover)"};
                color:${m.role === "user" ? "var(--text-on-accent)" : "var(--text-normal)"};
                border-radius:${m.role === "user" ? "10px 10px 4px 10px" : "10px 10px 10px 4px"};
              ">${isStreaming ? escapeHtml(m.content) : this.formatMessage(m.content)}</div>
              ${m.role === "assistant" && !isStreaming ? `
              <button class="na-copy-btn" data-content="${escapeHtml(m.content).replace(/"/g, "&quot;")}" style="
                align-self:flex-start;margin-top:2px;
                padding:2px 8px;border:1px solid var(--background-modifier-border);
                border-radius:4px;background:transparent;color:var(--text-faint);
                cursor:pointer;font-size:11px;font-family:inherit;
              ">📋 复制</button>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
      <!-- Input area -->
      <div id="na-input-area" style="
        padding:8px 12px;border-top:1px solid var(--background-modifier-border);
        display:flex;gap:8px;flex-shrink:0;
      ">
        <input id="na-chat-input" type="text" placeholder="${hasKey ? "输入消息..." : "请先在 LLM Wiki 中配置 API Key"}"
          ${!hasKey ? "disabled" : ""}
          style="
            flex:1;padding:6px 10px;border-radius:6px;
            border:1px solid var(--background-modifier-border);
            background:var(--background-primary);color:var(--text-normal);
            font-size:13px;outline:none;font-family:inherit;
          "
        />
        <button id="na-send-btn" style="
          padding:6px 14px;border:none;border-radius:6px;
          background:var(--interactive-accent);color:var(--text-on-accent);
          cursor:pointer;font-size:13px;font-family:inherit;
        " ${!hasKey ? "disabled" : ""}>发送</button>
      </div>
    `;

    this.bindEvents();
    this.scrollChatToBottom();
    this.updateSyncButton();
    this.refocusInput();
  }

  private updateSyncButton() {
    const btn = document.querySelector("#na-sync-btn");
    if (!btn) return;
    const syncOn = this.plugin.settings.noteAssistant.syncNoteContent;
    btn.textContent = syncOn ? "📄 同步" : "📄 不同步";
    if (syncOn) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }

  // ── Event Binding ───────────────────────────────────────────

  private bindEvents() {
    if (!this.floatEl) return;

    // Drag setup on header
    const header = this.floatEl.querySelector("#na-header") as HTMLElement;
    if (header) this.setupDrag(header);

    // Sync toggle
    this.floatEl.querySelector("#na-sync-btn")?.addEventListener("click", () => {
      this.toggleSync();
    });

    // Clear chat
    this.floatEl.querySelector("#na-clear-btn")?.addEventListener("click", () => {
      this.chatMessages = [];
      this.render();
    });

    // Minimize
    this.floatEl.querySelector("#na-min-btn")?.addEventListener("click", () => {
      this.minimize();
    });

    // Send
    this.floatEl.querySelector("#na-send-btn")?.addEventListener("click", () => {
      this.handleSend();
    });

    const input = this.floatEl!.querySelector("#na-chat-input") as HTMLInputElement;
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Delegated click for copy buttons
    const chatEl = this.floatEl.querySelector("#na-chat") as HTMLElement;
    chatEl?.addEventListener("click", (e) => {
      const copyBtn = (e.target as HTMLElement).closest(".na-copy-btn") as HTMLElement | null;
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
      }
    });
  }

  private refocusInput() {
    const input = this.floatEl?.querySelector("#na-chat-input") as HTMLInputElement;
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }

  // ── Drag Handling ────────────────────────────────────────────

  private setupDrag(headerEl: HTMLElement) {
    headerEl.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return; // Don't intercept button clicks
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      if (this.floatEl) {
        this.floatStartX = this.floatEl.offsetLeft;
        this.floatStartY = this.floatEl.offsetTop;
      }
      headerEl.setPointerCapture(e.pointerId);
      headerEl.style.cursor = "grabbing";
    });

    headerEl.addEventListener("pointermove", (e) => {
      if (!this.dragging || !this.floatEl) return;
      this.floatX = Math.max(0, this.floatStartX + e.clientX - this.dragStartX);
      this.floatY = Math.max(0, this.floatStartY + e.clientY - this.dragStartY);
      this.floatEl.style.left = this.floatX + "px";
      this.floatEl.style.top = this.floatY + "px";
    });

    const endDrag = () => {
      if (!this.dragging) return;
      this.dragging = false;
      headerEl.style.cursor = "grab";
      if (this.floatEl) {
        this.floatX = this.floatEl.offsetLeft;
        this.floatY = this.floatEl.offsetTop;
      }
    };

    headerEl.addEventListener("pointerup", endDrag);
    headerEl.addEventListener("pointercancel", endDrag);
  }

  // ── Chat Handling ───────────────────────────────────────────

  private async handleSend() {
    const input = this.floatEl?.querySelector("#na-chat-input") as HTMLInputElement;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    const orch = this.getOrCreateOrchestrator();
    if (!orch) {
      this.chatMessages.push({ role: "assistant", content: "❌ 请先在 LLM Wiki 中配置 API Key", timestamp: Date.now() });
      this.render();
      return;
    }

    // Build the final user text with optional note content
    let finalUserText = text;
    if (this.plugin.settings.noteAssistant.syncNoteContent) {
      const noteContent = await this.getActiveNoteContent();
      if (noteContent) {
        finalUserText = `我正在编辑笔记《${noteContent.name}》，以下是当前笔记的全部内容：\n\n\`\`\`markdown\n${noteContent.content}\n\`\`\`\n\n基于以上笔记内容，请回答：${text}`;
      }
    }

    const ts = Date.now();
    this.chatMessages.push({ role: "user", content: text, timestamp: ts });
    this.render();

    try {
      // Show activity
      this.showActivity("正在分析你的问题...");

      // Build chat history for LLM context
      const history = this.chatMessages
        .filter(m => m.role !== "activity")
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      // Note: use finalUserText (with injected note content) for the agent call,
      // but display the original text in the chat bubble
      const lastUserMsg = this.chatMessages[this.chatMessages.length - 1];
      if (lastUserMsg && lastUserMsg.role === "user") {
        lastUserMsg.content = text; // Keep original text in chat display
      }

      // Add streaming assistant bubble
      this.chatMessages.push({ role: "assistant", content: "", timestamp: Date.now() });
      this._streamingIdx = this.chatMessages.length - 1;
      this.render();

      const { response } = await orch.process(
        finalUserText,
        history,
        // onStream: update DOM with markdown rendering
        (content) => {
          const msg = this.chatMessages[this._streamingIdx];
          if (msg) msg.content = content;
          requestAnimationFrame(() => {
            const el = document.querySelector("#na-streaming");
            if (el) {
              el.innerHTML = this.formatMessage(content);
              this.scrollChatToBottom();
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
    } catch (e: any) {
      this.clearActivity();
      // Remove empty assistant bubble
      this.chatMessages = this.chatMessages.filter(
        m => !(m.role === "assistant" && m.content === "" && m.timestamp > ts - 1000)
      );
      this.chatMessages.push({ role: "assistant", content: `❌ 错误: ${e.message}`, timestamp: Date.now() });
    }
    this.render();
  }

  private showActivity(text: string) {
    this.clearActivity();
    this.chatMessages.push({ role: "activity", content: text, timestamp: Date.now() });
    this.render();
    this.scrollChatToBottom();
  }

  private clearActivity() {
    this.chatMessages = this.chatMessages.filter(m => m.role !== "activity");
  }

  private scrollChatToBottom() {
    requestAnimationFrame(() => {
      const chat = document.querySelector("#na-chat");
      if (chat) chat.scrollTop = chat.scrollHeight;
    });
  }

  private async getActiveNoteContent(): Promise<{ name: string; content: string } | null> {
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file) return null;
    try {
      let content = await this.plugin.app.vault.read(file);
      // Truncate long notes to ~4000 chars to avoid bloating system prompt
      if (content.length > 4000) {
        content = content.slice(0, 4000) + "\n\n...(内容已截断)";
      }
      return { name: file.name, content };
    } catch {
      return null;
    }
  }

  // ── Markdown Formatting ─────────────────────────────────────

  private formatMessage(content: string): string {
    let html = content
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Phase 0: Strip markdown tables — convert to list format
    html = html.replace(/\n(\|[^\n]+\|[\s\S]*?)(?=\n\n|\n(?!\|)|\n*$)/g, (tableBlock) => {
      const lines = tableBlock.trim().split("\n").filter(l => l.trim());
      if (lines.length < 2) return tableBlock;
      const hasSeparator = lines.some(l => /^\|[\s:-]+\|/.test(l));
      if (!hasSeparator) return tableBlock;
      const dataLines = lines.filter(l => !/^\|[\s:-]+\|/.test(l));
      if (dataLines.length === 0) return tableBlock;
      const headerCells = dataLines[0].split("|").map(c => c.trim()).filter(c => c);
      const rows = dataLines.slice(1).map(line =>
        line.split("|").map(c => c.trim()).filter(c => c)
      );
      if (headerCells.length === 0) return tableBlock;
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

    // Strip leftover separator-only lines
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

    for (const line of lines) {
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
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span style="color:var(--interactive-accent);text-decoration:underline;">$1</span>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--background-primary-alt);padding:1px 5px;border-radius:3px;font-size:12px;">$1</code>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Phase 4: Restore code blocks
    html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => codeBlocks[parseInt(idx)]);

    return html;
  }
}
