// ── Agent Module Barrel ─────────────────────────────────────
export { AgentOrchestrator, type OrchestratorConfig, type ToolCallResult } from "./agent_orchestrator";
export { routeTool, type RouterResult } from "./tool_router";
export { VectorWikiStore, type VectorSearchResult } from "./vector_wiki_store";
export { WorkingMemory } from "./memory/working_memory";
export { EpisodicMemory, type EpisodicEntry } from "./memory/episodic_memory";
export { UserProfile, type UserProfileData } from "./memory/user_profile";
export { ToolMemory, type ToolUsageRecord } from "./memory/tool_memory";
export { MemoryWriter, type MemoryWriteDecision } from "./memory/memory_writer";
export { RouterTelemetry, type RoutingRecord, type ToolMetrics } from "./router_telemetry";
export { RagFeedback, type RetrievalRecord, type DocumentWeight, type QueryCluster } from "./rag_feedback";
export {
  computeDecayScore,
  computeUsefulnessScore,
  reinforce,
  consolidate,
  mergeMemories,
  applyBatchDecay,
  type ScoredMemory,
  type EvolutionSignal,
  type ConsolidationResult,
  type EvolutionCycleResult,
} from "./system_evolution";
