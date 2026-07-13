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
import { MarkdownMemoryStore } from "./memory/memory_store";
import { ConceptGraphBuilder } from "./reasoning/concept_graph_builder";
import { ConceptReasoner, type ReasoningResult } from "./reasoning/concept_reasoner";
import { FeedbackProcessor } from "./reasoning/feedback_processor";
import { ConceptEvolver } from "./reasoning/concept_evolver";
import { MutationQueue } from "./core/mutation_queue";
import { StateMutationEngine } from "./core/state_mutation_engine";
import { CognitiveState, createEmptyState } from "./core/cognitive_state";
import { ToolDecisionPolicy, type ToolDecisionResult } from "./tools/tool_decision_policy";
import { SkillRegistry, createDefaultSkillRegistry, type SkillResult } from "./skills";
import { RouterTelemetry } from "./router_telemetry";
import { RagFeedback } from "./rag_feedback";

// ── Types ───────────────────────────────────────────────────

export interface OrchestratorConfig {
  vault: Vault;
  wikiFolder: string;
  getApiKey: () => string;
  apiEndpoint: string;
  model: string;
  getTodos: () => any[];
  addTodo: (text: string, color: string, date: string, startTime: string, endTime: string) => void;
  deleteTodo: (id: string) => void;
  requestUrl: (opts: { url: string; method?: string }) => Promise<{ status: number; json: any; text: string }>;
  // Note editing callbacks (optional, for note-assistant component)
  getActiveNoteContent?: () => string;
  insertIntoNote?: (text: string) => boolean;
  replaceInNote?: (oldText: string, newText: string) => boolean;
  appendToNote?: (text: string) => boolean;
  getNoteSelection?: () => string;
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

// ── Health ────────────────────────────────────────────────────

export interface AgentHealth {
  status: "healthy" | "degraded" | "error";
  initialized: boolean;
  interactionCount: number;
  lastError: string | null;
  lastErrorTime: number | null;
  consecutiveErrors: number;
  reentrancyBlocked: number;
  memoryStats: {
    episodicCount: number;
    episodicActive: number;
    vectorDocCount: number;
    toolsTracked: number;
    routerAccuracy: number;
  };
  cognitiveHealth: number | null;
  uptimeMs: number;
}

// ── Constants ─────────────────────────────────────────────────

const MAX_CONSECUTIVE_ERRORS = 5;
const LLM_TIMEOUT_MS = 60_000; // 60 second timeout for LLM calls
const MAX_SYSTEM_PROMPT_CHARS = 8_000;

/** Detect tool result errors in both plain-text ("Error:...") and JSON ({"error":"..."}) forms. */
function isToolResultError(result: string): boolean {
  if (result.startsWith("Error:")) return true;
  if (result.startsWith('{"error":')) return true;
  return false;
}

/** Format tool result for injection into system prompt, with human-readable summary. */
function formatToolResultSection(toolName: string, result: string): string {
  let summary = "";
  try {
    const parsed = JSON.parse(result);
    if (parsed.error) {
      summary = `\n**结果: 执行失败** — ${parsed.error}`;
    } else if (parsed.matched !== undefined && parsed.matched === 0) {
      summary = `\n**结果: 没有找到匹配的待办事项。** 请如实告诉用户今天没有任何待办，不要编造内容。`;
    } else if (parsed.success === true && parsed.count !== undefined) {
      const items = parsed.todos?.map((t: any) => `  - ${t.text}`).join("\n") || "";
      summary = `\n**结果: 成功** — 已添加 ${parsed.count} 条待办到 ${parsed.date}${items ? ":\n" + items : ""}`;
    } else if (parsed.todos && Array.isArray(parsed.todos)) {
      summary = `\n**结果: 查询成功** — 找到 ${parsed.returned || parsed.todos.length} 条待办`;
    }
  } catch { /* not JSON, use raw */ }
  return `\n## 工具执行结果\n工具 "${toolName}" 的执行结果:${summary}\n原始输出: ${result.substring(0, 600)}\n`;
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
      name: "delete_todo",
      description: "删除或完成待办事项。支持按文本关键词、ID、时间段匹配。",
      parameters: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "待办内容关键词模糊匹配，也支持时间如'09:30'或'09:30-10:30'格式" },
          id: { type: "string", description: "待办 ID，精确匹配" },
          date: { type: "string", description: "限定日期 YYYY-MM-DD，不传则搜索全部日期" },
          startTime: { type: "string", description: "按开始时间匹配 HH:MM" },
          endTime: { type: "string", description: "按结束时间匹配 HH:MM" },
          mark_done: { type: "boolean", description: "设为 true 表示标记完成而非删除。默认 false（删除）。" },
        },
        required: [],
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
  {
    type: "function" as const,
    function: {
      name: "list_wiki_files",
      description: "列出知识库中所有文件。可按目录前缀过滤。",
      parameters: {
        type: "object" as const,
        properties: {
          prefix: { type: "string", description: "可选的目录前缀过滤，如 'concepts/' 或 'summaries/'。不传则列出全部。" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_wiki_file",
      description: "读取知识库中的指定文件内容。",
      parameters: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "文件在知识库中的相对路径，如 'concepts/用户画像.md' 或 'index.md'" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_wiki_file",
      description: "创建或更新知识库中的文件。会覆盖已有文件内容。支持创建新目录。",
      parameters: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "文件在知识库中的相对路径，如 'concepts/新概念.md'" },
          content: { type: "string", description: "文件内容（Markdown 格式）" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_wiki_file",
      description: "删除知识库中的指定文件。删除后无法恢复，请谨慎使用。",
      parameters: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "要删除的文件在知识库中的相对路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_wiki",
      description: "在知识库文件中搜索关键词，返回匹配的文件和内容片段。",
      parameters: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "搜索关键词" },
          limit: { type: "number", description: "返回结果数上限，默认5" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "insert_into_note",
      description: "在光标位置插入文本。用于在用户当前编辑的笔记中插入内容，如补全段落、添加注释、插入代码片段等。",
      parameters: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "要插入的文本内容" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "replace_in_note",
      description: "在用户当前编辑的笔记中查找并替换指定文本。用于修改笔记中的内容。oldText 必须精确匹配笔记中的某段文本。",
      parameters: {
        type: "object" as const,
        properties: {
          oldText: { type: "string", description: "要被替换的原文本（需精确匹配）" },
          newText: { type: "string", description: "替换后的新文本" },
        },
        required: ["oldText", "newText"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "append_to_note",
      description: "在用户当前编辑的笔记末尾追加文本。用于添加新的章节、总结、或补充内容。",
      parameters: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "要追加到笔记末尾的文本" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_note_selection",
      description: "获取用户在笔记中当前选中的文本。用于理解用户正在关注的具体内容。",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
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
  private markdownStore: MarkdownMemoryStore;
  private conceptGraphBuilder: ConceptGraphBuilder;
  private conceptReasoner: ConceptReasoner;
  private feedbackProcessor: FeedbackProcessor;
  private conceptEvolver: ConceptEvolver;
  private mutationQueue: MutationQueue;
  private mutationEngine: StateMutationEngine;
  private toolDecisionPolicy: ToolDecisionPolicy;
  private skillRegistry: SkillRegistry;
  private lastReasoningResult: ReasoningResult | null = null;
  private routerTelemetry: RouterTelemetry;
  private ragFeedback: RagFeedback;
  private interactionCount = 0;
  private readonly EVOLUTION_CYCLE_INTERVAL = 10;
  private initialized = false;
  // Safety: prevent concurrent process() calls
  private processing = false;
  private consecutiveErrors = 0;
  private lastError: string | null = null;
  private lastErrorTime: number | null = null;
  private reentrancyBlocked = 0;
  private readonly startTime = Date.now();

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.vectorStore = new VectorWikiStore();
    this.workingMemory = new WorkingMemory(20);
    this.episodicMemory = new EpisodicMemory(200);
    this.userProfile = new UserProfile();
    this.toolMemory = new ToolMemory();
    this.markdownStore = new MarkdownMemoryStore(config.vault, `${config.wikiFolder}/agent/memory`);
    // Mutation system: all state changes go through queue → engine
    this.mutationQueue = new MutationQueue();
    this.mutationEngine = new StateMutationEngine(
      this.markdownStore,
      this.episodicMemory,
      this.userProfile,
    );
    this.memoryWriter = new MemoryWriter(
      this.episodicMemory, this.userProfile, this.toolMemory,
      this.markdownStore, this.mutationQueue,
    );
    this.conceptGraphBuilder = new ConceptGraphBuilder();
    this.conceptReasoner = new ConceptReasoner();
    this.feedbackProcessor = new FeedbackProcessor(
      this.markdownStore, undefined, this.mutationQueue,
    );
    this.conceptEvolver = new ConceptEvolver(this.markdownStore, this.mutationQueue);
    this.toolDecisionPolicy = new ToolDecisionPolicy({
      getApiKey: config.getApiKey,
      apiEndpoint: config.apiEndpoint,
      model: config.model,
    });
    this.skillRegistry = createDefaultSkillRegistry();
    this.routerTelemetry = new RouterTelemetry();
    this.ragFeedback = new RagFeedback();
  }

  // ── Initialization ────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load memory from vault
    await this.loadMemoryState();

    // Load cognitive policy
    await this.feedbackProcessor.loadPolicy().catch(() => { /* use defaults */ });
    // Build vector index from wiki files
    await this.rebuildVectorIndex();

    this.initialized = true;
  }

  // ── Input Sanitization ─────────────────────────────────────

  /**
   * Strip leaked tool call blocks from the final response text (safety net).
   */
  private stripToolCallText(text: string): string {
    // XML/DSML-style tool call blocks
    text = text.replace(/<\|DSML\|tool_calls>[\s\S]*?<\/\|DSML\|tool_calls>/g, "");
    text = text.replace(/<invoke\s+name="[^"]+"\s*>[\s\S]*?<\/invoke>/g, "");
    text = text.replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "");

    // Plain-text tool call simulations
    // "工具调用\nadd_todos", "调用工具: web_search", "tool_call: xxx" etc.
    text = text.replace(/(?:工具调用|调用工具|执行工具|tool[_\s]?call|function[_\s]?call)[:：]?\s*\n?\s*\w+/gi, "");

    // Trailing lines that are just a tool/function name after a line break
    // e.g. "...\n\nadd_todos\n" at end of response
    const knownTools = ["add_todos", "delete_todo", "get_todos", "get_todo_stats", "get_current_time",
      "web_search", "search_wiki", "list_wiki_files", "read_wiki_file",
      "write_wiki_file", "delete_wiki_file"];
    for (const tool of knownTools) {
      // Strip bare tool name that appears as its own line at the end
      const toolRegex = new RegExp(`\\n\\s*${tool.replace(/_/g, "_")}\\s*$`, "g");
      text = text.replace(toolRegex, "");
    }

    // Clean up multiple consecutive newlines left by stripping
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
  }

  /**
   * Sanitize user input to prevent prompt injection.
   * Strips markdown code fences and blocks known injection patterns.
   */
  private sanitizeInput(text: string): string {
    // Strip markdown code fences that could leak system instructions
    let sanitized = text.replace(/```[\s\S]*?```/g, "[code block removed]");
    // Strip JSON blocks that might contain system prompt attacks
    sanitized = sanitized.replace(/\{[\s\S]*?"role"\s*:\s*"system"[\s\S]*?\}/gi, "[system prompt block removed]");
    // Truncate excessively long inputs
    if (sanitized.length > 4000) {
      sanitized = sanitized.substring(0, 4000) + "\n...(message truncated)";
    }
    return sanitized;
  }

  /** Extract todo items from user query text (markdown bullets, numbered items, delimiters). */
  private extractTodoItems(text: string): Array<{ text: string; priority?: string }> {
    const items: Array<{ text: string; priority?: string }> = [];
    // Split by newlines, filter empty
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
    // Try markdown list: "- xxx", "* xxx", "• xxx", "+ xxx"
    const bulletLines = lines.filter(l => /^[-*•+] /.test(l));
    if (bulletLines.length > 0) {
      for (const line of bulletLines) {
        const content = line.replace(/^[-*•+] /, "").trim();
        if (content && content.length < 200) items.push({ text: content });
      }
      return items;
    }
    // Try numbered list: "1. xxx"
    const numLines = lines.filter(l => /^\d+[\.\)、] /.test(l));
    if (numLines.length > 0) {
      for (const line of numLines) {
        const content = line.replace(/^\d+[\.\)、] /, "").trim();
        if (content && content.length < 200) items.push({ text: content });
      }
      return items;
    }
    // Try Chinese delimiters: 、or ，splitting
    for (const line of lines) {
      const parts = line.split(/[、，]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 200);
      if (parts.length >= 2) {
        for (const p of parts) items.push({ text: p });
      }
    }
    return items;
  }

  // ── Health Check ───────────────────────────────────────────

  /**
   * Return a comprehensive health snapshot of the agent system.
   * Useful for monitoring, diagnostics, and UI health indicators.
   */
  healthCheck(): AgentHealth {
    let cognitiveHealth: number | null = null;
    try {
      const controller = this.feedbackProcessor.controller;
      cognitiveHealth = controller.computeHealth(
        [], this.episodicMemory.count, 0,
      ).overallHealth;
    } catch { /* */ }

    return {
      status: this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS ? "error"
        : this.consecutiveErrors > 0 ? "degraded"
        : "healthy",
      initialized: this.initialized,
      interactionCount: this.interactionCount,
      lastError: this.lastError,
      lastErrorTime: this.lastErrorTime,
      consecutiveErrors: this.consecutiveErrors,
      reentrancyBlocked: this.reentrancyBlocked,
      memoryStats: {
        episodicCount: this.episodicMemory.count,
        episodicActive: this.episodicMemory.activeCount,
        vectorDocCount: this.vectorStore.documentCount,
        toolsTracked: this.toolMemory.getAllStats().length,
        routerAccuracy: this.routerTelemetry.getOverallAccuracy(),
      },
      cognitiveHealth,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  // ── Main Pipeline ─────────────────────────────────────────

  /**
   * Process a user message through the full pipeline:
   *   Router → Memory → LLM → Tools → MemoryWriter → Response
   *
   * Thread-safety: prevents concurrent calls via reentrancy guard.
   * Error recovery: LLM failures degrade gracefully to direct response.
   */
  async process(
    userText: string,
    chatHistory: Array<{ role: string; content: string }>,
    onStream?: StreamCallback,
    onActivity?: (msg: string) => void,
  ): Promise<{ response: string; toolCalls: ToolCallResult[] }> {
    // Reentrancy guard: prevent concurrent calls from corrupting shared state
    if (this.processing) {
      this.reentrancyBlocked++;
      return {
        response: "系统正忙，请稍后再试。",
        toolCalls: [],
      };
    }
    this.processing = true;

    const startTime = Date.now();
    const toolCalls: ToolCallResult[] = [];
    const sanitizedText = this.sanitizeInput(userText);

    // Start a new mutation cycle for this interaction
    this.mutationQueue.newCycle();

    try {
    // 1. Push to working memory
    this.workingMemory.push({ role: "user", content: sanitizedText, timestamp: Date.now() });

    // 2. Tool Router: decide which tool (with adaptive telemetry)
    const route = routeTool(sanitizedText, this.routerTelemetry);
    onActivity?.(`路由决策: ${route.tool} (置信度 ${Math.round(route.confidence * 100)}%)`);

    // 3. Memory Retrieval Layer (including concept reasoning)
    const memoryContext = await this.retrieveMemory(sanitizedText, route);
    if (memoryContext.conceptReasoning) {
      onActivity?.("概念推理完成");
    }

    // 3.5 Tool & Skill Decision Layer: LLM autonomously decides tool/skill usage
    let toolDecisionResult: ToolDecisionResult | null = null;
    let proactiveToolResult: string | null = null;
    let proactiveSkillResult: SkillResult | null = null;

    try {
      const toolCtx = {
        userQuery: sanitizedText,
        wikiContext: memoryContext.wikiResults.map(r => r.content).join("\n"),
        conceptContext: memoryContext.conceptReasoning,
        episodicContext: memoryContext.episodicContext,
        availableTools: [
            "web_search", "get_todos", "add_todos", "delete_todo", "get_todo_stats",
            "get_current_time", "list_wiki_files", "read_wiki_file", "write_wiki_file",
            "delete_wiki_file", "search_wiki",
            // Note editing tools (only available when editor callbacks are provided)
            ...(this.config.insertIntoNote ? ["insert_into_note" as const] : []),
            ...(this.config.replaceInNote ? ["replace_in_note" as const] : []),
            ...(this.config.appendToNote ? ["append_to_note" as const] : []),
            ...(this.config.getNoteSelection ? ["get_note_selection" as const] : []),
          ],
        availableSkills: this.skillRegistry.getAll(),
      };

      toolDecisionResult = await this.toolDecisionPolicy.decide(toolCtx);
      onActivity?.(
        `工具决策: ${toolDecisionResult.decision.use_tool ? toolDecisionResult.decision.tool_name : "不需要工具"} ` +
        `(置信度 ${Math.round(toolDecisionResult.decision.confidence * 100)}%${toolDecisionResult.fallbackUsed ? ", fallback" : ""})`
      );

      // If LLM decided to use a tool, execute it proactively
      if (toolDecisionResult.decision.use_tool && toolDecisionResult.decision.tool_name) {
        const toolName = toolDecisionResult.decision.tool_name;
        const queryForTool = toolDecisionResult.decision.query_rewrite || sanitizedText;

        onActivity?.(`自主执行工具: ${toolName}`);
        const toolStart = Date.now();
        let toolArgs: Record<string, unknown> = {};

        // Prefer structured tool_args from LLM decision, fallback to heuristic extraction
        if (toolDecisionResult.decision.tool_args && Object.keys(toolDecisionResult.decision.tool_args).length > 0) {
          toolArgs = { ...toolDecisionResult.decision.tool_args };
        } else {
          // Build tool-specific args from the rewritten query (heuristic fallback)
          if (toolName === "web_search") {
            toolArgs.query = queryForTool;
          } else if (toolName === "get_todos") {
            if (/今天/.test(queryForTool)) toolArgs.date = new Date().toISOString().split("T")[0];
            if (/未完成|还没做/.test(queryForTool)) toolArgs.status = "pending";
          } else if (toolName === "add_todos") {
            const now = new Date();
            const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            toolArgs.date = /今天/.test(sanitizedText) ? dateStr : dateStr;
            // Extract todo items from query: markdown bullets, numbered items, or delimited list
            const items = this.extractTodoItems(sanitizedText);
            if (items.length > 0) toolArgs.todos = items;
          } else if (toolName === "search_wiki") {
            toolArgs.query = queryForTool;
          } else if (toolName === "list_wiki_files") {
            const prefixMatch = queryForTool.match(/(summaries|concepts|agent)/);
            if (prefixMatch) toolArgs.prefix = prefixMatch[1];
          }
        }

        proactiveToolResult = await this.executeToolLocal(toolName, toolArgs);
        const toolLatency = Date.now() - toolStart;

        toolCalls.push({
          toolName,
          success: !isToolResultError(proactiveToolResult),
          result: proactiveToolResult,
          latencyMs: toolLatency,
        });

        // Record tool usage
        this.toolMemory.recordCall(
          toolName,
          { success: !isToolResultError(proactiveToolResult), latencyMs: toolLatency, responseQuality: 0.7 },
          sanitizedText,
          route.tool,
        );

        // Store tool decision log
        this.markdownStore.saveToolDecision({
          id: `td-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          userQuery: sanitizedText,
          useTool: toolDecisionResult.decision.use_tool,
          toolName: toolDecisionResult.decision.tool_name,
          confidence: toolDecisionResult.decision.confidence,
          reason: toolDecisionResult.decision.reason,
          queryRewrite: toolDecisionResult.decision.query_rewrite,
          fallbackUsed: toolDecisionResult.fallbackUsed,
          rawResponse: toolDecisionResult.rawResponse,
          latencyMs: toolDecisionResult.latencyMs,
        }).catch(() => { /* best-effort log */ });

        // Skill execution: if LLM decided to use a skill
        if (toolDecisionResult.decision.use_skill && toolDecisionResult.decision.skill_name) {
          const skillName = toolDecisionResult.decision.skill_name;
          const skillArgs = toolDecisionResult.decision.query_rewrite
            ? { path: toolDecisionResult.decision.query_rewrite }
            : {};

          onActivity?.(`自主执行技能: ${skillName}`);
          proactiveSkillResult = await this.skillRegistry.execute(skillName, skillArgs, {
            vault: this.config.vault,
          });

          // If skill result has useful data, add to tool calls for tracking
          if (proactiveSkillResult.success) {
            onActivity?.(`技能执行成功: ${skillName}`);
          } else {
            onActivity?.(`技能执行失败: ${proactiveSkillResult.error || "unknown"}`);
          }
        }
      }
    } catch (decisionError: any) {
      // Tool decision layer failure → fall through to existing router behavior
      onActivity?.(`工具决策失败，回退到路由: ${decisionError?.message?.substring?.(0, 60) || "unknown"}`);
    }

    // 4. Build enhanced system prompt (with reasoning context)
    // If proactive tool/skill was executed, inject result into system prompt
    const toolResultSection = proactiveToolResult
      ? formatToolResultSection(toolDecisionResult?.decision.tool_name || "unknown", proactiveToolResult)
      : "";
    const skillResultSection = proactiveSkillResult?.success
      ? `\n## 技能执行结果\n技能 "${toolDecisionResult?.decision.skill_name}" 的执行结果:\n${JSON.stringify(proactiveSkillResult.data).substring(0, 800)}\n`
      : (proactiveSkillResult && !proactiveSkillResult.success
        ? `\n## 技能执行失败\n${proactiveSkillResult.error}\n`
        : "");
    const systemPrompt = this.buildSystemPrompt(memoryContext) + toolResultSection + skillResultSection;

    // 5. Build messages for LLM
    const messages = this.buildLLMMessages(systemPrompt, chatHistory, sanitizedText);

    // 6. LLM call (tools handled proactively by ToolDecisionPolicy in step 3.5)
    let response: string;
    let llmFailed = false;

    try {
      // DeepSeek does not support native function calling — tools are handled
      // proactively by ToolDecisionPolicy before this LLM call (see step 3.5).
      // We never pass `tools` to the API to prevent the model from outputting
      // tool call syntax as visible text.
      response = await this.streamLLMWithTimeout(messages, onStream);
    } catch (llmError: any) {
      // LLM failure — graceful degradation
      llmFailed = true;
      this.consecutiveErrors++;
      this.lastError = llmError?.message || String(llmError);
      this.lastErrorTime = Date.now();
      response = `抱歉，AI 服务暂时不可用（${llmError?.message?.substring?.(0, 80) || "网络错误"}）。请稍后重试或检查 API 配置。`;
      onActivity?.(`LLM 调用失败: ${this.lastError}`);
    }

    // Reset error counter on success
    if (!llmFailed) {
      this.consecutiveErrors = 0;
    }

    // Record for "direct_answer" in tool memory
    this.toolMemory.recordCall(
      "direct_answer",
      { success: true, latencyMs: Date.now() - startTime, responseQuality: 0.7 },
      userText,
      route.tool,
    );

    // 6.5 Strip leaked tool call blocks from response (safety net)
    response = this.stripToolCallText(response);

    // 7. Push to working memory
    this.workingMemory.push({ role: "assistant", content: response, timestamp: Date.now() });

    // 8. Memory Writer: analyze and persist
    const decisions = this.memoryWriter.analyze({
      userMessage: sanitizedText,
      assistantResponse: response,
      toolUsed: route.tool,
      toolResult: toolCalls.map(tc => tc.result).join("\n"),
      routerConfidence: route.confidence,
      timestamp: Date.now(),
    });
    this.memoryWriter.commit(decisions, {
      userMessage: sanitizedText,
      assistantResponse: response,
      toolUsed: route.tool,
      toolResult: toolCalls.map(tc => tc.result).join("\n"),
      routerConfidence: route.confidence,
      timestamp: Date.now(),
    });

    // 9. Router Telemetry: record routing decision with outcome
    this.routerTelemetry.recordRouting({
      query: sanitizedText,
      selectedTool: route.tool,
      confidence: route.confidence,
      executionSuccess: toolCalls.length === 0 || toolCalls.every(tc => tc.success),
      latencyMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    // 10. RAG Feedback: record retrieval quality
    if (memoryContext.wikiResults.length > 0) {
      const usedDocs = memoryContext.wikiResults
        .filter(r => response.includes(r.sourcePath) || response.includes(r.content.substring(0, 50)))
        .map(r => r.sourcePath);
      this.ragFeedback.recordRetrieval({
        query: sanitizedText,
        retrievedDocs: memoryContext.wikiResults.map(r => r.sourcePath),
        usedDocs: usedDocs.length > 0 ? usedDocs : memoryContext.wikiResults.slice(0, 1).map(r => r.sourcePath),
        answerQuality: toolCalls.length > 0 && toolCalls.every(tc => tc.success) ? 0.8 : 0.6,
        timestamp: Date.now(),
      });

      // Apply feedback to vector store
      for (const r of memoryContext.wikiResults) {
        const wasUsed = usedDocs.includes(r.sourcePath);
        this.vectorStore.applyFeedback(r.sourcePath, wasUsed ? 0.05 : -0.02);
      }
    }

    // 10.5 Cognitive Feedback: learn from reasoning
    if (this.lastReasoningResult) {
      const onFb = onActivity;
      if (onFb) onFb("认知反馈处理中...");
      await this.feedbackProcessor.process(this.lastReasoningResult, sanitizedText);
      this.lastReasoningResult = null;
    }

    // 10.5b Mutation Flush: apply all queued state changes atomically
    if (this.mutationQueue.size > 0) {
      try {
        const result = await this.mutationQueue.flush(this.mutationEngine);
        if (result.applied > 0 && onActivity) {
          onActivity(`状态变更已应用: ${result.applied} 项`);
        }
      } catch { /* best-effort */ }
    }

    // 10.6 Periodic Health Check: detect compression signals
    if (this.interactionCount > 0 && this.interactionCount % 15 === 0) {
      try {
        const concepts = await this.markdownStore.loadConcepts();
        const controller = this.feedbackProcessor.controller;
        const health = controller.computeHealth(
          concepts,
          concepts.length,
          this.memoryStats.toolsTracked.length,
        );
        // Log compression signals for diagnostics
        if (health.compressionSignals.length > 0 && onActivity) {
          onActivity(`认知健康: ${Math.round(health.overallHealth * 100)}% (${health.compressionSignals.length} 压缩信号)`);
        }
      } catch { /* best-effort */ }
    }

    // 11. Evolution Cycle: run periodically
    this.interactionCount++;
    if (this.interactionCount % this.EVOLUTION_CYCLE_INTERVAL === 0) {
      await this.runEvolutionCycle();
    }

    // 12. Persist memory state
    await this.saveMemoryState();

    return { response, toolCalls };
    } finally {
      // Always release the reentrancy guard
      this.processing = false;
    }
  }

  // ── Evolution Cycle ───────────────────────────────────────

  private async runEvolutionCycle(): Promise<void> {
    // Memory decay + consolidation (Phase 1)
    this.memoryWriter.runMemoryMaintenance();

    // Concept evolution (Phase 4): merge, split, decay
    // Run every 2nd evolution cycle (every ~20 interactions) to limit overhead
    if (this.interactionCount % (this.EVOLUTION_CYCLE_INTERVAL * 2) === 0) {
      try {
        const usageCounts = this.feedbackProcessor.getUsageStats();
        const evoResult = await this.conceptEvolver.evolve(
          usageCounts.size > 0 ? usageCounts : undefined,
        );

        // Apply low-risk merges only (similarity ≥ 0.85)
        const highConfidenceMerges = evoResult.merged.filter(m => m.similarity >= 0.85);
        if (highConfidenceMerges.length > 0) {
          await this.conceptEvolver.applyMerges(highConfidenceMerges);
        }

        // Apply split marks (soft annotations only)
        if (evoResult.splitCandidates.length > 0) {
          await this.conceptEvolver.applySplitMarks(evoResult.splitCandidates.slice(0, 3));
        }
      } catch {
        // Evolution is best-effort
      }
    }
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
    conceptReasoning: string;
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

    // Concept-aware reasoning: build subgraph + reason over it
    const conceptReasoning = await this.buildConceptReasoning(query);

    return { wikiResults, episodicContext, profileContext, toolStats, conceptReasoning };
  }

  // ── Concept-Aware Reasoning ───────────────────────────────

  /**
   * Build a concept reasoning context for the current query.
   * 1. Load all concepts from markdown store
   * 2. Build full concept graph
   * 3. Identify seed concepts matching the query
   * 4. Build 1-hop subgraph
   * 5. Run reasoning engine
   * 6. Format as prompt context block
   */
  private async buildConceptReasoning(query: string): Promise<string> {
    try {
      // Load concepts from markdown store
      const concepts = await this.markdownStore.loadConcepts();
      if (concepts.length < 2) return ""; // need at least 2 concepts for meaningful reasoning

      // Build full concept graph
      const fullGraph = this.conceptGraphBuilder.buildFull(concepts);

      // Find seed concepts: those whose name/slug/tags match the query
      // Policy-aware scoring: blend query relevance with cognitive preferences
      const policy = this.feedbackProcessor.controller.currentPolicy;
      const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
      const scoredConcepts = concepts.map(c => {
        let score = 0;
        const text = `${c.name} ${c.slug} ${c.tags.join(" ")}`.toLowerCase();
        for (const term of queryTerms) {
          if (text.includes(term)) score += 1;
          if (c.name.toLowerCase().includes(term)) score += 2;
        }
        // Policy: bias toward preferred concept domains
        for (const tag of c.tags) {
          if (tag === "concept") continue;
          const pref = policy.conceptPreferences[tag] ?? 0.5;
          score += pref * 0.3;
        }
        // Policy: stability preference — favor high-confidence concepts
        if (c.confidence >= 0.6) {
          score += policy.conceptStabilityPreference * 0.25;
        }
        // Policy: exploration — give novelty bonus to low-episode concepts
        if (c.sourceEpisodes.length <= 2) {
          score += policy.explorationRate * 0.2;
        }
        return { concept: c, score };
      }).filter(c => c.score > 0);

      // If no direct matches, take the highest-confidence concepts as seeds
      let seedSlugs: string[];
      if (scoredConcepts.length > 0) {
        scoredConcepts.sort((a, b) => b.score - a.score);
        seedSlugs = scoredConcepts.slice(0, 5).map(c => c.concept.slug);
      } else {
        // Fallback: use most-referenced concepts as seeds
        const sorted = [...concepts].sort((a, b) => b.sourceEpisodes.length - a.sourceEpisodes.length);
        seedSlugs = sorted.slice(0, 3).map(c => c.slug);
      }

      // Build 1-hop subgraph from seed concepts
      const subgraph = this.conceptGraphBuilder.buildSubgraph(fullGraph, seedSlugs);

      // Run reasoning
      const reasoning = this.conceptReasoner.reason(query, subgraph, fullGraph);

      // Store for feedback processing later in the pipeline
      this.lastReasoningResult = reasoning;

      // Format as prompt context
      return this.formatReasoningContext(reasoning);
    } catch {
      // Concept reasoning is best-effort
      return "";
    }
  }

  /**
   * Format the reasoning result into a prompt-ready context block.
   */
  private formatReasoningContext(reasoning: ReasoningResult): string {
    const sections: string[] = [];

    if (reasoning.keyConcepts.length > 0) {
      sections.push(`### 相关概念\n${reasoning.keyConcepts.map(c => `- ${c}`).join("\n")}`);
    }

    if (reasoning.relationships.length > 0) {
      sections.push(`### 概念关系\n${reasoning.relationships.slice(0, 8).map(r => `- ${r}`).join("\n")}`);
    }

    if (reasoning.inferredInsights.length > 0) {
      sections.push(`### 推理洞察\n${reasoning.inferredInsights.slice(0, 5).map(i => `- 💡 ${i}`).join("\n")}`);
    }

    if (reasoning.bridgingConcepts.length > 0) {
      sections.push(`### 桥接概念\n${reasoning.bridgingConcepts.map(b => `- 🔗 ${b}（连接不同知识领域）`).join("\n")}`);
    }

    if (reasoning.contradictions.length > 0) {
      sections.push(`### 潜在矛盾\n${reasoning.contradictions.slice(0, 3).map(c => `- ⚠ ${c}`).join("\n")}`);
    }

    if (sections.length === 0) return "";

    return `\n## 概念推理上下文 (置信度: ${Math.round(reasoning.confidence * 100)}%)\n${sections.join("\n")}\n`;
  }

  // ── Simplified System Prompt ──────────────────────────────

  private buildSystemPrompt(memory: {
    wikiResults: VectorSearchResult[];
    episodicContext: string;
    profileContext: string;
    toolStats: string;
    conceptReasoning: string;
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

    // Build prompt with length guard
    let prompt = `你是用户的个人 AI 助手。用中文回复，清晰简洁。

## ${timeContext}
${profileSection}
${wikiSection}
${episodicSection}
${memory.conceptReasoning}

## 规则
- 优先根据概念推理上下文中的洞察和关系来组织回答，而非逐条罗列原始笔记
- 如果概念推理上下文中有相关概念关系，说明它们之间的关联
- 基于提供的知识库内容和记忆回答用户问题
- 如果知识库中有相关信息，注明来源
- 如果知识库中没有，可以基于常识回答，但要说明
- 工具已在后台自动执行，如果系统提示中包含"## 工具执行结果"，直接引用其结果回复用户
- 不要在回复中输出工具调用文本、不要模拟函数调用、不要使用 <invoke> 或 DSML 标签
- 不要编造不存在的内容
## 格式约束（必须严格遵守）
- **绝对禁止使用 Markdown 表格**（\`| --- |\` 语法）。表格在渲染时有 bug，会导致内容叠压不可读
- 如需对比或列举结构化数据，使用列表（\`-\` 或 \`1.\`）代替表格
- 如需展示键值对或属性，用 \`**键**: 值\` 的列表形式
- **禁止使用任何 \`|\` 管道符作为列分隔符**，包括代码块中的表格示例
- 不要使用 YAML frontmatter 之外的 \`---\` 分隔线`;

    // Truncate if exceeds character limit to stay within model context window
    if (prompt.length > MAX_SYSTEM_PROMPT_CHARS) {
      // Preserve rules section, truncate from the middle (wiki/episodic sections)
      const rulesSection = "\n## 规则\n";
      const rulesIdx = prompt.lastIndexOf(rulesSection);
      if (rulesIdx > 0) {
        const prefix = prompt.substring(0, prompt.indexOf("\n## 知识库", prompt.indexOf("## ")));
        const suffix = prompt.substring(rulesIdx);
        const available = MAX_SYSTEM_PROMPT_CHARS - prefix.length - suffix.length - 100;
        if (available > 200) {
          const wikiTruncated = wikiSection.substring(0, Math.min(wikiSection.length, available));
          prompt = prefix + wikiTruncated + "\n\n...(上下文已截断以适配模型限制)\n" + suffix;
        } else {
          prompt = prompt.substring(0, MAX_SYSTEM_PROMPT_CHARS - 50) + "\n...(上下文已截断)";
        }
      }
    }
    return prompt;
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

      case "delete_todo": {
        const allTodos = this.config.getTodos();
        const text = args.text as string | undefined;
        const id = args.id as string | undefined;
        const date = args.date as string | undefined;
        const startTime = args.startTime as string | undefined;
        const endTime = args.endTime as string | undefined;
        const markDone = args.mark_done === true;

        // Pre-filter by date if specified
        let pool = allTodos;
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          pool = pool.filter((t: any) => t.date === date);
        }

        let matched: any[] = [];

        if (id) {
          matched = pool.filter((t: any) => t.id === id);
        } else if (text) {
          const q = text.toLowerCase();
          // Try exact text match first, then time match, then fuzzy
          matched = pool.filter((t: any) => t.text.toLowerCase().includes(q));
          if (matched.length === 0) {
            // Try matching by time: if text looks like "HH:MM" or "HH:MM-HH:MM"
            const timeMatch = q.match(/(\d{1,2}:\d{2})\s*[-~到至]\s*(\d{1,2}:\d{2})/);
            if (timeMatch) {
              matched = pool.filter((t: any) =>
                t.startTime === timeMatch[1] && t.endTime === timeMatch[2]
              );
            } else {
              // Single time: match startTime or endTime
              matched = pool.filter((t: any) =>
                t.startTime === q || t.endTime === q
              );
            }
          }
        } else if (startTime || endTime) {
          matched = pool.filter((t: any) => {
            if (startTime && endTime) return t.startTime === startTime && t.endTime === endTime;
            if (startTime) return t.startTime === startTime;
            return t.endTime === endTime;
          });
        } else {
          return JSON.stringify({ error: "必须提供 text、id 或 startTime/endTime 来指定要操作的目标" });
        }

        if (matched.length === 0) {
          // Return the pool for debugging so LLM can suggest alternatives
          const poolSummary = pool.map((t: any) =>
            `${t.text}${t.startTime ? ` (${t.startTime}${t.endTime ? '-' + t.endTime : ''})` : ''}`
          ).join("、");
          return JSON.stringify({
            error: `未找到匹配的待办: ${text || id || (startTime + (endTime ? '-' + endTime : ''))}`,
            searchedDate: date || "全部日期",
            availableInScope: poolSummary || "(无)",
          });
        }

        for (const t of matched) {
          if (markDone) {
            t.done = true;
          } else {
            this.config.deleteTodo(t.id);
          }
        }

        const action = markDone ? "已标记完成" : "已删除";
        return JSON.stringify({
          success: true,
          action,
          count: matched.length,
          items: matched.map((t: any) => ({ id: t.id, text: t.text, startTime: t.startTime, endTime: t.endTime })),
        }, null, 2);
      }

      case "web_search": {
        const query = args.query?.trim();
        if (!query) return JSON.stringify({ error: "query 不能为空" });
        const numResults = Math.min(args.num_results || 5, 10);

        // Strategy 1: Bing HTML scrape (accessible in China, no API key needed)
        try {
          const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn`;
          const resp = await this.config.requestUrl({ url: bingUrl });
          if (resp.status === 200) {
            const html = resp.text;
            const results: Array<{ title: string; snippet: string; url: string }> = [];
            // Bing search result blocks: <li class="b_algo">
            const blockRe = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
            let blockMatch;
            while ((blockMatch = blockRe.exec(html)) !== null && results.length < numResults) {
              const block = blockMatch[1];
              // Title + URL from <h2><a href="...">title</a></h2>
              const titleMatch = block.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i);
              if (!titleMatch) continue;
              const url = titleMatch[1];
              const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
              // Snippet from <p> or <div class="b_caption">
              const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
                || block.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
              const snippet = snippetMatch
                ? snippetMatch[1].replace(/<[^>]+>/g, "").trim().substring(0, 300)
                : "";
              if (title && url) {
                results.push({ title: title.substring(0, 120), snippet, url });
              }
            }
            if (results.length > 0) return JSON.stringify({ query, resultCount: results.length, results, provider: "bing" }, null, 2);
          }
        } catch { /* fall through to next strategy */ }

        // Strategy 2: DuckDuckGo HTML fallback
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
            if (results.length > 0) return JSON.stringify({ query, resultCount: results.length, results, provider: "duckduckgo" }, null, 2);
          }
        } catch { /* fall through */ }

        return JSON.stringify({ query, message: "未找到搜索结果", results: [] });
      }

      case "list_wiki_files": {
        const wikiFolder = this.config.wikiFolder;
        const allFiles = this.config.vault.getFiles();
        const prefix = (args.prefix || "") as string;

        let files = allFiles.filter(f =>
          f.path.startsWith(wikiFolder) && f.extension === "md"
        );
        if (prefix) {
          files = files.filter(f => f.path.startsWith(`${wikiFolder}/${prefix}`));
        }

        const listing = files.map(f => ({
          path: f.path.substring(wikiFolder.length + 1), // relative path
          name: f.name,
          size: f.stat?.size ?? 0,
        }));
        listing.sort((a, b) => a.path.localeCompare(b.path));

        return JSON.stringify({ wikiFolder, totalFiles: listing.length, files: listing }, null, 2);
      }

      case "read_wiki_file": {
        const relPath = (args.path || "") as string;
        if (!relPath) return JSON.stringify({ error: "path 不能为空" });

        // Path traversal protection
        if (relPath.includes("..") || relPath.startsWith("/") || relPath.includes("~")) {
          return JSON.stringify({ error: "非法路径" });
        }

        const wikiFolder = this.config.wikiFolder;
        const fullPath = `${wikiFolder}/${relPath}`;
        const file = this.config.vault.getFileByPath(fullPath);
        if (!file) return JSON.stringify({ error: `文件不存在: ${relPath}` });

        try {
          const content = await this.config.vault.read(file);
          return JSON.stringify({ path: relPath, content, size: content.length }, null, 2);
        } catch (e: any) {
          return JSON.stringify({ error: `读取失败: ${e?.message || e}` });
        }
      }

      case "write_wiki_file": {
        const relPath = (args.path || "") as string;
        const content = (args.content || "") as string;
        if (!relPath) return JSON.stringify({ error: "path 不能为空" });
        if (!content) return JSON.stringify({ error: "content 不能为空" });

        // Path traversal protection
        if (relPath.includes("..") || relPath.startsWith("/") || relPath.includes("~")) {
          return JSON.stringify({ error: "非法路径" });
        }
        // Must be .md file
        if (!relPath.endsWith(".md")) {
          return JSON.stringify({ error: "仅支持 .md 文件" });
        }
        // Size limit: 100KB
        if (content.length > 100_000) {
          return JSON.stringify({ error: "文件过大，限制 100KB" });
        }

        const wikiFolder = this.config.wikiFolder;
        const fullPath = `${wikiFolder}/${relPath}`;
        const vault = this.config.vault;

        try {
          // Ensure parent directories exist
          const dirParts = fullPath.split("/");
          for (let i = 1; i < dirParts.length; i++) {
            const sub = dirParts.slice(0, i).join("/");
            if (!(await vault.adapter.exists(sub))) {
              await vault.adapter.mkdir(sub);
            }
          }

          const existing = vault.getFileByPath(fullPath);
          if (existing) {
            await vault.modify(existing, content);
          } else {
            await vault.create(fullPath, content);
          }

          // Rebuild vector index to include new/updated file
          this.rebuildVectorIndex().catch(() => { /* best-effort */ });

          return JSON.stringify({ success: true, path: relPath, action: existing ? "updated" : "created", size: content.length }, null, 2);
        } catch (e: any) {
          return JSON.stringify({ error: `写入失败: ${e?.message || e}` });
        }
      }

      case "delete_wiki_file": {
        const relPath = (args.path || "") as string;
        if (!relPath) return JSON.stringify({ error: "path 不能为空" });

        // Path traversal protection
        if (relPath.includes("..") || relPath.startsWith("/") || relPath.includes("~")) {
          return JSON.stringify({ error: "非法路径" });
        }

        const wikiFolder = this.config.wikiFolder;
        const fullPath = `${wikiFolder}/${relPath}`;

        // Protect critical files
        const criticalFiles = ["SCHEMA.md", "index.md", "log.md", "overview.md"];
        const fileName = relPath.split("/").pop() || "";
        if (criticalFiles.includes(fileName)) {
          return JSON.stringify({ error: `不能删除系统文件: ${fileName}。如需重建，请使用维护功能。` });
        }

        const file = this.config.vault.getFileByPath(fullPath);
        if (!file) return JSON.stringify({ error: `文件不存在: ${relPath}` });

        try {
          await this.config.vault.trash(file, false); // false = system trash, not vault .trash
          // Rebuild vector index to remove deleted file
          this.rebuildVectorIndex().catch(() => { /* best-effort */ });
          return JSON.stringify({ success: true, path: relPath, action: "deleted" }, null, 2);
        } catch (e: any) {
          return JSON.stringify({ error: `删除失败: ${e?.message || e}` });
        }
      }

      case "search_wiki": {
        const query = (args.query || "") as string;
        if (!query) return JSON.stringify({ error: "query 不能为空" });
        const limit = Math.min(args.limit || 5, 20);

        const wikiFolder = this.config.wikiFolder;
        const allFiles = this.config.vault.getFiles();
        const wikiFiles = allFiles.filter(f =>
          f.path.startsWith(wikiFolder) && f.extension === "md"
        );

        const results: Array<{ path: string; matches: string[]; score: number }> = [];
        const qLower = query.toLowerCase();

        for (const file of wikiFiles) {
          try {
            const content = await this.config.vault.read(file);
            const lines = content.split("\n");
            const matches: string[] = [];

            for (const line of lines) {
              if (line.toLowerCase().includes(qLower)) {
                const trimmed = line.trim();
                if (trimmed) matches.push(trimmed.substring(0, 200));
              }
            }

            if (matches.length > 0) {
              results.push({
                path: file.path.substring(wikiFolder.length + 1),
                matches: matches.slice(0, 5), // top 5 matching lines per file
                score: matches.length,
              });
            }
          } catch { /* skip unreadable files */ }
        }

        results.sort((a, b) => b.score - a.score);
        const topResults = results.slice(0, limit);

        return JSON.stringify({
          query,
          totalMatches: results.length,
          returned: topResults.length,
          results: topResults,
        }, null, 2);
      }

      case "insert_into_note": {
        if (!this.config.insertIntoNote) return JSON.stringify({ error: "当前环境不支持编辑笔记（无活跃编辑器）" });
        const text = (args.text || "") as string;
        if (!text) return JSON.stringify({ error: "text 不能为空" });
        const ok = this.config.insertIntoNote(text);
        return JSON.stringify({ success: ok, action: "inserted", textLength: text.length }, null, 2);
      }

      case "replace_in_note": {
        if (!this.config.replaceInNote) return JSON.stringify({ error: "当前环境不支持编辑笔记（无活跃编辑器）" });
        const oldText = (args.oldText || "") as string;
        const newText = (args.newText || "") as string;
        if (!oldText) return JSON.stringify({ error: "oldText 不能为空" });
        const ok = this.config.replaceInNote(oldText, newText);
        return JSON.stringify({ success: ok, action: ok ? "replaced" : "not_found" }, null, 2);
      }

      case "append_to_note": {
        if (!this.config.appendToNote) return JSON.stringify({ error: "当前环境不支持编辑笔记（无活跃编辑器）" });
        const text = (args.text || "") as string;
        if (!text) return JSON.stringify({ error: "text 不能为空" });
        const ok = this.config.appendToNote(text);
        return JSON.stringify({ success: ok, action: "appended", textLength: text.length }, null, 2);
      }

      case "get_note_selection": {
        if (!this.config.getNoteSelection) return JSON.stringify({ error: "当前环境不支持获取笔记选区（无活跃编辑器）" });
        const selection = this.config.getNoteSelection();
        return JSON.stringify({ hasSelection: selection.length > 0, selection, length: selection.length }, null, 2);
      }

      default:
        return `Error: Unknown tool "${name}"`;
    }
  }

  // ── LLM API Calls ─────────────────────────────────────────

  /**
   * Stream LLM response with timeout.
   */
  private async streamLLMWithTimeout(
    messages: unknown[],
    onChunk?: StreamCallback,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const endpoint = this.config.apiEndpoint.replace(/\/$/, "");
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
      };

      const response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.getApiKey()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
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
          } catch { /* skip malformed SSE chunks */ }
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
    } finally {
      clearTimeout(timeoutId);
    }
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

    // Load episodic memory (JSON first, markdown fallback)
    const episodicJson = await loadJson(`${base}/episodic.json`);
    if (episodicJson) {
      this.episodicMemory.deserialize(episodicJson);
    }
    // Fallback: if JSON yielded nothing, try markdown
    if (this.episodicMemory.count === 0) {
      const mdEntries = await this.markdownStore.loadEpisodicEntries();
      if (mdEntries.length > 0) {
        this.episodicMemory.deserialize(JSON.stringify(mdEntries));
      }
    }

    // Load user profile (JSON first, markdown fallback)
    const profileJson = await loadJson(`${base}/profile.json`);
    if (profileJson) {
      this.userProfile.deserialize(profileJson);
    } else {
      const mdProfile = await this.markdownStore.loadProfile();
      if (mdProfile) {
        this.userProfile.deserialize(JSON.stringify(mdProfile));
      }
    }

    // Load tool memory
    const toolJson = await loadJson(`${base}/tool_stats.json`);
    if (toolJson) this.toolMemory.deserialize(toolJson);

    // Load vector index
    const indexJson = await loadJson(`${base}/vector_index.json`);
    if (indexJson) this.vectorStore.deserialize(indexJson);

    // Load router telemetry
    const telemetryJson = await loadJson(`${base}/router_telemetry.json`);
    if (telemetryJson) this.routerTelemetry.deserialize(telemetryJson);

    // Load RAG feedback
    const ragJson = await loadJson(`${base}/rag_feedback.json`);
    if (ragJson) this.ragFeedback.deserialize(ragJson);
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
    await writeJson("router_telemetry.json", this.routerTelemetry.serialize());
    await writeJson("rag_feedback.json", this.ragFeedback.serialize());

    // Dual-write: mirror to markdown (human-readable memory)
    try {
      const allEpisodic = this.episodicMemory.getActiveEntries();
      // Also include marked-for-removal entries so they're visible in markdown
      const removed = this.episodicMemory.getCandidatesForRemoval();
      await this.markdownStore.syncEpisodicEntries([...allEpisodic, ...removed]);
      await this.markdownStore.saveProfile(this.userProfile.profile as UserProfileData);
    } catch {
      // Markdown write is best-effort; JSON is the source of truth
    }
  }

  // ── Public Accessors (for UI/display) ─────────────────────

  get memoryStats(): {
    episodicCount: number;
    episodicActive: number;
    profileInitialized: boolean;
    vectorDocCount: number;
    toolsTracked: string[];
    routerAccuracy: number;
    ragDocsTracked: number;
    interactionCount: number;
  } {
    return {
      episodicCount: this.episodicMemory.count,
      episodicActive: this.episodicMemory.activeCount,
      profileInitialized: this.userProfile.isInitialized(),
      vectorDocCount: this.vectorStore.documentCount,
      toolsTracked: this.toolMemory.getAllStats().map(s => s.toolName),
      routerAccuracy: this.routerTelemetry.getOverallAccuracy(),
      ragDocsTracked: this.ragFeedback.getAllClusters().length,
      interactionCount: this.interactionCount,
    };
  }

  getEvolutionStats() {
    return {
      telemetry: this.routerTelemetry.getAllMetrics(),
      clusters: this.ragFeedback.getAllClusters(),
      negativeDocs: this.vectorStore.getNegativeSignals(),
      decayedEpisodic: this.episodicMemory.getCandidatesForRemoval().length,
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

  // ── Cognitive State Snapshot (SSOT) ────────────────────────

  /**
   * Build a read-only snapshot of the current cognitive state.
   * This is the SSOT — all modules should derive their view from this.
   */
  getStateSnapshot(): CognitiveState {
    const policy = this.feedbackProcessor.controller.currentPolicy;
    return {
      memory: {
        episodicCount: this.episodicMemory.count,
        episodicActive: this.episodicMemory.activeCount,
        workingMemorySize: this.workingMemory.count,
        profileFields: Object.keys(this.userProfile.profile).length,
        profileInitialized: this.userProfile.isInitialized(),
      },
      concepts: {
        conceptCount: 0, // requires async load; use healthCheck for live data
        avgConfidence: 0.5,
        totalEdges: 0,
        domainsTracked: Object.keys(policy.conceptPreferences),
      },
      reasoning: {
        lastReasoningConfidence: this.lastReasoningResult?.confidence ?? null,
        keyConceptsUsed: this.lastReasoningResult?.keyConcepts ?? [],
        lastQuery: null,
        reasoningCyclesRun: this.interactionCount,
      },
      feedback: {
        tracesStored: this.feedbackProcessor.getStats().tracesStored,
        conceptsReinforced: this.feedbackProcessor.getStats().conceptsReinforced,
        insightsReinforced: this.feedbackProcessor.getStats().insightsReinforced,
        contradictionsDetected: this.feedbackProcessor.getStats().contradictionsDetected,
        policyUpdates: 0,
      },
      policy: {
        domainPreferences: { ...policy.conceptPreferences },
        strategyWeights: {
          graphTraversal: policy.reasoningStrategyWeights.graphTraversal,
          patternMatching: policy.reasoningStrategyWeights.patternMatching,
          abstraction: policy.reasoningStrategyWeights.abstraction,
        },
        explorationRate: policy.explorationRate,
        compressionThreshold: policy.compressionThreshold,
        version: policy.version,
      },
      version: this.interactionCount,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get mutation audit trail (current in-memory log).
   */
  get mutationAudit(): { count: number; log: string } {
    return {
      count: this.mutationEngine.mutationCount,
      log: this.mutationEngine.serializeLog(),
    };
  }
}
