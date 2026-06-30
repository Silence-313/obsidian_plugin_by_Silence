// ── Unit Test Agent ─────────────────────────────────────────
// Tests each module independently for deterministic outputs,
// correct I/O schemas, and no dependency leakage.
//
// Run: npx tsx src/tests/unit_test_agent.ts

import { routeTool } from "../agent/tool_router";
import { VectorWikiStore } from "../agent/vector_wiki_store";
import { WorkingMemory } from "../agent/memory/working_memory";
import { EpisodicMemory } from "../agent/memory/episodic_memory";
import { UserProfile } from "../agent/memory/user_profile";
import { ToolMemory } from "../agent/memory/tool_memory";
import { MemoryWriter } from "../agent/memory/memory_writer";

interface TestResult {
  module: string;
  test: string;
  passed: boolean;
  error: string | null;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

function assert(module: string, test: string, condition: boolean, msg?: string) {
  const r: TestResult = { module, test, passed: condition, error: condition ? null : (msg || "Assertion failed") };
  results.push(r);
  if (condition) passed++; else { failed++; console.error(`  FAIL [${module}] ${test}: ${msg}`); }
}

// ──────────────────────────────────────────────────────────────
// 1. Tool Router Tests
// ──────────────────────────────────────────────────────────────

function testToolRouter() {
  console.log("\n── Tool Router ──");

  // Deterministic: add_todos exclusive keywords
  const r1 = routeTool("帮我添加一个明天的待办，买菜");
  assert("tool_router", "exclusive add_todos triggers", r1.tool === "add_todos", `Got ${r1.tool}`);
  assert("tool_router", "add_todos confidence > 0.8", r1.confidence > 0.8, `${r1.confidence}`);

  // get_todos keywords
  const r2 = routeTool("查看我的待办列表");
  assert("tool_router", "get_todos keywords", r2.tool === "get_todos", `Got ${r2.tool}`);

  // get_current_time
  const r3 = routeTool("现在几点了");
  assert("tool_router", "time query", r3.tool === "get_current_time", `Got ${r3.tool}`);

  // web_search
  const r4 = routeTool("帮我搜索一下最新的React 19特性");
  assert("tool_router", "web_search trigger", r4.tool === "web_search", `Got ${r4.tool}`);

  // wiki_search
  const r5 = routeTool("根据我的笔记，我之前记过关于TypeScript的内容");
  assert("tool_router", "wiki_search trigger", r5.tool === "wiki_search", `Got ${r5.tool}`);

  // memory_search
  const r6 = routeTool("之前聊过这个话题，你还记得吗");
  assert("tool_router", "memory recall", r6.tool === "memory_search", `Got ${r6.tool}`);

  // direct_answer for greetings
  const r7 = routeTool("你好");
  assert("tool_router", "greeting → direct_answer", r7.tool === "direct_answer", `Got ${r7.tool}`);

  // direct_answer for very short messages
  const r8 = routeTool("好的");
  assert("tool_router", "short msg → direct_answer", r8.tool === "direct_answer", `Got ${r8.tool}`);

  // Confidence bounds
  for (const r of [r1, r2, r3, r4, r5, r6, r7, r8]) {
    assert("tool_router", `confidence in [0..1] for ${r.tool}`, r.confidence >= 0 && r.confidence <= 1, `${r.confidence}`);
  }

  // RouterResult schema
  for (const r of [r1, r2, r3]) {
    assert("tool_router", "RouterResult has tool", typeof r.tool === "string", "");
    assert("tool_router", "RouterResult has confidence", typeof r.confidence === "number", "");
    assert("tool_router", "RouterResult has reason", typeof r.reason === "string", "");
  }
}

// ──────────────────────────────────────────────────────────────
// 2. Vector Wiki Store Tests
// ──────────────────────────────────────────────────────────────

function testVectorWikiStore() {
  console.log("\n── Vector Wiki Store ──");

  const store = new VectorWikiStore();

  // Empty store
  assert("vector_store", "empty search returns []", store.search("test").length === 0);
  assert("vector_store", "empty store not loaded", !store.isLoaded());

  // Build with documents
  const docs = [
    { path: "notes/TypeScript.md", content: "TypeScript is a typed superset of JavaScript. It adds static type checking to the language. Interfaces and generics are powerful features." },
    { path: "notes/React.md", content: "React is a JavaScript library for building user interfaces. Components are the building blocks. Hooks like useState and useEffect are commonly used." },
    { path: "notes/Python.md", content: "Python is an interpreted high-level programming language. It emphasizes code readability with its notable use of significant whitespace." },
    { path: "notes/算法.md", content: "排序算法是计算机科学的基础。快速排序和归并排序是最常用的比较排序算法。时间复杂度是衡量算法效率的重要指标。" },
    { path: "notes/机器学习.md", content: "机器学习是人工智能的一个分支。深度学习使用多层神经网络来学习数据的表示。Transformer架构在自然语言处理中表现出色。" },
  ];
  store.build(docs);

  assert("vector_store", "built 5 docs", store.documentCount === 5);
  assert("vector_store", "is loaded after build", store.isLoaded());

  // Semantic search — TypeScript query should match TypeScript doc
  const r1 = store.search("TypeScript type checking", 3);
  assert("vector_store", "search returns results", r1.length > 0);
  if (r1.length > 0) {
    assert("vector_store", "TypeScript query → TS doc ranked highest", r1[0].sourcePath.includes("TypeScript"), `${r1[0].sourcePath}`);
    assert("vector_store", "similarity score in [0..1]", r1[0].score >= 0 && r1[0].score <= 1, `${r1[0].score}`);
  }

  // Chinese queries
  const r2 = store.search("排序算法 时间复杂度", 3);
  assert("vector_store", "Chinese search returns results", r2.length > 0);
  if (r2.length > 0) {
    assert("vector_store", "Chinese query → 算法 doc", r2[0].sourcePath.includes("算法"), `${r2[0].sourcePath}`);
  }

  // React query
  const r3 = store.search("React hooks useState", 3);
  assert("vector_store", "React query → React doc", r3.length > 0 && r3[0].sourcePath.includes("React"), `${r3[0]?.sourcePath}`);

  // Serialization round-trip
  const serialized = store.serialize();
  const store2 = new VectorWikiStore();
  store2.deserialize(serialized);
  assert("vector_store", "deserialize restores count", store2.documentCount === 5);
  const r4 = store2.search("深度学习 神经网络 Transformer", 2);
  assert("vector_store", "deserialized store search works", r4.length > 0);
}

// ──────────────────────────────────────────────────────────────
// 3. Working Memory Tests
// ──────────────────────────────────────────────────────────────

function testWorkingMemory() {
  console.log("\n── Working Memory ──");

  const wm = new WorkingMemory(5);

  assert("working_memory", "starts empty", wm.count === 0);

  wm.push({ role: "user", content: "Hello", timestamp: 1000 });
  wm.push({ role: "assistant", content: "Hi!", timestamp: 1001 });
  assert("working_memory", "2 messages", wm.count === 2);
  assert("working_memory", "getAll returns all", wm.getAll().length === 2);

  // Capacity enforcement
  for (let i = 0; i < 10; i++) {
    wm.push({ role: "user", content: `msg${i}`, timestamp: 2000 + i });
  }
  assert("working_memory", "respects capacity (5)", wm.count === 5);

  // getLast
  const last2 = wm.getLast(2);
  assert("working_memory", "getLast returns 2", last2.length === 2);

  // getByRole
  const users = wm.getByRole("user");
  assert("working_memory", "getByRole filters correctly", users.every(m => m.role === "user"));

  // getRecentContext
  const ctx = wm.getRecentContext();
  assert("working_memory", "getRecentContext returns string", typeof ctx === "string" && ctx.length > 0);

  // clear
  wm.clear();
  assert("working_memory", "clear empties", wm.count === 0);
}

// ──────────────────────────────────────────────────────────────
// 4. Episodic Memory Tests
// ──────────────────────────────────────────────────────────────

function testEpisodicMemory() {
  console.log("\n── Episodic Memory ──");

  const em = new EpisodicMemory(10);

  assert("episodic_memory", "starts empty", em.count === 0);

  const e1 = em.add({
    type: "goal",
    summary: "完成项目重构",
    detail: "计划在两周内完成agent系统重构",
    importance: 0.9,
    tags: ["refactor", "agent"],
    relatedFiles: [],
  });

  const e2 = em.add({
    type: "decision",
    summary: "使用TF-IDF做向量检索",
    detail: "因为无法在Obsidian沙箱中安装FAISS",
    importance: 0.7,
    tags: ["architecture", "vector-store"],
    relatedFiles: [],
  });

  const e3 = em.add({
    type: "milestone",
    summary: "完成第一期测试",
    detail: "所有单元测试通过",
    importance: 0.95,
    tags: ["testing", "milestone"],
    relatedFiles: [],
  });

  assert("episodic_memory", "3 entries added", em.count === 3);

  // Search
  const s1 = em.search("重构");
  assert("episodic_memory", "search finds refactor entry", s1.length > 0 && s1[0].summary.includes("重构"));

  // getRecent
  const recent = em.getRecent(2);
  assert("episodic_memory", "getRecent returns 2", recent.length === 2);
  assert("episodic_memory", "most recent first", recent[0].summary.includes("第一期测试"));

  // getByType
  const goals = em.getByType("goal");
  assert("episodic_memory", "getByType goal", goals.length === 1);
  const decisions = em.getByType("decision");
  assert("episodic_memory", "getByType decision", decisions.length === 1);

  // getByTag
  const tagged = em.getByTag("architecture");
  assert("episodic_memory", "getByTag", tagged.length === 1);

  // getByImportance
  const hi = em.getByImportance(0.8);
  assert("episodic_memory", "getByImportance >= 0.8", hi.length === 2);

  // formatForContext
  const ctx = em.formatForContext(3);
  assert("episodic_memory", "formatForContext returns string", typeof ctx === "string" && ctx.length > 0);

  // update
  em.update(e1.id, { summary: "完成项目重构（已延期）" });
  const updated = em.search("延期");
  assert("episodic_memory", "update works", updated.length > 0);

  // Serialization round-trip
  const json = em.serialize();
  const em2 = new EpisodicMemory(10);
  em2.deserialize(json);
  assert("episodic_memory", "round-trip preserves count", em2.count === 3);
  const s2 = em2.search("TF-IDF");
  assert("episodic_memory", "round-trip search works", s2.length > 0);
}

// ──────────────────────────────────────────────────────────────
// 5. User Profile Tests
// ──────────────────────────────────────────────────────────────

function testUserProfile() {
  console.log("\n── User Profile ──");

  const up = new UserProfile();

  assert("user_profile", "starts uninitialized", !up.isInitialized());

  up.set("name", "Silence", 0.9);
  up.set("role", "全栈工程师", 0.8);
  up.set("preferredName", "Silence", 0.95);

  assert("user_profile", "initialized after set", up.isInitialized());
  assert("user_profile", "name get", up.get("name") === "Silence");
  assert("user_profile", "role get", up.get("role") === "全栈工程师");

  // Array fields
  up.addToArray("interests", "AI Agent");
  up.addToArray("interests", "Obsidian插件开发");
  up.addToArray("interests", "AI Agent"); // duplicate should be ignored
  assert("user_profile", "interests count", up.get("interests").length === 2);
  assert("user_profile", "no duplicate interests", up.get("interests").filter(i => i === "AI Agent").length === 1);

  up.addToArray("currentFocus", "Agent重构");
  up.addToArray("expertise", "TypeScript");

  // Remove
  up.removeFromArray("interests", "AI Agent");
  assert("user_profile", "remove from array", up.get("interests").length === 1);

  // formatForContext
  const ctx = up.formatForContext();
  assert("user_profile", "formatForContext non-empty", ctx.length > 0 && ctx.includes("Silence"));

  // Empty profile
  const up2 = new UserProfile();
  assert("user_profile", "empty profile context empty", up2.formatForContext() === "");

  // Serialization
  const json = up.serialize();
  const up3 = new UserProfile();
  up3.deserialize(json);
  assert("user_profile", "round-trip name", up3.get("name") === "Silence");
  assert("user_profile", "round-trip interests", up3.get("interests").length === 1);

  // Confidence tracking
  const scores = up.profile.confidenceScores;
  assert("user_profile", "confidence tracked for name", scores["name"] === 0.9);
}

// ──────────────────────────────────────────────────────────────
// 6. Tool Memory Tests
// ──────────────────────────────────────────────────────────────

function testToolMemory() {
  console.log("\n── Tool Memory ──");

  const tm = new ToolMemory();

  // Record some calls
  tm.recordCall("add_todos", { success: true, latencyMs: 150, responseQuality: 0.9 }, "帮我添加明天的待办");
  tm.recordCall("add_todos", { success: true, latencyMs: 200, responseQuality: 0.85 }, "添加一个周五的任务");
  tm.recordCall("add_todos", { success: false, latencyMs: 300, responseQuality: 0.2 }, "添加待办"); // bad query

  tm.recordCall("web_search", { success: true, latencyMs: 800, responseQuality: 0.8 }, "搜索React 19新特性");
  tm.recordCall("get_todos", { success: true, latencyMs: 100, responseQuality: 0.9 }, "查看我的待办");

  // Success rate
  const addRate = tm.getSuccessRate("add_todos");
  assert("tool_memory", "add_todos 2/3 success", Math.abs(addRate - 2 / 3) < 0.01, `${addRate}`);

  const searchRate = tm.getSuccessRate("web_search");
  assert("tool_memory", "web_search 1/1 success", searchRate === 1);

  // Effectiveness
  const eff = tm.getEffectiveness("add_todos");
  assert("tool_memory", "effectiveness in [0..1]", eff >= 0 && eff <= 1);

  // Frequency
  const freq = tm.getFrequency("add_todos");
  assert("tool_memory", "frequency > 0", freq > 0);

  // Unknown tool
  assert("tool_memory", "unknown tool rate defaults 0.5", tm.getSuccessRate("unknown_tool") === 0.5);

  // GetAllStats
  const all = tm.getAllStats();
  assert("tool_memory", "3 tools tracked", all.length >= 3);

  // Serialization
  const json = tm.serialize();
  const tm2 = new ToolMemory();
  tm2.deserialize(json);
  assert("tool_memory", "round-trip preserves stats", Math.abs(tm2.getSuccessRate("add_todos") - 2 / 3) < 0.01);

  // clear
  tm.clear();
  assert("tool_memory", "clear empties", tm.getAllStats().length === 0);
}

// ──────────────────────────────────────────────────────────────
// 7. Memory Writer Tests
// ──────────────────────────────────────────────────────────────

function testMemoryWriter() {
  console.log("\n── Memory Writer ──");

  const em = new EpisodicMemory(50);
  const up = new UserProfile();
  const tm = new ToolMemory();
  const mw = new MemoryWriter(em, up, tm);

  // Test 1: Profile extraction from "我是..." pattern
  const d1 = mw.analyze({
    userMessage: "我是前端工程师，主要用React和TypeScript",
    assistantResponse: "好的，我记住了。你是前端工程师。",
    toolUsed: "direct_answer",
    toolResult: "",
    routerConfidence: 0.5,
    timestamp: Date.now(),
  });
  const profileDecs = d1.filter(d => d.memoryType === "profile");
  assert("memory_writer", "role extracted from message", profileDecs.some(d => d.targetField === "role"));

  // Commit profile changes
  mw.commit(d1, {
    userMessage: "我是前端工程师，主要用React和TypeScript",
    assistantResponse: "好的",
    toolUsed: "direct_answer",
    toolResult: "",
    routerConfidence: 0.5,
    timestamp: Date.now(),
  });
  assert("memory_writer", "profile updated after commit", up.get("role") === "前端工程师");

  // Test 2: Goal detection
  const d2 = mw.analyze({
    userMessage: "我的目标是完成这个插件的重构",
    assistantResponse: "明白了，我会帮你跟踪这个目标。",
    toolUsed: "direct_answer",
    toolResult: "",
    routerConfidence: 0.5,
    timestamp: Date.now(),
  });
  const epDecs = d2.filter(d => d.memoryType === "episodic");
  assert("memory_writer", "goal detected", epDecs.length > 0 && epDecs.some(d => d.tags.includes("goal")));

  // Commit episodic
  mw.commit(d2, {
    userMessage: "我的目标是完成这个插件的重构",
    assistantResponse: "明白了",
    toolUsed: "direct_answer",
    toolResult: "",
    routerConfidence: 0.5,
    timestamp: Date.now(),
  });
  assert("memory_writer", "episodic entry added", em.count > 0);

  // Test 3: Question detection
  const d3 = mw.analyze({
    userMessage: "为什么TypeScript的泛型这么难理解？",
    assistantResponse: "泛型确实需要时间...",
    toolUsed: "direct_answer",
    toolResult: "",
    routerConfidence: 0.5,
    timestamp: Date.now(),
  });
  const qDecs = d3.filter(d => d.memoryType === "episodic" && d.tags.includes("question"));
  assert("memory_writer", "question detected", qDecs.length > 0);

  // Test 4: Tool usage tracking always generated
  const d4 = mw.analyze({
    userMessage: "搜索React",
    assistantResponse: "找到了这些结果...",
    toolUsed: "web_search",
    toolResult: "search results here",
    routerConfidence: 0.8,
    timestamp: Date.now(),
  });
  const toolDecs = d4.filter(d => d.memoryType === "tool");
  assert("memory_writer", "tool tracking always present", toolDecs.length > 0);

  // Test 5: Ignore trivial messages
  const d5 = mw.analyze({
    userMessage: "好的",
    assistantResponse: "👍",
    toolUsed: "direct_answer",
    toolResult: "",
    routerConfidence: 0.85,
    timestamp: Date.now(),
  });
  const nonIgnore = d5.filter(d => d.action !== "ignore" && d.memoryType !== "tool");
  assert("memory_writer", "trivial message produces no significant memories", nonIgnore.length === 0);
}

// ──────────────────────────────────────────────────────────────
// Run All
// ──────────────────────────────────────────────────────────────

console.log("╔══════════════════════════════════════╗");
console.log("║     UNIT TEST AGENT                  ║");
console.log("╚══════════════════════════════════════╝");

testToolRouter();
testVectorWikiStore();
testWorkingMemory();
testEpisodicMemory();
testUserProfile();
testToolMemory();
testMemoryWriter();

console.log(`\n── Results ──`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  console.log("\n── Failures ──");
  for (const r of results.filter(r => !r.passed)) {
    console.log(`  [${r.module}] ${r.test}: ${r.error}`);
  }
  process.exit(1);
} else {
  console.log("\n✅ All unit tests passed.");
  process.exit(0);
}
