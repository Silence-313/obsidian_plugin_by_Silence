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
  use_skill: boolean;
  skill_name: string | null;
  confidence: number;        // 0..1
  reason: string;
  query_rewrite?: string;    // optimized query for the selected tool/skill
  tool_args?: Record<string, any>;  // structured args extracted from user query
}

export interface ToolDecisionContext {
  userQuery: string;
  wikiContext: string;        // from vector search
  conceptContext: string;     // from concept reasoning
  episodicContext: string;    // from episodic memory
  availableTools: string[];   // tool names available
  availableSkills: Array<{ name: string; description: string }>; // skills available
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
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const todayLabel = `${todayStr} (${weekdays[today.getDay()]})`;

  const toolList = ctx.availableTools
    .map(t => {
      switch (t) {
        case "web_search": return `  - web_search: 搜索互联网获取实时信息、新闻、最新数据、外部事实`;
        case "get_todos": return `  - get_todos: 查询用户的待办事项列表，按日期/状态/优先级筛选`;
        case "add_todos": return `  - add_todos: 添加新的待办事项到指定日期。tool_args: {"date":"YYYY-MM-DD","todos":[{"text":"...","priority":"高/中高/中/低","startTime":"HH:MM","endTime":"HH:MM"}]}`;
        case "delete_todo": return `  - delete_todo: 删除或完成待办事项。tool_args: {"text":"关键词"}模糊匹配内容/时间, {"id":"xxx"}精确匹配, {"startTime":"HH:MM","endTime":"HH:MM"}按时间段匹配, 可选"date":"YYYY-MM-DD"限定日期, "mark_done":true标记完成`;
        case "get_todo_stats": return `  - get_todo_stats: 获取待办统计概览（完成率、分布等）`;
        case "get_current_time": return `  - get_current_time: 获取当前精确时间和日期`;
        case "insert_into_note": return `  - insert_into_note: 在用户当前编辑的笔记光标位置插入文本。tool_args: {"text":"要插入的内容"}。用于补全段落、添加注释、插入代码块等需要直接修改笔记的操作`;
        case "replace_in_note": return `  - replace_in_note: 在用户当前笔记中查找并替换指定文本。tool_args: {"oldText":"要被替换的原文本（需精确匹配）","newText":"替换后的新文本"}。用于修改错误、改写段落等`;
        case "append_to_note": return `  - append_to_note: 在用户当前笔记末尾追加文本。tool_args: {"text":"要追加的内容"}。用于添加新章节、总结、补充说明等`;
        case "get_note_selection": return `  - get_note_selection: 获取用户在笔记中当前选中的文本。用于了解用户正在关注的具体段落或代码`;
        case "delete_from_note": return `  - delete_from_note: 从用户当前笔记中删除指定文本。tool_args: {"text":"要删除的文本（需精确匹配）"}。用于删除错误内容、移除冗余段落等`;
        default: return `  - ${t}`;
      }
    })
    .join("\n");

  const skillList = ctx.availableSkills.length > 0
    ? ctx.availableSkills.map(s => `  - ${s.name}: ${s.description}`).join("\n")
    : "  (无可用技能)";

  return `你是工具和技能使用决策器。你的唯一任务是判断是否需要调用工具或技能来回答用户问题。

## 重要：今天是 ${todayLabel}
用户说的"今天"就是指 ${todayStr}，不要使用其他日期。

## 可用工具（外部世界）
${toolList}

## 可用技能（系统能力）
${skillList}

## 决策规则（优先级：技能 > 工具 > 无）
### 使用技能：
- 用户要求读取笔记、打开文件、查看 vault 内容 → read_local_file
- 用户询问"我在哪里"、"当前位置"、"附近有什么" → get_current_location

### 使用工具：
- 用户要求修改、编辑、插入、添加内容到当前笔记 → insert_into_note / append_to_note
- 用户要求删除、移除、清除笔记中的内容 → delete_from_note
- 用户要求改写、修正、替换笔记中的某段内容 → replace_in_note
- 用户要求查看或理解选中的文本 → get_note_selection
- 用户问题需要实时信息、最新数据、外部事实 → web_search
- 用户询问待办、任务、日程 → get_todos 或 get_todo_stats
- 用户要添加待办、安排任务 → add_todos
- 用户要删除待办、移除任务、标记完成 → delete_todo
- 用户询问当前时间、日期 → get_current_time

### 不使用：
- 知识库已有足够信息
- 问题可以从上下文推断
- 纯对话、问候、闲聊

## 当前上下文
${ctx.wikiContext ? `\n### 知识库检索结果\n${ctx.wikiContext.substring(0, 500)}` : ""}
${ctx.conceptContext ? `\n### 概念推理\n${ctx.conceptContext.substring(0, 300)}` : ""}
${ctx.episodicContext ? `\n### 近期记忆\n${ctx.episodicContext.substring(0, 200)}` : ""}

## 用户问题
${ctx.userQuery}

## 输出格式（必须严格 JSON，不要其他任何内容）
{
  "use_tool": true/false,
  "tool_name": "工具名或null",
  "use_skill": true/false,
  "skill_name": "技能名或null",
  "confidence": 0.0-1.0,
  "reason": "简短决策理由",
  "query_rewrite": "优化后的查询或null",
  "tool_args": null  // 仅当 use_tool=true 时：从用户输入中提取的结构化参数，格式见工具描述中的 tool_args
}

### tool_args 说明
- 仅当 use_tool=true 且该工具需要参数时才填写 tool_args
- 从用户输入中提取实际值填入
- 不需要参数的工具（如 get_current_time）填 null
- add_todos 示例：{"date":"${todayStr}","todos":[{"text":"LeetCode","startTime":"09:30","endTime":"10:30"}]}
- web_search 示例：{"query":"最新AI新闻"}
- get_todos 示例：{"date":"2026-07-04"}
- insert_into_note 示例：{"text":"## 总结\\n\\n以上内容的核心观点是..."}`;
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
    const useSkill = /"use_skill"\s*:\s*(true|false)/i.exec(raw);
    const skillName = /"skill_name"\s*:\s*"([^"]*)"/i.exec(raw);
    const confidence = /"confidence"\s*:\s*([\d.]+)/i.exec(raw);
    const reason = /"reason"\s*:\s*"([^"]*)"/i.exec(raw);
    const rewrite = /"query_rewrite"\s*:\s*"([^"]*)"/i.exec(raw);

    // Brace-counting extraction for nested tool_args object
    const toolArgs = this.extractNestedJson(raw, "tool_args");

    return this.validateAndNormalize({
      use_tool: useTool ? useTool[1] === "true" : false,
      tool_name: toolName?.[1] || null,
      use_skill: useSkill ? useSkill[1] === "true" : false,
      skill_name: skillName?.[1] || null,
      confidence: confidence ? parseFloat(confidence[1]) : 0.6,
      reason: reason?.[1] || "Fallback parse from LLM response",
      query_rewrite: rewrite?.[1] || undefined,
      tool_args: toolArgs,
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

  /** Brace-counting extraction of a nested JSON object by key name. */
  private extractNestedJson(raw: string, key: string): Record<string, unknown> | undefined {
    const keyPattern = new RegExp(`"${key}"\\s*:\\s*`, "i");
    const keyMatch = keyPattern.exec(raw);
    if (!keyMatch) return undefined;

    const startIdx = keyMatch.index + keyMatch[0].length;
    const rest = raw.slice(startIdx);
    if (!rest.startsWith("{")) return undefined;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") { depth++; continue; }
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(rest.slice(0, i + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch { /* unparseable */ }
          return undefined;
        }
      }
    }
    return undefined;
  }

  // ── Validation & Normalization ────────────────────────────

  private validateAndNormalize(parsed: Record<string, unknown>, ctx: ToolDecisionContext): ToolDecision {
    const useTool = typeof parsed.use_tool === "boolean" ? parsed.use_tool : false;
    const useSkill = typeof parsed.use_skill === "boolean" ? parsed.use_skill : false;
    let toolName: string | null = typeof parsed.tool_name === "string" && parsed.tool_name !== "null" ? parsed.tool_name : null;
    let skillName: string | null = typeof parsed.skill_name === "string" && parsed.skill_name !== "null" ? parsed.skill_name : null;

    // Validate tool name against available tools
    if (toolName && !ctx.availableTools.includes(toolName)) {
      const match = ctx.availableTools.find(t =>
        t.toLowerCase().includes(toolName!.toLowerCase()) ||
        toolName!.toLowerCase().includes(t.toLowerCase())
      );
      toolName = match ?? (useTool ? ctx.availableTools[0] : null);
    }

    // Validate skill name against available skills
    if (skillName && !ctx.availableSkills.some(s => s.name === skillName)) {
      const match = ctx.availableSkills.find(s =>
        s.name.toLowerCase().includes(skillName!.toLowerCase()) ||
        skillName!.toLowerCase().includes(s.name.toLowerCase())
      );
      skillName = match?.name ?? (useSkill ? ctx.availableSkills[0]?.name ?? null : null);
    }

    // Priority: skill > tool — if both requested, prefer skill
    if (useSkill && useTool) {
      // Skill takes priority
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

    const toolArgs: Record<string, any> | undefined = (parsed.tool_args != null && typeof parsed.tool_args === "object")
      ? parsed.tool_args as Record<string, any>
      : undefined;

    return { use_tool: useTool, tool_name: toolName, use_skill: useSkill, skill_name: skillName, confidence, reason, query_rewrite: queryRewrite, tool_args: toolArgs };
  }

  // ── Fallback ──────────────────────────────────────────────

  /**
   * Conservative fallback: when LLM call fails, use heuristics to decide.
   * Defaults to use_tool=true for safety on uncertain queries.
   */
  private buildFallbackDecision(ctx: ToolDecisionContext): ToolDecision {
    const q = ctx.userQuery.toLowerCase();

    // Heuristic: detect skill-need signals first (priority)
    const needsFileRead = /读取|打开.*文件|查看.*笔记|读取.*笔记|我的.*文件|vault/.test(q);
    const needsLocation = /我在哪里|当前位置|定位|附近|where am i/i.test(q);

    if (needsFileRead && ctx.availableSkills.some(s => s.name === "read_local_file")) {
      return { use_tool: false, tool_name: null, use_skill: true, skill_name: "read_local_file", confidence: 0.7, reason: "Heuristic: file read signal detected", query_rewrite: q };
    }
    if (needsLocation && ctx.availableSkills.some(s => s.name === "get_current_location")) {
      return { use_tool: false, tool_name: null, use_skill: true, skill_name: "get_current_location", confidence: 0.7, reason: "Heuristic: location signal detected", query_rewrite: q };
    }

    // Heuristic: detect tool-need signals
    const needsSearch = /搜索|查一下|搜一下|最新|新闻|实时|现在|今天|当前/i.test(q);
    const needsTodo = /待办|任务|添加待办|安排|日程|todo/i.test(q);
    const needsTime = /几点|几号|日期|时间|星期几/i.test(q);
    // Note: insert/replace/append/delete tools are NOT available preemptively —
    // they work through post-response markers (```note-insert etc.) because
    // the content must be generated by the LLM first.
    const isQuestion = /[？?]$/.test(q) || /^(什么|怎么|如何|为什么|谁|哪里|什么时候)/i.test(q);

    if (needsSearch) {
      return { use_tool: true, tool_name: "web_search", use_skill: false, skill_name: null, confidence: 0.7, reason: "Heuristic: search signal detected", query_rewrite: q };
    }
    if (needsTodo) {
      return { use_tool: true, tool_name: "get_todos", use_skill: false, skill_name: null, confidence: 0.7, reason: "Heuristic: todo signal detected", query_rewrite: q };
    }
    if (needsTime) {
      return { use_tool: true, tool_name: "get_current_time", use_skill: false, skill_name: null, confidence: 0.85, reason: "Heuristic: time query detected", query_rewrite: q };
    }

    const hasWikiContext = ctx.wikiContext.length > 50;
    if (isQuestion && !hasWikiContext) {
      return { use_tool: true, tool_name: "web_search", use_skill: false, skill_name: null, confidence: 0.5, reason: "Fallback: question without wiki context", query_rewrite: q };
    }

    return { use_tool: false, tool_name: null, use_skill: false, skill_name: null, confidence: 0.5, reason: "Fallback: no tool/skill signal detected" };
  }
}
