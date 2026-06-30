// ── Router Telemetry ────────────────────────────────────────
// Adaptive routing: per-tool success tracking, dynamic confidence
// thresholds, policy weight evolution, self-tuning router.
//
// Safety: ±0.05 clamp per cycle, 3+ confirmations gate.

const MAX_UPDATE_PER_CYCLE = 0.05;
const BASE_THRESHOLD = 0.2;

export interface RoutingRecord {
  query: string;
  selectedTool: string;
  confidence: number;
  executionSuccess: boolean;
  latencyMs: number;
  timestamp: number;
}

export interface ToolMetrics {
  toolName: string;
  successRate: number;       // rolling 0..1
  avgConfidence: number;     // rolling
  contextMatchScore: number; // how well context supported this tool
  selectionCount: number;
  adaptiveThreshold: number; // dynamic threshold for this tool
  policyWeight: number;      // selection probability weight
  recentDecisions: RoutingRecord[]; // last N decisions for this tool
}

export class RouterTelemetry {
  private records: RoutingRecord[] = [];
  private metrics: Map<string, ToolMetrics> = new Map();
  private maxRecords = 1000;
  private maxRecentPerTool = 20;

  // ── Recording ─────────────────────────────────────────────

  recordRouting(record: RoutingRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
    this.updateMetrics(record);
  }

  private updateMetrics(record: RoutingRecord): void {
    const m = this.ensureMetrics(record.selectedTool);

    m.recentDecisions.push(record);
    if (m.recentDecisions.length > this.maxRecentPerTool) {
      m.recentDecisions = m.recentDecisions.slice(-this.maxRecentPerTool);
    }

    m.selectionCount++;
    const n = m.selectionCount;

    // Rolling success rate
    m.successRate = Number(
      ((m.successRate * (n - 1) + (record.executionSuccess ? 1 : 0)) / n).toFixed(4)
    );

    // Rolling average confidence
    m.avgConfidence = Number(
      ((m.avgConfidence * (n - 1) + record.confidence) / n).toFixed(4)
    );

    // Update adaptive threshold based on success rate trend
    m.adaptiveThreshold = this.computeAdaptiveThreshold(m);
    m.policyWeight = this.computePolicyWeight(m);
  }

  // ── Adaptive Threshold ────────────────────────────────────

  private computeAdaptiveThreshold(metrics: ToolMetrics): number {
    const sr = metrics.successRate;

    if (metrics.selectionCount < 3) return BASE_THRESHOLD;

    // Success rate ↑ → lower threshold (easier to select)
    // Success rate ↓ → raise threshold (harder to select)
    let adjustment = 0;

    if (sr > 0.85) adjustment = -0.03;       // high success → more permissive
    else if (sr > 0.7) adjustment = -0.01;
    else if (sr < 0.3) adjustment = 0.05;     // low success → more restrictive
    else if (sr < 0.5) adjustment = 0.03;
    // else: stay near base

    // Clamp
    adjustment = Math.max(-MAX_UPDATE_PER_CYCLE, Math.min(MAX_UPDATE_PER_CYCLE, adjustment));
    return Number(Math.max(0.05, Math.min(0.5, BASE_THRESHOLD + adjustment)).toFixed(4));
  }

  // ── Policy Weight ─────────────────────────────────────────

  private computePolicyWeight(metrics: ToolMetrics): number {
    // Weight = successRate * frequencyFactor * recencyFactor
    const sr = metrics.successRate;
    const freq = Math.min(1, metrics.selectionCount / 20); // caps at 20 selections
    const recentSuccesses = metrics.recentDecisions.filter(d => d.executionSuccess).length;
    const recency = metrics.recentDecisions.length > 0
      ? recentSuccesses / metrics.recentDecisions.length
      : 0.5;

    return Number(Math.max(0.1, (sr * 0.5 + freq * 0.2 + recency * 0.3)).toFixed(4));
  }

  private ensureMetrics(toolName: string): ToolMetrics {
    if (!this.metrics.has(toolName)) {
      this.metrics.set(toolName, {
        toolName,
        successRate: 0.5,
        avgConfidence: 0.5,
        contextMatchScore: 0.5,
        selectionCount: 0,
        adaptiveThreshold: BASE_THRESHOLD,
        policyWeight: 0.5,
        recentDecisions: [],
      });
    }
    return this.metrics.get(toolName)!;
  }

  // ── Getters ───────────────────────────────────────────────

  getAdaptiveThreshold(toolName: string): number {
    return this.metrics.get(toolName)?.adaptiveThreshold ?? BASE_THRESHOLD;
  }

  getPolicyWeight(toolName: string): number {
    return this.metrics.get(toolName)?.policyWeight ?? 0.5;
  }

  getSuccessRate(toolName: string): number {
    return this.metrics.get(toolName)?.successRate ?? 0.5;
  }

  getMetrics(toolName: string): ToolMetrics | null {
    return this.metrics.get(toolName) ?? null;
  }

  getAllMetrics(): ToolMetrics[] {
    return Array.from(this.metrics.values());
  }

  getRecentRecords(n: number = 20): RoutingRecord[] {
    return this.records.slice(-n);
  }

  // ── Aggregate Stats ───────────────────────────────────────

  getOverallAccuracy(): number {
    if (this.records.length === 0) return 0.5;
    const successes = this.records.filter(r => r.executionSuccess).length;
    return Number((successes / this.records.length).toFixed(4));
  }

  getToolDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const r of this.records.slice(-100)) {
      dist[r.selectedTool] = (dist[r.selectedTool] || 0) + 1;
    }
    return dist;
  }

  // ── Serialization ─────────────────────────────────────────

  serialize(): string {
    return JSON.stringify({
      records: this.records.slice(-200), // keep last 200 for persistence
      metrics: Array.from(this.metrics.entries()),
    });
  }

  deserialize(json: string): void {
    try {
      const data = JSON.parse(json);
      this.records = data.records || [];
      this.metrics = new Map(data.metrics || []);
    } catch {
      this.records = [];
      this.metrics = new Map();
    }
  }

  clear(): void {
    this.records = [];
    this.metrics = new Map();
  }
}
