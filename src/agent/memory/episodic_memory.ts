// ── Episodic Memory ─────────────────────────────────────────
// Stores user events, goals, decisions — things that happened.
// Persisted to JSON in wiki folder.
// Evolution: scoring fields for decay, reinforcement, consolidation.

export interface EpisodicEntry {
  id: string;
  timestamp: number;
  type: "event" | "goal" | "decision" | "milestone" | "question";
  summary: string;
  detail: string;
  importance: number; // 0..1
  tags: string[];
  relatedFiles: string[];
  // Evolution scoring fields (backward-compatible, defaults applied on load)
  importanceScore?: number;
  usageFrequency?: number;
  lastAccessTime?: number;
  decayScore?: number;
  usefulnessScore?: number;
  markedForRemoval?: boolean;
}

export class EpisodicMemory {
  private entries: EpisodicEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 200) {
    this.maxEntries = maxEntries;
  }

  add(entry: Omit<EpisodicEntry, "id" | "timestamp">): EpisodicEntry {
    const full: EpisodicEntry = {
      ...entry,
      id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      // Initialize evolution fields
      importanceScore: entry.importanceScore ?? entry.importance,
      usageFrequency: entry.usageFrequency ?? 0,
      lastAccessTime: entry.lastAccessTime ?? Date.now(),
      decayScore: entry.decayScore ?? 1.0,
      usefulnessScore: entry.usefulnessScore ?? 0.5,
      markedForRemoval: entry.markedForRemoval ?? false,
    };
    this.entries.push(full);
    this.prune();
    return full;
  }

  update(id: string, updates: Partial<Omit<EpisodicEntry, "id" | "timestamp">>): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.entries[idx] = { ...this.entries[idx], ...updates };
    return true;
  }

  // ── Evolution Methods ─────────────────────────────────────

  markAccessed(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const e = this.entries[idx];
    e.usageFrequency = (e.usageFrequency ?? 0) + 1;
    e.lastAccessTime = Date.now();
    e.decayScore = 1.0; // reset decay on access
    e.markedForRemoval = false; // clear removal flag
    return true;
  }

  reinforce(id: string, amount: number): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const e = this.entries[idx];
    const current = e.importanceScore ?? e.importance;
    e.importanceScore = Math.min(1, Math.max(0, current + amount));
    e.usefulnessScore = Math.min(1, (e.usefulnessScore ?? 0.5) + amount * 0.5);
    e.markedForRemoval = false;
    return true;
  }

  applyDecay(cyclesSinceLastAccess: number): number {
    let decayed = 0;
    const now = Date.now();
    for (const e of this.entries) {
      if (e.markedForRemoval) continue;
      const lastAccess = e.lastAccessTime ?? e.timestamp;
      const cycles = lastAccess > 0
        ? Math.floor((now - lastAccess) / (1000 * 60 * 60)) // 1h cycles
        : cyclesSinceLastAccess;
      const rate = 0.03 * (1 - (e.usageFrequency ?? 0) * 0.6);
      e.decayScore = Number(((e.importanceScore ?? e.importance) * Math.exp(-rate * Math.max(0, cycles))).toFixed(4));
      if (e.decayScore < 0.25 && (e.usageFrequency ?? 0) === 0 && cycles >= 14) {
        e.markedForRemoval = true;
        decayed++;
      }
    }
    return decayed;
  }

  getCandidatesForRemoval(): EpisodicEntry[] {
    return this.entries.filter(e => e.markedForRemoval === true);
  }

  getActiveEntries(): EpisodicEntry[] {
    return this.entries.filter(e => !e.markedForRemoval);
  }

  // ── Query Methods ─────────────────────────────────────────

  search(query: string, topK: number = 5): EpisodicEntry[] {
    const keywords = query.toLowerCase().split(/\s+/);
    const scored = this.entries
      .filter(e => !e.markedForRemoval)
      .map(e => {
        let score = 0;
        const text = `${e.summary} ${e.detail} ${e.tags.join(" ")}`.toLowerCase();
        for (const kw of keywords) {
          if (text.includes(kw)) score += 10;
          if (e.tags.some(t => t.toLowerCase().includes(kw))) score += 20;
          if (e.type.toLowerCase() === kw) score += 15;
        }
        // Recency boost
        const hoursAgo = (Date.now() - e.timestamp) / (1000 * 60 * 60);
        score += Math.max(0, 5 - hoursAgo * 0.1);
        // Evolution boost: higher usefulness → bonus
        score += (e.usefulnessScore ?? 0.5) * 5;
        return { entry: e, score };
      });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score > 0).slice(0, topK).map(s => s.entry);
  }

  getRecent(n: number = 10): EpisodicEntry[] {
    return this.entries
      .filter(e => !e.markedForRemoval)
      .slice(-n).reverse();
  }

  getByType(type: EpisodicEntry["type"]): EpisodicEntry[] {
    return this.entries.filter(e => e.type === type && !e.markedForRemoval);
  }

  getByTag(tag: string): EpisodicEntry[] {
    return this.entries.filter(e => e.tags.includes(tag) && !e.markedForRemoval);
  }

  getByImportance(minImportance: number): EpisodicEntry[] {
    return this.entries.filter(e => (e.importanceScore ?? e.importance) >= minImportance && !e.markedForRemoval);
  }

  formatForContext(maxEntries: number = 5): string {
    const recent = this.getRecent(maxEntries);
    if (recent.length === 0) return "";
    return recent.map(e =>
      `- [${e.type}] ${e.summary} (${new Date(e.timestamp).toLocaleDateString("zh-CN")})`
    ).join("\n");
  }

  // ── Maintenance ───────────────────────────────────────────

  private prune(): void {
    if (this.entries.length > this.maxEntries) {
      // Prefer removing marked entries first, then lowest importance+decay
      this.entries.sort((a, b) => {
        // Marked entries go last (get removed first)
        if (a.markedForRemoval && !b.markedForRemoval) return 1;
        if (!a.markedForRemoval && b.markedForRemoval) return -1;
        // Then by composite score
        const scoreA = (a.importanceScore ?? a.importance) * 100 - (Date.now() - a.timestamp) / (1000 * 60 * 60 * 24);
        const scoreB = (b.importanceScore ?? b.importance) * 100 - (Date.now() - b.timestamp) / (1000 * 60 * 60 * 24);
        return scoreB - scoreA;
      });
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  // ── Serialization ─────────────────────────────────────────

  serialize(): string {
    return JSON.stringify(this.entries);
  }

  deserialize(json: string): void {
    try {
      const raw = JSON.parse(json);
      // Apply defaults for backward compatibility
      this.entries = raw.map((e: any) => ({
        ...e,
        importanceScore: e.importanceScore ?? e.importance ?? 0.5,
        usageFrequency: e.usageFrequency ?? 0,
        lastAccessTime: e.lastAccessTime ?? e.timestamp ?? Date.now(),
        decayScore: e.decayScore ?? 1.0,
        usefulnessScore: e.usefulnessScore ?? 0.5,
        markedForRemoval: e.markedForRemoval ?? false,
      }));
    } catch {
      this.entries = [];
    }
  }

  get count(): number {
    return this.entries.length;
  }

  get activeCount(): number {
    return this.entries.filter(e => !e.markedForRemoval).length;
  }

  clear(): void {
    this.entries = [];
  }
}
