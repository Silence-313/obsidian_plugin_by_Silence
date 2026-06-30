// ── Skill Registry ───────────────────────────────────────────
// Central registry for system-level skills.
// Skills are privileged system functions, distinct from tools.
// Tools = external world (web_search, todos)
// Skills = system capabilities (file I/O, location, OS)

// ── Types ───────────────────────────────────────────────────

export interface Skill {
  name: string;
  description: string;
  permissions: "safe" | "privileged";
  execute: (args: Record<string, unknown>, context: SkillContext) => Promise<SkillResult>;
}

export interface SkillContext {
  vault?: unknown;    // Obsidian Vault instance
  app?: unknown;      // Obsidian App instance
  vaultRoot?: string; // vault root path for path validation
}

export interface SkillResult {
  success: boolean;
  data: unknown;
  error?: string;
}

export interface SkillExecutionRecord {
  skillName: string;
  args: Record<string, unknown>;
  result: SkillResult;
  latencyMs: number;
  timestamp: number;
}

// ── Registry ────────────────────────────────────────────────

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private executionLog: SkillExecutionRecord[] = [];

  /**
   * Register a skill. Replaces any existing skill with the same name.
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Check if a skill is registered.
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Get a skill by name.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all registered skill names.
   */
  getSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Get all registered skills with their metadata.
   */
  getAll(): Array<{ name: string; description: string; permissions: string }> {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      permissions: s.permissions,
    }));
  }

  /**
   * Validate that a skill can be executed given the current context.
   * Privileged skills require vault context to be present.
   */
  validatePermissions(name: string, context: SkillContext): { allowed: boolean; reason?: string } {
    const skill = this.skills.get(name);
    if (!skill) {
      return { allowed: false, reason: `Skill "${name}" is not registered` };
    }

    if (skill.permissions === "privileged") {
      if (!context.vault && !context.app && !context.vaultRoot) {
        return { allowed: false, reason: `Skill "${name}" requires vault/app context but none provided` };
      }
    }

    return { allowed: true };
  }

  /**
   * Execute a skill by name with the given args and context.
   * Validates permissions before execution.
   */
  async execute(name: string, args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const permCheck = this.validatePermissions(name, context);
    if (!permCheck.allowed) {
      return { success: false, data: null, error: permCheck.reason };
    }

    const skill = this.skills.get(name);
    if (!skill) {
      return { success: false, data: null, error: `Unknown skill: ${name}` };
    }

    const startTime = Date.now();

    try {
      const result = await skill.execute(args, context);
      this.executionLog.push({
        skillName: name,
        args,
        result,
        latencyMs: Date.now() - startTime,
        timestamp: Date.now(),
      });
      return result;
    } catch (e: any) {
      const errorResult: SkillResult = {
        success: false,
        data: null,
        error: e?.message || String(e),
      };
      this.executionLog.push({
        skillName: name,
        args,
        result: errorResult,
        latencyMs: Date.now() - startTime,
        timestamp: Date.now(),
      });
      return errorResult;
    }
  }

  /**
   * Get execution history.
   */
  getExecutionLog(): ReadonlyArray<SkillExecutionRecord> {
    return this.executionLog;
  }

  /**
   * Clear execution log.
   */
  clearLog(): void {
    this.executionLog = [];
  }
}
