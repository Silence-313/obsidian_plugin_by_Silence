// ── Tool Memory ─────────────────────────────────────────────
// Tracks tool usage performance: success rate, context effectiveness, frequency.
// Used by Tool Router to improve future routing decisions.

export interface ToolUsageRecord {
  toolName: string;
  callCount: number;
  successCount: number;
  failureCount: number;

  // Context signals that preceded this tool call
  topQueryPatterns: string[];   // top N query patterns that triggered this tool
  patternCounts: Record<string, number>; // pattern → count

  // Effectiveness tracking
  avgResponseQuality: number;   // 0..1, updated after each use
  avgLatencyMs: number;

  // Temporal
  firstUsed: number;
  lastUsed: number;

  // Per-context-type effectiveness
  contextEffectiveness: Record<string, { count: number; avgQuality: number }>;
}

export class ToolMemory {
  private records: Map<string, ToolUsageRecord> = new Map();
  private maxPatternsPerTool = 20;

  private ensureRecord(toolName: string): ToolUsageRecord {
    if (!this.records.has(toolName)) {
      this.records.set(toolName, {
        toolName,
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        topQueryPatterns: [],
        patternCounts: {},
        avgResponseQuality: 0.5,
        avgLatencyMs: 0,
        firstUsed: Date.now(),
        lastUsed: 0,
        contextEffectiveness: {},
      });
    }
    return this.records.get(toolName)!;
  }

  recordCall(
    toolName: string,
    result: { success: boolean; latencyMs: number; responseQuality: number },
    query: string,
    contextType: string = "general",
  ): void {
    const rec = this.ensureRecord(toolName);

    rec.callCount++;
    if (result.success) rec.successCount++;
    else rec.failureCount++;
    rec.lastUsed = Date.now();

    // Update rolling averages
    const n = rec.callCount;
    rec.avgResponseQuality = (rec.avgResponseQuality * (n - 1) + result.responseQuality) / n;
    rec.avgLatencyMs = (rec.avgLatencyMs * (n - 1) + result.latencyMs) / n;

    // Track query patterns (extract keywords from query)
    const keywords = this.extractPattern(query);
    if (keywords) {
      rec.patternCounts[keywords] = (rec.patternCounts[keywords] || 0) + 1;
      // Keep top patterns
      rec.topQueryPatterns = Object.entries(rec.patternCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.maxPatternsPerTool)
        .map(([p]) => p);
    }

    // Track per-context effectiveness
    if (!rec.contextEffectiveness[contextType]) {
      rec.contextEffectiveness[contextType] = { count: 0, avgQuality: 0.5 };
    }
    const ce = rec.contextEffectiveness[contextType];
    ce.count++;
    ce.avgQuality = (ce.avgQuality * (ce.count - 1) + result.responseQuality) / ce.count;
  }

  private extractPattern(query: string): string {
    // Extract key n-grams that represent the intent
    const cleaned = query.replace(/[，。！？、,.!?\s]+/g, " ").trim().toLowerCase();
    const words = cleaned.split(/\s+/).filter(w => w.length >= 2);
    if (words.length === 0) return cleaned.substring(0, 20);
    // Take first 3 meaningful words as pattern
    return words.slice(0, 3).join(" ");
  }

  getSuccessRate(toolName: string): number {
    const rec = this.records.get(toolName);
    if (!rec || rec.callCount === 0) return 0.5; // neutral default
    return rec.successCount / rec.callCount;
  }

  getEffectiveness(toolName: string): number {
    const rec = this.records.get(toolName);
    return rec?.avgResponseQuality ?? 0.5;
  }

  getFrequency(toolName: string): number {
    const rec = this.records.get(toolName);
    if (!rec || rec.callCount === 0) return 0;
    const daysSinceFirst = (Date.now() - rec.firstUsed) / (1000 * 60 * 60 * 24);
    return daysSinceFirst > 0 ? rec.callCount / daysSinceFirst : rec.callCount;
  }

  // Suggest alternate tool based on historical effectiveness for similar queries
  suggestAlternate(toolName: string, query: string): string | null {
    const pattern = this.extractPattern(query);
    let bestTool: string | null = null;
    let bestScore = 0;

    for (const [name, rec] of this.records) {
      if (name === toolName) continue;
      // Check if this tool has been effective for similar patterns
      const patternMatch = rec.topQueryPatterns.some(p => {
        const pWords = p.split(" ");
        const qWords = pattern.split(" ");
        return pWords.some(pw => qWords.some(qw => qw.includes(pw) || pw.includes(qw)));
      });
      if (patternMatch && rec.avgResponseQuality > bestScore) {
        bestScore = rec.avgResponseQuality;
        bestTool = name;
      }
    }

    return bestTool;
  }

  getStats(toolName: string): ToolUsageRecord | null {
    return this.records.get(toolName) ?? null;
  }

  getAllStats(): ToolUsageRecord[] {
    return Array.from(this.records.values());
  }

  // ── Serialization ─────────────────────────────────────────

  serialize(): string {
    return JSON.stringify(Array.from(this.records.entries()));
  }

  deserialize(json: string): void {
    try {
      const entries = JSON.parse(json);
      this.records = new Map(entries);
    } catch {
      this.records = new Map();
    }
  }

  clear(): void {
    this.records = new Map();
  }
}
