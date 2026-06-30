// ── Agent Module Barrel ─────────────────────────────────────
export { AgentOrchestrator, type OrchestratorConfig, type ToolCallResult } from "./agent_orchestrator";
export { routeTool, type RouterResult } from "./tool_router";
export { VectorWikiStore, type VectorSearchResult } from "./vector_wiki_store";
export { WorkingMemory } from "./memory/working_memory";
export { EpisodicMemory, type EpisodicEntry } from "./memory/episodic_memory";
export { UserProfile, type UserProfileData } from "./memory/user_profile";
export { ToolMemory, type ToolUsageRecord } from "./memory/tool_memory";
export { MemoryWriter, type MemoryWriteDecision } from "./memory/memory_writer";
export { ConceptExtractor, type ExtractedConcept } from "./memory/concept_extractor";
export { MarkdownMemoryStore, type ConceptData } from "./memory/memory_store";
export { ConceptGraphBuilder, type ConceptGraph, type ConceptGraphNode, type ConceptGraphEdge, type ConceptSubgraph } from "./reasoning/concept_graph_builder";
export { ConceptReasoner, type ReasoningResult } from "./reasoning/concept_reasoner";
export { FeedbackProcessor, type ReasoningTrace, type FeedbackStats } from "./reasoning/feedback_processor";
export { ConceptEvolver, type MergeCandidate, type SplitCandidate, type DecayResult, type EvolutionResult } from "./reasoning/concept_evolver";
export { DriftController, type CognitivePolicy, type CompressionSignal, type DriftMetrics, DEFAULT_POLICY } from "./policy/drift_controller";
export { StateMutationEngine, type StateMutation, MUTATION_PRIORITY } from "./core/state_mutation_engine";
export { MutationQueue } from "./core/mutation_queue";
export { type CognitiveState, type MemoryState, type ConceptGraphState, type ReasoningState, type FeedbackState, type PolicyState, createEmptyState } from "./core/cognitive_state";
export { SkillRegistry, type Skill, type SkillContext, type SkillResult, type SkillExecutionRecord, createDefaultSkillRegistry } from "./skills";
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
