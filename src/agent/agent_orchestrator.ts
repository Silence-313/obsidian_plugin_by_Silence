// ── Agent Orchestrator ──────────────────────────────────────
// Central execution pipeline wiring together:
//   Tool Router → Memory Retrieval → LLM Reasoning → Tools → Memory Writer → Response
//
// All decision logic lives here, NOT in the system prompt.

import type { Vault } from "obsidian";
import { routeTool, type RouterResult } from "./tool_router";
import { VectorWikiStore, type VectorSearchResult } from "./vector_wiki_store";
import { WorkingMemory } from "./memory/working_memory";
import { EpisodicMemory } from "./memory/episodic_memory";
import { UserProfile, type UserProfileData } from "./memory/user_profile";
import { ToolMemory } from "./memory/tool_memory";
import { MemoryWriter } from "./memory/memory_writer";

// ── Types ───────────────────────────────────────────────────

export interface OrchestratorConfig {
  vault: Vault;
  wikiFolder: string;
  getApiKey: () => string;
  apiEndpoint: string;
  model: string;
  getTodos: () => any[];
  addTodo: (text: string, color: string, date: string, startTime: string, endTime: string) => void;
  requestUrl: (opts: { url: string; method?: string }) => Promise<{ status: number; json: any; text: string }>;
}

export interface ToolCallResult {
  toolName: string;
  success: boolean;
  result: string;
  latencyMs: number;
}

export interface StreamCallback {
  (content: string): void;
}

// ── Tool Definitions (keep compatible with existing AGENT_TOOLS) ──

const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_current_time",
      description: "获取当前的日期、时间和星期几。",
      parameters: { type: "object" as const, properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_todos",
      description: "查询待办事项。可按日期、状态、优先级筛选。",
      parameters: {
        type: "object" as const,
        properties: {
          date: { type: "string", description: "日期 YYYY-MM-DD" },
          status: { type: "string", description: "'done' | 'pending'" },
          priority: { type: "string", description: "高/中高/中/低" },
          search: { type: "string", description: "关键词搜索" },
          limit: { type: "number", description: "返回上限，默认50" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_todo_stats",
      description: "获取待办统计概览：总数、完成率、按优先级/日期分布。",
      parameters: { type: "object" as const, properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_todos",
      description: "添加待办事项到指定日期。",
      parameters: {
        type: "object" as const,
        properties: {
          date: { type: "string", description: "目标日期 YYYY-MM-DD" },
          todos: {
            type: "array",
            description: "待办列表",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "待办内容" },
                priority: { type: "string", description: "高/中高/中/低，默认中" },
                startTime: { type: "string", description: "开始时间 HH:MM" },
                endTime: { type: "string", description: "结束时间 HH:MM" },
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
    type: "function" as const,
    function: {
      name: "web_search",
      description: "搜索互联网获取实时信息。",
      parameters: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "搜索关键词" },
          num_results: { type: "number", description: "返回数量，默认5，最多10" },
        },
        required: ["query"],
      },
    },
  },
];

// ── Orchestrator ────────────────────────────────────────────

export class AgentOrchestrator {
  private config: OrchestratorConfig;
  private vectorStore: VectorWikiStore;
  private workingMemory: WorkingMemory;
  private episodicMemory: EpisodicMemory;
  private userProfile: UserProfile;
  private toolMemory: ToolMemory;
  private memoryWriter: MemoryWriter;
  private initialized = false;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.vectorStore = new VectorWikiStore();
    this.workingMemory = new WorkingMemory(20);
    this.episodicMemory = new EpisodicMemory(200);
    this.userProfile = new UserProfile();
    this.toolMemory = new ToolMemory();
    this.memoryWriter = new MemoryWriter(this.episodicMemory, this.userProfile, this.toolMemory);
  }

  // ── Initialization ────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load memory from vault
    await this.loadMemoryState();
    // Build vector index from wiki files
    await this.rebuildVectorIndex();

    this.initialized = true;
  }

  // ── Main Pipeline ─────────────────────────────────────────

  /**
   * Process a user message through the full pipeline:
   *   Router → Memory → LLM → Tools → MemoryWriter → Response
   */
  async process(
    userText: string,
    chatHistory: Array<{ role: string; content: string }>,
    onStream?: StreamCallback,
    onActivity?: (msg: string) => void,
  ): Promise<{ response: string; toolCalls: ToolCallResult[] }> {
    const startTime = Date.now();
    const toolCalls: ToolCallResult[] = [];

    // 1. Push to working memory
    this.workingMemory.push({ role: "user", content: userText, timestamp: Date.now() });

    // 2. Tool Router: decide which tool
    const route = routeTool(userText);
    onActivity?.(`路由决策: ${route.tool} (置信度 ${Math.round(route.confidence * 100)}%)`);

    // 3. Memory Retrieval Layer
    const memoryContext = await this.retrieveMemory(userText, route);

    // 4. Build simplified system prompt (no decision logic)
    const systemPrompt = this.buildSystemPrompt(memoryContext);

    // 5. Build messages for LLM
    const messages = this.buildLLMMessages(systemPrompt, chatHistory, userText);

    // 6. Agent loop: probe → maybe tools → stream
    let response: string;

    // First, probe for tool calls (non-streaming)
    const probeResp = await this.callLLM(messages, true);
    const probeChoice = probeResp.choices?.[0];
    const llmToolCalls = probeChoice?.message?.tool_calls ?? [];
    const probeText = probeChoice?.message?.content ?? "";

    if (llmToolCalls.length > 0) {
      // Execute tools locally
      messages.push({ role: "assistant", content: probeText, tool_calls: llmToolCalls });

      for (const tc of llmToolCalls) {
        let args: Record<string, any> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
        onActivity?.(`执行工具: ${tc.function.name}`);

        const toolStart = Date.now();
        const result = await this.executeToolLocal(tc.function.name, args);
        const latencyMs = Date.now() - toolStart;

        toolCalls.push({
          toolName: tc.function.name,
          success: !result.startsWith("Error:"),
          result,
          latencyMs,
        });

        // Record tool usage
        this.toolMemory.recordCall(
          tc.function.name,
          { success: !result.startsWith("Error:"), latencyMs, responseQuality: 0.7 },
          userText,
          route.tool,
        );

        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      // Stream final summary (no tools needed for this call)
      response = await this.streamLLM(messages, false, onStream);
    } else {
      // No tools needed, stream directly
      response = await this.streamLLM(messages, false, onStream);
    }

    // Record for "direct_answer" in tool memory
    if (llmToolCalls.length === 0) {
      this.toolMemory.recordCall(
        "direct_answer",
        { success: true, latencyMs: Date.now() - startTime, responseQuality: 0.7 },
        userText,
        route.tool,
      );
    }

    // 7. Push to working memory
    this.workingMemory.push({ role: "assistant", content: response, timestamp: Date.now() });

    // 8. Memory Writer: analyze and persist
    const decisions = this.memoryWriter.analyze({
      userMessage: userText,
      assistantResponse: response,
      toolUsed: route.tool,
      toolResult: toolCalls.map(tc => tc.result).join("\n"),
      routerConfidence: route.confidence,
      timestamp: Date.now(),
    });
    this.memoryWriter.commit(decisions, {
      userMessage: userText,
      assistantResponse: response,
      toolUsed: route.tool,
      toolResult: toolCalls.map(tc => tc.result).join("\n"),
      routerConfidence: route.confidence,
      timestamp: Date.now(),
    });

    // 9. Persist memory state (debounced in practice, here we save on each interaction)
    await this.saveMemoryState();

    return { response, toolCalls };
  }

  // ── Memory Retrieval Layer ─────────────────────────────────

  private async retrieveMemory(
    query: string,
    route: RouterResult,
  ): Promise<{
    wikiResults: VectorSearchResult[];
    episodicContext: string;
    profileContext: string;
    toolStats: string;
  }> {
    // Vector wiki search (always, for context)
    const wikiResults = this.vectorStore.search(query, 3);

    // Episodic memory search
    let episodicContext = "";
    if (route.tool === "memory_search" || route.confidence < 0.7) {
      episodicContext = this.episodicMemory.formatForContext(5);
    }

    // User profile context
    const profileContext = this.userProfile.formatForContext();

    // Tool stats for routing insights
    const toolStats = this.toolMemory.getStats(route.tool)
      ? `Tool "${route.tool}" success rate: ${Math.round(this.toolMemory.getSuccessRate(route.tool) * 100)}%`
      : "";

    return { wikiResults, episodicContext, profileContext, toolStats };
  }

  // ── Simplified System Prompt ──────────────────────────────

  private buildSystemPrompt(memory: {
    wikiResults: VectorSearchResult[];
    episodicContext: string;
    profileContext: string;
    toolStats: string;
  }): string {
    const now = new Date();
    const timeContext = `当前时间: ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} 星期${["日", "一", "二", "三", "四", "五", "六"][now.getDay()]}`;

    const wikiSection = memory.wikiResults.length > 0
      ? `\n## 知识库相关上下文\n${memory.wikiResults.map(r =>
        `- [${r.sourcePath}] (相关度: ${Math.round(r.score * 100)}%)\n  ${r.content.substring(0, 500)}`
      ).join("\n")}`
      : "";

    const episodicSection = memory.episodicContext
      ? `\n## 近期事件记忆\n${memory.episodicContext}`
      : "";

    const profileSection = memory.profileContext
      ? `\n${memory.profileContext}`
      : "";

    // Simplified prompt: role definition + tool schemas only, NO routing rules
    return `你是用户的个人 AI 助手，拥有工具调用能力。用中文回复，清晰简洁。

## ${timeContext}
${profileSection}
${wikiSection}
${episodicSection}

## 规则
- 基于提供的知识库内容和记忆回答用户问题
- 如果知识库中有相关信息，注明来源
- 如果知识库中没有，可以基于常识回答，但要说明
- 使用可用工具获取实时数据（时间、待办、搜索等）
- 不要编造不存在的内容
- 不要使用 Markdown 表格`;
  }

  private buildLLMMessages(
    systemPrompt: string,
    chatHistory: Array<{ role: string; content: string }>,
    userText: string,
  ): any[] {
    return [
      { role: "system", content: systemPrompt },
      ...chatHistory.slice(-10),
      { role: "user", content: userText },
    ];
  }

  // ── Tool Execution ────────────────────────────────────────

  private async executeToolLocal(name: string, args: Record<string, any>): Promise<string> {
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
        const todos = this.config.getTodos();
        const priorityLabels: Record<string, string> = {
          "#e53935": "高", "#fb8c00": "中高", "#fdd835": "中", "#43a047": "低",
        };
        let filtered = [...todos];
        if (args.date) filtered = filtered.filter((t: any) => t.date === args.date);
        if (args.status === "done") filtered = filtered.filter((t: any) => t.done);
        else if (args.status === "pending") filtered = filtered.filter((t: any) => !t.done);
        if (args.priority) filtered = filtered.filter((t: any) => priorityLabels[t.color] === args.priority);
        if (args.search) {
          const kw = args.search.toLowerCase();
          filtered = filtered.filter((t: any) => t.text.toLowerCase().includes(kw));
        }
        const limit = args.limit || 50;
        const results = filtered.slice(0, limit).map((t: any) => ({
          id: t.id, text: t.text,
          status: t.done ? "已完成" : "未完成",
          priority: priorityLabels[t.color] || "未知",
          date: t.date, startTime: t.startTime || "", endTime: t.endTime || "",
        }));
        results.sort((a: any, b: any) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return a.status === "未完成" ? -1 : 1;
        });
        return JSON.stringify({ total: todos.length, matched: filtered.length, returned: results.length, todos: results }, null, 2);
      }

      case "get_todo_stats": {
        const todos = this.config.getTodos();
        const priorityLabels: Record<string, string> = {
          "#e53935": "高", "#fb8c00": "中高", "#fdd835": "中", "#43a047": "低",
        };
        const doneCount = todos.filter((t: any) => t.done).length;
        const totalCount = todos.length;
        const byPriority: Record<string, any> = {};
        for (const t of todos as any[]) {
          const key = t.color || "unknown";
          if (!byPriority[key]) byPriority[key] = { label: priorityLabels[key] || "未知", total: 0, done: 0, rate: 0 };
          byPriority[key].total++;
          if (t.done) byPriority[key].done++;
        }
        for (const v of Object.values(byPriority)) {
          v.rate = v.total > 0 ? Math.round((v.done / v.total) * 100) : 0;
        }
        const pending = todos.filter((t: any) => !t.done).sort((a: any, b: any) => a.date.localeCompare(b.date)).slice(0, 20);
        return JSON.stringify({
          overview: {
            totalCount, doneCount,
            pendingCount: totalCount - doneCount,
            completionRate: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
          },
          byPriority,
          pendingTop20: pending.map((t: any) => ({ text: t.text, priority: priorityLabels[t.color] || "?", date: t.date })),
        }, null, 2);
      }

      case "add_todos": {
        const priorityMap: Record<string, string> = {
          "高": "#e53935", "中高": "#fb8c00", "中": "#fdd835", "低": "#43a047",
        };
        const dateKey: string = args.date || "";
        if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          return JSON.stringify({ error: "date 必须为 YYYY-MM-DD 格式" });
        }
        const items: Array<{ text: string; priority?: string; startTime?: string; endTime?: string }> = args.todos || [];
        if (!Array.isArray(items) || items.length === 0) {
          return JSON.stringify({ error: "todos 必须是非空数组" });
        }
        const added: Array<{ text: string; priority: string }> = [];
        for (const item of items) {
          if (!item.text) continue;
          const priority = item.priority || "中";
          const color = priorityMap[priority] || "#fdd835";
          this.config.addTodo(item.text, color, dateKey, item.startTime || "", item.endTime || "");
          added.push({ text: item.text, priority });
        }
        return JSON.stringify({ success: true, date: dateKey, count: added.length, todos: added }, null, 2);
      }

      case "web_search": {
        const query = args.query?.trim();
        if (!query) return JSON.stringify({ error: "query 不能为空" });
        const numResults = Math.min(args.num_results || 5, 10);
        try {
          const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
          const apiResp = await this.config.requestUrl({ url: apiUrl });
          if (apiResp.status === 200) {
            const data = apiResp.json;
            const results: Array<{ title: string; snippet: string; url: string }> = [];
            if (data.AbstractText) {
              results.push({ title: data.Heading || query, snippet: (data.AbstractText as string).substring(0, 500), url: data.AbstractURL || "" });
            }
            const collectTopics = (ts: any[]) => {
              for (const t of ts) {
                if (results.length >= numResults) break;
                if (t.Text) {
                  const parts = (t.Text as string).split(" - ");
                  results.push({ title: (parts[0] || t.Text).substring(0, 120), snippet: (t.Text as string).substring(0, 300), url: t.FirstURL || "" });
                }
                if (t.Topics) collectTopics(t.Topics);
              }
            };
            collectTopics(data.RelatedTopics || []);
            if (results.length > 0) return JSON.stringify({ query, resultCount: results.length, results }, null, 2);
          }
        } catch { /* fall through */ }
        // HTML fallback
        try {
          const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const htmlResp = await this.config.requestUrl({ url: htmlUrl });
          if (htmlResp.status === 200) {
            const html = htmlResp.text;
            const results: Array<{ title: string; snippet: string; url: string }> = [];
            const re = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\//gi;
            let match;
            while ((match = re.exec(html)) !== null && results.length < numResults) {
              const rawTitle = match[2].replace(/<[^>]+>/g, "").trim();
              const rawSnippet = match[3].replace(/<[^>]+>/g, "").trim();
              if (!rawTitle || !rawSnippet) continue;
              const uddgMatch = match[1].match(/uddg=(https?%3A[^&]+)/);
              results.push({ title: rawTitle.substring(0, 120), snippet: rawSnippet.substring(0, 300), url: uddgMatch ? decodeURIComponent(uddgMatch[1]) : match[1] });
            }
            if (results.length > 0) return JSON.stringify({ query, resultCount: results.length, results }, null, 2);
          }
        } catch { /* fall through */ }
        return JSON.stringify({ query, message: "未找到搜索结果", results: [] });
      }

      default:
        return `Error: Unknown tool "${name}"`;
    }
  }

  // ── LLM API Calls ─────────────────────────────────────────

  private async callLLM(messages: any[], withTools: boolean): Promise<any> {
    const endpoint = this.config.apiEndpoint.replace(/\/$/, "");
    const body: any = {
      model: this.config.model,
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
        "Authorization": `Bearer ${this.config.getApiKey()}`,
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

  private async streamLLM(
    messages: any[],
    withTools: boolean,
    onChunk?: StreamCallback,
  ): Promise<string> {
    const endpoint = this.config.apiEndpoint.replace(/\/$/, "");
    const body: any = {
      model: this.config.model,
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
        "Authorization": `Bearer ${this.config.getApiKey()}`,
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
          if (delta?.content) {
            content += delta.content;
            hasContent = true;
          }
        } catch { /* skip */ }
      }

      if (hasContent && onChunk) {
        onChunk(content);
        const now = Date.now();
        if (now - lastPaint > 50) {
          lastPaint = now;
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    return content;
  }

  // ── Vector Index Management ───────────────────────────────

  async rebuildVectorIndex(): Promise<void> {
    const vault = this.config.vault;
    const wikiFolder = this.config.wikiFolder;
    const allFiles = vault.getFiles();

    const wikiFiles = allFiles.filter(
      f => f.path.startsWith(wikiFolder) && f.extension === "md"
    );

    if (wikiFiles.length === 0) return;

    const docs = [];
    for (const file of wikiFiles) {
      try {
        const content = await vault.read(file);
        if (content.trim().length > 0) {
          docs.push({ path: file.path, content });
        }
      } catch { /* skip */ }
    }

    this.vectorStore.build(docs);
  }

  // ── Memory Persistence ────────────────────────────────────

  private get memoryBasePath(): string {
    return `${this.config.wikiFolder}/agent/memory`;
  }

  private async loadMemoryState(): Promise<void> {
    const vault = this.config.vault;
    const base = this.memoryBasePath;
    const allFiles = vault.getFiles();

    const loadJson = async (path: string): Promise<string | null> => {
      try {
        const file = allFiles.find(f => f.path === path);
        if (file) return await vault.read(file);
      } catch { /* */ }
      return null;
    };

    // Load episodic memory
    const episodicJson = await loadJson(`${base}/episodic.json`);
    if (episodicJson) this.episodicMemory.deserialize(episodicJson);

    // Load user profile
    const profileJson = await loadJson(`${base}/profile.json`);
    if (profileJson) this.userProfile.deserialize(profileJson);

    // Load tool memory
    const toolJson = await loadJson(`${base}/tool_stats.json`);
    if (toolJson) this.toolMemory.deserialize(toolJson);

    // Load vector index
    const indexJson = await loadJson(`${base}/vector_index.json`);
    if (indexJson) this.vectorStore.deserialize(indexJson);
  }

  async saveMemoryState(): Promise<void> {
    const vault = this.config.vault;
    const base = this.memoryBasePath;

    // Ensure directory exists
    const exists = await vault.adapter.exists(base);
    if (!exists) {
      // Create parent dirs
      const parts = base.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join("/");
        if (!(await vault.adapter.exists(sub))) {
          await vault.adapter.mkdir(sub);
        }
      }
    }

    const allFiles = vault.getFiles();

    const writeJson = async (filename: string, content: string) => {
      const path = `${base}/${filename}`;
      const existing = allFiles.find(f => f.path === path);
      if (existing) {
        await vault.modify(existing, content);
      } else {
        await vault.create(path, content);
      }
    };

    await writeJson("episodic.json", this.episodicMemory.serialize());
    await writeJson("profile.json", this.userProfile.serialize());
    await writeJson("tool_stats.json", this.toolMemory.serialize());
    await writeJson("vector_index.json", this.vectorStore.serialize());
  }

  // ── Public Accessors (for UI/display) ─────────────────────

  get memoryStats(): {
    episodicCount: number;
    profileInitialized: boolean;
    vectorDocCount: number;
    toolsTracked: string[];
  } {
    return {
      episodicCount: this.episodicMemory.count,
      profileInitialized: this.userProfile.isInitialized(),
      vectorDocCount: this.vectorStore.documentCount,
      toolsTracked: this.toolMemory.getAllStats().map(s => s.toolName),
    };
  }

  getProfile(): Readonly<UserProfileData> {
    return this.userProfile.profile;
  }

  searchEpisodic(query: string, topK?: number) {
    return this.episodicMemory.search(query, topK);
  }

  searchWiki(query: string, topK?: number) {
    return this.vectorStore.search(query, topK);
  }
}
