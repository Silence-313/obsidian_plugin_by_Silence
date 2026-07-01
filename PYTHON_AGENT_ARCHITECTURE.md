# Python Agent Architecture Specification

> **Status:** Definitive architecture reference for Python implementation.
> **Principle:** Interface-driven, async-first, plugin-architecture, event-sourced.
> **Target:** Python 3.12+, no framework dependency beyond stdlib + httpx + Pydantic.

---

## 1. Architectural Style

**Hexagonal Architecture (Ports & Adapters)** with an **Event-Driven Pipeline** core.

```
EXTERNAL ADAPTERS (infrastructure/)
  LLM (DeepSeek) | FileSystem (Local) | HTTP (Web) | Vector Store (TF-IDF)
       │                │                  │              │
       ▼                ▼                  ▼              ▼
PORT INTERFACES (ports/)
  LLMClient Protocol | FileStorage Protocol | HttpClient Protocol | VectorStore Protocol
       │                │                  │              │
       └────────────────┴──────────────────┴──────────────┘
                         │
                         ▼
APPLICATION CORE
  Pipeline (12 stages) ← EventBus → Capability Layer (Tools + Skills + Search + Providers)
       │
       ▼
DOMAIN SERVICES
  Memory | Reasoning | Planner | Execution | Evolution | Policy
       │
       ▼
DOMAIN MODEL
  CognitiveState | Episode | Concept | Mutation | Events (frozen Pydantic models)
```

---

## 2. Layered Architecture

```
Layer 0: Infrastructure  — Adapter implementations (llm/, storage/, http/, vector/)
Layer 1: Domain Model    — Frozen Pydantic models (models/)
Layer 2: Domain Services — Business logic (memory/, reasoning/, evolution/, policy/, routing/, retrieval/)
Layer 3: Capability      — Pluggable capabilities (tools/, skills/, search/, planner/, execution/)
Layer 4: Orchestration   — Pipeline + EventBus (pipeline/, bus/)
Layer 5: Application     — Agent public API (agent.py)
```

### Dependency Rules
```
Layer 5 → Layer 4
Layer 4 → Layer 3 + Layer 2
Layer 3 → Layer 2 + Layer 1
Layer 2 → Layer 1 + Layer 0 (Protocols only!)
Layer 1 → nothing internal
Layer 0 → nothing internal
```

**Forbidden:** Layer 2 must never import from Layer 3 or 4. Layer 1 must never import from any other layer.

---

## 3. Package Structure

```
agent/
├── agent.py                    # Agent: public API entry point
├── config.py                   # AgentConfig (Pydantic Settings)
├── exceptions.py               # AgentException hierarchy (14 classes)
│
├── models/                     # Layer 1: Frozen Pydantic models
│   ├── state.py, memory.py, concepts.py, tools.py, skills.py
│   ├── routing.py, reasoning.py, evolution.py, policy.py
│   ├── mutations.py, retrieval.py, search.py, events.py
│
├── ports/                      # Layer 0: Protocol interfaces
│   ├── llm.py, storage.py, http_client.py, vector_store.py, event_bus.py
│
├── infrastructure/             # Layer 0: Adapter implementations
│   ├── llm/deepseek.py, mock.py
│   ├── storage/local_fs.py, memory_fs.py
│   ├── http/httpx_client.py
│   ├── vector/tfidf_store.py
│   └── logging/structlog_adapter.py
│
├── memory/                     # Layer 2
│   ├── working.py, episodic.py, profile.py, tool_stats.py, store.py, writer.py
│
├── concepts/                   # Layer 2
│   └── extractor.py
│
├── reasoning/                  # Layer 2
│   ├── graph.py, reasoner.py, feedback.py
│
├── evolution/                  # Layer 2
│   ├── scoring.py, memory_evolution.py, concept_evolver.py
│
├── policy/                     # Layer 2
│   └── controller.py
│
├── routing/                    # Layer 2
│   ├── router.py, telemetry.py
│
├── retrieval/                  # Layer 2
│   └── feedback.py
│
├── tools/                      # Layer 3 — REDESIGNED
│   ├── protocol.py, registry.py, decision.py
│   └── builtins/ (web_search, todos, time, wiki_crud)
│
├── skills/                     # Layer 3
│   ├── protocol.py, registry.py
│   └── builtins/ (location, file_reader)
│
├── search/                     # Layer 3 — NEW
│   ├── protocol.py, manager.py
│   └── providers/ (bing, duckduckgo, bilibili, github, arxiv, local, obsidian)
│
├── planner/                    # Layer 3 — NEW
│   ├── intent.py, plan.py, planner.py
│
├── execution/                  # Layer 3 — NEW
│   ├── engine.py, fallback.py, verifier.py
│
├── pipeline/                   # Layer 4
│   ├── protocol.py, context.py, pipeline.py
│   └── stages/ (12 stages: sanitize, route, retrieve, reason, plan, execute,
│                 prompt, generate, sanitize_response, persist, learn, health)
│
├── bus/                        # Layer 4
│   └── memory_bus.py
│
├── observability/              # Cross-cutting
│   ├── health.py, metrics.py, tracer.py
│
└── plugins/                    # Layer 5 extension
    ├── discovery.py, manifest.py, loader.py
```

---

## 4. Core Design Decisions

### 4.1 Pipeline Stage Protocol
```python
class PipelineStage(ABC):
    name: str
    priority: int
    async def execute(self, context: PipelineContext) -> PipelineContext: ...
```

### 4.2 Immutable PipelineContext
Frozen Pydantic model carried through all stages. Each stage returns a NEW instance. No mutation.

### 4.3 Capability Protocol (unified)
```python
class Capability(ABC):
    name: str; description: str; version: str
    async def execute(self, args: dict, context: ExecutionContext) -> CapabilityResult: ...
    def validate_args(self, args: dict) -> bool: ...
```
Tool, Skill, and SearchProvider all extend Capability.

### 4.4 Planner + Execution Engine
Router no longer selects a single tool. Instead:
1. IntentParser: query → Intent {action, domain, platform}
2. ExecutionPlanner: Intent → ExecutionPlan {steps with dependencies + parallel groups}
3. ExecutionEngine: execute plan (topological sort → parallel groups → retry/fallback)

### 4.5 Event-Driven Decoupling
Pipeline stages emit typed events. Observability, logging, audit trail consume events.
All events are frozen Pydantic models (PipelineEvent discriminated union, 18 variants).

### 4.6 Provider Abstraction
Every external dependency (LLM, FileSystem, HTTP, VectorStore) is behind a Protocol. Agent core never depends on concrete implementations.

---

## 5. Agent Public API

```python
class Agent:
    async def initialize(self) -> None: ...
    async def shutdown(self) -> None: ...
    async def process(self, user_input: str, *, on_stream: Callable | None = None) -> AgentResponse: ...
    async def health_check(self) -> HealthReport: ...
    def register_tool(self, tool: Tool) -> None: ...
    def register_skill(self, skill: Skill) -> None: ...
    def register_search_provider(self, provider: SearchProvider) -> None: ...
    def register_pipeline_stage(self, stage: PipelineStage) -> None: ...
```

---

## 6. Extensibility

**Adding a new Tool:** Implement Tool protocol → `agent.register_tool(MyTool())`. Zero changes to core.

**Adding a new Search Provider:** Implement SearchProvider → `agent.register_search_provider(MyProvider())`.

**Adding a new Pipeline Stage:** Implement PipelineStage with unique priority → `agent.register_pipeline_stage(MyStage())`.

---

*This specification is the definitive architecture reference. All implementation decisions should be traceable to principles defined herein.*
