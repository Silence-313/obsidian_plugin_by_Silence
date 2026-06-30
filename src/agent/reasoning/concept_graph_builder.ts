// ── Concept Graph Builder ───────────────────────────────────
// In-memory concept subgraph construction.
// Takes markdown-loaded concepts + episodes, builds a weighted
// graph with nodes (concepts) and edges (related[] + shared episodes).
// Limits expansion to 1-hop neighborhood for focused reasoning.

// ── Types ───────────────────────────────────────────────────

export interface ConceptGraphNode {
  id: string;           // concept id (concept-xxx)
  name: string;         // human-readable name
  slug: string;         // file-safe identifier
  confidence: number;   // extraction confidence
  sourceEpisodes: string[]; // episode file names
  related: string[];    // related concept slugs
  tags: string[];       // concept tags
  degree: number;       // computed: total edge count
}

export interface ConceptGraphEdge {
  from: string;   // source slug
  to: string;     // target slug
  weight: number; // edge strength 0..1
  type: "related" | "shared-episode" | "tag-overlap";
}

export interface ConceptGraph {
  nodes: Map<string, ConceptGraphNode>;
  edges: ConceptGraphEdge[];
}

export interface ConceptSubgraph {
  seedNodes: ConceptGraphNode[];     // the concepts directly matched from episodes
  neighborNodes: ConceptGraphNode[]; // 1-hop neighbors
  edges: ConceptGraphEdge[];         // all edges among seed + neighbor
  centralConcepts: ConceptGraphNode[]; // nodes with highest degree in subgraph
}

// ── Builder ─────────────────────────────────────────────────

export class ConceptGraphBuilder {
  /**
   * Build the full concept graph from loaded concept data and episode entries.
   */
  buildFull(
    concepts: Array<{
      id: string; name: string; slug: string; confidence: number;
      sourceEpisodes: string[]; related: string[]; tags: string[];
    }>,
    episodeSlugs: string[] = [],
  ): ConceptGraph {
    const nodes = new Map<string, ConceptGraphNode>();
    const edges: ConceptGraphEdge[] = [];

    // 1. Create nodes
    for (const c of concepts) {
      nodes.set(c.slug, {
        id: c.id,
        name: c.name,
        slug: c.slug,
        confidence: c.confidence,
        sourceEpisodes: c.sourceEpisodes,
        related: c.related,
        tags: c.tags,
        degree: 0,
      });
    }

    // 2. Build edges from explicit related[] links
    for (const c of concepts) {
      for (const relatedSlug of c.related) {
        if (!nodes.has(relatedSlug)) continue;
        // Avoid duplicate edges (undirected)
        const key1 = `${c.slug}→${relatedSlug}`;
        const key2 = `${relatedSlug}→${c.slug}`;
        if (edges.some(e => `${e.from}→${e.to}` === key1 || `${e.from}→${e.to}` === key2)) continue;

        edges.push({
          from: c.slug,
          to: relatedSlug,
          weight: 0.8, // explicit related links are strong signals
          type: "related",
        });
        // Update degrees
        const fromNode = nodes.get(c.slug);
        const toNode = nodes.get(relatedSlug);
        if (fromNode) fromNode.degree++;
        if (toNode) toNode.degree++;
      }
    }

    // 3. Build edges from shared source episodes
    const conceptList = Array.from(nodes.values());
    for (let i = 0; i < conceptList.length; i++) {
      for (let j = i + 1; j < conceptList.length; j++) {
        const shared = conceptList[i].sourceEpisodes.filter(e =>
          conceptList[j].sourceEpisodes.includes(e)
        );
        if (shared.length >= 1) {
          const weight = Math.min(1, 0.3 + shared.length * 0.15);
          edges.push({
            from: conceptList[i].slug,
            to: conceptList[j].slug,
            weight,
            type: "shared-episode",
          });
          const fromN = nodes.get(conceptList[i].slug);
          const toN = nodes.get(conceptList[j].slug);
          if (fromN) fromN.degree++;
          if (toN) toN.degree++;
        }
      }
    }

    // 4. Build edges from tag overlap
    for (let i = 0; i < conceptList.length; i++) {
      for (let j = i + 1; j < conceptList.length; j++) {
        const sharedTags = conceptList[i].tags.filter(t =>
          conceptList[j].tags.includes(t) && t !== "concept"
        );
        if (sharedTags.length >= 1) {
          edges.push({
            from: conceptList[i].slug,
            to: conceptList[j].slug,
            weight: 0.3 + sharedTags.length * 0.1,
            type: "tag-overlap",
          });
          const fromN = nodes.get(conceptList[i].slug);
          const toN = nodes.get(conceptList[j].slug);
          if (fromN) fromN.degree++;
          if (toN) toN.degree++;
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Build a 1-hop subgraph from seed concept slugs.
   * Expands to direct neighbors, returns the local reasoning context.
   */
  buildSubgraph(graph: ConceptGraph, seedSlugs: string[]): ConceptSubgraph {
    const seedNodes: ConceptGraphNode[] = [];
    const neighborSlugs = new Set<string>();
    const includedSlugs = new Set(seedSlugs);

    // Collect seed nodes
    for (const slug of seedSlugs) {
      const node = graph.nodes.get(slug);
      if (node) seedNodes.push(node);
    }

    // 1-hop expansion: find neighbors of seed nodes
    for (const edge of graph.edges) {
      const isFromSeed = seedSlugs.includes(edge.from);
      const isToSeed = seedSlugs.includes(edge.to);

      if (isFromSeed && !isToSeed) {
        neighborSlugs.add(edge.to);
        includedSlugs.add(edge.to);
      } else if (isToSeed && !isFromSeed) {
        neighborSlugs.add(edge.from);
        includedSlugs.add(edge.from);
      }
    }

    // Collect neighbor nodes
    const neighborNodes: ConceptGraphNode[] = [];
    for (const slug of neighborSlugs) {
      const node = graph.nodes.get(slug);
      if (node) neighborNodes.push(node);
    }

    // Filter edges to only include those within the subgraph
    const subgraphEdges = graph.edges.filter(e =>
      includedSlugs.has(e.from) && includedSlugs.has(e.to)
    );

    // Rank central concepts by degree within subgraph
    const allNodes = [...seedNodes, ...neighborNodes];
    allNodes.sort((a, b) => b.degree - a.degree);
    const centralConcepts = allNodes.slice(0, Math.min(5, allNodes.length));

    return {
      seedNodes,
      neighborNodes,
      edges: subgraphEdges,
      centralConcepts,
    };
  }

  /**
   * Get all slugs reachable within 1 hop from seed slugs.
   * Useful for concept expansion before subgraph building.
   */
  expandOneHop(graph: ConceptGraph, seedSlugs: string[]): string[] {
    const reachable = new Set(seedSlugs);
    for (const edge of graph.edges) {
      if (seedSlugs.includes(edge.from)) reachable.add(edge.to);
      if (seedSlugs.includes(edge.to)) reachable.add(edge.from);
    }
    return Array.from(reachable);
  }
}
