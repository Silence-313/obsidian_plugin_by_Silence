// ── Markdown Memory Store ────────────────────────────────────
// Human-readable, vault-native memory persistence.
// Episodic entries → individual .md files with YAML frontmatter.
// User profile → profile.md with YAML frontmatter.
// INDEX.md → auto-generated directory of all episodic entries.
//
// Dual-write: JSON system continues unchanged; this mirrors to
// markdown so the user can see, search, and edit their memory.

import type { Vault } from "obsidian";
import type { EpisodicEntry } from "./episodic_memory";
import type { UserProfileData } from "./user_profile";

const MEMORY_BASE = "agent-memory";
const EPISODES_DIR = "episodes";

// ── YAML Frontmatter Helpers ────────────────────────────────

function escapeYamlValue(v: string): string {
  if (/[:"{}#&*!|>'%@`[\],\n]/.test(v) || v.includes("  ")) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return v;
}

function formatYamlFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${escapeYamlValue(String(item))}`);
        }
      }
    } else if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${escapeYamlValue(String(value))}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function parseYamlFrontmatter(content: string): { fields: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const yamlBlock = match[1];
  const body = match[2] || "";
  const fields: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");

  let currentArrayKey: string | null = null;

  for (const line of lines) {
    const arrayMatch = line.match(/^\s{2}-\s+(.+)$/);
    if (arrayMatch && currentArrayKey) {
      let val = arrayMatch[1].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      const arr = fields[currentArrayKey] as string[];
      arr.push(val);
      continue;
    }

    currentArrayKey = null;
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):(?:\s+(.+))?$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = (kvMatch[2] || "").trim();

    if (rawValue === "[]") {
      fields[key] = [];
      currentArrayKey = null;
    } else if (rawValue === "") {
      // Start of an array (next lines will be "- items")
      fields[key] = [];
      currentArrayKey = key;
    } else if (rawValue === "true") {
      fields[key] = true;
    } else if (rawValue === "false") {
      fields[key] = false;
    } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      fields[key] = parseFloat(rawValue);
    } else {
      let val = rawValue;
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n");
      }
      fields[key] = val;
    }
  }

  return { fields, body };
}

// ── Concept Data ────────────────────────────────────────────

export interface ConceptData {
  id: string;
  name: string;
  slug: string;
  tags: string[];
  related: string[];         // slugs of related concepts
  sourceEpisodes: string[];  // episode file names (not full paths)
  definition: string;
  created: number;
  updated: number;
  confidence: number;        // extraction confidence 0..1
}

// ── MarkdownMemoryStore ─────────────────────────────────────

export class MarkdownMemoryStore {
  private vault: Vault;
  private basePath: string;

  constructor(vault: Vault, basePath?: string) {
    this.vault = vault;
    this.basePath = basePath || MEMORY_BASE;
  }

  // ── Path helpers ──────────────────────────────────────────

  private get episodesDir(): string {
    return `${this.basePath}/${EPISODES_DIR}`;
  }

  private get conceptsDir(): string {
    return `${this.basePath}/concepts`;
  }

  private get profilePath(): string {
    return `${this.basePath}/profile.md`;
  }

  private get indexPath(): string {
    return `${this.basePath}/INDEX.md`;
  }

  // ── Directory helpers ─────────────────────────────────────

  private async ensureDir(dirPath: string): Promise<void> {
    const parts = dirPath.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join("/");
      if (!(await this.vault.adapter.exists(sub))) {
        await this.vault.adapter.mkdir(sub);
      }
    }
  }

  // ── Episode file naming ───────────────────────────────────

  episodeFileName(entry: EpisodicEntry): string {
    const d = new Date(entry.timestamp);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const typeStr = entry.type;
    const summary = (entry.summary || "memory")
      .replace(/[<>:"/\\|?*#\[\]\n\r]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 40);
    const idShort = entry.id.slice(-6);
    return `${dateStr}-${typeStr}-${summary}-${idShort}.md`;
  }

  private episodeFilePath(entry: EpisodicEntry): string {
    return `${this.episodesDir}/${this.episodeFileName(entry)}`;
  }

  // ── Episodic: Format markdown ─────────────────────────────

  private formatEpisodeMarkdown(entry: EpisodicEntry): string {
    const fm = formatYamlFrontmatter({
      id: entry.id,
      type: entry.type,
      timestamp: new Date(entry.timestamp).toISOString(),
      importance: entry.importanceScore ?? entry.importance,
      importanceScore: entry.importanceScore ?? entry.importance,
      usageFrequency: entry.usageFrequency ?? 0,
      decayScore: entry.decayScore ?? 1.0,
      usefulnessScore: entry.usefulnessScore ?? 0.5,
      tags: entry.tags,
      relatedFiles: entry.relatedFiles,
      markedForRemoval: entry.markedForRemoval ?? false,
      source: "agent",
    });

    const body = `# ${entry.summary || "Memory Entry"}

## Summary
${entry.summary || "(no summary)"}

## Detail
${entry.detail || "(no detail)"}

## Meta
- **Type**: ${entry.type}
- **Importance**: ${entry.importanceScore ?? entry.importance}
- **Tags**: ${entry.tags.length > 0 ? entry.tags.join(", ") : "none"}
- **Date**: ${new Date(entry.timestamp).toLocaleDateString("zh-CN")}
`;

    return `${fm}\n\n${body}`;
  }

  // ── Episodic: Parse markdown ──────────────────────────────

  private parseEpisodeMarkdown(content: string): EpisodicEntry | null {
    const parsed = parseYamlFrontmatter(content);
    if (!parsed) return null;

    const f = parsed.fields;
    if (!f.id || !f.type) return null;

    // Extract summary and detail from body
    let summary = "";
    let detail = "";

    const summaryMatch = parsed.body.match(/## Summary\n([\s\S]*?)(?=\n## |$)/);
    if (summaryMatch) summary = summaryMatch[1].trim();

    const detailMatch = parsed.body.match(/## Detail\n([\s\S]*?)(?=\n## |$)/);
    if (detailMatch) detail = detailMatch[1].trim();

    return {
      id: String(f.id),
      timestamp: typeof f.timestamp === "string"
        ? new Date(f.timestamp).getTime()
        : (typeof f.timestamp === "number" ? f.timestamp : Date.now()),
      type: String(f.type) as EpisodicEntry["type"],
      summary: summary || String(f.summary || ""),
      detail: detail || String(f.detail || ""),
      importance: typeof f.importance === "number" ? f.importance : 0.5,
      tags: Array.isArray(f.tags) ? f.tags.map(String) : [],
      relatedFiles: Array.isArray(f.relatedFiles) ? f.relatedFiles.map(String) : [],
      importanceScore: typeof f.importanceScore === "number" ? f.importanceScore : undefined,
      usageFrequency: typeof f.usageFrequency === "number" ? f.usageFrequency : 0,
      lastAccessTime: typeof f.lastAccessTime === "number" ? f.lastAccessTime : undefined,
      decayScore: typeof f.decayScore === "number" ? f.decayScore : undefined,
      usefulnessScore: typeof f.usefulnessScore === "number" ? f.usefulnessScore : undefined,
      markedForRemoval: f.markedForRemoval === true,
    };
  }

  // ── Episodic: Load all ────────────────────────────────────

  async loadEpisodicEntries(): Promise<EpisodicEntry[]> {
    const dir = this.episodesDir;
    const exists = await this.vault.adapter.exists(dir);
    if (!exists) return [];

    const allFiles = this.vault.getFiles();
    const episodeFiles = allFiles.filter(
      f => f.path.startsWith(dir + "/") && f.extension === "md"
    );

    const entries: EpisodicEntry[] = [];
    for (const file of episodeFiles) {
      try {
        const content = await this.vault.read(file);
        const entry = this.parseEpisodeMarkdown(content);
        if (entry) entries.push(entry);
      } catch { /* skip corrupt files */ }
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  }

  // ── Episodic: Full sync (create / update / delete) ────────

  async syncEpisodicEntries(entries: EpisodicEntry[]): Promise<void> {
    await this.ensureDir(this.episodesDir);

    const allFiles = this.vault.getFiles();
    const dir = this.episodesDir;
    const existingFiles = allFiles.filter(
      f => f.path.startsWith(dir + "/") && f.extension === "md"
    );

    // Build ID → path map from existing markdown files
    const existingIdToPath = new Map<string, string>();
    for (const file of existingFiles) {
      try {
        const content = await this.vault.read(file);
        const parsed = parseYamlFrontmatter(content);
        if (parsed?.fields?.id) {
          existingIdToPath.set(String(parsed.fields.id), file.path);
        }
      } catch { /* skip */ }
    }

    // Set of IDs we are writing
    const entryIds = new Set(entries.map(e => e.id));

    // Delete files for entries that no longer exist (merged / pruned)
    for (const [id, path] of existingIdToPath) {
      if (!entryIds.has(id)) {
        try {
          const file = allFiles.find(f => f.path === path);
          if (file) await this.vault.delete(file);
        } catch { /* file might already be gone */ }
      }
    }

    // Write / update each entry
    const usedPaths = new Set<string>();
    for (const entry of entries) {
      const md = this.formatEpisodeMarkdown(entry);
      const existingPath = existingIdToPath.get(entry.id);
      const newPath = this.episodeFilePath(entry);

      // Resolve potential path conflict
      let resolvedPath = existingPath || newPath;
      if (!existingPath) {
        let candidate = newPath;
        let counter = 1;
        while (usedPaths.has(candidate) || allFiles.some(f => f.path === candidate)) {
          const base = candidate.replace(/\.md$/, "");
          candidate = `${base}-${counter}.md`;
          counter++;
        }
        resolvedPath = candidate;
      }
      usedPaths.add(resolvedPath);

      if (existingPath) {
        const file = allFiles.find(f => f.path === existingPath);
        if (file) {
          await this.vault.modify(file, md);
        } else {
          // File was deleted externally, create new
          await this.vault.create(resolvedPath, md);
        }
      } else {
        await this.vault.create(resolvedPath, md);
      }
    }

    // Rebuild INDEX.md
    await this.rebuildIndex(entries);
  }

  // ── Single episode write (for immediate commits) ──────────

  async writeEpisode(entry: EpisodicEntry): Promise<void> {
    await this.ensureDir(this.episodesDir);

    const md = this.formatEpisodeMarkdown(entry);
    const path = this.episodeFilePath(entry);

    // Check if this entry already has a file (by ID scan)
    const allFiles = this.vault.getFiles();
    let existingPath: string | null = null;
    for (const f of allFiles) {
      if (!f.path.startsWith(this.episodesDir + "/") || f.extension !== "md") continue;
      try {
        const content = await this.vault.read(f);
        const parsed = parseYamlFrontmatter(content);
        if (parsed?.fields?.id === entry.id) {
          existingPath = f.path;
          break;
        }
      } catch { /* */ }
    }

    if (existingPath) {
      const file = allFiles.find(f => f.path === existingPath);
      if (file) {
        await this.vault.modify(file, md);
        return;
      }
    }

    // Resolve filename conflicts
    let resolved = path;
    let counter = 1;
    while (allFiles.some(f => f.path === resolved)) {
      const base = path.replace(/\.md$/, "");
      resolved = `${base}-${counter}.md`;
      counter++;
    }
    await this.vault.create(resolved, md);
  }

  // ── Profile ───────────────────────────────────────────────

  async saveProfile(profile: UserProfileData): Promise<void> {
    await this.ensureDir(this.basePath);

    const fm = formatYamlFrontmatter({
      name: profile.name || "",
      preferredName: profile.preferredName || "",
      role: profile.role || "",
      timezone: profile.timezone || "Asia/Shanghai",
      language: profile.language || "zh-CN",
      interests: profile.interests,
      expertise: profile.expertise,
      workHabits: profile.workHabits,
      activeProjects: profile.activeProjects,
      commonTools: profile.commonTools,
      responseStyle: profile.responseStyle || "concise",
      preferredFormat: profile.preferredFormat || "mixed",
      currentFocus: profile.currentFocus,
      longTermGoals: profile.longTermGoals,
      lastUpdated: profile.lastUpdated
        ? new Date(profile.lastUpdated).toISOString()
        : "",
      source: "agent",
    });

    const confidenceSection = Object.keys(profile.confidenceScores).length > 0
      ? `\n## Confidence Scores\n${Object.entries(profile.confidenceScores)
        .map(([k, v]) => `- **${k}**: ${Math.round(v * 100)}%`)
        .join("\n")}\n`
      : "";

    const body = `# 用户画像

> Auto-generated by Agent from conversation analysis.
> Last updated: ${profile.lastUpdated ? new Date(profile.lastUpdated).toLocaleString("zh-CN") : "never"}

## 基本信息
- **称呼**: ${profile.preferredName || profile.name || "(unknown)"}
- **角色**: ${profile.role || "(unknown)"}
- **时区**: ${profile.timezone || "Asia/Shanghai"}
- **语言**: ${profile.language || "zh-CN"}

## 兴趣与专长
${profile.interests.length > 0 ? profile.interests.map(i => `- ${i}`).join("\n") : "- (暂无信息)"}
${profile.expertise.length > 0 ? "\n### 专长\n" + profile.expertise.map(e => `- ${e}`).join("\n") : ""}

## 工作习惯
${profile.workHabits.length > 0 ? profile.workHabits.map(h => `- ${h}`).join("\n") : "- (暂无信息)"}

## 常用工具
${profile.commonTools.length > 0 ? profile.commonTools.map(t => `- ${t}`).join("\n") : "- (暂无信息)"}

## 活跃项目
${profile.activeProjects.length > 0 ? profile.activeProjects.map(p => `- ${p}`).join("\n") : "- (暂无信息)"}

## 当前关注
${profile.currentFocus.length > 0 ? profile.currentFocus.map(f => `- ${f}`).join("\n") : "- (暂无信息)"}

## 长期目标
${profile.longTermGoals.length > 0 ? profile.longTermGoals.map(g => `- ${g}`).join("\n") : "- (暂无信息)"}

## 沟通偏好
- **风格**: ${profile.responseStyle || "concise"}
- **格式**: ${profile.preferredFormat || "mixed"}
${confidenceSection}`;

    const content = `${fm}\n\n${body}`;

    const allFiles = this.vault.getFiles();
    const existing = allFiles.find(f => f.path === this.profilePath);
    if (existing) {
      await this.vault.modify(existing, content);
    } else {
      await this.vault.create(this.profilePath, content);
    }
  }

  async loadProfile(): Promise<UserProfileData | null> {
    const allFiles = this.vault.getFiles();
    const file = allFiles.find(f => f.path === this.profilePath);
    if (!file) return null;

    try {
      const content = await this.vault.read(file);
      const parsed = parseYamlFrontmatter(content);
      if (!parsed) return null;

      const f = parsed.fields;
      return {
        name: String(f.name || ""),
        preferredName: String(f.preferredName || f.name || ""),
        role: String(f.role || ""),
        timezone: String(f.timezone || "Asia/Shanghai"),
        language: String(f.language || "zh-CN"),
        interests: Array.isArray(f.interests) ? f.interests.map(String) : [],
        expertise: Array.isArray(f.expertise) ? f.expertise.map(String) : [],
        workHabits: Array.isArray(f.workHabits) ? f.workHabits.map(String) : [],
        activeProjects: Array.isArray(f.activeProjects) ? f.activeProjects.map(String) : [],
        commonTools: Array.isArray(f.commonTools) ? f.commonTools.map(String) : [],
        responseStyle: (String(f.responseStyle || "concise")) as UserProfileData["responseStyle"],
        preferredFormat: (String(f.preferredFormat || "mixed")) as UserProfileData["preferredFormat"],
        currentFocus: Array.isArray(f.currentFocus) ? f.currentFocus.map(String) : [],
        longTermGoals: Array.isArray(f.longTermGoals) ? f.longTermGoals.map(String) : [],
        lastUpdated: typeof f.lastUpdated === "string"
          ? new Date(f.lastUpdated).getTime()
          : (typeof f.lastUpdated === "number" ? f.lastUpdated : Date.now()),
        confidenceScores: {},
      };
    } catch {
      return null;
    }
  }

  // ── INDEX.md generation ───────────────────────────────────

  async rebuildIndex(entries: EpisodicEntry[]): Promise<void> {
    await this.ensureDir(this.basePath);

    const active = entries.filter(e => !e.markedForRemoval);
    const byType: Record<string, EpisodicEntry[]> = {};
    for (const e of active) {
      const t = e.type || "event";
      if (!byType[t]) byType[t] = [];
      byType[t].push(e);
    }

    // Load concept stats
    const concepts = await this.loadConcepts();
    const conceptStats = concepts.length > 0
      ? `\n- **Concepts**: ${concepts.length} extracted`
      : "";

    let body = `# Agent Memory Index

> Auto-generated. Last rebuilt: ${new Date().toLocaleString("zh-CN")}
> Total entries: ${active.length} active (${entries.length - active.length} marked for removal)${conceptStats}

## Statistics
${Object.entries(byType).map(([type, items]) => `- **${type}**: ${items.length} entries`).join("\n")}

## Recent Entries
${active.slice(0, 20).map(e => {
  const d = new Date(e.timestamp);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `- [[${this.episodeFileName(e)}|${dateStr}]] — ${e.summary.substring(0, 80)}`;
}).join("\n")}

`;

    // Per-type sections
    for (const [type, items] of Object.entries(byType)) {
      body += `\n## ${type} (${items.length})\n`;
      for (const e of items.slice(0, 30)) {
        const d = new Date(e.timestamp);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        body += `- [[${this.episodeFileName(e)}|${dateStr}]] — ${e.summary.substring(0, 80)} [importance: ${((e.importanceScore ?? e.importance) * 100).toFixed(0)}%]\n`;
      }
      if (items.length > 30) body += `- ... and ${items.length - 30} more\n`;
    }

    // Concepts section — lightweight knowledge graph
    if (concepts.length > 0) {
      body += `\n## Concepts (${concepts.length})\n`;
      // Group concepts by source episode count
      const sorted = [...concepts].sort((a, b) => b.sourceEpisodes.length - a.sourceEpisodes.length);
      for (const c of sorted.slice(0, 20)) {
        body += `- [[${c.slug}]] — ${c.name} (${c.sourceEpisodes.length} episodes, confidence: ${Math.round(c.confidence * 100)}%)\n`;
      }
      if (concepts.length > 20) body += `- ... and ${concepts.length - 20} more concepts\n`;

      // Related concept clusters (concepts that share source episodes)
      const clusterPairs: Array<[string, string]> = [];
      for (let i = 0; i < concepts.length; i++) {
        for (let j = i + 1; j < concepts.length; j++) {
          const shared = concepts[i].sourceEpisodes.filter(e =>
            concepts[j].sourceEpisodes.includes(e)
          );
          if (shared.length >= 2) {
            clusterPairs.push([concepts[i].slug, concepts[j].slug]);
          }
        }
      }
      if (clusterPairs.length > 0) {
        body += `\n### Related Concept Clusters\n`;
        for (const [a, b] of clusterPairs.slice(0, 10)) {
          body += `- [[${a}]] ↔ [[${b}]]\n`;
        }
      }
    }

    const allFiles = this.vault.getFiles();
    const existing = allFiles.find(f => f.path === this.indexPath);
    if (existing) {
      await this.vault.modify(existing, body);
    } else {
      await this.vault.create(this.indexPath, body);
    }
  }

  // ── Mark deleted episode ──────────────────────────────────

  async markEpisodeRemoved(entryId: string): Promise<void> {
    const allFiles = this.vault.getFiles();
    for (const f of allFiles) {
      if (!f.path.startsWith(this.episodesDir + "/") || f.extension !== "md") continue;
      try {
        const content = await this.vault.read(f);
        const parsed = parseYamlFrontmatter(content);
        if (parsed?.fields?.id === entryId) {
          // Update frontmatter to mark as removed
          parsed.fields.markedForRemoval = true;
          parsed.fields.importanceScore = 0;
          const newFm = formatYamlFrontmatter(parsed.fields);
          const newContent = content.replace(/^---\n[\s\S]*?\n---/, newFm);
          await this.vault.modify(f, newContent);
          return;
        }
      } catch { /* */ }
    }
  }

  // ── Concept Storage ───────────────────────────────────────

  private conceptFileName(slug: string): string {
    return `${slug}.md`;
  }

  private conceptFilePath(slug: string): string {
    return `${this.conceptsDir}/${this.conceptFileName(slug)}`;
  }

  private formatConceptMarkdown(concept: ConceptData): string {
    const fm = formatYamlFrontmatter({
      id: concept.id,
      name: concept.name,
      slug: concept.slug,
      tags: concept.tags,
      related: concept.related,
      sourceEpisodes: concept.sourceEpisodes,
      confidence: concept.confidence,
      created: new Date(concept.created).toISOString(),
      updated: new Date(concept.updated).toISOString(),
      type: "concept",
      source: "agent",
    });

    const relatedLinks = concept.related.length > 0
      ? `\n## Related Concepts\n${concept.related.map(r => `- [[${r}]]`).join("\n")}\n`
      : "";

    const episodeLinks = concept.sourceEpisodes.length > 0
      ? `\n## Source Episodes\n${concept.sourceEpisodes.map(e => `- [[${e}]]`).join("\n")}\n`
      : "";

    const body = `# ${concept.name}

> Auto-extracted concept. Confidence: ${Math.round(concept.confidence * 100)}%

## Definition
${concept.definition || "(to be defined)"}
${relatedLinks}${episodeLinks}
## Meta
- **Created**: ${new Date(concept.created).toLocaleDateString("zh-CN")}
- **Updated**: ${new Date(concept.updated).toLocaleDateString("zh-CN")}
- **Tags**: ${concept.tags.length > 0 ? concept.tags.join(", ") : "concept"}
`;

    return `${fm}\n\n${body}`;
  }

  private parseConceptMarkdown(content: string): ConceptData | null {
    const parsed = parseYamlFrontmatter(content);
    if (!parsed || !parsed.fields.slug) return null;

    const f = parsed.fields;

    // Extract definition from body
    let definition = "";
    const defMatch = parsed.body.match(/## Definition\n([\s\S]*?)(?=\n## |$)/);
    if (defMatch) definition = defMatch[1].trim();

    return {
      id: String(f.id || ""),
      name: String(f.name || f.slug || ""),
      slug: String(f.slug),
      tags: Array.isArray(f.tags) ? f.tags.map(String) : [],
      related: Array.isArray(f.related) ? f.related.map(String) : [],
      sourceEpisodes: Array.isArray(f.sourceEpisodes) ? f.sourceEpisodes.map(String) : [],
      definition,
      created: typeof f.created === "string"
        ? new Date(f.created).getTime()
        : (typeof f.created === "number" ? f.created : Date.now()),
      updated: typeof f.updated === "string"
        ? new Date(f.updated).getTime()
        : (typeof f.updated === "number" ? f.updated : Date.now()),
      confidence: typeof f.confidence === "number" ? f.confidence : 0.5,
    };
  }

  /**
   * Write or update a concept file.
   * If the concept already exists, merge: preserve definition, add new episodes, update tags.
   */
  async writeConcept(concept: ConceptData): Promise<void> {
    await this.ensureDir(this.conceptsDir);

    const existing = await this.loadConceptBySlug(concept.slug);
    let merged: ConceptData;

    if (existing) {
      // Merge: keep existing definition if new one is empty
      // Add new source episodes, merge related concepts, update confidence
      merged = {
        ...existing,
        name: concept.name || existing.name,
        definition: concept.definition || existing.definition,
        tags: [...new Set([...existing.tags, ...concept.tags])],
        related: [...new Set([...existing.related, ...concept.related])],
        sourceEpisodes: [...new Set([...existing.sourceEpisodes, ...concept.sourceEpisodes])],
        confidence: Math.max(existing.confidence, concept.confidence),
        updated: Date.now(),
      };
    } else {
      merged = { ...concept, updated: concept.updated || Date.now() };
    }

    const md = this.formatConceptMarkdown(merged);
    const path = this.conceptFilePath(concept.slug);

    const allFiles = this.vault.getFiles();
    const file = allFiles.find(f => f.path === path);
    if (file) {
      await this.vault.modify(file, md);
    } else {
      await this.vault.create(path, md);
    }
  }

  /**
   * Load all concepts from the concepts directory.
   */
  async loadConcepts(): Promise<ConceptData[]> {
    const dir = this.conceptsDir;
    const exists = await this.vault.adapter.exists(dir);
    if (!exists) return [];

    const allFiles = this.vault.getFiles();
    const conceptFiles = allFiles.filter(
      f => f.path.startsWith(dir + "/") && f.extension === "md"
    );

    const concepts: ConceptData[] = [];
    for (const file of conceptFiles) {
      try {
        const content = await this.vault.read(file);
        const concept = this.parseConceptMarkdown(content);
        if (concept) concepts.push(concept);
      } catch { /* skip corrupt files */ }
    }

    return concepts;
  }

  /**
   * Load a single concept by its slug.
   */
  async loadConceptBySlug(slug: string): Promise<ConceptData | null> {
    const path = this.conceptFilePath(slug);
    const allFiles = this.vault.getFiles();
    const file = allFiles.find(f => f.path === path);
    if (!file) return null;

    try {
      const content = await this.vault.read(file);
      return this.parseConceptMarkdown(content);
    } catch {
      return null;
    }
  }

  /**
   * Get all known concept slugs (for existing-concept matching).
   */
  async getAllConceptSlugs(): Promise<string[]> {
    const concepts = await this.loadConcepts();
    return concepts.map(c => c.slug);
  }

  /**
   * Update an episode file to include concept wikilinks.
   * Appends a "## Concepts" section at the end of the body.
   */
  async updateEpisodeConceptLinks(entryId: string, conceptSlugs: string[]): Promise<void> {
    if (conceptSlugs.length === 0) return;

    const allFiles = this.vault.getFiles();
    for (const f of allFiles) {
      if (!f.path.startsWith(this.episodesDir + "/") || f.extension !== "md") continue;
      try {
        const content = await this.vault.read(f);
        const parsed = parseYamlFrontmatter(content);
        if (!parsed || parsed.fields.id !== entryId) continue;

        // Remove any existing Concepts section, then append new one
        let body = parsed.body.replace(/\n## Concepts\n[\s\S]*$/, "").trimEnd();

        const links = conceptSlugs.map(s => `- [[${s}]]`).join("\n");
        body += `\n\n## Concepts\n${links}\n`;

        // Rebuild with same frontmatter
        const fm = formatYamlFrontmatter(parsed.fields);
        const newContent = `${fm}\n\n${body}`;

        await this.vault.modify(f, newContent);
        return;
      } catch { /* */ }
    }
  }

  /**
   * Append an episode backlink to a concept file.
   */
  async appendEpisodeBacklink(conceptSlug: string, episodeFileName: string): Promise<void> {
    const path = this.conceptFilePath(conceptSlug);
    const allFiles = this.vault.getFiles();
    const file = allFiles.find(f => f.path === path);
    if (!file) return;

    try {
      const content = await this.vault.read(file);
      const concept = this.parseConceptMarkdown(content);
      if (!concept) return;

      // Check if episode already linked
      if (concept.sourceEpisodes.includes(episodeFileName)) return;

      concept.sourceEpisodes = [...concept.sourceEpisodes, episodeFileName];
      concept.updated = Date.now();
      const md = this.formatConceptMarkdown(concept);
      await this.vault.modify(file, md);
    } catch { /* best-effort */ }
  }

  // ── Reasoning Trace Storage ───────────────────────────────

  private get reasoningDir(): string {
    return `${this.basePath}/reasoning`;
  }

  /**
   * Save a reasoning trace as a markdown file.
   */
  async saveReasoningTrace(trace: {
    id: string; timestamp: number; query: string;
    keyConcepts: string[]; conceptNames: string[];
    insights: string[]; contradictions: string[];
    bridgingConcepts: string[]; confidence: number;
  }): Promise<void> {
    await this.ensureDir(this.reasoningDir);

    const fm = formatYamlFrontmatter({
      id: trace.id,
      timestamp: new Date(trace.timestamp).toISOString(),
      query: trace.query,
      keyConcepts: trace.keyConcepts,
      confidence: trace.confidence,
      type: "reasoning-trace",
    });

    const body = `# Reasoning Trace

## Query
${trace.query}

## Key Concepts
${trace.keyConcepts.length > 0 ? trace.keyConcepts.map(c => `- ${c}`).join("\n") : "- (none)"}

## Inferred Insights
${trace.insights.length > 0 ? trace.insights.map(i => `- ${i}`).join("\n") : "- (none)"}

## Contradictions
${trace.contradictions.length > 0 ? trace.contradictions.map(c => `- ⚠ ${c}`).join("\n") : "- (none)"}

## Bridging Concepts
${trace.bridgingConcepts.length > 0 ? trace.bridgingConcepts.map(b => `- ${b}`).join("\n") : "- (none)"}

## Meta
- **Confidence**: ${Math.round(trace.confidence * 100)}%
- **Timestamp**: ${new Date(trace.timestamp).toLocaleString("zh-CN")}
`;

    const path = `${this.reasoningDir}/${trace.id}.md`;
    await this.vault.create(path, `${fm}\n\n${body}`);
  }

  /**
   * Load all reasoning traces from the reasoning directory.
   */
  async loadReasoningTraces(): Promise<Array<{
    id: string; timestamp: number; query: string;
    keyConcepts: string[]; insights: string[];
    contradictions: string[]; confidence: number;
  }>> {
    const dir = this.reasoningDir;
    const exists = await this.vault.adapter.exists(dir);
    if (!exists) return [];

    const allFiles = this.vault.getFiles();
    const traceFiles = allFiles.filter(
      f => f.path.startsWith(dir + "/") && f.extension === "md"
    );

    const traces: Array<{
      id: string; timestamp: number; query: string;
      keyConcepts: string[]; insights: string[];
      contradictions: string[]; confidence: number;
    }> = [];

    for (const file of traceFiles) {
      try {
        const content = await this.vault.read(file);
        const parsed = parseYamlFrontmatter(content);
        if (!parsed) continue;

        const f = parsed.fields;

        // Extract insights from body
        const insights: string[] = [];
        const insMatch = parsed.body.match(/## Inferred Insights\n([\s\S]*?)(?=\n## |$)/);
        if (insMatch) {
          for (const line of insMatch[1].split("\n")) {
            const m = line.match(/^- (.+)$/);
            if (m) insights.push(m[1].trim());
          }
        }

        const contradictions: string[] = [];
        const contraMatch = parsed.body.match(/## Contradictions\n([\s\S]*?)(?=\n## |$)/);
        if (contraMatch) {
          for (const line of contraMatch[1].split("\n")) {
            const m = line.match(/^- ⚠ (.+)$/);
            if (m) contradictions.push(m[1].trim());
          }
        }

        traces.push({
          id: String(f.id || ""),
          timestamp: typeof f.timestamp === "string"
            ? new Date(f.timestamp).getTime()
            : (typeof f.timestamp === "number" ? f.timestamp : 0),
          query: String(f.query || ""),
          keyConcepts: Array.isArray(f.keyConcepts) ? f.keyConcepts.map(String) : [],
          insights,
          contradictions,
          confidence: typeof f.confidence === "number" ? f.confidence : 0.5,
        });
      } catch { /* skip corrupt files */ }
    }

    return traces.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ── Concept Weight Adjustment ─────────────────────────────

  /**
   * Adjust a concept's confidence and importance weights.
   * Clamped to ±0.05 per update. Finds concept by name or slug.
   */
  async adjustConceptWeight(
    nameOrSlug: string,
    opts: {
      confidenceDelta: number;
      importanceDelta: number;
      reason: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const allFiles = this.vault.getFiles();
    const dir = this.conceptsDir;

    for (const f of allFiles) {
      if (!f.path.startsWith(dir + "/") || f.extension !== "md") continue;
      try {
        const content = await this.vault.read(f);
        const concept = this.parseConceptMarkdown(content);
        if (!concept) continue;

        // Match by slug or name
        if (concept.slug !== nameOrSlug && concept.name !== nameOrSlug) continue;

        // Clamp deltas
        const maxDelta = 0.05;
        const cDelta = Math.max(-maxDelta, Math.min(maxDelta, opts.confidenceDelta));
        const iDelta = Math.max(-maxDelta, Math.min(maxDelta, opts.importanceDelta));

        // Update confidence
        const newConfidence = Math.max(0.05, Math.min(1, concept.confidence + cDelta));
        concept.confidence = Math.round(newConfidence * 10000) / 10000;

        // Store metadata
        if (opts.metadata) {
          concept.tags = [...new Set([...concept.tags, ...Object.keys(opts.metadata)])];
        }

        concept.updated = Date.now();

        const md = this.formatConceptMarkdown(concept);
        await this.vault.modify(f, md);
        return;
      } catch { /* */ }
    }
  }

  /**
   * Mark a relationship between two concepts as unstable.
   * Adds an "unstable" tag and records the conflicting partner.
   */
  async markRelationshipUnstable(nameA: string, nameB: string): Promise<void> {
    for (const name of [nameA, nameB]) {
      await this.adjustConceptWeight(name, {
        confidenceDelta: -0.02,
        importanceDelta: 0,
        reason: `unstable-relationship: ${nameA} ↔ ${nameB}`,
        metadata: { unstableRelationship: true },
      });
    }
  }

  /**
   * Merge source concept into target concept.
   * Target absorbs source's episodes, tags, and related concepts.
   * Source is marked as merged (confidence set to 0, tags updated).
   */
  async mergeConcepts(sourceSlug: string, targetSlug: string): Promise<void> {
    const source = await this.loadConceptBySlug(sourceSlug);
    const target = await this.loadConceptBySlug(targetSlug);
    if (!source || !target) return;

    // Merge into target
    target.sourceEpisodes = [...new Set([...target.sourceEpisodes, ...source.sourceEpisodes])];
    target.tags = [...new Set([...target.tags, ...source.tags, "merged"])];
    target.related = [...new Set([...target.related, ...source.related])]
      .filter(r => r !== sourceSlug && r !== targetSlug);
    target.definition = target.definition
      ? `${target.definition}\n\n> Merged with concept "${source.name}" (was: ${source.definition || "no definition"})`
      : source.definition;
    target.confidence = Math.max(target.confidence, source.confidence);
    target.updated = Date.now();

    await this.writeConcept(target);

    // Mark source as merged
    source.tags = [...new Set([...source.tags, "merged-into", targetSlug])];
    source.confidence = 0.05;
    source.updated = Date.now();
    await this.writeConcept(source);
  }

  // ── Cognitive Policy Storage ──────────────────────────────

  private get policyDir(): string {
    return `${this.basePath}/policy`;
  }

  private get policyPath(): string {
    return `${this.policyDir}/cognitive_policy.json`;
  }

  /**
   * Load cognitive policy from JSON file.
   */
  async loadCognitivePolicy(): Promise<Record<string, unknown> | null> {
    const exists = await this.vault.adapter.exists(this.policyPath);
    if (!exists) return null;

    try {
      const allFiles = this.vault.getFiles();
      const file = allFiles.find(f => f.path === this.policyPath);
      if (!file) return null;
      const content = await this.vault.read(file);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Save cognitive policy to JSON file.
   */
  async saveCognitivePolicy(policy: Record<string, unknown>): Promise<void> {
    await this.ensureDir(this.policyDir);

    const content = JSON.stringify(policy, null, 2);
    const allFiles = this.vault.getFiles();
    const existing = allFiles.find(f => f.path === this.policyPath);
    if (existing) {
      await this.vault.modify(existing, content);
    } else {
      await this.vault.create(this.policyPath, content);
    }
  }

  // ── Tool Decision Storage ─────────────────────────────────

  private get toolDecisionsDir(): string {
    return `${this.basePath}/tool_decisions`;
  }

  /**
   * Save a tool decision log as markdown.
   */
  async saveToolDecision(decision: {
    id: string; timestamp: number; userQuery: string;
    useTool: boolean; toolName: string | null; confidence: number;
    reason: string; queryRewrite?: string; fallbackUsed: boolean;
    rawResponse: string; latencyMs: number;
  }): Promise<void> {
    await this.ensureDir(this.toolDecisionsDir);

    const fm = formatYamlFrontmatter({
      id: decision.id,
      timestamp: new Date(decision.timestamp).toISOString(),
      useTool: decision.useTool,
      toolName: decision.toolName || "none",
      confidence: decision.confidence,
      fallbackUsed: decision.fallbackUsed,
      type: "tool-decision",
    });

    const body = `# Tool Decision

## Query
${decision.userQuery}

## Decision
- **Use Tool**: ${decision.useTool}
- **Tool**: ${decision.toolName || "none"}
- **Confidence**: ${Math.round(decision.confidence * 100)}%
- **Reason**: ${decision.reason}
${decision.queryRewrite ? `- **Query Rewrite**: ${decision.queryRewrite}` : ""}

## Meta
- **Fallback**: ${decision.fallbackUsed}
- **Latency**: ${decision.latencyMs}ms
- **Timestamp**: ${new Date(decision.timestamp).toLocaleString("zh-CN")}

## Raw LLM Response
\`\`\`
${decision.rawResponse || "(empty)"}
\`\`\`
`;

    const path = `${this.toolDecisionsDir}/${decision.id}.md`;
    await this.vault.create(path, `${fm}\n\n${body}`);
  }

  // ── Utility ───────────────────────────────────────────────

  async isInitialized(): Promise<boolean> {
    return this.vault.adapter.exists(this.basePath);
  }

  get memoryBasePath(): string {
    return this.basePath;
  }

  get episodesDirectory(): string {
    return this.episodesDir;
  }
}
