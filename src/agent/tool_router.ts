// ── Tool Router ──────────────────────────────────────────────
// Intent classification via scoring rules, NOT LLM prompt logic.
// Decouples tool-selection decisions from the system prompt.
// Adaptive: supports RouterTelemetry for dynamic thresholds.

import type { RouterTelemetry } from "./router_telemetry";

export interface RouterResult {
  tool: string;
  confidence: number;
  reason: string;
}

interface ToolPattern {
  keywords: string[];
  patterns: RegExp[];
  weight: number;
  exclusives?: string[]; // if any of these keywords present, boost heavily
}

// Ordered by priority — first match with high confidence wins
const TOOL_PATTERNS: Record<string, ToolPattern> = {
  add_todos: {
    keywords: [
      "添加待办", "新增待办", "创建待办", "安排", "帮我添加", "帮我安排",
      "加一个待办", "加一条待办", "增加待办", "添加任务", "新增任务",
      "明天的任务", "今天的任务", "下周", "下周一", "下周二", "下周三",
      "下周四", "下周五", "下周六", "下周日", "周五", "周六", "周日",
      "周一", "周二", "周三", "周四",
      "add todo", "create task", "schedule", "安排任务", "计划",
    ],
    patterns: [
      /(?:添加|新增|创建|安排|加|帮我).{0,6}(?:待办|任务|事项)/,
      /(?:明天|今天|下周|周[一二三四五六日]|星期[一二三四五六日]).{0,6}(?:的)?(?:待办|任务|安排)/,
      /(?:安排|计划|设置).{0,4}(?:一下|一个)/,
    ],
    weight: 1.0,
    exclusives: ["添加待办", "新增待办", "帮我添加", "帮我安排", "安排任务"],
  },

  get_todos: {
    keywords: [
      "待办", "任务列表", "查看待办", "我的待办", "有哪些待办", "看下待办",
      "未完成", "完成了多少", "还有多少", "做了多少", "进度",
      "今天做了什么", "昨天做了什么", "最近做了什么",
      "todo", "task list", "what did i", "pending",
    ],
    patterns: [
      /(?:查看|看|显示|列出|有哪些|多少).{0,4}(?:待办|任务)/,
      /(?:完成|进度|做了).{0,4}(?:多少|什么|哪些)/,
      /(?:今天|昨天|最近).{0,4}(?:做了|完成)/,
      /待办.*(?:情况|列表|统计)/,
    ],
    weight: 0.9,
    exclusives: ["待办列表", "我的待办", "查看待办", "有哪些待办"],
  },

  get_current_time: {
    keywords: [
      "现在几点", "今天几号", "今天日期", "当前时间", "现在是",
      "星期几", "几点了", "今天星期几", "日期", "时间",
      "what time", "current time", "current date", "what day",
    ],
    patterns: [
      /^(?:现在|今天|当前).{0,3}(?:几点|几号|日期|时间|星期)/,
      /(?:现在|当前)(?:是)?(?:几点|什么时间|什么日期)/,
      /几点了|星期几/,
    ],
    weight: 0.85,
    exclusives: ["现在几点", "今天几号", "几点了"],
  },

  web_search: {
    keywords: [
      "搜索", "查一下", "帮我查", "查查", "搜一下", "搜索一下",
      "最新的", "最近", "新闻", "现在", "当前", "实时",
      "search", "look up", "find", "最新", "资讯",
    ],
    patterns: [
      /(?:搜索|查|搜).{0,4}(?:一下|一查|看看)/,
      /(?:最新|最近|现在|当前).{0,4}(?:的|有什么)/,
      /(?:帮我查|查一下|搜一下).+/,
      /(?:什么是|是谁|在哪里|什么时候).+/,
    ],
    weight: 0.7,
  },

  wiki_search: {
    keywords: [
      "笔记", "知识库", "wiki", "我的笔记", "我记得", "我写过",
      "之前记的", "记录", "笔记里", "根据笔记", "摘要",
      "my notes", "knowledge base", "wiki",
    ],
    patterns: [
      /(?:笔记|知识库|wiki).{0,4}(?:里|中|有|关于)/,
      /(?:根据|按照).{0,4}(?:笔记|记录)/,
      /(?:我|之前).{0,3}(?:记过|写过|记录过)/,
    ],
    weight: 0.75,
  },

  memory_search: {
    keywords: [
      "之前聊过", "上次说", "你记得", "回忆", "记得吗", "上次",
      "之前", "以前说过", "之前提到", "你说过", "记录显示",
      "do you remember", "last time", "previously",
    ],
    patterns: [
      /(?:之前|上次|以前).{0,4}(?:聊过|说过|提到|讨论)/,
      /(?:你记得|回忆|记得吗).+/,
      /(?:过去|历史).{0,2}(?:对话|聊天|交流)/,
    ],
    weight: 0.8,
  },
};

// Negative patterns that push toward direct_answer
const DIRECT_ANSWER_SIGNALS = [
  /^(?:你好|hi|hello|hey)/i,
  /^(?:谢谢|感谢|thanks|thank)/i,
  /^(?:再见|bye|拜拜)/i,
  /^(?:好|ok|知道了|明白了|懂了)/i,
  /^.{0,8}$/, // very short messages are usually conversational (8 chars for CJK)
];

/**
 * Classify user intent and decide which tool to use.
 * Returns the tool with highest confidence score.
 */
export function routeTool(query: string, telemetry?: RouterTelemetry): RouterResult {
  const normalized = query.toLowerCase().trim();

  // 1. Check direct-answer signals first
  for (const pattern of DIRECT_ANSWER_SIGNALS) {
    if (pattern.test(normalized)) {
      // Only short-circuit if no strong tool signal is also present
      const hasStrongToolSignal = Object.values(TOOL_PATTERNS).some(
        tp => tp.exclusives?.some(e => normalized.includes(e.toLowerCase()))
      );
      if (!hasStrongToolSignal) {
        return {
          tool: "direct_answer",
          confidence: 0.85,
          reason: "Conversational signal detected, no tool needed",
        };
      }
    }
  }

  // 2. Score each tool with adaptive weights from telemetry
  const scores: Array<{ tool: string; score: number; reasons: string[] }> = [];

  for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) {
    let score = 0;
    const reasons: string[] = [];

    // Keyword matching
    for (const kw of pattern.keywords) {
      if (normalized.includes(kw.toLowerCase())) {
        score += 0.15;
        if (score === 0.15) reasons.push(`keyword: "${kw}"`);
      }
    }

    // Exclusive keyword boost
    if (pattern.exclusives) {
      for (const ex of pattern.exclusives) {
        if (normalized.includes(ex.toLowerCase())) {
          score += 0.3;
          reasons.push(`exclusive: "${ex}"`);
          break;
        }
      }
    }

    // Regex pattern matching
    for (const regex of pattern.patterns) {
      if (regex.test(query)) {
        score += 0.2;
        reasons.push(`pattern: ${regex.source.substring(0, 30)}`);
      }
    }

    // Apply base weight
    score *= pattern.weight;

    // Apply adaptive policy weight from telemetry if available
    if (telemetry) {
      const policyWeight = telemetry.getPolicyWeight(tool);
      // Blend base weight with learned policy weight
      score *= (0.7 + 0.3 * policyWeight);
    }

    // Cap individual tool score at 1.0
    score = Math.min(score, 1.0);

    if (score > 0) {
      scores.push({ tool, score, reasons });
    }
  }

  // 3. Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // 4. Default to direct_answer if nothing matched
  if (scores.length === 0) {
    return {
      tool: "direct_answer",
      confidence: 0.5,
      reason: "No tool patterns matched, defaulting to direct answer",
    };
  }

  const best = scores[0];

  // 5. Adaptive fallback threshold (from telemetry if available)
  const fallbackThreshold = telemetry
    ? telemetry.getAdaptiveThreshold(best.tool)
    : 0.2;

  if (best.score < fallbackThreshold) {
    return {
      tool: "direct_answer",
      confidence: 0.6,
      reason: `Best tool "${best.tool}" scored too low (${best.score.toFixed(2)} < ${fallbackThreshold}), falling back to direct answer`,
    };
  }

  return {
    tool: best.tool,
    confidence: Math.round(best.score * 100) / 100,
    reason: best.reasons.join("; ") || `Scored highest at ${best.score.toFixed(2)}`,
  };
}
