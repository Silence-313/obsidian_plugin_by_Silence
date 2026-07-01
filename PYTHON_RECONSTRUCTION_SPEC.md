# Python Agent Reconstruction Specification

> **Purpose:** Complete blueprint for rebuilding the Agent Framework in Python.
> **Scope:** Agent framework only. Obsidian UI, components, and plugin glue are excluded.
> **Status:** Generated from complete analysis of 22 TypeScript source files in src/agent/.

---

## 1. Executive Summary

The Agent is a 5-layer self-improving cognitive system for personal knowledge management. It processes user queries through: deterministic routing → semantic memory retrieval → concept-aware reasoning → proactive tool execution → LLM generation → post-interaction learning.

Core strengths: Clean memory/reasoning/evolution layers, SSOT-based state management with mutation safety clamps, unique self-improving concept evolution.

Core weakness: Tool System has no interface abstraction — tools are hardcoded in the central orchestrator (switch/case).

---

## 2. Agent File Inventory (22 source files)

### Orchestration
- `agent_orchestrator.ts` — Central pipeline coordinator (1500+ lines, 12-stage lifecycle)

### Routing
- `tool_router.ts` — Keyword-scoring intent classifier (6 tool categories)
- `router_telemetry.ts` — Per-tool success tracking, adaptive threshold evolution

### Memory (Layer 1)
- `memory/working_memory.ts` — Short-term conversation buffer (last 20, in-memory)
- `memory/episodic_memory.ts` — Event/goal/decision storage with evolution scoring
- `memory/user_profile.ts` — Structured user attributes with confidence tracking
- `memory/tool_memory.ts` — Tool usage frequency/success rate/context effectiveness
- `memory/memory_writer.ts` — Post-interaction classification, merge dedup, concept extraction
- `memory/memory_store.ts` — Markdown persistence (YAML frontmatter, CRUD)

### Concepts (Layer 2)
- `memory/concept_extractor.ts` — Heuristic concept extraction (headings/bigrams/trigrams/English)

### Reasoning (Layer 3)
- `reasoning/concept_graph_builder.ts` — Full graph + 1-hop subgraph from concept data
- `reasoning/concept_reasoner.ts` — 3-strategy reasoning (graph traversal/pattern matching/abstraction)

### Feedback & Evolution (Layer 4)
- `reasoning/feedback_processor.ts` — Reasoning trace storage, concept weight reinforcement
- `reasoning/concept_evolver.ts` — Concept merge/split/decay evolution cycles

### Policy (Layer 5)
- `policy/drift_controller.ts` — Global cognitive governor: balance, compression, health

### Tool System
- `tools/tool_decision_policy.ts` — LLM-based autonomous tool/skill usage decision

### Skills
- `skills/skill_registry.ts` — Registry pattern for privileged system capabilities
- `skills/get_current_location.ts` — Browser geolocation
- `skills/read_local_file.ts` — Sandboxed file reading (6-layer security)
- `skills/index.ts` — Default skill registry factory

### Core Architecture
- `core/cognitive_state.ts` — SSOT type definitions for all 5 layers
- `core/state_mutation_engine.ts` — Mutation validation, clamping, batch application
- `core/mutation_queue.ts` — Mutation buffer with dedup, sort, flush

### Retrieval
- `vector_wiki_store.ts` — TF-IDF vectorization, cosine similarity, RAG feedback
- `rag_feedback.ts` — Retrieval quality feedback, query clustering, document weight

### Evolution
- `system_evolution.ts` — Memory decay/reinforcement/consolidation scoring functions

### Exports
- `index.ts` — Barrel export of all agent modules

---

## 3. Architecture Overview

### 5-Layer Cognitive Stack
| Layer | Name | Storage |
|-------|------|---------|
| L1 | Memory | JSON + Markdown files |
| L2 | Concepts | Markdown files with YAML frontmatter |
| L3 | Reasoning | In-memory (no persistence) |
| L4 | Feedback | Markdown files |
| L5 | Policy | JSON file |

### Communication Pattern
All modules communicate through the Orchestrator. No direct module-to-module communication except:
- memory_writer → system_evolution (scoring functions)
- mutation_queue → state_mutation_engine → memory_store (mutation pipeline)
- feedback_processor → drift_controller (policy queries)

### Core Design Decisions
1. Dual-write persistence: JSON is source of truth, Markdown is human-readable mirror
2. No native function calling: LLM API never receives tools — all proactive, before LLM call
3. Safety-first mutations: All state changes through MutationQueue → StateMutationEngine with ±0.05 clamp
4. Soft deletion only: Memories/concepts marked for removal, never physically deleted
5. Policy-aware reasoning: Concept seed selection biased by learned domain preferences

---

## 4. Runtime Lifecycle (12 Stages)

```
Stage 0:  SanitizeInput — strip injection, truncate >4000 chars
Stage 1:  WorkingMemory.push(user)
Stage 2:  routeTool() — keyword+regex scoring across 6 categories, adaptive threshold
Stage 3:  retrieveMemory()
           ├─ vectorStore.search() — TF-IDF cosine similarity (top 3)
           ├─ episodicMemory.search() — keyword + recency + usefulness
           ├─ episodicMemory.formatForContext()
           ├─ userProfile.formatForContext()
           └─ buildConceptReasoning()
                ├─ markdownStore.loadConcepts()
                ├─ conceptGraphBuilder.buildFull()
                ├─ policy-aware seed scoring
                ├─ conceptGraphBuilder.buildSubgraph(1-hop)
                └─ conceptReasoner.reason() — 3 strategies
Stage 3.5: toolDecisionPolicy.decide() — SEPARATE LLM call, strict JSON
           ├─ if use_tool → executeToolLocal(name, args) — switch/case
           └─ if use_skill → skillRegistry.execute()
Stage 4:  buildSystemPrompt() — time + profile + wiki + episodic + reasoning + rules
Stage 5:  buildLLMMessages() — system + last 10 history + user
Stage 6:  streamLLMWithTimeout() — SSE streaming, 60s timeout, 50ms throttle
Stage 6.5: stripToolCallText() — safety net for leaked tool call text
Stage 7:  WorkingMemory.push(assistant)
Stage 8:  MemoryWriter.analyze() + commit() — classify, consolidate, extract concepts
Stage 9:  RouterTelemetry.recordRouting()
Stage 10: RagFeedback.recordRetrieval() — adjust document weights
Stage 10.5: FeedbackProcessor.process() — cognitive feedback
Stage 10.5b: MutationQueue.flush(engine)
Stage 10.6: Health check (every 15 interactions)
Stage 11: Evolution cycle
           - Every 10: memory decay + consolidation
           - Every 20: concept merge/split/decay
Stage 12: saveMemoryState() — JSON + Markdown dual-write
```

---

## 5. Module Responsibilities (abbreviated)

### AgentOrchestrator — 3/10
Central pipeline coordinator. Owns 18 direct imports. 1500+ lines. 6 distinct responsibilities in one class. Tool definitions and execution hardcoded. CRITICAL: God Object.

### ToolRouter — 7/10
Fast deterministic intent classifier. 6 tool categories with keyword + regex scoring. Adaptive threshold via RouterTelemetry. Clean, single responsibility.

### WorkingMemory — 8/10
Short-term buffer. Last 20 messages. In-memory only. Clean, minimal.

### EpisodicMemory — 8/10
Persistent event store. 200 entries. Evolution scoring fields. search() with keyword+tag+recency+usefulness. applyDecay() with exponential formula. Clean, well-designed.

### UserProfile — 8/10
Structured user attributes. Confidence tracking per field. formatForContext() for system prompt injection.

### ToolMemory — 7/10
Tool usage tracker. Rolling averages. Pattern extraction. suggestAlternate() for tool recommendation.

### MemoryWriter — 6/10
Post-interaction coordinator. 6 dependencies. Classify into episodic/profile/semantic/tool. Consolidation check (Jaccard > 0.85). IMPROVEMENT: Reduce dependency count.

### ConceptExtractor — 8/10
Heuristic extraction. 4 strategies (headings/bigrams/trigrams/English). No LLM. Clean.

### ConceptGraphBuilder — 8/10
Graph construction. 3 edge types. 1-hop subgraph. Clean, pure computation.

### ConceptReasoner — 9/10
3-strategy reasoning engine. Pure graph logic. No LLM. No I/O. Excellent.

### DriftController — 9/10
Global governor. Policy normalization. Balance enforcement. Compression detection. Health scoring. Pure computation. Excellent.

### SkillRegistry — 9/10
Registry pattern. Clean Skill interface. Permission validation. Execution logging. This should be the model for the Tool system. Excellent.

### ToolDecisionPolicy — 7/10
LLM-based decision. Separate API call. Fallback heuristics. Good, but hardcoded tool descriptions.

### StateMutationEngine — 9/10
Authoritative mutation validator. 7 mutation types. ±0.05 clamp. Atomic batch apply. Excellent.

---

## 6. Key Algorithms

### Router Scoring
For each of 6 tool categories, compute keyword hits + regex matches, multiply by weight, compare against adaptive threshold. Highest weighted match wins.

### TF-IDF Vectorization
Tokenize → remove stop words → compute TF per doc → compute IDF = log(N/df) → sparse vectors → cosine similarity → apply RAG feedback adjustment.

### Concept Reasoning (3 strategies)
1. Graph Traversal: degree centrality → key concepts, between-cluster edges → bridging
2. Pattern Matching: query-co-occurring concepts → key, co-occurrence without edge → insight
3. Abstraction: dense groups → clusters, cluster themes → insights, conflict → contradictions
Merge: union of findings, weighted confidence (0.4 × traversal + 0.3 × pattern + 0.3 × abstraction).

### Memory Decay
effectiveRate = 0.03 × (1 - usageFreq × 0.6)
decayScore = importance × e^(-effectiveRate × cycles)
Mark for removal if: decayScore < 0.25 AND unused AND ≥14 cycles.

### Concept Evolution
Merge: shared episodes ≥70% or strong edge (≥0.7), min 2 co-occurrences
Split: ≥2 conflicting relationship groups
Decay: ≥7 days unused → -0.05 confidence, floor 0.15.

---

## 7. Architecture Scores

| Subsystem | Score |
|-----------|-------|
| Agent Orchestrator | 3/10 |
| Memory | 8/10 |
| Reasoning | 8/10 |
| Evolution | 7/10 |
| Skills | 8/10 |
| Tools | 2/10 |
| Router | 7/10 |
| Core (SSOT) | 9/10 |
| **Overall** | **6.2/10** |

---

## 8. Key Architectural Smells

- **God Object:** orchestrator — 1500+ lines, 18 imports, 6 responsibilities
- **Shotgun Surgery:** Adding a tool requires changes in 5 locations
- **Leaky Abstraction:** HTML scraping in core orchestrator code
- **Mixed Layers:** Prompt + LLM + tools + memory + evolution in one class
- **No Tool Interface:** Tools are strings in a switch/case — only subsystem without abstraction

---

*Generated from complete analysis of 22 source files. Every behavior, algorithm, and data model is derived from actual implementation.*
