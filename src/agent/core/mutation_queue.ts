// ── Mutation Queue ───────────────────────────────────────────
// Buffers, deduplicates, and sorts mutations within a single
// interaction cycle. Flushes batch to StateMutationEngine.
//
// Conflict resolution:
//   1. Deduplicate: identical concept_updates merge into one
//   2. Sort: by priority (policy_update → concept_merge → ...)
//   3. Batch apply: all validated mutations executed atomically

import {
  type StateMutation,
  type StateMutationEngine,
  MUTATION_PRIORITY,
} from "./state_mutation_engine";

// ── Queue ────────────────────────────────────────────────────

export class MutationQueue {
  private queue: StateMutation[] = [];
  private cycleId: string;
  private enabled = true;

  constructor() {
    this.cycleId = `cycle-${Date.now()}`;
  }

  get size(): number {
    return this.queue.length;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  // ── Add ────────────────────────────────────────────────────

  add(mutation: StateMutation): void {
    if (!this.enabled) return;
    this.queue.push(mutation);
  }

  addBatch(mutations: StateMutation[]): void {
    if (!this.enabled) return;
    for (const m of mutations) {
      this.queue.push(m);
    }
  }

  // ── Resolution ─────────────────────────────────────────────

  /**
   * Resolve the queue: deduplicate, sort by priority.
   * Returns the resolved batch ready for engine application.
   */
  resolve(): StateMutation[] {
    // 1. Deduplicate: merge identical concept_updates for the same concept
    const deduped = this.deduplicate(this.queue);

    // 2. Sort by priority
    deduped.sort((a, b) => {
      const pa = MUTATION_PRIORITY[a.type] ?? 99;
      const pb = MUTATION_PRIORITY[b.type] ?? 99;
      return pa - pb;
    });

    return deduped;
  }

  /**
   * Flush: resolve + apply all mutations via the engine.
   * Clears the queue after successful application.
   */
  async flush(
    engine: StateMutationEngine,
  ): Promise<{ applied: number; rejected: number; errors: string[]; cycleId: string }> {
    if (!this.enabled || this.queue.length === 0) {
      return { applied: 0, rejected: 0, errors: [], cycleId: this.cycleId };
    }

    const resolved = this.resolve();
    const result = await engine.applyBatch(resolved);

    // Clear queue after application
    this.queue = [];

    return { ...result, cycleId: this.cycleId };
  }

  /**
   * Start a new cycle (generates new cycle ID).
   */
  newCycle(): void {
    this.queue = [];
    this.cycleId = `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * Temporarily disable the queue (e.g., during maintenance).
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // ── Private: Deduplication ─────────────────────────────────

  private deduplicate(mutations: StateMutation[]): StateMutation[] {
    const result: StateMutation[] = [];
    const conceptUpdates = new Map<string, StateMutation & { type: "concept_update" }>();

    for (const m of mutations) {
      if (m.type === "concept_update") {
        const key = m.payload.conceptName;
        const existing = conceptUpdates.get(key);

        if (existing) {
          // Merge: accumulate deltas, keep the later reason
          const clampedCDelta = this.clampDelta(
            existing.payload.confidenceDelta + m.payload.confidenceDelta,
          );
          const clampedIDelta = this.clampDelta(
            existing.payload.importanceDelta + m.payload.importanceDelta,
          );

          conceptUpdates.set(key, {
            ...existing,
            payload: {
              ...existing.payload,
              confidenceDelta: clampedCDelta,
              importanceDelta: clampedIDelta,
              reason: `${existing.payload.reason}; ${m.payload.reason}`,
              metadata: { ...(existing.payload.metadata || {}), ...(m.payload.metadata || {}) },
            },
          });
        } else {
          conceptUpdates.set(key, m as StateMutation & { type: "concept_update" });
        }
      } else if (m.type === "policy_update") {
        // Deduplicate policy_updates: merge domain/strategy changes
        const existingIdx = result.findIndex(
          r => r.type === "policy_update" && r.payload.reason === m.payload.reason,
        );
        if (existingIdx >= 0) {
          const existing = result[existingIdx] as StateMutation & { type: "policy_update" };
          result[existingIdx] = {
            ...existing,
            payload: {
              ...existing.payload,
              domainDelta: this.clampDelta(
                (existing.payload.domainDelta ?? 0) + (m.payload.domainDelta ?? 0),
              ),
              strategyDelta: this.clampDelta(
                (existing.payload.strategyDelta ?? 0) + (m.payload.strategyDelta ?? 0),
              ),
            },
          };
        } else {
          result.push(m);
        }
      } else {
        result.push(m);
      }
    }

    // Add deduplicated concept updates
    for (const m of conceptUpdates.values()) {
      result.push(m);
    }

    return result;
  }

  private clampDelta(value: number): number {
    return Math.round(Math.max(-0.05, Math.min(0.05, value)) * 10000) / 10000;
  }

  // ── Audit ──────────────────────────────────────────────────

  /**
   * Serialize the current queue state for audit trail.
   */
  snapshot(): { cycleId: string; queueSize: number; mutations: StateMutation[] } {
    return {
      cycleId: this.cycleId,
      queueSize: this.queue.length,
      mutations: [...this.queue],
    };
  }
}
