import { requestUrl } from "obsidian";
import type HomepageView from "../view";
import type { ChatMessage } from "../types";
import { escapeHtml, loadApiKeyFromKeychain, saveApiKeyToKeychain, deleteApiKeyFromKeychain } from "../utils";

// ── Agent Tools ──────────────────────────────────────────────

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

const AGENT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前的日期、时间和星期几。用于需要知道现在是什么时间/日期/星期几的场景。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_todos",
      description: "查询待办事项。可按日期、状态（完成/未完成）、优先级筛选。用于用户询问'我有哪些待办'、'昨天的待办'、'未完成的事情'等场景。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "日期筛选，格式 YYYY-MM-DD。不传则返回所有日期。" },
          status: { type: "string", description: "状态筛选: 'done' 已完成, 'pending' 未完成。不传则返回全部。" },
          priority: { type: "string", description: "优先级筛选: '高'/'中高'/'中'/'低'。不传则返回全部。" },
          search: { type: "string", description: "关键词搜索待办文本。不传则返回全部。" },
          limit: { type: "number", description: "返回条数上限，默认 50。" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_todo_stats",
      description: "获取待办事项的统计概览：总数、完成率、按优先级分布、按日期分布。用于用户询问'我的整体待办情况'、'完成率多少'等场景。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_todos",
      description: "添加待办事项到指定日期。用户说'帮我安排明天的任务'、'添加一个周五的待办'、'下周一的待办'时使用。按正确格式写入插件数据，让待办直接显示在日程中。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "目标日期，格式 YYYY-MM-DD。用户说'明天'就计算明天日期，'下周一'就算下周一日期。" },
          todos: {
            type: "array",
            description: "要添加的待办事项列表",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "待办内容" },
                priority: { type: "string", description: "优先级: 高/中高/中/低，默认中" },
                startTime: { type: "string", description: "开始时间，格式 HH:MM，如 09:00" },
                endTime: { type: "string", description: "结束时间，格式 HH:MM，如 10:30" },
              },
              required: ["text"],
            },
          },
        },
        required: ["date", "todos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "搜索互联网获取实时信息。当知识库无法回答用户问题、需要最新资讯、查询事实性信息时使用。返回搜索结果列表（标题、摘要、链接）。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          num_results: { type: "number", description: "返回结果数量，默认 5，最多 10。" },
        },
        required: ["query"],
      },
    },
  },
];

async function executeTool(name: string, args: Record<string, any>, view: HomepageView): Promise<string> {
  switch (name) {
    case "get_current_time": {
      const now = new Date();
      const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
      return JSON.stringify({
        date: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
        time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
        weekday: weekdays[now.getDay()],
        iso: now.toISOString(),
      }, null, 2);
    }

    case "get_todos": {
      const todos = view.plugin.settings.todos;
      const priorityLabels: Record<string, string> = {
        "#e53935": "高", "#fb8c00": "中高", "#fdd835": "中", "#43a047": "低",
      };

      let filtered = [...todos];
      if (args.date) {
        filtered = filtered.filter(t => t.date === args.date);
      }
      if (args.status === "done") {
        filtered = filtered.filter(t => t.done);
      } else if (args.status === "pending") {
        filtered = filtered.filter(t => !t.done);
      }
      if (args.priority) {
        filtered = filtered.filter(t => priorityLabels[t.color] === args.priority);
      }
      if (args.search) {
        const kw = args.search.toLowerCase();
        filtered = filtered.filter(t => t.text.toLowerCase().includes(kw));
      }

      const limit = args.limit || 50;
      const results = filtered.slice(0, limit).map(t => ({
        id: t.id,
        text: t.text,
        status: t.done ? "已完成" : "未完成",
        priority: priorityLabels[t.color] || "未知",
        date: t.date,
        startTime: t.startTime || "",
        endTime: t.endTime || "",
      }));

      // Sort by date descending, then status
      results.sort((a: any, b: any) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return a.status === "未完成" ? -1 : 1;
      });

      return JSON.stringify({
        total: todos.length,
        matched: filtered.length,
        returned: results.length,
        filters: { date: args.date, status: args.status, priority: args.priority, search: args.search },
        todos: results,
      }, null, 2);
    }

    case "get_todo_stats": {
      const todos = view.plugin.settings.todos;
      const priorityLabels: Record<string, string> = {
        "#e53935": "高", "#fb8c00": "中高", "#fdd835": "中", "#43a047": "低",
      };
      const totalCount = todos.length;
      const doneCount = todos.filter(t => t.done).length;
      const pendingCount = totalCount - doneCount;
      const completionRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

      // By priority
      const byPriority: Record<string, { label: string; total: number; done: number; rate: number }> = {};
      for (const t of todos) {
        const key = t.color || "unknown";
        if (!byPriority[key]) byPriority[key] = { label: priorityLabels[key] || "未知", total: 0, done: 0, rate: 0 };
        byPriority[key].total++;
        if (t.done) byPriority[key].done++;
      }
      for (const v of Object.values(byPriority)) {
        v.rate = v.total > 0 ? Math.round((v.done / v.total) * 100) : 0;
      }

      // By date (last 14 days)
      const today = new Date();
      const byDate: Record<string, { total: number; done: number; pending: number }> = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const dayTodos = todos.filter(t => t.date === key);
        byDate[key] = {
          total: dayTodos.length,
          done: dayTodos.filter(t => t.done).length,
          pending: dayTodos.filter(t => !t.done).length,
        };
      }

      // Pending list (top 20)
      const pending = todos.filter(t => !t.done).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20).map(t => ({
        text: t.text,
        priority: priorityLabels[t.color] || "?",
        date: t.date,
      }));

      return JSON.stringify({
        overview: { totalCount, doneCount, pendingCount, completionRate },
        byPriority,
        recent14Days: byDate,
        pendingTop20: pending,
      }, null, 2);
    }

    case "add_todos": {
      const priorityMap: Record<string, string> = {
        "高": "#e53935", "中高": "#fb8c00", "中": "#fdd835", "低": "#43a047",
      };
      const dateKey: string = args.date || "";
      if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return JSON.stringify({ error: "date 参数必须为 YYYY-MM-DD 格式" });
      }

      const items: Array<{ text: string; priority?: string; startTime?: string; endTime?: string }> = args.todos || [];
      if (!Array.isArray(items) || items.length === 0) {
        return JSON.stringify({ error: "todos 参数必须是非空数组" });
      }

      const added: Array<{ text: string; priority: string; date: string; startTime?: string; endTime?: string }> = [];
      for (const item of items) {
        if (!item.text) continue;
        const priority = item.priority || "中";
        const color = priorityMap[priority] || "#fdd835";
        view.addTodo(
          item.text,
          color,
          dateKey,
          item.startTime || "",
          item.endTime || "",
        );
        added.push({
          text: item.text,
          priority,
          date: dateKey,
          startTime: item.startTime || undefined,
          endTime: item.endTime || undefined,
        });
      }

      const [y, m, d] = dateKey.split("-").map(Number);
      return JSON.stringify({
        success: true,
        date: dateKey,
        dateDisplay: `${y}年${m}月${d}日`,
        count: added.length,
        todos: added,
      }, null, 2);
    }

    case "web_search": {
      const query = args.query?.trim();
      if (!query) return JSON.stringify({ error: "query 参数不能为空" });
      const numResults = Math.min(args.num_results || 5, 10);

      // Try DDG JSON API via Obsidian's requestUrl (bypasses CSP/CORS)
      try {
        const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const apiResp = await requestUrl({ url: apiUrl, method: "GET" });
        if (apiResp.status === 200) {
          const data = apiResp.json;
          const results: Array<{ title: string; snippet: string; url: string }> = [];

          // Instant answer
          if (data.AbstractText) {
            results.push({
              title: data.Heading || query,
              snippet: (data.AbstractText as string).substring(0, 500),
              url: data.AbstractURL || "",
            });
          }

          // RelatedTopics — handle both flat items and nested categories
          const topics: any[] = data.RelatedTopics || [];
          const collectTopics = (ts: any[]) => {
            for (const t of ts) {
              if (results.length >= numResults) break;
              if (t.Text) {
                const parts = (t.Text as string).split(" - ");
                results.push({
                  title: (parts[0] || t.Text).substring(0, 120),
                  snippet: (t.Text as string).substring(0, 300),
                  url: t.FirstURL || "",
                });
              }
              if (t.Topics) collectTopics(t.Topics);
            }
          };
          collectTopics(topics);

          if (results.length > 0) {
            return JSON.stringify({ query, resultCount: results.length, results }, null, 2);
          }
        }
      } catch {
        // JSON API failed, fall through to HTML scraping
      }

      // Fallback: scrape DDG HTML via requestUrl
      try {
        const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const htmlResp = await requestUrl({ url: htmlUrl, method: "GET" });
        if (htmlResp.status !== 200) throw new Error(`HTTP ${htmlResp.status}`);
        const html = htmlResp.text;

        const results: Array<{ title: string; snippet: string; url: string }> = [];
        // Parse <a class="result__a" href="...">Title</a> ... <a class="result__snippet">Snippet</a>
        const re = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\//gi;
        let match;
        while ((match = re.exec(html)) !== null && results.length < numResults) {
          const rawTitle = match[2].replace(/<[^>]+>/g, "").trim();
          const rawSnippet = match[3].replace(/<[^>]+>/g, "").trim();
          if (!rawTitle || !rawSnippet) continue;
          const uddgMatch = match[1].match(/uddg=(https?%3A[^&]+)/);
          results.push({
            title: rawTitle.substring(0, 120),
            snippet: rawSnippet.substring(0, 300),
            url: uddgMatch ? decodeURIComponent(uddgMatch[1]) : match[1],
          });
        }

        if (results.length > 0) {
          return JSON.stringify({ query, resultCount: results.length, results }, null, 2);
        }
      } catch {
        // HTML scraping also failed
      }

      return JSON.stringify({ query, message: "未找到搜索结果，请尝试更换关键词或稍后重试。", results: [] });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

const WIKI_SCHEMA = `# LLM Wiki Schema

你是一个知识库维护者。你的任务是阅读用户的笔记，并维护一个结构化的 wiki。

## Wiki 结构

- index.md — 所有页面的目录，带链接和一行摘要
- log.md — 按时间顺序记录所有操作
- overview.md — 知识库总览
- summaries/ — 每篇笔记的摘要
- concepts/ — 跨笔记的概念页面

## 规则

1. 用户笔记是只读的，绝对不要修改
2. 每个摘要页面要包含：来源文件名、关键要点、标签
3. 概念页面要交叉引用相关的笔记和摘要
4. 每次操作后更新 index.md 和 log.md
5. 发现矛盾或不一致时记录到 log.md
6. 所有页面用中文撰写`;

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

    // Migration: plaintext key exists but not yet in Keychain
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
      // Keychain unavailable, fall back to plaintext
      this._cachedApiKey = s.apiKey;
      this._apiKeyLoaded = true;
      return this._cachedApiKey ?? "";
    }

    this._apiKeyLoaded = true;
    return "";
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
              <div${isStreaming ? ' id="llmwiki-streaming"' : ""} style="
                max-width:75%;padding:8px 12px;border-radius:10px;
                font-size:13px;line-height:1.5;word-break:break-word;
                background:${m.role === "user" ? "var(--interactive-accent)" : "var(--background-modifier-hover)"};
                color:${m.role === "user" ? "var(--text-on-accent)" : "var(--text-normal)"};
                border-radius:${m.role === "user" ? "10px 10px 4px 10px" : "10px 10px 10px 4px"};
              ">${isStreaming ? escapeHtml(m.content) : this.formatMessage(m.content)}</div>
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
      // Move cursor to end of text
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
      this.showApiKeyConfig = false;
      this.render();
    });

    // Enter key to save
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

    // Delegated click for links in chat messages
    const chatEl = card.querySelector("#llmwiki-chat") as HTMLElement;
    chatEl?.addEventListener("click", (e) => {
      const link = (e.target as HTMLElement).closest(".llmwiki-link") as HTMLElement | null;
      if (!link) { this.closeLinkPopup(); return; }
      e.preventDefault();
      e.stopPropagation();
      const url = link.dataset.url || "";
      this.showLinkPopup(link, url);
    });
    // Close popup on outside click (skip clicks on links or inside popup)
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".llmwiki-link") || target.closest("#llmwiki-link-popup")) return;
      this.closeLinkPopup();
    });
  }

  private showLinkPopup(anchor: HTMLElement, url: string) {
    // Remove any existing popup
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
        // fallback for older Electron
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

    // Keep popup in viewport
    const popRect = popup.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) popup.style.left = `${window.innerWidth - popRect.width - 8}px`;
    if (popRect.bottom > window.innerHeight - 8) popup.style.top = `${rect.top - popRect.height - 4}px`;
  }

  private closeLinkPopup() {
    const existing = document.getElementById("llmwiki-link-popup");
    if (existing) existing.remove();
  }

  private formatMessage(content: string): string {
    // Phase 0: Escape HTML
    let html = content
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Phase 1: Extract code blocks to protect from further processing
    const codeBlocks: string[] = [];
    html = html.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_m, _lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre style="background:var(--background-primary-alt);padding:10px 12px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.5;margin:6px 0;"><code>${code.trim()}</code></pre>`);
      return `%%CODEBLOCK_${idx}%%`;
    });

    // Phase 2: Block-level elements (line by line)
    const lines = html.split("\n");
    const out: string[] = [];
    let inList = false;
    let listType = "";

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Headers
      const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        if (inList) { out.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
        const level = hMatch[1].length;
        const sizes = ["", "18px", "16px", "14px", "13px", "12px", "11px"];
        out.push(`<h${level} style="font-size:${sizes[level]};font-weight:600;margin:8px 0 4px;color:var(--text-normal);">${hMatch[2]}</h${level}>`);
        continue;
      }

      // Horizontal rule
      if (/^[-*_]{3,}\s*$/.test(line)) {
        if (inList) { out.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
        out.push('<hr style="border:none;border-top:1px solid var(--background-modifier-border);margin:8px 0;">');
        continue;
      }

      // Blockquote
      if (line.startsWith("> ")) {
        if (inList) { out.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
        const q = line.replace(/^> /, "");
        out.push(`<blockquote style="border-left:3px solid var(--interactive-accent);margin:4px 0;padding:2px 10px;color:var(--text-muted);">${q}</blockquote>`);
        continue;
      }

      // Unordered list
      const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
      if (ulMatch) {
        if (!inList || listType !== "ul") {
          if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
          out.push('<ul style="margin:4px 0;padding-left:18px;">');
          inList = true;
          listType = "ul";
        }
        out.push(`<li style="margin:2px 0;">${ulMatch[2]}</li>`);
        continue;
      }

      // Ordered list
      const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
      if (olMatch) {
        if (!inList || listType !== "ol") {
          if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
          out.push('<ol style="margin:4px 0;padding-left:18px;">');
          inList = true;
          listType = "ol";
        }
        out.push(`<li style="margin:2px 0;">${olMatch[2]}</li>`);
        continue;
      }

      // End of list
      if (inList && line.trim() === "") {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
        out.push("<br>");
        continue;
      }
      if (inList && line.trim() !== "") {
        // Close list on non-list line
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }

      // Paragraph / empty line
      if (line.trim() === "") {
        out.push("<br>");
      } else {
        out.push(line);
      }
    }
    if (inList) {
      out.push(listType === "ul" ? "</ul>" : "</ol>");
    }

    html = out.join("\n");

    // Phase 3: Inline elements
    // Links — use data-url to intercept clicks
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="llmwiki-link" data-url="$2" style="color:var(--interactive-accent);text-decoration:underline;cursor:pointer;">$1</span>');
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Inline code (but not inside code blocks)
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--background-primary-alt);padding:1px 5px;border-radius:3px;font-size:12px;">$1</code>');
    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Phase 4: Restore code blocks
    html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => codeBlocks[parseInt(idx)]);

    return html;
  }

  private async handleSend() {
    const input = this.view.containerEl.querySelector("#llmwiki-chat-input") as HTMLInputElement;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    const ts = Date.now();
    this.chatMessages.push({ role: "user", content: text, timestamp: ts });
    this._keepInputFocus = true;
    this.render();

    try {
      const wikiContext = await this.searchWiki(text);
      const response = await this.agentLoop(text, wikiContext);
      this.clearActivity();
      await this.appendChatLog(text, response);
    } catch (e: any) {
      this.clearActivity();
      this.chatMessages.push({ role: "assistant", content: `❌ 错误: ${e.message}`, timestamp: ts });
    }
    this._keepInputFocus = true;
    this.render();
  }

  // ── Agent Loop ──────────────────────────────────────────

  private clearActivity() {
    this.chatMessages = this.chatMessages.filter(m => m.role !== "activity");
  }

  private addActivity(text: string) {
    this.clearActivity();
    this.chatMessages.push({ role: "activity", content: text, timestamp: Date.now() });
    this._keepInputFocus = true;
    this.render();
  }

  private async agentLoop(userText: string, wikiContext: string): Promise<string> {
    const messages = this.buildChatMessages(userText, wikiContext);

    // Step 1: Determine if tools are needed (non-streaming, quick)
    this.addActivity("🤔 正在分析你的问题...");
    const probeResp = await this.callDeepSeekWithTools(messages);
    const probeChoice = probeResp.choices?.[0];
    if (!probeChoice) throw new Error("API 返回空响应");
    const toolCalls = probeChoice.message?.tool_calls ?? [];
    const probeText = probeChoice.message?.content ?? "";

    this.clearActivity();

    if (toolCalls.length > 0) {
      // ── Tools path: execute tools, then stream final answer ──
      messages.push({
        role: "assistant",
        content: probeText,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        let args: Record<string, any> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
        const argsStr = this.formatToolArgs(tc.function.name, args);
        this.addActivity(`🔧 正在调用 ${tc.function.name}${argsStr}...`);
        const result = await executeTool(tc.function.name, args, this.view);
        const summary = this.summarizeToolResult(tc.function.name, result);
        this.addActivity(`✅ ${summary}`);
        await this.delay(300);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      // Stream final answer (no tools needed — tool results are already in context)
      this.clearActivity();
      return this.streamResponse(messages);
    }

    // ── No-tools path: stream directly into assistant bubble ──
    return this.streamResponse(messages);
  }

  private async streamResponse(messages: any[]): Promise<string> {
    this.chatMessages.push({ role: "assistant", content: "", timestamp: Date.now() });
    this._streamingIdx = this.chatMessages.length - 1;
    this._keepInputFocus = true;
    this.render();

    let rafId = 0;
    let fullContent = "";
    const result = await this.callDeepSeekStream(messages, false, (content) => {
      fullContent = content;
      const msg = this.chatMessages[this._streamingIdx];
      if (msg) msg.content = content;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const el = this.view.containerEl.querySelector("#llmwiki-streaming");
        if (el) {
          el.innerHTML = this.formatMessage(content);
          const chat = this.view.containerEl.querySelector("#llmwiki-chat");
          if (chat) chat.scrollTop = chat.scrollHeight;
        }
      });
    });

    if (rafId) {
      await new Promise<void>(resolve => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => resolve());
      });
    }

    this._streamingIdx = -1;
    const msg = this.chatMessages[this.chatMessages.length - 1];
    if (msg && msg.role === "assistant") msg.content = fullContent || result.content;
    return fullContent || result.content;
  }

  private formatToolArgs(_name: string, args: Record<string, any>): string {
    const nonEmpty = Object.entries(args).filter(([_, v]) => v !== undefined && v !== "");
    if (nonEmpty.length === 0) return "";
    return `(${nonEmpty.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})`;
  }

  private summarizeToolResult(name: string, result: string): string {
    try {
      const obj = JSON.parse(result);
      switch (name) {
        case "get_current_time":
          return `当前时间: ${obj.date} ${obj.time} ${obj.weekday}`;
        case "get_todos":
          return `查询到 ${obj.matched} 条待办（返回 ${obj.returned} 条）`;
        case "get_todo_stats":
          return `待办统计: 共 ${obj.overview.totalCount} 条，完成率 ${obj.overview.completionRate}%`;
        case "add_todos":
          return `已添加 ${obj.count} 条待办 (${obj.dateDisplay})`;
        case "web_search":
          return `搜索 "${obj.query}" 返回 ${obj.resultCount} 条结果`;
        default:
          return "工具执行完成";
      }
    } catch {
      return "工具执行完成";
    }
  }

  private buildChatMessages(userText: string, wikiContext: string): any[] {
    const now = new Date();
    const systemPrompt = `你是用户个人知识库的 AI Agent，拥有工具调用能力。你有权访问用户笔记生成的 wiki 知识库。

## 当前时间
- 日期: ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日
- 时间: ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}
- 星期${["日", "一", "二", "三", "四", "五", "六"][now.getDay()]}

## 可用工具
- get_current_time: 获取精确的当前日期和时间。当需要知道"现在几点"、"今天几号"、"昨天是什么日期"时使用。
- get_todos: 查询待办事项，可按日期、状态、优先级筛选。当用户问"我的待办"、"昨天的待办"、"未完成的事"时必须使用。
- get_todo_stats: 获取待办统计概览。当用户问"完成率"、"整体待办情况"时使用。
- add_todos: 添加待办事项到指定日期。需要提供 date（YYYY-MM-DD 格式）和 todos 数组。用户说"帮我安排明天的任务"、"添加周五的待办"、"下周一的待办"时使用。根据当前时间计算出目标日期后调用。每个待办可指定内容、优先级（高/中高/中/低）、时间范围。
- web_search: 搜索互联网获取实时信息。当知识库无法回答用户的问题、需要最新资讯或事实性信息时使用。参数 query（搜索关键词），可选 num_results（默认5）。返回结果含 url 字段，回答时必须附带来源链接。

## 待办优先级颜色
- 高: #e53935 (红色)
- 中高: #fb8c00 (橙色)
- 中: #fdd835 (黄色)
- 低: #43a047 (绿色)
创建待办时必须使用这些优先级标签。

## 知识库内容
${wikiContext || "（知识库为空或未找到相关内容）"}

## 规则
1. 如果知识库中有相关信息，请基于知识库内容回答，并注明来源（如 "根据你的笔记《xxx》..."）
2. 如果知识库中没有相关信息，可以基于你的常识回答，但要说明这是常识而非来自用户的笔记
3. 回答使用中文，清晰简洁
4. 相关页面用 [[页面名]] 格式引用
5. 不要编造知识库中不存在的内容
6. 当用户问到时间/日期相关问题时，主动使用 get_current_time 工具
7. 当用户问到待办/日程/任务相关问题时，必须使用 get_todos 或 get_todo_stats 工具查询实时数据
8. 当用户要求添加/安排/创建待办事项时，使用 add_todos 工具，根据当前时间计算出目标日期（YYYY-MM-DD），优先级的默认值为"中"
9. 当知识库无法回答用户问题、用户询问最新信息/实时资讯、或用户明确要求搜索时，使用 web_search 工具。**关键：搜索结果的每条信息后面必须附带来源链接**，格式为 "- 信息内容 [来源标题](url)" 或 "根据 [来源标题](url)，..."。禁止只给搜索结果文本而不给链接。
10. 绝对不要使用 Markdown 表格（表格渲染有 bug）。用列表、分段文字或其他格式替代表格展示数据`;

    const history = this.chatMessages.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
    }));

    return [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userText },
    ];
  }

  async searchWiki(query: string): Promise<string> {
    const wikiFolder = this.settings.wikiFolder;
    const files = this.view.plugin.app.vault.getFiles();

    // Find index.md in wiki folder
    const indexFile = files.find(
      f => f.path.startsWith(wikiFolder) && f.path.endsWith("index.md")
    );
    const wikiFiles = files.filter(
      f => f.path.startsWith(wikiFolder) && f.extension === "md" && f !== indexFile
    );

    if (!indexFile && wikiFiles.length === 0) return "";

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
    const scored: Array<{ path: string; score: number; content: string }> = [];

    for (const file of wikiFiles.slice(0, 30)) {
      try {
        const content = await this.view.plugin.app.vault.read(file);
        const lower = content.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          const count = lower.split(kw).length - 1;
          score += count * 10;
          if (file.name.toLowerCase().includes(kw)) score += 50;
          if (file.path.toLowerCase().includes(kw)) score += 30;
        }
        if (score > 0) {
          scored.push({ path: file.path, score, content });
        }
      } catch {
        // skip unreadable files
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      // Return index content as overview
      if (indexFile) {
        try {
          const idxContent = await this.view.plugin.app.vault.read(indexFile);
          return `## Wiki 目录\n${idxContent.substring(0, 3000)}`;
        } catch {
          return "";
        }
      }
      return "";
    }

    const top = scored.slice(0, 3);
    return top.map(s =>
      `### 📄 ${s.path}\n${s.content.substring(0, 2000)}${s.content.length > 2000 ? "\n...(已截断)" : ""}`
    ).join("\n\n---\n\n");
  }

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

      // Exclude system dirs and wiki folder itself
      const excludeDirs = [".obsidian", ".trash", ".git", wikiFolder, "_attachments", "assets"];
      const noteFiles = allFiles.filter(f => {
        if (f.extension !== "md") return false;
        for (const dir of excludeDirs) {
          if (f.path.startsWith(dir + "/") || f.path === dir) return false;
        }
        return true;
      });

      // Read chat log before building (will be consumed and cleared)
      const chatLog = await this.readChatLog();
      const hasChatLog = chatLog.length > 100; // more than just the header

      // Ensure wiki directory structure exists
      await this.ensureWikiDir(`${wikiFolder}/summaries`);
      await this.ensureWikiDir(`${wikiFolder}/concepts`);

      // Create SCHEMA.md if it doesn't exist
      const schemaPath = `${wikiFolder}/SCHEMA.md`;
      if (!allFiles.some(f => f.path === schemaPath)) {
        await vault.create(schemaPath, WIKI_SCHEMA);
        this.addBuildLog("已创建 SCHEMA.md");
      }

      // Process each note
      const total = noteFiles.length;
      let processed = 0;

      for (const file of noteFiles) {
        processed++;
        this.buildProgress = `处理笔记 ${processed}/${total}: ${file.name}`;
        this.addBuildLog(`[${processed}/${total}] 读取: ${file.path}`);
        this.render();

        try {
          const content = await vault.read(file);
          if (content.trim().length === 0) {
            this.addBuildLog(`  跳过(空文件): ${file.name}`);
            continue;
          }

          const summaryPath = `${wikiFolder}/summaries/${this.sanitizeFileName(file.name)}`;
          const existingSummary = allFiles.some(f => f.path === summaryPath);

          if (existingSummary) {
            const existingFile = allFiles.find(f => f.path === summaryPath)!;
            const existingStat = await vault.read(existingFile);
            // Only skip if source hasn't changed (stored in summary meta)
            if (existingStat.includes(`source-mtime: ${file.stat.mtime}`)) {
              this.addBuildLog(`  跳过(未变更): ${file.name}`);
              continue;
            }
          }

          // Generate summary via LLM
          const summary = await this.generateSummary(file.path, content);
          if (existingSummary) {
            const existingFile = allFiles.find(f => f.path === summaryPath)!;
            await vault.modify(existingFile, summary);
          } else {
            await vault.create(summaryPath, summary);
          }
          this.addBuildLog(`  ✅ 已生成摘要: ${summaryPath}`);
        } catch (e: any) {
          this.addBuildLog(`  ❌ 失败: ${e.message}`);
        }

        // Small delay between API calls to avoid rate limiting
        if (processed < total) {
          await this.delay(500);
        }
      }

      // Generate index - refresh file list to include newly created summaries
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

      // Generate todo/concept page if there's todo data
      if (todoCtx) {
        this.buildProgress = "生成待办知识页...";
        this.addBuildLog("生成 待办与日程.md ...");
        this.render();
        const todoPagePath = `${wikiFolder}/concepts/待办与日程.md`;
        const refreshedAgain = vault.getFiles();
        const existingTodo = refreshedAgain.find(f => f.path === todoPagePath);
        const todoPageContent = `---
date: ${new Date().toISOString().split("T")[0]}
type: concept
---

${todoCtx}`;
        if (existingTodo) {
          await vault.modify(existingTodo, todoPageContent);
        } else {
          await vault.create(todoPagePath, todoPageContent);
        }
        this.addBuildLog("  ✅ 已生成待办知识页");
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

      // Clear chat log after successful digestion
      if (hasChatLog) {
        await this.clearChatLog();
        this.addBuildLog("已清空对话记录");
      }

      // Delete temporary todo page — Agent tools provide real-time data
      const todoPagePath = `${wikiFolder}/concepts/待办与日程.md`;
      const finalFiles = vault.getFiles();
      const todoPage = finalFiles.find(f => f.path === todoPagePath);
      if (todoPage) {
        await vault.delete(todoPage);
        this.addBuildLog("已删除临时待办页面");
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

    // Group by priority (color)
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

    // Group by date (last 30 days)
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

    // Pending todos
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

  private async generateSummary(filePath: string, content: string): Promise<string> {
    const truncated = content.length > 8000 ? content.substring(0, 8000) + "\n...(内容已截断)" : content;
    const systemPrompt = `你是知识库维护者。为以下笔记生成摘要页面。

格式要求：
---
source: ${filePath}
source-mtime: ${Date.now()}
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
    // Read a few summaries to understand the content
    const sampleSummaries: Array<{ path: string; firstLines: string }> = [];
    for (const f of summaries.slice(0, 20)) {
      try {
        const c = await this.view.plugin.app.vault.read(f);
        sampleSummaries.push({ path: f.path, firstLines: c.substring(0, 500) });
      } catch { /* skip */ }
    }

    const systemPrompt = `你是知识库维护者。根据以下摘要文件列表，生成 index.md（知识库目录）。

格式:
# 知识库目录

## 概述
（一句话描述知识库覆盖的主题范围）

## 按主题分类

### 主题A
- [[页面路径|页面名]] — 一行摘要
...

## 概念索引
- [[概念1]] — 说明
...

## 统计
- 总笔记数: X
- 总摘要数: Y
- 最后更新: ${new Date().toLocaleDateString("zh-CN")}

只输出 index.md 内容，不要额外解释。`;

    const summaryList = sampleSummaries.map(s => `### ${s.path}\n${s.firstLines}`).join("\n\n");
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `摘要列表:\n\n${summaryList.substring(0, 8000)}` },
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
    const systemPrompt = `你是知识库维护者。生成 overview.md（知识库总览）。

格式:
# 知识库总览

## 知识领域
（基于笔记内容、待办数据和用户对话，列出主要知识领域和工作方向）

## 笔记概况
- 总笔记数: ${noteFiles.length}
- 总摘要数: ${summaries.length}
${hasChatLog ? "\n## 近期对话洞察\n（从最近的用户对话中提炼关键主题和关注点）" : ""}

## 工作脉络
（基于待办数据和对话记录，分析用户的工作模式、关注领域、完成趋势）

## 主题地图
（融合笔记主题、待办项目和对话主题，描述各领域之间的关系）

## 待探索方向
（基于所有信息源，建议深入探索的方向）

## 更新信息
- 最后维护: ${new Date().toLocaleString("zh-CN")}

只输出 overview.md 内容。`;

    const chatSection = hasChatLog ? `\n\n近期对话记录:\n${chatLog.substring(0, 5000)}` : "";
    const userContent = `摘要内容:\n\n${sampleSummaries.join("\n\n---\n\n").substring(0, 5000)}\n\n${todoData.substring(0, 3000)}${chatSection}`;
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userContent },
    ];

    return this.callDeepSeek(messages);
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
    try {
      return await vault.read(logFile);
    } catch {
      return "";
    }
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

  private async generateUserProfile(chatLog: string): Promise<string> {
    const wikiFolder = this.settings.wikiFolder;
    const vault = this.view.plugin.app.vault;
    const existingPath = `${wikiFolder}/concepts/用户画像.md`;
    const allFiles = vault.getFiles();
    const existingFile = allFiles.find(f => f.path === existingPath);
    let existingProfile = "";
    if (existingFile) {
      try {
        existingProfile = await vault.read(existingFile);
      } catch { /* use empty */ }
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
    const data = await this.callDeepSeekRaw(messages, false);
    return data.choices?.[0]?.message?.content ?? "(空响应)";
  }

  private async callDeepSeekWithTools(messages: any[]): Promise<any> {
    return this.callDeepSeekRaw(messages, true);
  }

  private async callDeepSeekRaw(messages: any[], withTools: boolean): Promise<any> {
    const endpoint = this.settings.apiEndpoint.replace(/\/$/, "");
    const body: any = {
      model: this.settings.model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    };

    if (withTools) {
      body.tools = AGENT_TOOLS;
      body.tool_choice = "auto";
    }

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
    if (!data.choices || data.choices.length === 0) {
      throw new Error("API 返回空响应");
    }
    return data;
  }

  // ── Streaming API ───────────────────────────────────────

  private async callDeepSeekStream(
    messages: any[],
    withTools: boolean,
    onContent: (text: string) => void,
  ): Promise<{ content: string; tool_calls: any[] }> {
    const endpoint = this.settings.apiEndpoint.replace(/\/$/, "");
    const body: any = {
      model: this.settings.model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    };

    if (withTools) {
      body.tools = AGENT_TOOLS;
      body.tool_choice = "auto";
    }

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

    const reader = response.body?.getReader();
    if (!reader) throw new Error("无法读取流式响应");

    const decoder = new TextDecoder();
    let content = "";
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let buffer = "";

    let lastPaint = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let hasContent = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Content delta
          if (delta.content) {
            content += delta.content;
            hasContent = true;
          }

          // Tool call deltas
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, { id: "", name: "", arguments: "" });
              }
              const entry = toolCalls.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }
        } catch {
          // skip malformed chunks
        }
      }

      // Fire callback with accumulated content, then yield for DOM repaint
      if (hasContent) {
        onContent(content);
        // Yield to event loop at most every 50ms so browser can repaint
        const now = Date.now();
        if (now - lastPaint > 50) {
          lastPaint = now;
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    const toolCallsArr = Array.from(toolCalls.values())
      .filter(tc => tc.id)
      .map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));

    return { content, tool_calls: toolCallsArr };
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
