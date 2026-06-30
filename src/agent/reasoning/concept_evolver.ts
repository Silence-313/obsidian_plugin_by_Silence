// ── Concept Evolver ─────────────────────────────────────────
// Lightweight concept evolution engine.
// Runs periodically (every ~10 reasoning cycles) to:
//   1. Merge highly similar concepts
//   2. Detect split candidates
//   3. Apply decay to unused concepts
//
// All operations are soft: mark/annotate, never delete.

import type { MarkdownMemoryStore, ConceptData } from "../memory/memory_store";
import type { ConceptGraph, ConceptGraphEdge } from "./concept_graph_builder";
import { ConceptGraphBuilder } from "./concept_graph_builder";

// ── Types ───────────────────────────────────────────────────

export interface MergeCandidate {
  source: ConceptData;       // concept to merge FROM
  target: ConceptData;       // concept to merge INTO
  similarity: number;        // 0..1 overlap score
  sharedEpisodes: string[];  // episodes they both appear in
  reason: string;
}

export interface SplitCandidate {
  concept: ConceptData;
  reason: string;
  conflictingRelationships: string[][]; // groups of conflicting related concepts
}

export interface DecayResult {
  conceptSlug: string;
  oldConfidence: number;
  newConfidence: number;
  reason: string;
}

export interface EvolutionResult {
  merged: MergeCandidate[];
  splitCandidates: SplitCandidate[];
  decayed: DecayResult[];
  timestamp: number;
}

// ── Thresholds ──────────────────────────────────────────────

const MERGE_SIMILARITY_THRESHOLD = 0.7;   // shared episode ratio
const MERGE_COOCCURRENCE_MIN = 2;          // min co-occurrences to consider merge
const DECAY_INTERVAL_DAYS = 7;             // days without use to trigger decay
const DECAY_RATE = 0.05;                   // confidence reduction per decay cycle
const DECAY_MIN_CONFIDENCE = 0.15;         // floor for decay
const SPLIT_MIN_CONFLICTING = 2;           // min conflicting relationship groups

// ── Evolver ─────────────────────────────────────────────────

export class ConceptEvolver {
  private markdownStore: MarkdownMemoryStore;
  private graphBuilder: ConceptGraphBuilder;

  constructor(markdownStore: MarkdownMemoryStore) {
    this.markdownStore = markdownStore;
    this.graphBuilder = new ConceptGraphBuilder();
  }

  // ── Main Evolution Cycle ──────────────────────────────────

  /**
   * Run the full evolution cycle: merge → split → decay.
   * Returns actionable candidates; caller decides whether to apply.
   */
  async evolve(
    conceptUsageCounts?: Map<string, number>,
  ): Promise<EvolutionResult> {
    const concepts = await this.markdownStore.loadConcepts();
    if (concepts.length < 2) {
      return { merged: [], splitCandidates: [], decayed: [], timestamp: Date.now() };
    }

    // Build graph for analysis
    const graph = this.graphBuilder.buildFull(concepts);

    // 1. Find merge candidates
    const merged = await this.findMergeCandidates(concepts, graph);

    // 2. Find split candidates
    const splitCandidates = this.findSplitCandidates(concepts, graph);

    // 3. Apply decay
    const decayed = await this.applyDecay(concepts, conceptUsageCounts);

    return {
      merged,
      splitCandidates,
      decayed,
      timestamp: Date.now(),
    };
  }

  /**
   * Apply merge candidates (execute the merges).
   */
  async applyMerges(candidates: MergeCandidate[]): Promise<number> {
    let applied = 0;
    for (const c of candidates) {
      try {
        await this.markdownStore.mergeConcepts(c.source.slug, c.target.slug);
        applied++;
      } catch {
        // skip failed merges
      }
    }
    return applied;
  }

  /**
   * Apply split marks (soft annotation only).
   */
  async applySplitMarks(candidates: SplitCandidate[]): Promise<number> {
    let applied = 0;
    for (const c of candidates) {
      try {
        await this.markdownStore.adjustConceptWeight(c.concept.name, {
          confidenceDelta: 0,
          importanceDelta: 0,
          reason: `split-candidate: ${c.reason}`,
          metadata: { splitCandidate: true, splitReason: c.reason },
        });
        applied++;
      } catch {
        // skip
      }
    }
    return applied;
  }

  // ── Merge Detection ───────────────────────────────────────

  private async findMergeCandidates(
    concepts: ConceptData[],
    graph: ConceptGraph,
  ): Promise<MergeCandidate[]> {
    const candidates: MergeCandidate[] = [];
    const checked = new Set<string>();

    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const a = concepts[i];
        const b = concepts[j];
        const pairKey = [a.slug, b.slug].sort().join("||");
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        // Compute shared episodes ratio
        const sharedEpisodes = a.sourceEpisodes.filter(ep =>
          b.sourceEpisodes.includes(ep)
        );

        const totalUnique = new Set([...a.sourceEpisodes, ...b.sourceEpisodes]).size;
        const overlapRatio = totalUnique > 0 ? sharedEpisodes.length / totalUnique : 0;

        // Check tag overlap
        const sharedTags = a.tags.filter(t => b.tags.includes(t));

        // Check edge weight in graph
        const edge = graph.edges.find(e =>
          (e.from === a.slug && e.to === b.slug) ||
          (e.from === b.slug && e.to === a.slug)
        );
        const edgeWeight = edge?.weight ?? 0;

        // Merge conditions:
        // 1. High shared episode ratio OR
        // 2. Strong graph edge with shared episodes
        if (overlapRatio >= MERGE_SIMILARITY_THRESHOLD ||
          (sharedEpisodes.length >= MERGE_COOCCURRENCE_MIN && edgeWeight >= 0.5)) {

          // Pick the one with more episodes as target
          const [source, target] = a.sourceEpisodes.length >= b.sourceEpisodes.length
            ? [b, a] : [a, b];

          const similarity = Math.max(overlapRatio, edgeWeight);

          candidates.push({
            source,
            target,
            similarity: Math.round(similarity * 100) / 100,
            sharedEpisodes,
            reason: sharedEpisodes.length >= MERGE_COOCCURRENCE_MIN
              ? `共享 ${sharedEpisodes.length} 个 episode (重叠率 ${Math.round(overlapRatio * 100)}%)`
              : `概念图边权重 ${Math.round(edgeWeight * 100)}%`,
          });
        }
      }
    }

    return candidates;
  }

  // ── Split Detection ───────────────────────────────────────

  private findSplitCandidates(
    concepts: ConceptData[],
    graph: ConceptGraph,
  ): SplitCandidate[] {
    const candidates: SplitCandidate[] = [];

    for (const concept of concepts) {
      // Get all edges for this concept
      const conceptEdges = graph.edges.filter(e =>
        e.from === concept.slug || e.to === concept.slug
      );

      if (conceptEdges.length < 3) continue;

      // Group edges by type
      const byType = new Map<string, string[]>();
      for (const edge of conceptEdges) {
        const neighbor = edge.from === concept.slug ? edge.to : edge.from;
        if (!byType.has(edge.type)) byType.set(edge.type, []);
        byType.get(edge.type)!.push(neighbor);
      }

      // Split signal: connected to many concepts of different types
      // but has low tag cohesion
      const hasMultipleTypes = byType.size >= 2;
      const totalRelations = concept.related.length + conceptEdges.length;

      if (hasMultipleTypes && totalRelations >= 4 && concept.tags.length <= 2) {
        const conflictingGroups = Array.from(byType.entries()).map(([type, neighbors]) => {
          const names = neighbors.map(slug => {
            const c = concepts.find(c2 => c2.slug === slug);
            return c?.name ?? slug;
          });
          return names;
        });

        if (conflictingGroups.length >= SPLIT_MIN_CONFLICTING) {
          candidates.push({
            concept,
            reason: `连接 ${conceptEdges.length} 个概念但标签较少 (${concept.tags.join(", ")})，可能涵盖多个独立主题`,
            conflictingRelationships: conflictingGroups,
          });
        }
      }
    }

    return candidates;
  }

  // ── Decay ─────────────────────────────────────────────────

  private async applyDecay(
    concepts: ConceptData[],
    usageCounts?: Map<string, number>,
  ): Promise<DecayResult[]> {
    const results: DecayResult[] = [];
    const now = Date.now();

    for (const concept of concepts) {
      // Skip concepts with high confidence (≥0.8) — they're stable
      if (concept.confidence >= 0.8) continue;

      // Check usage: if used recently, skip decay
      const usageCount = usageCounts?.get(concept.name) ?? 0;
      if (usageCount > 0) continue;

      // Check time since last update
      const daysSinceUpdate = (now - concept.updated) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < DECAY_INTERVAL_DAYS) continue;

      const oldConfidence = concept.confidence;
      const newConfidence = Math.max(
        DECAY_MIN_CONFIDENCE,
        Math.round((oldConfidence - DECAY_RATE) * 100) / 100,
      );

      if (newConfidence < oldConfidence) {
        await this.markdownStore.adjustConceptWeight(concept.name, {
          confidenceDelta: newConfidence - oldConfidence,
          importanceDelta: 0,
          reason: `decay: unused for ${Math.round(daysSinceUpdate)} days`,
        });

        results.push({
          conceptSlug: concept.slug,
          oldConfidence,
          newConfidence,
          reason: `${Math.round(daysSinceUpdate)} 天未使用`,
        });
      }
    }

    return results;
  }

  // ── Getters ───────────────────────────────────────────────

  /**
   * Get concept usage aging stats (for diagnostics).
   */
  async getAgingStats(): Promise<Array<{ name: string; daysSinceUpdate: number; confidence: number }>> {
    const concepts = await this.markdownStore.loadConcepts();
    const now = Date.now();
    return concepts
      .map(c => ({
        name: c.name,
        daysSinceUpdate: Math.round((now - c.updated) / (1000 * 60 * 60 * 24)),
        confidence: c.confidence,
      }))
      .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
  }
}
