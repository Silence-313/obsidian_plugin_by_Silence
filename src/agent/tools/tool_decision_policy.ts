// ── Tool Decision Policy ─────────────────────────────────────
// LLM-driven autonomous tool usage decision.
// Instead of keyword-based routing, the LLM itself decides:
//   1. Whether a tool is needed
//   2. Which tool to use
//   3. How to rewrite the query for optimal tool results
//
// This is an ADD-ON layer — existing tool_router.ts is unchanged.
// On failure, falls back to existing router behavior.

// ── Types ───────────────────────────────────────────────────

export interface ToolDecision {
  use_tool: boolean;
  tool_name: string | null;
  confidence: number;        // 0..1
  reason: string;
  query_rewrite?: string;    // optimized query for the selected tool
}

export interface ToolDecisionContext {
  userQuery: string;
  wikiContext: string;        // from vector search
  conceptContext: string;     // from concept reasoning
  episodicContext: string;    // from episodic memory
  availableTools: string[];   // tool names available
}

export interface ToolDecisionResult {
  decision: ToolDecision;
  rawResponse: string;        // raw LLM response for debugging
  latencyMs: number;
  fallbackUsed: boolean;      // true if JSON parse failed and fallback applied
}

// ── Decision Prompt ─────────────────────────────────────────

/**
 * Strict JSON-only prompt. The model MUST NOT answer the user query.
 * It MUST only decide tool usage and output valid JSON.
 */
function buildDecisionPrompt(ctx: ToolDecisionContext): string {
  const toolList = ctx.availableTools
    .map(t => {
      switch (t) {
        case "web_search": return `- web_search: 搜索互联网获取实时信息、新闻、最新数据、外部事实`;
        case "get_todos": return `- get_todos: 查询用户的待办事项列表，按日期/状态/优先级筛选`;
        case "add_todos": return `- add_todos: 添加新的待办事项到指定日期`;
        case "get_todo_stats": return `- get_todo_stats: 获取待办统计概览（完成率、分布等）`;
        case "get_current_time": return `- get_current_time: 获取当前精确时间和日期`;
        default: return `- ${t}`;
      }
    })
    .join("\n");

  return `你是工具使用决策器。你的唯一任务是判断是否需要调用工具来回答用户问题。

## 可用工具
${toolList}

## 当前上下文
${ctx.wikiContext ? `\n### 知识库检索结果\n${ctx.wikiContext.substring(0, 600)}` : ""}
${ctx.conceptContext ? `\n### 概念推理上下文\n${ctx.conceptContext.substring(0, 400)}` : ""}
${ctx.episodicContext ? `\n### 近期记忆\n${ctx.episodicContext.substring(0, 300)}` : ""}

## 决策规则
1. 如果用户问题需要实时信息、最新数据、外部事实 → web_search
2. 如果用户询问待办、任务、日程 → get_todos 或 get_todo_stats
3. 如果用户要添加待办、安排任务 → add_todos
4. 如果用户询问当前时间、日期 → get_current_time
5. 如果知识库已有足够信息回答 → use_tool=false
6. 如果问题可以从上下文推断 → use_tool=false

## 用户问题
${ctx.userQuery}

## 输出格式（必须严格 JSON，不要其他任何内容）
{
  "use_tool": true/false,
  "tool_name": "工具名或null",
  "confidence": 0.0-1.0,
  "reason": "简短决策理由",
  "query_rewrite": "优化后的搜索词或null"
}`;
}

// ── Policy ──────────────────────────────────────────────────

const MAX_DECISION_TOKENS = 256;
const DECISION_TEMPERATURE = 0.1; // low temperature for deterministic decisions

export class ToolDecisionPolicy {
  private getApiKey: () => string;
  private apiEndpoint: string;
  private model: string;

  constructor(opts: {
    getApiKey: () => string;
    apiEndpoint: string;
    model: string;
  }) {
    this.getApiKey = opts.getApiKey;
    this.apiEndpoint = opts.apiEndpoint;
    this.model = opts.model;
  }

  /**
   * Decide whether to use a tool for the given query context.
   * Returns a structured decision with fallback safety.
   */
  async decide(ctx: ToolDecisionContext): Promise<ToolDecisionResult> {
    const startTime = Date.now();
    let fallbackUsed = false;
    let rawResponse = "";

    try {
      const prompt = buildDecisionPrompt(ctx);
      const messages = [
        { role: "system", content: "你是一个工具使用决策器。只输出JSON，不要其他内容。" },
        { role: "user", content: prompt },
      ];

      // Call LLM with low temperature for deterministic decisions
      rawResponse = await this.callDecisionLLM(messages);

      // Parse JSON from response
      const decision = this.parseDecision(rawResponse, ctx);

      return {
        decision,
        rawResponse,
        latencyMs: Date.now() - startTime,
        fallbackUsed: false,
      };
    } catch {
      // Fallback: on any failure, use conservative defaults
      fallbackUsed = true;
      return {
        decision: this.buildFallbackDecision(ctx),
        rawResponse,
        latencyMs: Date.now() - startTime,
        fallbackUsed: true,
      };
    }
  }

  // ── LLM Call ──────────────────────────────────────────────

  private async callDecisionLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
    const endpoint = this.apiEndpoint.replace(/\/$/, "");
    const body = {
      model: this.model,
      messages,
      temperature: DECISION_TEMPERATURE,
      max_tokens: MAX_DECISION_TOKENS,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15s timeout for decision

    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.getApiKey()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Decision API error (${response.status})`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── JSON Parsing ──────────────────────────────────────────

  private parseDecision(raw: string, ctx: ToolDecisionContext): ToolDecision {
    // Try direct JSON parse
    const jsonStr = this.extractJson(raw);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        return this.validateAndNormalize(parsed, ctx);
      } catch { /* fall through to regex extraction */ }
    }

    // Regex fallback: extract key fields from non-JSON response
    const useTool = /"use_tool"\s*:\s*(true|false)/i.exec(raw);
    const toolName = /"tool_name"\s*:\s*"([^"]*)"/i.exec(raw);
    const confidence = /"confidence"\s*:\s*([\d.]+)/i.exec(raw);
    const reason = /"reason"\s*:\s*"([^"]*)"/i.exec(raw);
    const rewrite = /"query_rewrite"\s*:\s*"([^"]*)"/i.exec(raw);

    return this.validateAndNormalize({
      use_tool: useTool ? useTool[1] === "true" : true,
      tool_name: toolName?.[1] || null,
      confidence: confidence ? parseFloat(confidence[1]) : 0.6,
      reason: reason?.[1] || "Fallback parse from LLM response",
      query_rewrite: rewrite?.[1] || undefined,
    }, ctx);
  }

  private extractJson(text: string): string | null {
    // Try to find JSON block in markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) return fenceMatch[1].trim();

    // Try to find raw JSON object
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      return text.substring(braceStart, braceEnd + 1);
    }

    return null;
  }

  // ── Validation & Normalization ────────────────────────────

  private validateAndNormalize(parsed: Record<string, unknown>, ctx: ToolDecisionContext): ToolDecision {
    const useTool = typeof parsed.use_tool === "boolean" ? parsed.use_tool : true;
    let toolName: string | null = typeof parsed.tool_name === "string" ? parsed.tool_name : null;

    // Validate tool name against available tools
    if (toolName && !ctx.availableTools.includes(toolName)) {
      // Try to find a matching tool
      const match = ctx.availableTools.find(t =>
        t.toLowerCase().includes(toolName!.toLowerCase()) ||
        toolName!.toLowerCase().includes(t.toLowerCase())
      );
      toolName = match ?? (useTool ? ctx.availableTools[0] : null);
    }

    // If use_tool but no tool specified, pick the most likely one
    if (useTool && !toolName && ctx.availableTools.length > 0) {
      const query = ctx.userQuery.toLowerCase();
      if (/搜索|查|搜|最新|新闻|实时/.test(query)) toolName = "web_search";
      else if (/待办|任务|添加|安排/.test(query)) toolName = "get_todos";
      else if (/时间|几点|日期|星期/.test(query)) toolName = "get_current_time";
      else toolName = ctx.availableTools[0];
    }

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.6;

    const reason = typeof parsed.reason === "string" ? parsed.reason : "No reason provided";

    const queryRewrite = typeof parsed.query_rewrite === "string" && parsed.query_rewrite !== "null"
      ? parsed.query_rewrite
      : undefined;

    return { use_tool: useTool, tool_name: toolName, confidence, reason, query_rewrite: queryRewrite };
  }

  // ── Fallback ──────────────────────────────────────────────

  /**
   * Conservative fallback: when LLM call fails, use heuristics to decide.
   * Defaults to use_tool=true for safety on uncertain queries.
   */
  private buildFallbackDecision(ctx: ToolDecisionContext): ToolDecision {
    const q = ctx.userQuery.toLowerCase();

    // Heuristic: detect clear tool-need signals
    const needsSearch = /搜索|查一下|搜一下|最新|新闻|现在|实时|今天|当前/i.test(q);
    const needsTodo = /待办|任务|添加待办|安排|日程|todo/i.test(q);
    const needsTime = /几点|几号|日期|时间|星期几/i.test(q);
    const isQuestion = /[？?]$/.test(q) || /^(什么|怎么|如何|为什么|谁|哪里|什么时候)/i.test(q);

    if (needsSearch) {
      return { use_tool: true, tool_name: "web_search", confidence: 0.7, reason: "Heuristic: search signal detected", query_rewrite: q };
    }
    if (needsTodo) {
      return { use_tool: true, tool_name: "get_todos", confidence: 0.7, reason: "Heuristic: todo signal detected", query_rewrite: q };
    }
    if (needsTime) {
      return { use_tool: true, tool_name: "get_current_time", confidence: 0.85, reason: "Heuristic: time query detected", query_rewrite: q };
    }

    // Default: for external/unknown questions, use web_search; for others, skip
    const hasWikiContext = ctx.wikiContext.length > 50;
    if (isQuestion && !hasWikiContext) {
      return { use_tool: true, tool_name: "web_search", confidence: 0.5, reason: "Fallback: question without wiki context", query_rewrite: q };
    }

    return { use_tool: false, tool_name: null, confidence: 0.5, reason: "Fallback: no tool signal detected" };
  }
}
