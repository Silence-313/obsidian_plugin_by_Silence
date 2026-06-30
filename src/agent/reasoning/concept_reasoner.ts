// ── Concept Reasoner ────────────────────────────────────────
// Lightweight reasoning engine operating over the concept graph.
// Three strategies, composable and independent:
//   1. Graph Traversal  — follow edges, identify central/bridging nodes
//   2. Pattern Matching  — detect repeated co-occurrence patterns
//   3. Abstraction       — surface higher-level themes from clusters
//
// No LLM dependency. No heavy computation. Pure graph logic.

import type {
  ConceptGraph, ConceptGraphNode, ConceptGraphEdge, ConceptSubgraph,
} from "./concept_graph_builder";

// ── Types ───────────────────────────────────────────────────

export interface ReasoningResult {
  keyConcepts: string[];          // most relevant concepts for the query
  relationships: string[];        // edges expressed as "A → relates_to → B"
  inferredInsights: string[];     // higher-level abstractions
  contradictions: string[];       // detected conflicts or tensions
  bridgingConcepts: string[];     // concepts that connect otherwise separate clusters
  conceptClusters: string[][];    // groups of tightly-related concepts
  confidence: number;             // overall reasoning confidence 0..1
}

// ── Reasoner ────────────────────────────────────────────────

export class ConceptReasoner {
  /**
   * Run the full reasoning pipeline over a subgraph.
   */
  reason(
    query: string,
    subgraph: ConceptSubgraph,
    fullGraph: ConceptGraph,
  ): ReasoningResult {
    const allNodes = [...subgraph.seedNodes, ...subgraph.neighborNodes];

    if (allNodes.length === 0) {
      return {
        keyConcepts: [],
        relationships: [],
        inferredInsights: [],
        contradictions: [],
        bridgingConcepts: [],
        conceptClusters: [],
        confidence: 0.1,
      };
    }

    // Strategy 1: Graph Traversal
    const traversalResult = this.graphTraversalReasoning(subgraph, fullGraph);

    // Strategy 2: Pattern Reasoning
    const patternResult = this.patternReasoning(query, allNodes, subgraph.edges);

    // Strategy 3: Abstraction Reasoning
    const abstractionResult = this.abstractionReasoning(allNodes, subgraph.edges);

    // Merge results
    return this.mergeResults(
      traversalResult,
      patternResult,
      abstractionResult,
      allNodes,
    );
  }

  // ── Strategy 1: Graph Traversal ───────────────────────────

  private graphTraversalReasoning(
    subgraph: ConceptSubgraph,
    _fullGraph: ConceptGraph,
  ): Partial<ReasoningResult> {
    const relationships: string[] = [];
    const bridgingConcepts: string[] = [];

    // Extract edge relationships in human-readable form
    for (const edge of subgraph.edges) {
      const fromName = this.findNodeName(subgraph, edge.from);
      const toName = this.findNodeName(subgraph, edge.to);
      if (fromName && toName) {
        const relType = edge.type === "related"
          ? "关联"
          : edge.type === "shared-episode"
            ? "共现"
            : "标签重叠";
        relationships.push(`${fromName} → ${relType} → ${toName}`);
      }
    }

    // Identify bridging concepts: nodes that connect seed ↔ neighbor clusters
    const seedSlugs = new Set(subgraph.seedNodes.map(n => n.slug));
    const allNodes = [...subgraph.seedNodes, ...subgraph.neighborNodes];

    for (const node of allNodes) {
      if (node.degree < 2) continue;

      let seedConnections = 0;
      let neighborConnections = 0;

      for (const edge of subgraph.edges) {
        if (edge.from === node.slug) {
          if (seedSlugs.has(edge.to)) seedConnections++;
          else neighborConnections++;
        } else if (edge.to === node.slug) {
          if (seedSlugs.has(edge.from)) seedConnections++;
          else neighborConnections++;
        }
      }

      // Bridging if it connects both seed and neighbor clusters
      if (seedConnections >= 1 && neighborConnections >= 1) {
        bridgingConcepts.push(node.name);
      }
    }

    return { relationships, bridgingConcepts };
  }

  // ── Strategy 2: Pattern Reasoning ─────────────────────────

  private patternReasoning(
    query: string,
    allNodes: ConceptGraphNode[],
    edges: ConceptGraphEdge[],
  ): Partial<ReasoningResult> {
    const keyConcepts: string[] = [];
    const queryTerms = this.extractQueryTerms(query);

    // Score each concept by relevance to query
    const scored = allNodes.map(node => {
      let score = 0;

      // Direct name match
      const nodeNameLower = node.name.toLowerCase();
      for (const term of queryTerms) {
        if (nodeNameLower.includes(term)) score += 0.4;
      }

      // Tag match
      for (const tag of node.tags) {
        for (const term of queryTerms) {
          if (tag.toLowerCase().includes(term)) score += 0.25;
        }
      }

      // Centrality bonus: higher-degree nodes are more relevant
      score += Math.min(0.3, node.degree * 0.05);

      // Confidence bonus
      score += node.confidence * 0.15;

      return { node, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Select key concepts (those with significant query relevance)
    for (const { node, score } of scored) {
      if (score > 0.15 && keyConcepts.length < 6) {
        keyConcepts.push(node.name);
      }
    }

    // Detect strong associations: edges with high weight
    const strongAssociations: string[] = [];
    for (const edge of edges) {
      if (edge.weight >= 0.6) {
        const fromName = this.findNodeNameFromList(allNodes, edge.from);
        const toName = this.findNodeNameFromList(allNodes, edge.to);
        if (fromName && toName && edge.type === "shared-episode") {
          strongAssociations.push(`${fromName} ↔ ${toName} (共同出现在 ${Math.round(edge.weight * 10) / 10} 的 episode 中)`);
        }
      }
    }

    return { keyConcepts };
  }

  // ── Strategy 3: Abstraction Reasoning ─────────────────────

  private abstractionReasoning(
    allNodes: ConceptGraphNode[],
    edges: ConceptGraphEdge[],
  ): Partial<ReasoningResult> {
    const inferredInsights: string[] = [];
    const contradictions: string[] = [];

    // 1. Find concept clusters using connected components
    const visited = new Set<string>();
    const clusters: ConceptGraphNode[][] = [];
    const conceptClusters: string[][] = [];

    for (const node of allNodes) {
      if (visited.has(node.slug)) continue;

      // BFS to find connected component
      const cluster: ConceptGraphNode[] = [];
      const queue = [node.slug];
      visited.add(node.slug);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentNode = allNodes.find(n => n.slug === current);
        if (currentNode) cluster.push(currentNode);

        for (const edge of edges) {
          let neighbor: string | null = null;
          if (edge.from === current && !visited.has(edge.to)) neighbor = edge.to;
          else if (edge.to === current && !visited.has(edge.from)) neighbor = edge.from;

          if (neighbor) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      if (cluster.length >= 2) clusters.push(cluster);
    }

    // Generate insights from clusters
    for (const cluster of clusters) {
      const names = cluster.map(n => n.name);

      // Cluster theme: most frequent tag
      const tagCounts = new Map<string, number>();
      for (const n of cluster) {
        for (const t of n.tags) {
          if (t === "concept") continue;
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }
      const topTag = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])[0];

      if (cluster.length >= 3) {
        conceptClusters.push(names);
        if (topTag) {
          inferredInsights.push(
            `概念簇 "${topTag[0]}" 包含 ${cluster.length} 个相关概念: ${names.join(", ")}`
          );
        }
      }

      // High-confidence stable concepts
      const stableConcepts = cluster.filter(n => n.confidence > 0.6 && n.sourceEpisodes.length >= 2);
      if (stableConcepts.length >= 2) {
        inferredInsights.push(
          `稳定概念组: ${stableConcepts.map(n => n.name).join(", ")} — 每个都有多个 episode 支撑`
        );
      }
    }

    // 2. Detect contradictions
    // Contradiction pattern: two concepts with high confidence but very different tags
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i];
        const b = allNodes[j];
        // Both high confidence, both have episodes, but no edge between them
        if (a.confidence > 0.5 && b.confidence > 0.5 &&
          a.sourceEpisodes.length >= 2 && b.sourceEpisodes.length >= 2) {
          const connected = edges.some(e =>
            (e.from === a.slug && e.to === b.slug) ||
            (e.from === b.slug && e.to === a.slug)
          );
          // Not connected despite both being stable — potential insight gap
          if (!connected && a.tags.length > 0 && b.tags.length > 0) {
            const sharedTags = a.tags.filter(t => b.tags.includes(t) && t !== "concept");
            if (sharedTags.length > 0) {
              // Same tag domain but no connection — worth noting
              contradictions.push(
                `"${a.name}" 和 "${b.name}" 共享标签 "${sharedTags[0]}" 但尚未建立关联`
              );
            }
          }
        }
      }
    }

    // 3. Abstraction: if episodes deeply reference a single concept cluster
    for (const cluster of clusters) {
      const allEpisodes = new Set<string>();
      for (const n of cluster) {
        for (const ep of n.sourceEpisodes) allEpisodes.add(ep);
      }
      if (allEpisodes.size >= 3) {
        inferredInsights.push(
          `${allEpisodes.size} 个 episode 构成了围绕 "${cluster.map(n => n.name).join(" / ")}" 的知识网络`
        );
      }
    }

    return { inferredInsights, contradictions, conceptClusters };
  }

  // ── Merge & Finalize ──────────────────────────────────────

  private mergeResults(
    traversal: Partial<ReasoningResult>,
    pattern: Partial<ReasoningResult>,
    abstraction: Partial<ReasoningResult>,
    allNodes: ConceptGraphNode[],
  ): ReasoningResult {
    // Deduplicate relationships
    const relSet = new Set([...(traversal.relationships || []), ...(pattern.relationships || [])]);

    // Deduplicate insights
    const insightSet = new Set(abstraction.inferredInsights || []);

    // Deduplicate contradictions
    const contraSet = new Set(abstraction.contradictions || []);

    // Compute overall confidence: based on graph completeness
    let confidence = 0.3; // base

    // More nodes → more confident (up to 0.3 bonus)
    confidence += Math.min(0.3, allNodes.length * 0.05);

    // More edges → stronger graph (up to 0.2 bonus)
    const edgeCount = (traversal.relationships || []).length;
    confidence += Math.min(0.2, edgeCount * 0.03);

    // Insights generated → reasoning was productive (up to 0.2 bonus)
    const insightCount = (abstraction.inferredInsights || []).length;
    confidence += Math.min(0.2, insightCount * 0.05);

    confidence = Math.round(Math.min(1, confidence) * 100) / 100;

    return {
      keyConcepts: pattern.keyConcepts || [],
      relationships: Array.from(relSet).slice(0, 15),
      inferredInsights: Array.from(insightSet).slice(0, 10),
      contradictions: Array.from(contraSet).slice(0, 5),
      bridgingConcepts: traversal.bridgingConcepts || [],
      conceptClusters: abstraction.conceptClusters || [],
      confidence,
    };
  }

  // ── Utilities ─────────────────────────────────────────────

  private findNodeName(subgraph: ConceptSubgraph, slug: string): string | null {
    const all = [...subgraph.seedNodes, ...subgraph.neighborNodes];
    return this.findNodeNameFromList(all, slug);
  }

  private findNodeNameFromList(nodes: ConceptGraphNode[], slug: string): string | null {
    const node = nodes.find(n => n.slug === slug);
    return node?.name ?? null;
  }

  private extractQueryTerms(query: string): string[] {
    // Extract meaningful terms from the query
    const cleaned = query
      .toLowerCase()
      .replace(/[，。！？、,.!?\s]+/g, " ")
      .trim();

    // Chinese bigrams
    const terms: string[] = [];
    const cjk = cleaned.replace(/[^一-鿿]/g, "");
    for (let i = 0; i < cjk.length - 1; i++) {
      terms.push(cjk.substring(i, i + 2));
    }

    // English words (3+ chars)
    const words = cleaned.match(/[a-z]{3,}/g) || [];
    terms.push(...words);

    // Also add the full cleaned query as a term
    if (cleaned.length > 2) terms.push(cleaned);

    return [...new Set(terms)].slice(0, 20);
  }
}
