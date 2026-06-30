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
  private markdownStore: MarkdownMemoryStore;
  private conceptGraphBuilder: ConceptGraphBuilder;
  private conceptReasoner: ConceptReasoner;
  private feedbackProcessor: FeedbackProcessor;
  private conceptEvolver: ConceptEvolver;
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
    this.memoryWriter = new MemoryWriter(this.episodicMemory, this.userProfile, this.toolMemory, this.markdownStore);
    this.conceptGraphBuilder = new ConceptGraphBuilder();
    this.conceptReasoner = new ConceptReasoner();
    this.feedbackProcessor = new FeedbackProcessor(this.markdownStore);
    this.conceptEvolver = new ConceptEvolver(this.markdownStore);
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

    // 4. Build enhanced system prompt (with reasoning context)
    const systemPrompt = this.buildSystemPrompt(memoryContext);

    // 5. Build messages for LLM
    const messages = this.buildLLMMessages(systemPrompt, chatHistory, sanitizedText);

    // 6. Agent loop: probe → maybe tools → stream
    let response: string;
    let llmFailed = false;
    let llmToolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];

    try {
      // First, probe for tool calls (non-streaming)
      const probeResp = await this.callLLMWithTimeout(messages, true) as any;
      const probeChoice = probeResp.choices?.[0];
      llmToolCalls = probeChoice?.message?.tool_calls ?? [];
      const probeText = probeChoice?.message?.content ?? "";

      if (llmToolCalls.length > 0) {
        // Execute tools locally
        messages.push({ role: "assistant", content: probeText, tool_calls: llmToolCalls });

        for (const tc of llmToolCalls) {
          let args: Record<string, unknown> = {};
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
            sanitizedText,
            route.tool,
          );

          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }

        // Stream final summary (no tools needed for this call)
        response = await this.streamLLMWithTimeout(messages, false, onStream);
      } else {
        // No tools needed, stream directly
        response = await this.streamLLMWithTimeout(messages, false, onStream);
      }
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
    let prompt = `你是用户的个人 AI 助手，拥有工具调用能力。用中文回复，清晰简洁。

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
- 使用可用工具获取实时数据（时间、待办、搜索等）
- 不要编造不存在的内容
- 不要使用 Markdown 表格`;

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

  /**
   * Call LLM with a configurable timeout. Wraps fetch with AbortController.
   */
  private async callLLMWithTimeout(messages: unknown[], withTools: boolean): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const endpoint = this.config.apiEndpoint.replace(/\/$/, "");
      const body: Record<string, unknown> = {
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
        signal: controller.signal,
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
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Stream LLM response with timeout.
   */
  private async streamLLMWithTimeout(
    messages: unknown[],
    withTools: boolean,
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

  // Keep old methods for backward compatibility
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
}
