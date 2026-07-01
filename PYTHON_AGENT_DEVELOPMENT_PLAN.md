# Python Agent Development Plan

> **Reference Architecture:** `PYTHON_AGENT_ARCHITECTURE.md`
> **Principle:** Every stage delivers a runnable, testable project.

---

## Milestones

| Milestone | After Stage | Deliverable |
|-----------|-------------|-------------|
| M0: Skeleton | Stage 0 | Empty project with linting, CI, test harness |
| M1: Foundation | Stage 1 | All Pydantic models, config, exceptions, port protocols |
| M2: Cognitive Core | Stage 3 | Memory + Reasoning fully functional, testable with mock LLM |
| M3: Capability System | Stage 6 | Tools, Skills, Search, Planner, Execution Engine all wired |
| M4: Complete Agent | Stage 9 | Full pipeline, public API, observability, end-to-end tested |
| M5: Extensible | Stage 10 | Plugin SDK, docs, examples, third-party tool support |

---

## Stages

### Stage 0: Project Initialization
- **Goal:** Empty Python project with build system, linting, CI
- **Files:** pyproject.toml, .python-version, .gitignore, .pre-commit-config.yaml, CI workflow
- **AC:** pip install succeeds, ruff/mypy pass, pytest runs (0 tests)
- **Complexity:** Low | **Hours:** 2

### Stage 1: Core
- **Goal:** All Pydantic models, config, exceptions, port protocols. Zero business logic.
- **Files:** 15 files across models/ and ports/
- **Key:** 13 Pydantic model files (frozen), 6 Protocol interfaces, 14 exception classes
- **AC:** All models construct + serialize/deserialize, discriminated unions parse correctly
- **Complexity:** Low | **Hours:** 8

### Stage 2: Memory
- **Goal:** WorkingMemory, EpisodicMemory, UserProfile, ToolMemory, MemoryStore, MemoryWriter, ConceptExtractor
- **Files:** 10 files in memory/ and concepts/
- **Algorithms:** Episodic search (keyword+recency+usefulness), decay (exponential), consolidation (Jaccard>0.85), concept extraction (4 strategies)
- **AC:** All memory services functional with InMemoryFileStorage, writer analyzes + commits correctly
- **Complexity:** Medium | **Hours:** 16

### Stage 3: Reasoning
- **Goal:** ConceptGraphBuilder, ConceptReasoner (3 strategies), FeedbackProcessor
- **Files:** 6 files in reasoning/
- **Algorithms:** Graph construction (3 edge types), 1-hop subgraph, 3-strategy reasoning (traversal/pattern/abstraction)
- **AC:** Builder creates correct edges, reasoner produces non-empty results, handles edge cases (0/1 concepts)
- **Complexity:** Medium | **Hours:** 12

### Stage 4: Planner
- **Goal:** IntentParser, ExecutionPlanner, Planner
- **Files:** 5 files in planner/
- **Key:** Intent {action, domain, platform}, ExecutionPlan {steps with depends_on + parallel_group}
- **AC:** Parser maps queries to correct intents, Planner generates valid execution plans
- **Complexity:** Medium | **Hours:** 10

### Stage 5: Execution Engine
- **Goal:** ExecutionEngine, FallbackStrategy, ResultVerifier
- **Files:** 6 files in execution/
- **Key:** Topological sort → parallel groups → execute with timeout → retry/fallback → verify
- **AC:** Sequential + parallel execution, step failure with fallback, timeout per step
- **Complexity:** High | **Hours:** 16

### Stage 6: Search Framework
- **Goal:** SearchProvider protocol, SearchManager, built-in providers (Bing, DuckDuckGo)
- **Files:** 10 files in search/
- **Key:** Parallel search, merge, rank (TF-IDF), dedup (URL-based)
- **AC:** Manager searches with 2 providers, ranks/dedupes, handles provider failure
- **Complexity:** Medium | **Hours:** 12

### Stage 7: Providers
- **Goal:** Concrete implementations: DeepSeek LLM, LocalFileStorage, HTTPX client, TF-IDF vector store, EventBus
- **Files:** 8 files in infrastructure/
- **AC:** LLM streams chunks, storage reads/writes, TF-IDF builds + searches, EventBus emits + delivers
- **Complexity:** Medium | **Hours:** 10

### Stage 8: Evolution
- **Goal:** Memory evolution, ConceptEvolver, DriftController, MutationQueue, StateMutationEngine
- **Files:** 8 files in evolution/, policy/, core/
- **Algorithms:** Decay (exponential), reinforcement (±0.05 clamp), concept merge (≥70% shared), mutation dedup/sort/flush
- **AC:** All evolution algorithms produce correct results, mutations validated + clamped
- **Complexity:** High | **Hours:** 16

### Stage 9: API
- **Goal:** Agent class, Pipeline (12 stages), EventBus, observability (health/metrics/tracing)
- **Files:** 14 files in pipeline/, bus/, observability/, agent.py
- **Key:** Composition root — all modules wired together for the first time
- **AC:** Full pipeline executes, agent.process() works end-to-end with mock LLM, reentrancy guard works
- **Complexity:** High | **Hours:** 20

### Stage 10: Plugin SDK
- **Goal:** Plugin auto-discovery, manifest format, installation/uninstallation, docs, examples
- **Files:** 6 files in plugins/, docs/PLUGIN_SDK.md
- **AC:** Discover + install + uninstall custom tool/provider, example plugins work end-to-end
- **Complexity:** Low | **Hours:** 8

---

## Summary

| Metric | Value |
|--------|-------|
| Total stages | 11 (0-10) |
| Total files | ~93 |
| Total hours | ~130 |
| Critical path | Stage 0→1→2→9 |
| Parallelizable | Stages 3-8 (after Stage 1) |
| Bottleneck | Stage 9 (depends on all) |

### Branch Strategy
```
main ← develop ← stage/N-name (feature branches)
```

### Dependency Order
```
Stage 0 → Stage 1 → Stage 2 → Stage 9
                        ↘ Stage 3 → Stage 9
                        ↘ Stage 8 → Stage 9
                 Stage 4 → Stage 5 → Stage 9
                 Stage 6 → Stage 9
                 Stage 7 → Stage 9
```

### Developer Allocation (3 devs)
- Dev A: 0, 1, 2, 8 (foundations + memory + evolution)
- Dev B: 4, 5, 6 (planner + execution + search)
- Dev C: 3, 7 (reasoning + providers)
- All: 9, 10 (API + plugins — pair programming)
