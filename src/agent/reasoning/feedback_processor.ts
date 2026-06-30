// ── Feedback Processor ──────────────────────────────────────
// Self-improving cognitive feedback loop.
// After each reasoning cycle:
//   1. Store reasoning trace as markdown
//   2. Reinforce concept weights based on reasoning quality
//   3. Track insight frequency for cumulative learning
//   4. Detect unstable relationships
//
// All updates are lightweight (±0.05 clamp) and best-effort.

import type { MarkdownMemoryStore, ConceptData } from "../memory/memory_store";
import type { ReasoningResult } from "./concept_reasoner";
import { DriftController, DEFAULT_POLICY, type CognitivePolicy } from "../policy/drift_controller";
import type { MutationQueue } from "../core/mutation_queue";

// ── Types ───────────────────────────────────────────────────

export interface ReasoningTrace {
  id: string;
  timestamp: number;
  query: string;
  keyConcepts: string[];       // concept slugs used
  conceptNames: string[];       // human-readable names
  insights: string[];
  contradictions: string[];
  bridgingConcepts: string[];
  confidence: number;
}

export interface FeedbackStats {
  tracesStored: number;
  conceptsReinforced: number;
  insightsReinforced: number;
  contradictionsDetected: number;
  lastProcessed: number;
}

// ── Processor ───────────────────────────────────────────────

export class FeedbackProcessor {
  private markdownStore: MarkdownMemoryStore;
  private driftController: DriftController;
  private mutationQueue: MutationQueue | null;
  private policyDirty = false;
  private processCount = 0;
  // Track insight frequency across reasoning cycles
  private insightFrequency: Map<string, { count: number; conceptSlugs: string[] }> = new Map();
  // Track concept usage in reasoning
  private conceptUsageCount: Map<string, number> = new Map();
  // Track contradiction patterns
  private contradictionPatterns: Map<string, number> = new Map();
  // Track strategy outcomes for policy learning
  private strategyOutcomes: Map<string, { successes: number; failures: number }> = new Map();
  // Stats
  private stats: FeedbackStats = {
    tracesStored: 0,
    conceptsReinforced: 0,
    insightsReinforced: 0,
    contradictionsDetected: 0,
    lastProcessed: 0,
  };

  constructor(
    markdownStore: MarkdownMemoryStore,
    driftController?: DriftController,
    mutationQueue?: MutationQueue,
  ) {
    this.markdownStore = markdownStore;
    this.driftController = driftController ?? new DriftController();
    this.mutationQueue = mutationQueue ?? null;
  }

  get controller(): DriftController {
    return this.driftController;
  }

  // ── Main Processing ───────────────────────────────────────

  /**
   * Process a reasoning result after each reasoning cycle.
   * Stores trace, reinforces concepts, tracks patterns.
   */
  async process(
    reasoning: ReasoningResult,
    query: string,
  ): Promise<FeedbackStats> {
    if (reasoning.keyConcepts.length === 0 && reasoning.inferredInsights.length === 0) {
      return this.stats;
    }

    try {
      // 1. Store reasoning trace
      await this.storeTrace(reasoning, query);

      // 2. Reinforce concept weights
      await this.reinforceConcepts(reasoning);

      // 3. Track insight frequency
      this.trackInsights(reasoning);

      // 4. Track contradictions
      this.trackContradictions(reasoning);

      // 5. Update concept usage counts
      this.updateUsageCounts(reasoning);

      // 6. Apply insight-based reinforcement
      await this.applyInsightReinforcement();

      // 7. Policy learning: update cognitive policy from outcomes
      this.learnPolicyFromOutcome(reasoning);

      // 8. Persist policy periodically (every 5 processes)
      this.processCount++;
      if (this.processCount % 5 === 0 && this.policyDirty) {
        await this.persistPolicy();
        this.policyDirty = false;
      }

      this.stats.lastProcessed = Date.now();
    } catch {
      // Feedback processing is best-effort
    }

    return this.stats;
  }

  // ── Trace Storage ─────────────────────────────────────────

  private async storeTrace(
    reasoning: ReasoningResult,
    query: string,
  ): Promise<void> {
    const trace: ReasoningTrace = {
      id: `reasoning-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      query: query.substring(0, 200),
      keyConcepts: reasoning.keyConcepts,
      conceptNames: reasoning.keyConcepts, // keyConcepts are already names
      insights: reasoning.inferredInsights,
      contradictions: reasoning.contradictions,
      bridgingConcepts: reasoning.bridgingConcepts,
      confidence: reasoning.confidence,
    };

    if (this.mutationQueue) {
      this.mutationQueue.add({ type: "reasoning_trace", payload: { trace } });
    } else {
      await this.markdownStore.saveReasoningTrace(trace);
    }
    this.stats.tracesStored++;
  }

  // ── Concept Reinforcement ─────────────────────────────────

  /**
   * Reinforce concept weights based on reasoning quality.
   * Concepts used in high-confidence reasoning get a boost.
   */
  private async reinforceConcepts(reasoning: ReasoningResult): Promise<void> {
    // Key concepts used in reasoning → boost confidence
    for (const conceptName of reasoning.keyConcepts) {
      if (this.mutationQueue) {
        this.mutationQueue.add({
          type: "concept_update",
          payload: { conceptName, confidenceDelta: 0.02, importanceDelta: 0.01, reason: "used-in-reasoning" },
        });
      } else {
        await this.markdownStore.adjustConceptWeight(conceptName, {
          confidenceDelta: 0.02, importanceDelta: 0.01, reason: "used-in-reasoning",
        });
      }
      this.stats.conceptsReinforced++;
    }

    // Bridging concepts → boost (they connect knowledge domains)
    for (const bridgeName of reasoning.bridgingConcepts) {
      if (this.mutationQueue) {
        this.mutationQueue.add({
          type: "concept_update",
          payload: { conceptName: bridgeName, confidenceDelta: 0.03, importanceDelta: 0.02, reason: "bridging-concept" },
        });
      } else {
        await this.markdownStore.adjustConceptWeight(bridgeName, {
          confidenceDelta: 0.03, importanceDelta: 0.02, reason: "bridging-concept",
        });
      }
      this.stats.conceptsReinforced++;
    }

    // High-confidence reasoning → extra boost to all involved concepts
    if (reasoning.confidence >= 0.6) {
      const allUsed = [...reasoning.keyConcepts, ...reasoning.bridgingConcepts];
      for (const name of allUsed) {
        if (this.mutationQueue) {
          this.mutationQueue.add({
            type: "concept_update",
            payload: { conceptName: name, confidenceDelta: 0.01, importanceDelta: 0.0, reason: "high-confidence-reasoning" },
          });
        } else {
          await this.markdownStore.adjustConceptWeight(name, {
            confidenceDelta: 0.01, importanceDelta: 0.0, reason: "high-confidence-reasoning",
          });
        }
      }
    }
  }

  // ── Insight Tracking ──────────────────────────────────────

  private trackInsights(reasoning: ReasoningResult): void {
    for (const insight of reasoning.inferredInsights) {
      // Normalize insight for dedup (first 80 chars as key)
      const key = insight.substring(0, 80).trim();
      const existing = this.insightFrequency.get(key);
      if (existing) {
        existing.count++;
        // Add any new concept names
        for (const c of reasoning.keyConcepts) {
          if (!existing.conceptSlugs.includes(c)) {
            existing.conceptSlugs.push(c);
          }
        }
      } else {
        this.insightFrequency.set(key, {
          count: 1,
          conceptSlugs: [...reasoning.keyConcepts],
        });
      }
    }
  }

  /**
   * If an insight appears ≥2 times, boost related concepts.
   */
  private async applyInsightReinforcement(): Promise<void> {
    for (const [insightKey, data] of this.insightFrequency) {
      if (data.count >= 2) {
        for (const conceptName of data.conceptSlugs) {
          if (this.mutationQueue) {
            this.mutationQueue.add({
              type: "concept_update",
              payload: { conceptName, confidenceDelta: 0.03, importanceDelta: 0.02, reason: `insight-reinforced-x${data.count}` },
            });
          } else {
            await this.markdownStore.adjustConceptWeight(conceptName, {
              confidenceDelta: 0.03, importanceDelta: 0.02, reason: `insight-reinforced-x${data.count}`,
            });
          }
          this.stats.insightsReinforced++;
        }
      }
    }
  }

  // ── Contradiction Tracking ────────────────────────────────

  private trackContradictions(reasoning: ReasoningResult): void {
    for (const contradiction of reasoning.contradictions) {
      const key = contradiction.substring(0, 80).trim();
      const count = (this.contradictionPatterns.get(key) || 0) + 1;
      this.contradictionPatterns.set(key, count);
      this.stats.contradictionsDetected++;

      // If contradiction repeats ≥3 times, mark relationships as unstable
      if (count >= 3) {
        const nameMatches = contradiction.match(/"([^"]+)"/g);
        if (nameMatches && nameMatches.length >= 2) {
          const a = nameMatches[0].replace(/"/g, "");
          const b = nameMatches[1].replace(/"/g, "");
          if (this.mutationQueue) {
            this.mutationQueue.add({
              type: "relationship_mark",
              payload: { conceptA: a, conceptB: b, stable: false, reason: `contradiction-x${count}` },
            });
          } else {
            this.markdownStore.markRelationshipUnstable(a, b).catch(() => {});
          }
        }
      }
    }
  }

  // ── Usage Tracking ────────────────────────────────────────

  private updateUsageCounts(reasoning: ReasoningResult): void {
    for (const name of reasoning.keyConcepts) {
      this.conceptUsageCount.set(
        name,
        (this.conceptUsageCount.get(name) || 0) + 1,
      );
    }

    for (const name of reasoning.bridgingConcepts) {
      this.conceptUsageCount.set(
        name,
        (this.conceptUsageCount.get(name) || 0) + 1,
      );
    }
  }

  // ── Policy Learning ───────────────────────────────────────

  /**
   * Learn from reasoning outcomes and update the cognitive policy.
   * Reinforces successful concept domains, adapts strategy weights,
   * and suppresses low-value concept clusters.
   */
  private learnPolicyFromOutcome(reasoning: ReasoningResult): void {
    // 1. Reinforce concept domains used in successful reasoning
    if (reasoning.confidence >= 0.5) {
      // Extract domain tags from key concepts
      const domains = this.extractDomains(reasoning);
      for (const domain of domains) {
        this.driftController.reinforceDomain(domain, 0.02);
      }
      this.policyDirty = true;

      // Track strategy success
      this.recordStrategyOutcome("graphTraversal", true);
      this.recordStrategyOutcome("patternMatching", true);
      this.recordStrategyOutcome("abstraction", true);
    }

    // If contradictions found, the reasoning strategies may need adjustment
    if (reasoning.contradictions.length > 0) {
      this.recordStrategyOutcome("abstraction", false);
    }

    // 2. Adapt strategy weights based on accumulated outcomes
    this.adaptStrategyWeights();

    // 3. Adapt exploration rate based on concept count
    this.driftController.adaptExplorationRate(this.conceptUsageCount.size);

    // 4. Enforce balance to prevent extreme drift
    this.driftController.enforceBalance();
  }

  private extractDomains(reasoning: ReasoningResult): string[] {
    const domains = new Set<string>();
    // Heuristic: look for domain-indicating tags in concept clusters
    const keywords: Record<string, string[]> = {
      engineering: ["系统", "工程", "架构", "工具", "代码", "开发", "实现", "部署"],
      theory: ["理论", "概念", "原理", "抽象", "模式", "模型", "框架"],
      design: ["设计", "UI", "界面", "交互", "体验", "布局", "组件"],
      data: ["数据", "存储", "索引", "检索", "查询", "分析", "统计"],
      agent: ["agent", "记忆", "推理", "学习", "反馈", "演化", "策略"],
      knowledge: ["知识", "笔记", "wiki", "文档", "概念", "关系"],
    };

    const allText = [
      ...reasoning.keyConcepts,
      ...reasoning.relationships,
      ...reasoning.inferredInsights,
    ].join(" ").toLowerCase();

    for (const [domain, domainKeywords] of Object.entries(keywords)) {
      for (const kw of domainKeywords) {
        if (allText.includes(kw)) {
          domains.add(domain);
          break;
        }
      }
    }

    return Array.from(domains);
  }

  private recordStrategyOutcome(strategy: string, success: boolean): void {
    if (!this.strategyOutcomes.has(strategy)) {
      this.strategyOutcomes.set(strategy, { successes: 0, failures: 0 });
    }
    const so = this.strategyOutcomes.get(strategy)!;
    if (success) so.successes++;
    else so.failures++;
  }

  private adaptStrategyWeights(): void {
    for (const [strategy, outcomes] of this.strategyOutcomes) {
      const total = outcomes.successes + outcomes.failures;
      if (total < 3) continue; // need at least 3 outcomes

      const successRate = outcomes.successes / total;
      const mappedStrategy = strategy as "graphTraversal" | "patternMatching" | "abstraction";

      if (successRate > 0.8) {
        this.driftController.adjustStrategyWeight(mappedStrategy, 0.02);
      } else if (successRate < 0.4) {
        this.driftController.adjustStrategyWeight(mappedStrategy, -0.03);
      }
      // Reset after adjustment to avoid over-accumulation
      this.strategyOutcomes.set(strategy, { successes: 0, failures: 0 });
    }
  }

  /**
   * Save the current cognitive policy to the markdown store.
   */
  async persistPolicy(): Promise<void> {
    try {
      this.driftController.markUpdated();
      await this.markdownStore.saveCognitivePolicy(
        this.driftController.currentPolicy as unknown as Record<string, unknown>,
      );
    } catch {
      // Policy persistence is best-effort
    }
  }

  /**
   * Load cognitive policy from store into the drift controller.
   */
  async loadPolicy(): Promise<void> {
    try {
      const json = await this.markdownStore.loadCognitivePolicy();
      if (json) {
        this.driftController.loadPolicy(json as unknown as CognitivePolicy);
      }
    } catch {
      // Use defaults if load fails
    }
  }

  // ── Getters ───────────────────────────────────────────────

  getStats(): Readonly<FeedbackStats> {
    return { ...this.stats };
  }

  getTopInsights(limit: number = 10): Array<{ insight: string; count: number }> {
    return Array.from(this.insightFrequency.entries())
      .filter(([_, d]) => d.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([key, data]) => ({ insight: key, count: data.count }));
  }

  getUsageStats(): Map<string, number> {
    return new Map(this.conceptUsageCount);
  }

  getContradictionStats(): Array<{ pattern: string; count: number }> {
    return Array.from(this.contradictionPatterns.entries())
      .filter(([_, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, count]) => ({ pattern, count }));
  }

  /**
   * Reset in-memory frequency counters (not persisted traces).
   * Useful when stats grow too large.
   */
  resetCounters(): void {
    this.insightFrequency = new Map();
    this.conceptUsageCount = new Map();
    this.contradictionPatterns = new Map();
  }
}
