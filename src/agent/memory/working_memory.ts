// ── Working Memory ──────────────────────────────────────────
// Short-term: last N messages of the current conversation.
// In-memory only, not persisted.

export interface WorkingMemoryEntry {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: number;
}

export class WorkingMemory {
  private capacity: number;
  private messages: WorkingMemoryEntry[] = [];

  constructor(capacity: number = 20) {
    this.capacity = capacity;
  }

  push(entry: WorkingMemoryEntry): void {
    this.messages.push(entry);
    // Trim to capacity
    if (this.messages.length > this.capacity) {
      this.messages = this.messages.slice(-this.capacity);
    }
  }

  getAll(): WorkingMemoryEntry[] {
    return [...this.messages];
  }

  getLast(n: number): WorkingMemoryEntry[] {
    return this.messages.slice(-n);
  }

  getByRole(role: string): WorkingMemoryEntry[] {
    return this.messages.filter(m => m.role === role);
  }

  getRecentContext(maxTokens: number = 4000): string {
    const recent = this.getLast(15);
    let context = "";
    for (const m of recent) {
      context += `[${m.role}] ${m.content}\n`;
      if (context.length > maxTokens * 3) break; // rough estimate
    }
    return context;
  }

  clear(): void {
    this.messages = [];
  }

  get count(): number {
    return this.messages.length;
  }
}
