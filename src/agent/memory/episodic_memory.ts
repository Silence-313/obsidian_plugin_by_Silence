// ── Episodic Memory ─────────────────────────────────────────
// Stores user events, goals, decisions — things that happened.
// Persisted to JSON in wiki folder.

export interface EpisodicEntry {
  id: string;
  timestamp: number;
  type: "event" | "goal" | "decision" | "milestone" | "question";
  summary: string;
  detail: string;
  importance: number; // 0..1
  tags: string[];
  relatedFiles: string[];
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

  search(query: string, topK: number = 5): EpisodicEntry[] {
    const keywords = query.toLowerCase().split(/\s+/);
    const scored = this.entries.map(e => {
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
      return { entry: e, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score > 0).slice(0, topK).map(s => s.entry);
  }

  getRecent(n: number = 10): EpisodicEntry[] {
    return this.entries.slice(-n).reverse();
  }

  getByType(type: EpisodicEntry["type"]): EpisodicEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  getByTag(tag: string): EpisodicEntry[] {
    return this.entries.filter(e => e.tags.includes(tag));
  }

  getByImportance(minImportance: number): EpisodicEntry[] {
    return this.entries.filter(e => e.importance >= minImportance);
  }

  formatForContext(maxEntries: number = 5): string {
    const recent = this.getRecent(maxEntries);
    if (recent.length === 0) return "";
    return recent.map(e =>
      `- [${e.type}] ${e.summary} (${new Date(e.timestamp).toLocaleDateString("zh-CN")})`
    ).join("\n");
  }

  private prune(): void {
    if (this.entries.length > this.maxEntries) {
      // Remove lowest-importance + oldest entries
      this.entries.sort((a, b) => {
        const scoreA = a.importance * 100 - (Date.now() - a.timestamp) / (1000 * 60 * 60 * 24);
        const scoreB = b.importance * 100 - (Date.now() - b.timestamp) / (1000 * 60 * 60 * 24);
        return scoreB - scoreA;
      });
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  serialize(): string {
    return JSON.stringify(this.entries);
  }

  deserialize(json: string): void {
    try {
      this.entries = JSON.parse(json);
    } catch {
      this.entries = [];
    }
  }

  get count(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
