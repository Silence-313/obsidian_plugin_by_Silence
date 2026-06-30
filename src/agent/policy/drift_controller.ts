// ── Drift Controller ────────────────────────────────────────
// Global cognitive stability enforcement.
// Prevents concept explosion, maintains preference balance,
// enforces soft constraints, and detects compression signals.
//
// This is the "governor" that keeps the cognitive system
// from drifting into noise or instability over time.

// ── Types ───────────────────────────────────────────────────

export interface CognitivePolicy {
  conceptPreferences: Record<string, number>; // domain tag → weight 0..1
  reasoningStrategyWeights: {
    graphTraversal: number;
    patternMatching: number;
    abstraction: number;
  };
  conceptStabilityPreference: number;  // bias toward stable vs novel concepts
  explorationRate: number;             // how much to explore new concepts
  compressionThreshold: number;        // when to trigger compression
  lastUpdated: number;
  version: number;
}

export interface CompressionSignal {
  type: "low-confidence" | "redundant-cluster" | "unstable-pattern" | "high-entropy";
  severity: number;       // 0..1, higher = more urgent
  affectedConcepts: string[];
  suggestion: string;
  timestamp: number;
}

export interface DriftMetrics {
  conceptCount: number;
  avgConfidence: number;
  preferenceEntropy: number;      // distribution evenness
  unstableRelationshipCount: number;
  compressionSignals: CompressionSignal[];
  overallHealth: number;           // 0..1, composite score
  lastChecked: number;
}

// ── Policy Defaults ─────────────────────────────────────────

export const DEFAULT_POLICY: CognitivePolicy = {
  conceptPreferences: {},
  reasoningStrategyWeights: {
    graphTraversal: 0.7,
    patternMatching: 0.6,
    abstraction: 0.9,
  },
  conceptStabilityPreference: 0.75,
  explorationRate: 0.2,
  compressionThreshold: 0.65,
  lastUpdated: 0,
  version: 1,
};

// ── Controller ──────────────────────────────────────────────

export class DriftController {
  private policy: CognitivePolicy;

  constructor(policy?: CognitivePolicy) {
    this.policy = policy ? this.normalizePolicy(policy) : { ...DEFAULT_POLICY };
  }

  get currentPolicy(): Readonly<CognitivePolicy> {
    return this.policy;
  }

  // ── Policy Management ─────────────────────────────────────

  /**
   * Load a new policy, normalizing all values.
   */
  loadPolicy(policy: CognitivePolicy): void {
    this.policy = this.normalizePolicy(policy);
  }

  /**
   * Get the effective concept preference for a given domain tag.
   * Falls back to a neutral value if domain is not in preferences.
   */
  getConceptPreference(domainTag: string): number {
    return this.policy.conceptPreferences[domainTag] ?? 0.5;
  }

  /**
   * Get effective reasoning strategy weight.
   */
  getStrategyWeight(strategy: "graphTraversal" | "patternMatching" | "abstraction"): number {
    return this.policy.reasoningStrategyWeights[strategy];
  }

  // ── Policy Learning Operations ────────────────────────────

  /**
   * Reinforce a concept domain preference.
   * Called when reasoning in this domain yields high-confidence results.
   */
  reinforceDomain(domainTag: string, amount: number = 0.03): void {
    const current = this.policy.conceptPreferences[domainTag] ?? 0.5;
    const clamped = Math.max(0.1, Math.min(1.0, current + amount));
    this.policy.conceptPreferences[domainTag] = Math.round(clamped * 10000) / 10000;
  }

  /**
   * Suppress a concept domain preference.
   * Called when domain rarely contributes to useful reasoning.
   */
  suppressDomain(domainTag: string, amount: number = 0.02): void {
    const current = this.policy.conceptPreferences[domainTag] ?? 0.5;
    const clamped = Math.max(0.1, Math.min(1.0, current - amount));
    this.policy.conceptPreferences[domainTag] = Math.round(clamped * 10000) / 10000;
  }

  /**
   * Adjust a reasoning strategy weight based on outcomes.
   */
  adjustStrategyWeight(
    strategy: "graphTraversal" | "patternMatching" | "abstraction",
    delta: number,
  ): void {
    const current = this.policy.reasoningStrategyWeights[strategy];
    const clamped = Math.max(0.1, Math.min(1.0, current + delta));
    this.policy.reasoningStrategyWeights[strategy] = Math.round(clamped * 10000) / 10000;
  }

  /**
   * Update exploration rate based on system maturity.
   * More concepts → reduce exploration (exploit known knowledge).
   * Fewer concepts → increase exploration.
   */
  adaptExplorationRate(conceptCount: number): void {
    if (conceptCount > 20) {
      this.policy.explorationRate = Math.round(Math.max(0.05, 0.3 - conceptCount * 0.01) * 100) / 100;
    } else if (conceptCount < 5) {
      this.policy.explorationRate = 0.4;
    } else {
      this.policy.explorationRate = 0.2;
    }
  }

  // ── Stability Enforcement ─────────────────────────────────

  /**
   * Normalize all policy values to safe ranges.
   */
  private normalizePolicy(policy: CognitivePolicy): CognitivePolicy {
    const normalized: CognitivePolicy = {
      conceptPreferences: {},
      reasoningStrategyWeights: {
        graphTraversal: this.clamp(policy.reasoningStrategyWeights?.graphTraversal ?? 0.7, 0.1, 1.0),
        patternMatching: this.clamp(policy.reasoningStrategyWeights?.patternMatching ?? 0.6, 0.1, 1.0),
        abstraction: this.clamp(policy.reasoningStrategyWeights?.abstraction ?? 0.9, 0.1, 1.0),
      },
      conceptStabilityPreference: this.clamp(policy.conceptStabilityPreference ?? 0.75, 0.3, 0.95),
      explorationRate: this.clamp(policy.explorationRate ?? 0.2, 0.05, 0.5),
      compressionThreshold: this.clamp(policy.compressionThreshold ?? 0.65, 0.4, 0.9),
      lastUpdated: policy.lastUpdated ?? Date.now(),
      version: (policy.version ?? 1) + 1,
    };

    // Normalize concept preferences
    for (const [key, value] of Object.entries(policy.conceptPreferences ?? {})) {
      normalized.conceptPreferences[key] = this.clamp(value, 0.1, 1.0);
    }

    return normalized;
  }

  /**
   * Enforce balanced preference distribution.
   * If one domain dominates too heavily, slightly dampen it.
   */
  enforceBalance(): void {
    const values = Object.values(this.policy.conceptPreferences);
    if (values.length < 2) return;

    const max = Math.max(...values);
    const min = Math.min(...values);
    const spread = max - min;

    // If spread is too large (>0.6), dampen the extreme
    if (spread > 0.6) {
      for (const key of Object.keys(this.policy.conceptPreferences)) {
        const val = this.policy.conceptPreferences[key];
        if (val === max) {
          this.policy.conceptPreferences[key] = Math.round((val - 0.05) * 10000) / 10000;
        }
        if (val === min) {
          this.policy.conceptPreferences[key] = Math.round((val + 0.03) * 10000) / 10000;
        }
      }
    }
  }

  // ── Compression Signal Detection ──────────────────────────

  /**
   * Detect compression signals based on current system state.
   * Returns actionable signals for concept compression.
   */
  detectCompressionSignals(
    concepts: Array<{ slug: string; name: string; confidence: number; tags: string[]; sourceEpisodes: string[] }>,
    conceptCount: number,
    unstableRelationshipCount: number = 0,
  ): CompressionSignal[] {
    const signals: CompressionSignal[] = [];

    if (concepts.length === 0) return signals;

    const avgConfidence = concepts.reduce((s, c) => s + c.confidence, 0) / concepts.length;

    // 1. Low-confidence concept accumulation
    const lowConfConcepts = concepts.filter(c => c.confidence < 0.3);
    const lowConfRatio = lowConfConcepts.length / Math.max(1, concepts.length);

    if (lowConfRatio > this.policy.compressionThreshold) {
      signals.push({
        type: "low-confidence",
        severity: Math.round(Math.min(1, lowConfRatio) * 100) / 100,
        affectedConcepts: lowConfConcepts.map(c => c.slug),
        suggestion: `${lowConfConcepts.length}/${concepts.length} concepts have low confidence (<0.3). Consider merging or marking for review.`,
        timestamp: Date.now(),
      });
    }

    // 2. Redundant concept clusters (same tags, overlapping episodes)
    const tagGroups = new Map<string, Array<typeof concepts[0]>>();
    for (const c of concepts) {
      for (const tag of c.tags) {
        if (tag === "concept") continue;
        if (!tagGroups.has(tag)) tagGroups.set(tag, []);
        tagGroups.get(tag)!.push(c);
      }
    }

    for (const [tag, group] of tagGroups) {
      if (group.length >= 4) {
        // Check if these concepts share many episodes
        const allEpisodes = new Set<string>();
        for (const c of group) {
          for (const ep of c.sourceEpisodes) allEpisodes.add(ep);
        }
        const redundancyRatio = allEpisodes.size / Math.max(1, group.length * 2);
        if (redundancyRatio < 0.5) {
          signals.push({
            type: "redundant-cluster",
            severity: Math.round((1 - redundancyRatio) * 100) / 100,
            affectedConcepts: group.map(c => c.slug),
            suggestion: `"${tag}" cluster has ${group.length} concepts sharing ${allEpisodes.size} unique episodes. Consider merging.`,
            timestamp: Date.now(),
          });
        }
      }
    }

    // 3. High entropy: too many concepts relative to episode diversity
    if (conceptCount > 15 && avgConfidence < 0.5) {
      signals.push({
        type: "high-entropy",
        severity: Math.round(Math.min(1, (conceptCount - 15) / 20) * 100) / 100,
        affectedConcepts: [],
        suggestion: `${conceptCount} concepts with avg confidence ${Math.round(avgConfidence * 100)}%. Consider running concept merge cycle.`,
        timestamp: Date.now(),
      });
    }

    // 4. Unstable relationship patterns
    if (unstableRelationshipCount >= 3) {
      signals.push({
        type: "unstable-pattern",
        severity: Math.round(Math.min(1, unstableRelationshipCount / 10) * 100) / 100,
        affectedConcepts: [],
        suggestion: `${unstableRelationshipCount} unstable concept relationships detected. Review and reconcile.`,
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  /**
   * Compute overall cognitive health metrics.
   */
  computeHealth(
    concepts: Array<{ confidence: number }>,
    conceptCount: number,
    unstableRelationshipCount: number,
  ): DriftMetrics {
    const avgConfidence = concepts.length > 0
      ? concepts.reduce((s, c) => s + c.confidence, 0) / concepts.length
      : 0.5;

    // Preference entropy: how evenly are preferences distributed
    const prefValues = Object.values(this.policy.conceptPreferences);
    let preferenceEntropy = 0;
    if (prefValues.length > 0) {
      const total = prefValues.reduce((s, v) => s + v, 0);
      for (const v of prefValues) {
        const p = v / total;
        if (p > 0) preferenceEntropy -= p * Math.log2(p);
      }
      const maxEntropy = Math.log2(Math.max(1, prefValues.length));
      preferenceEntropy = maxEntropy > 0 ? preferenceEntropy / maxEntropy : 0.5;
    }

    const signals = this.detectCompressionSignals(
      [], // pass empty for health check only
      conceptCount,
      unstableRelationshipCount,
    );

    // Composite health score
    const confidenceHealth = Math.min(1, avgConfidence * 1.5);
    const stabilityHealth = Math.max(0, 1 - unstableRelationshipCount * 0.1);
    const signalPenalty = Math.max(0, 1 - signals.length * 0.15);
    const overallHealth = Math.round(
      (confidenceHealth * 0.3 + stabilityHealth * 0.4 + signalPenalty * 0.3) * 100
    ) / 100;

    return {
      conceptCount,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      preferenceEntropy: Math.round(preferenceEntropy * 100) / 100,
      unstableRelationshipCount,
      compressionSignals: signals,
      overallHealth,
      lastChecked: Date.now(),
    };
  }

  // ── Utility ───────────────────────────────────────────────

  serialize(): string {
    return JSON.stringify(this.policy, null, 2);
  }

  markUpdated(): void {
    this.policy.lastUpdated = Date.now();
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
