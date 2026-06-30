// ── RAG Feedback ────────────────────────────────────────────
// Feedback-aware retrieval: relevance scoring, query clustering,
// document weight adjustment, negative signal handling.
//
// Documents are NEVER deleted — only downweighted.

const MAX_UPDATE_PER_CYCLE = 0.05;
const MIN_CONFIRMATIONS = 3;
const NEGATIVE_SIGNAL_THRESHOLD = 3;
const DOWNWEIGHT_FACTOR = 0.15;

export interface RetrievalRecord {
  query: string;
  retrievedDocs: string[];       // document paths
  usedDocs: string[];            // docs actually used in answer
  answerQuality: number;         // 0..1 estimated
  timestamp: number;
}

export interface DocumentWeight {
  path: string;
  baseWeight: number;            // starts at 1.0
  relevanceScore: number;        // rolling average of retrieval relevance
  answerImpactScore: number;     // how often this doc improves answers
  positiveSignals: number;
  negativeSignals: number;
  downweightFactor: number;      // cumulative downweight (never below 0.1)
  lastAccessed: number;
}

export interface QueryCluster {
  signature: string;             // keyword signature hash
  queries: string[];             // representative queries
  centroidTerms: string[];       // top terms
  retrievalCount: number;
  avgSuccessRate: number;        // how often retrieval from this cluster helps
  lastSeen: number;
}

export class RagFeedback {
  private records: RetrievalRecord[] = [];
  private docWeights: Map<string, DocumentWeight> = new Map();
  private clusters: Map<string, QueryCluster> = new Map();
  private maxRecords = 500;

  // ── Recording ─────────────────────────────────────────────

  recordRetrieval(record: RetrievalRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // Update document weights
    this.updateDocWeights(record);

    // Update query clusters
    this.updateClusters(record);
  }

  private updateDocWeights(record: RetrievalRecord): void {
    for (const docPath of record.retrievedDocs) {
      const dw = this.ensureDocWeight(docPath);
      const wasUsed = record.usedDocs.includes(docPath);

      if (wasUsed) {
        dw.positiveSignals++;
        // Boost: document was useful
        dw.relevanceScore = Number(
          ((dw.relevanceScore * (dw.positiveSignals + dw.negativeSignals - 1) + 1) /
            (dw.positiveSignals + dw.negativeSignals)).toFixed(4)
        );
        dw.answerImpactScore = Number(
          ((dw.answerImpactScore * (dw.positiveSignals - 1) + record.answerQuality) /
            dw.positiveSignals).toFixed(4)
        );
      } else {
        dw.negativeSignals++;
        dw.relevanceScore = Number(
          ((dw.relevanceScore * (dw.positiveSignals + dw.negativeSignals - 1) + 0) /
            (dw.positiveSignals + dw.negativeSignals)).toFixed(4)
        );
        // Check for negative signal threshold
        if (dw.negativeSignals >= NEGATIVE_SIGNAL_THRESHOLD &&
          dw.positiveSignals < dw.negativeSignals) {
          dw.downweightFactor = Number(
            Math.max(0.1, dw.downweightFactor - DOWNWEIGHT_FACTOR * MAX_UPDATE_PER_CYCLE * 10).toFixed(4)
          );
        }
      }

      dw.lastAccessed = record.timestamp;
    }
  }

  private updateClusters(record: RetrievalRecord): void {
    const sig = this.computeQuerySignature(record.query);
    const cluster = this.ensureCluster(sig, record.query);

    cluster.retrievalCount++;
    cluster.lastSeen = record.timestamp;
    cluster.avgSuccessRate = Number(
      ((cluster.avgSuccessRate * (cluster.retrievalCount - 1) + record.answerQuality) /
        cluster.retrievalCount).toFixed(4)
    );

    // Update centroid terms with new query
    const queryTerms = this.extractKeyTerms(record.query);
    for (const term of queryTerms) {
      if (!cluster.centroidTerms.includes(term)) {
        cluster.centroidTerms.push(term);
        if (cluster.centroidTerms.length > 10) {
          cluster.centroidTerms = cluster.centroidTerms.slice(-10);
        }
      }
    }

    // Keep representative queries
    if (!cluster.queries.includes(record.query)) {
      cluster.queries.push(record.query);
      if (cluster.queries.length > 5) {
        cluster.queries = cluster.queries.slice(-5);
      }
    }
  }

  // ── Query Clustering ──────────────────────────────────────

  private computeQuerySignature(query: string): string {
    const terms = this.extractKeyTerms(query);
    // Hash into a signature
    const sorted = [...new Set(terms)].sort().join("|");
    // Simple hash for grouping
    let hash = 0;
    for (let i = 0; i < sorted.length; i++) {
      hash = ((hash << 5) - hash) + sorted.charCodeAt(i);
      hash |= 0;
    }
    // Group by first 2-3 meaningful terms
    const prefix = terms.slice(0, Math.min(3, terms.length)).join("_");
    return prefix || `cluster_${Math.abs(hash % 50)}`;
  }

  private extractKeyTerms(query: string): string[] {
    return query
      .replace(/[，。！？、,.!?\s]+/g, " ")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 2 && !["的", "了", "是", "在", "the", "a", "an", "is", "are"].includes(w))
      .slice(0, 5);
  }

  private ensureCluster(sig: string, query: string): QueryCluster {
    if (!this.clusters.has(sig)) {
      this.clusters.set(sig, {
        signature: sig,
        queries: [query],
        centroidTerms: this.extractKeyTerms(query),
        retrievalCount: 0,
        avgSuccessRate: 0.5,
        lastSeen: Date.now(),
      });
    }
    return this.clusters.get(sig)!;
  }

  private ensureDocWeight(path: string): DocumentWeight {
    if (!this.docWeights.has(path)) {
      this.docWeights.set(path, {
        path,
        baseWeight: 1.0,
        relevanceScore: 0.5,
        answerImpactScore: 0.5,
        positiveSignals: 0,
        negativeSignals: 0,
        downweightFactor: 1.0,
        lastAccessed: Date.now(),
      });
    }
    return this.docWeights.get(path)!;
  }

  // ── Document Weight Queries ───────────────────────────────

  getDocWeight(path: string): number {
    const dw = this.docWeights.get(path);
    if (!dw) return 1.0;
    return Number((dw.baseWeight * dw.downweightFactor).toFixed(4));
  }

  getNegativeSignals(): DocumentWeight[] {
    return Array.from(this.docWeights.values())
      .filter(dw => dw.downweightFactor < 0.5 && dw.negativeSignals >= NEGATIVE_SIGNAL_THRESHOLD);
  }

  getTopDocs(n: number = 10): DocumentWeight[] {
    return Array.from(this.docWeights.values())
      .sort((a, b) => (b.answerImpactScore * b.downweightFactor) - (a.answerImpactScore * a.downweightFactor))
      .slice(0, n);
  }

  // ── Cluster Queries ───────────────────────────────────────

  findCluster(query: string): QueryCluster | null {
    const sig = this.computeQuerySignature(query);
    return this.clusters.get(sig) ?? null;
  }

  getClusterContext(query: string): string[] {
    const cluster = this.findCluster(query);
    if (!cluster || cluster.retrievalCount < 3) return [];
    return cluster.centroidTerms;
  }

  getAllClusters(): QueryCluster[] {
    return Array.from(this.clusters.values())
      .sort((a, b) => b.retrievalCount - a.retrievalCount);
  }

  // ── Serialization ─────────────────────────────────────────

  serialize(): string {
    return JSON.stringify({
      records: this.records.slice(-100),
      docWeights: Array.from(this.docWeights.entries()),
      clusters: Array.from(this.clusters.entries()),
    });
  }

  deserialize(json: string): void {
    try {
      const data = JSON.parse(json);
      this.records = data.records || [];
      this.docWeights = new Map(data.docWeights || []);
      this.clusters = new Map(data.clusters || []);
    } catch {
      this.records = [];
      this.docWeights = new Map();
      this.clusters = new Map();
    }
  }

  clear(): void {
    this.records = [];
    this.docWeights = new Map();
    this.clusters = new Map();
  }
}
