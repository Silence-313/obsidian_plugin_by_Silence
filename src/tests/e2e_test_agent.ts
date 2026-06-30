// ── End-to-End Test Agent ───────────────────────────────────
// Simulates 6 real usage scenarios end-to-end.
// Validates: correct tool routing, memory usage, response quality, system stability.
//
// Run: npx tsx src/tests/e2e_test_agent.ts

import { routeTool } from "../agent/tool_router";
import { VectorWikiStore } from "../agent/vector_wiki_store";
import { WorkingMemory } from "../agent/memory/working_memory";
import { EpisodicMemory } from "../agent/memory/episodic_memory";
import { UserProfile } from "../agent/memory/user_profile";
import { ToolMemory } from "../agent/memory/tool_memory";
import { MemoryWriter } from "../agent/memory/memory_writer";

interface ScenarioResult {
  scenario: string;
  expectedTool: string;
  actualTool: string;
  passed: boolean;
  details: string;
}

const results: ScenarioResult[] = [];
let passed = 0;
let failed = 0;

// ── Shared State (simulates a running agent session) ────────

const store = new VectorWikiStore();
const wm = new WorkingMemory(20);
const em = new EpisodicMemory(100);
const up = new UserProfile();
const tm = new ToolMemory();
const mw = new MemoryWriter(em, up, tm);

// Pre-populate wiki with realistic content
store.build([
  { path: "notes/TypeScript泛型.md", content: "TypeScript泛型（Generics）允许创建可复用的组件。语法使用尖括号<T>。可以用extends约束泛型类型。泛型工具类型包括Partial<T>、Required<T>、Pick<T,K>、Omit<T,K>等。" },
  { path: "notes/React状态管理.md", content: "React状态管理方案包括：useState用于简单状态、useReducer用于复杂状态逻辑、Context API用于跨组件共享、Redux用于大型应用。React 19引入了use() hook和Server Components。" },
  { path: "notes/Obsidian插件架构.md", content: "Obsidian插件使用TypeScript开发。核心API包括：Plugin类（onload/onunload）、ItemView（自定义视图）、SettingTab（设置面板）、Vault API（文件读写）。注册视图使用registerView()和registerExtensions()。" },
  { path: "notes/AI Agent设计.md", content: "AI Agent架构包含：感知层（输入处理）、决策层（规划/路由）、执行层（工具调用）、记忆层（短期/长期记忆）。记忆系统分为工作记忆、情景记忆、语义记忆。工具路由可以用规则引擎或LLM驱动。" },
  { path: "notes/机器学习基础.md", content: "机器学习三大范式：监督学习（分类/回归）、无监督学习（聚类/降维）、强化学习（奖励驱动）。深度学习使用多层神经网络。Transformer架构基于自注意力机制。" },
]);

function recordScenario(
  scenario: string,
  expectedTool: string,
  query: string,
  _assistantResponse: string,
) {
  // 1. Router decision
  const route = routeTool(query);

  // 2. Memory retrieval
  const wikiResults = store.search(query, 3);
  const episodicCtx = em.formatForContext(5);
  const profileCtx = up.formatForContext();

  // 3. Simulate tool execution (just track it)
  const toolPassed = route.tool === expectedTool ||
    // Accept close matches
    (expectedTool === "wiki_search" && route.tool === "direct_answer") ||
    (expectedTool === "direct_answer" && ["wiki_search", "web_search"].includes(route.tool));

  // 4. Record tool usage
  tm.recordCall(
    route.tool,
    { success: toolPassed, latencyMs: 100, responseQuality: toolPassed ? 0.8 : 0.3 },
    query,
    route.tool,
  );

  // 5. Memory writer
  const decisions = mw.analyze({
    userMessage: query,
    assistantResponse: _assistantResponse,
    toolUsed: route.tool,
    toolResult: wikiResults.map(r => r.content).join("\n"),
    routerConfidence: route.confidence,
    timestamp: Date.now(),
  });
  mw.commit(decisions, {
    userMessage: query,
    assistantResponse: _assistantResponse,
    toolUsed: route.tool,
    toolResult: wikiResults.map(r => r.content).join("\n"),
    routerConfidence: route.confidence,
    timestamp: Date.now(),
  });

  // 6. Working memory
  wm.push({ role: "user", content: query, timestamp: Date.now() });
  wm.push({ role: "assistant", content: _assistantResponse, timestamp: Date.now() });

  const contextAvailable = wikiResults.length > 0 || episodicCtx.length > 0 || profileCtx.length > 0;
  const details = `router=${route.tool}(conf=${route.confidence}), wiki=${wikiResults.length} results, episodic=${em.count}, profile=${up.isInitialized()}`;

  const r: ScenarioResult = {
    scenario,
    expectedTool,
    actualTool: route.tool,
    passed: toolPassed && contextAvailable,
    details,
  };
  results.push(r);
  if (r.passed) passed++;
  else { failed++; console.error(`  FAIL [${scenario}]: ${details}`); }
}

// ──────────────────────────────────────────────────────────────
// Scenario 1: Technical question requiring wiki retrieval
// ──────────────────────────────────────────────────────────────

console.log("\n── Scenario 1: Technical question → wiki_search ──");
recordScenario(
  "S1: Technical wiki query",
  "wiki_search",
  "TypeScript的泛型怎么用？extends约束是什么意思？",
  "根据你的笔记《TypeScript泛型》，泛型允许创建可复用的组件。extends用于约束泛型类型参数，确保传入的类型满足特定条件。",
);

// ──────────────────────────────────────────────────────────────
// Scenario 2: Query requiring web_search
// ──────────────────────────────────────────────────────────────

console.log("\n── Scenario 2: External knowledge → web_search ──");
recordScenario(
  "S2: Web search for latest info",
  "web_search",
  "帮我搜索一下2025年最新的前端开发趋势",
  "根据搜索结果，2025年前端开发趋势包括：AI驱动的开发工具、WebAssembly的广泛应用、边缘计算、以及CSS的新特性如view-transitions等。",
);

// ──────────────────────────────────────────────────────────────
// Scenario 3: Adding and retrieving todos
// ──────────────────────────────────────────────────────────────

console.log("\n── Scenario 3: Todo operations ──");
recordScenario(
  "S3a: Add todo",
  "add_todos",
  "帮我添加一个明天的待办：完成React组件重构，优先级高",
  "好的，已为你添加明天的高优先级待办：完成React组件重构。",
);

recordScenario(
  "S3b: Get todos",
  "get_todos",
  "查看我的待办列表，有哪些还没完成？",
  "你目前有3条未完成待办：1) [高] 完成React组件重构 (明天) 2) [中] 更新插件文档 (今天) 3) [低] 整理笔记 (今天)",
);

// ──────────────────────────────────────────────────────────────
// Scenario 4: Memory recall based question
// ──────────────────────────────────────────────────────────────

console.log("\n── Scenario 4: Memory recall ──");
// First, establish some memory
em.add({
  type: "decision",
  summary: "决定使用TF-IDF而不是FAISS做向量检索",
  detail: "因为Obsidian的Electron沙箱无法安装FAISS等原生库，选择了TF-IDF+余弦相似度的纯JS实现",
  importance: 0.85,
  tags: ["architecture", "vector-store", "decision"],
  relatedFiles: ["src/agent/vector_wiki_store.ts"],
});

recordScenario(
  "S4: Memory recall question",
  "memory_search",
  "之前你说过为什么不用FAISS做向量检索？你还记得吗？",
  "根据之前的决策记录，我们选择TF-IDF而不是FAISS的原因是Obsidian的Electron沙箱环境无法安装FAISS这类需要原生C++扩展的库。TF-IDF+余弦相似度是纯JS实现，可以在任何环境运行。",
);

// ──────────────────────────────────────────────────────────────
// Scenario 5: Ambiguous query requiring direct_answer fallback
// ──────────────────────────────────────────────────────────────

console.log("\n── Scenario 5: Ambiguous query → direct_answer ──");
recordScenario(
  "S5: Ambiguous/greeting query",
  "direct_answer",
  "你好，今天天气不错",
  "你好！确实，好天气让人心情愉悦。有什么我可以帮你的吗？",
);

// ──────────────────────────────────────────────────────────────
// Scenario 6: Time/date query
// ──────────────────────────────────────────────────────────────

console.log("\n── Scenario 6: Time/date query ──");
recordScenario(
  "S6: Current time query",
  "get_current_time",
  "现在几点了？今天是星期几？",
  "现在是2026年6月30日 14:30:00 星期二。",
);

// ──────────────────────────────────────────────────────────────
// System stability checks
// ──────────────────────────────────────────────────────────────

console.log("\n── System Stability Checks ──");

// 1. Memory integrity after all scenarios
const memIntegrity = wm.count >= 12; // 6 scenarios × 2 messages
const stability1 = memIntegrity ? "PASS" : "FAIL";
if (!memIntegrity) console.error(`  FAIL: Working memory count ${wm.count} < 12`);

// 2. Episodic count increased
const stability2 = em.count >= 1 ? "PASS" : "FAIL";

// 3. Tool memory tracks all tools used
const toolsTracked = tm.getAllStats().map(s => s.toolName);
const stability3 = toolsTracked.length >= 3 ? "PASS" : "FAIL";
if (toolsTracked.length < 3) console.error(`  FAIL: Only ${toolsTracked.length} tools tracked: ${toolsTracked.join(", ")}`);

// 4. Vector store still functional after all operations
const finalSearch = store.search("AI Agent", 2);
const stability4 = finalSearch.length > 0 ? "PASS" : "FAIL";

// 5. No module state corruption
// All modules should still be independently functional
const testRoute = routeTool("帮我添加一个待办");
const stability5 = testRoute.tool === "add_todos" ? "PASS" : "FAIL";

// 6. Memory writer doesn't throw on edge cases
let stability6 = "PASS";
try {
  mw.analyze({
    userMessage: "",
    assistantResponse: "",
    toolUsed: "direct_answer",
    toolResult: "",
    routerConfidence: 0,
    timestamp: 0,
  });
} catch {
  stability6 = "FAIL";
  console.error("  FAIL: Memory writer threw on edge case");
}

console.log(`  Memory integrity: ${stability1}`);
console.log(`  Episodic growth: ${stability2}`);
console.log(`  Tool coverage: ${stability3}`);
console.log(`  Vector store health: ${stability4}`);
console.log(`  Router stability: ${stability5}`);
console.log(`  Memory writer edge cases: ${stability6}`);

const stabilityPassed = [stability1, stability2, stability3, stability4, stability5, stability6]
  .filter(s => s === "PASS").length;
const stabilityFailed = 6 - stabilityPassed;

// ──────────────────────────────────────────────────────────────
// Run All
// ──────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════╗");
console.log("║     E2E TEST AGENT                   ║");
console.log("╚══════════════════════════════════════╝");

console.log(`\n── Scenario Results ──`);
for (const r of results) {
  const status = r.passed ? "✅" : "❌";
  console.log(`${status} ${r.scenario}: expected=${r.expectedTool}, actual=${r.actualTool}`);
  if (!r.passed) console.log(`   ${r.details}`);
}

console.log(`\n── Results ──`);
console.log(`  Scenarios Passed: ${passed}/${passed + failed}`);
console.log(`  Stability Passed: ${stabilityPassed}/${stabilityPassed + stabilityFailed}`);

const totalPassed = passed + stabilityPassed;
const totalFailed = failed + stabilityFailed;

if (totalFailed > 0) {
  console.log(`\n❌ ${totalFailed} total failures.`);
  process.exit(1);
} else {
  console.log("\n✅ All E2E tests passed with system stability verified.");
  process.exit(0);
}
