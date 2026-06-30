// ── Cognitive State Kernel ───────────────────────────────────
// Single Source of Truth (SSOT) for the entire cognitive system.
// All system components read from this state snapshot and
// propose changes through the StateMutationEngine — never
// directly mutate derived state.
//
// This is a read-only snapshot. Actual state lives in:
//   - EpisodicMemory (in-memory)
//   - MarkdownMemoryStore (vault files)
//   - DriftController (policy)
// The StateMutationEngine bridges mutations → actual stores.

// ── State Interfaces ─────────────────────────────────────────

export interface MemoryState {
  episodicCount: number;
  episodicActive: number;
  workingMemorySize: number;
  profileFields: number;
  profileInitialized: boolean;
}

export interface ConceptGraphState {
  conceptCount: number;
  avgConfidence: number;
  totalEdges: number;
  domainsTracked: string[];
}

export interface ReasoningState {
  lastReasoningConfidence: number | null;
  keyConceptsUsed: string[];
  lastQuery: string | null;
  reasoningCyclesRun: number;
}

export interface FeedbackState {
  tracesStored: number;
  conceptsReinforced: number;
  insightsReinforced: number;
  contradictionsDetected: number;
  policyUpdates: number;
}

export interface PolicyState {
  domainPreferences: Record<string, number>;
  strategyWeights: Record<string, number>;
  explorationRate: number;
  compressionThreshold: number;
  version: number;
}

export interface CognitiveState {
  memory: MemoryState;
  concepts: ConceptGraphState;
  reasoning: ReasoningState;
  feedback: FeedbackState;
  policy: PolicyState;
  version: number;
  lastUpdated: number;
}

// ── State Snapshot Builder ───────────────────────────────────

export function createEmptyState(): CognitiveState {
  return {
    memory: {
      episodicCount: 0, episodicActive: 0,
      workingMemorySize: 0, profileFields: 0, profileInitialized: false,
    },
    concepts: {
      conceptCount: 0, avgConfidence: 0.5,
      totalEdges: 0, domainsTracked: [],
    },
    reasoning: {
      lastReasoningConfidence: null,
      keyConceptsUsed: [], lastQuery: null, reasoningCyclesRun: 0,
    },
    feedback: {
      tracesStored: 0, conceptsReinforced: 0,
      insightsReinforced: 0, contradictionsDetected: 0, policyUpdates: 0,
    },
    policy: {
      domainPreferences: {},
      strategyWeights: { graphTraversal: 0.7, patternMatching: 0.6, abstraction: 0.9 },
      explorationRate: 0.2, compressionThreshold: 0.65, version: 1,
    },
    version: 1,
    lastUpdated: Date.now(),
  };
}
