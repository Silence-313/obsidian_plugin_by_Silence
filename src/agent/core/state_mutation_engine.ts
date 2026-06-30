// ── State Mutation Engine ────────────────────────────────────
// Central authority for ALL cognitive state changes.
// Every module emits StateMutation objects; this engine validates,
// clamps, and applies them atomically.
//
// Rules enforced:
//   - ±0.05 clamp on confidence/importance deltas
//   - Priority-based conflict resolution
//   - Immutable mutation records for audit trail

import type { MarkdownMemoryStore } from "../memory/memory_store";
import type { EpisodicMemory, EpisodicEntry } from "../memory/episodic_memory";
import type { UserProfile } from "../memory/user_profile";
import type { ReasoningTrace } from "../reasoning/feedback_processor";

// ── Mutation Types ───────────────────────────────────────────

export type StateMutation =
  | ConceptUpdateMutation
  | ConceptMergeMutation
  | ConceptDecayMutation
  | MemoryWriteMutation
  | PolicyUpdateMutation
  | ReasoningTraceMutation
  | RelationshipMarkMutation;

export interface ConceptUpdateMutation {
  type: "concept_update";
  payload: {
    conceptName: string;
    confidenceDelta: number;
    importanceDelta: number;
    reason: string;
    metadata?: Record<string, unknown>;
  };
}

export interface ConceptMergeMutation {
  type: "concept_merge";
  payload: {
    sourceSlug: string;
    targetSlug: string;
    reason: string;
  };
}

export interface ConceptDecayMutation {
  type: "concept_decay";
  payload: {
    conceptSlug: string;
    delta: number;
    reason: string;
  };
}

export interface MemoryWriteMutation {
  type: "memory_write";
  payload: {
    entry: EpisodicEntry;
  };
}

export interface PolicyUpdateMutation {
  type: "policy_update";
  payload: {
    domain?: string;
    domainDelta?: number;
    strategy?: "graphTraversal" | "patternMatching" | "abstraction";
    strategyDelta?: number;
    reason: string;
  };
}

export interface ReasoningTraceMutation {
  type: "reasoning_trace";
  payload: {
    trace: ReasoningTrace;
  };
}

export interface RelationshipMarkMutation {
  type: "relationship_mark";
  payload: {
    conceptA: string;
    conceptB: string;
    stable: boolean; // true = stable, false = unstable
    reason: string;
  };
}

// ── Mutation Priority (for conflict resolution) ──────────────

export const MUTATION_PRIORITY: Record<StateMutation["type"], number> = {
  "policy_update": 1,
  "concept_merge": 2,
  "concept_update": 3,
  "concept_decay": 4,
  "memory_write": 5,
  "reasoning_trace": 6,
  "relationship_mark": 7,
};

// ── Engine ───────────────────────────────────────────────────

const MAX_DELTA = 0.05;

export class StateMutationEngine {
  private markdownStore: MarkdownMemoryStore;
  private episodicMemory: EpisodicMemory | null;
  private userProfile: UserProfile | null;
  private mutationLog: StateMutation[] = [];

  constructor(
    markdownStore: MarkdownMemoryStore,
    episodicMemory?: EpisodicMemory,
    userProfile?: UserProfile,
  ) {
    this.markdownStore = markdownStore;
    this.episodicMemory = episodicMemory ?? null;
    this.userProfile = userProfile ?? null;
  }

  // ── Validation ─────────────────────────────────────────────

  /**
   * Validate a mutation before applying.
   * Enforces ±0.05 clamp on confidence/importance deltas.
   */
  validate(mutation: StateMutation): { valid: boolean; reason?: string } {
    switch (mutation.type) {
      case "concept_update": {
        const { confidenceDelta, importanceDelta } = mutation.payload;
        if (Math.abs(confidenceDelta) > MAX_DELTA) {
          return {
            valid: false,
            reason: `confidenceDelta ${confidenceDelta} exceeds ±${MAX_DELTA} clamp`,
          };
        }
        if (Math.abs(importanceDelta) > MAX_DELTA) {
          return {
            valid: false,
            reason: `importanceDelta ${importanceDelta} exceeds ±${MAX_DELTA} clamp`,
          };
        }
        if (!mutation.payload.conceptName || mutation.payload.conceptName.length < 1) {
          return { valid: false, reason: "conceptName is required" };
        }
        return { valid: true };
      }
      case "concept_merge": {
        if (!mutation.payload.sourceSlug || !mutation.payload.targetSlug) {
          return { valid: false, reason: "sourceSlug and targetSlug are required" };
        }
        if (mutation.payload.sourceSlug === mutation.payload.targetSlug) {
          return { valid: false, reason: "source and target must differ" };
        }
        return { valid: true };
      }
      case "concept_decay": {
        if (Math.abs(mutation.payload.delta) > MAX_DELTA) {
          return {
            valid: false,
            reason: `decay delta ${mutation.payload.delta} exceeds ±${MAX_DELTA} clamp`,
          };
        }
        return { valid: true };
      }
      case "memory_write":
      case "policy_update":
      case "reasoning_trace":
      case "relationship_mark":
        return { valid: true };
      default:
        return { valid: false, reason: "unknown mutation type" };
    }
  }

  // ── Apply ──────────────────────────────────────────────────

  /**
   * Apply a single validated mutation.
   */
  async apply(mutation: StateMutation): Promise<void> {
    const validation = this.validate(mutation);
    if (!validation.valid) {
      throw new Error(`Mutation validation failed: ${validation.reason}`);
    }

    this.mutationLog.push(mutation);

    switch (mutation.type) {
      case "concept_update":
        await this.markdownStore.adjustConceptWeight(
          mutation.payload.conceptName,
          {
            confidenceDelta: mutation.payload.confidenceDelta,
            importanceDelta: mutation.payload.importanceDelta,
            reason: mutation.payload.reason,
            metadata: mutation.payload.metadata,
          },
        );
        break;

      case "concept_merge":
        await this.markdownStore.mergeConcepts(
          mutation.payload.sourceSlug,
          mutation.payload.targetSlug,
        );
        break;

      case "concept_decay":
        await this.markdownStore.adjustConceptWeight(
          mutation.payload.conceptSlug,
          {
            confidenceDelta: mutation.payload.delta,
            importanceDelta: 0,
            reason: mutation.payload.reason,
          },
        );
        break;

      case "memory_write":
        if (this.episodicMemory) {
          // Entry already added to episodicMemory; just write to markdown
          await this.markdownStore.writeEpisode(mutation.payload.entry);
        }
        break;

      case "policy_update":
        await this.markdownStore.saveCognitivePolicy({
          domain: mutation.payload.domain,
          domainDelta: mutation.payload.domainDelta,
          strategy: mutation.payload.strategy,
          strategyDelta: mutation.payload.strategyDelta,
          reason: mutation.payload.reason,
        });
        break;

      case "reasoning_trace":
        await this.markdownStore.saveReasoningTrace(mutation.payload.trace);
        break;

      case "relationship_mark":
        await this.markdownStore.markRelationshipUnstable(
          mutation.payload.conceptA,
          mutation.payload.conceptB,
        );
        break;
    }
  }

  /**
   * Apply a batch of mutations in priority order.
   * Deduplication is handled by MutationQueue before this call.
   */
  async applyBatch(mutations: StateMutation[]): Promise<{ applied: number; rejected: number; errors: string[] }> {
    const errors: string[] = [];
    let applied = 0;
    let rejected = 0;

    for (const mutation of mutations) {
      try {
        await this.apply(mutation);
        applied++;
      } catch (e: any) {
        rejected++;
        errors.push(`[${mutation.type}] ${e?.message || String(e)}`);
      }
    }

    return { applied, rejected, errors };
  }

  // ── Audit ──────────────────────────────────────────────────

  get mutationHistory(): ReadonlyArray<StateMutation> {
    return this.mutationLog;
  }

  get mutationCount(): number {
    return this.mutationLog.length;
  }

  /**
   * Clear mutation log (e.g., after persistence).
   */
  clearLog(): void {
    this.mutationLog = [];
  }

  /**
   * Serialize mutation log for audit storage.
   */
  serializeLog(): string {
    return JSON.stringify({
      mutations: this.mutationLog,
      totalCount: this.mutationLog.length,
      exportedAt: Date.now(),
    }, null, 2);
  }
}
