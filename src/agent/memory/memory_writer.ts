// ── Memory Writer ───────────────────────────────────────────
// After every user interaction, classifies and stores relevant memories.
// Decides: what to store, memory type, importance, update vs append vs ignore.

import type { EpisodicMemory, EpisodicEntry } from "./episodic_memory";
import type { UserProfile } from "./user_profile";
import type { ToolMemory } from "./tool_memory";
import type { MarkdownMemoryStore } from "./memory_store";
import { ConceptExtractor } from "./concept_extractor";
import { consolidate, mergeMemories, type ScoredMemory } from "../system_evolution";

export interface MemoryWriteDecision {
  memoryType: "episodic" | "profile" | "tool" | "semantic" | "ignore";
  content: string;
  importance: number;
  tags: string[];
  action: "append" | "update" | "ignore";
  targetField?: string; // for profile updates
  confidence: number;
}

interface Interaction {
  userMessage: string;
  assistantResponse: string;
  toolUsed: string;
  toolResult: string;
  routerConfidence: number;
  timestamp: number;
  retrievalRelevanceScore?: number;
  answerImpactScore?: number;
}

export class MemoryWriter {
  private episodic: EpisodicMemory;
  private profile: UserProfile;
  private toolMemory: ToolMemory;
  private markdownStore?: MarkdownMemoryStore;
  private conceptExtractor: ConceptExtractor;

  constructor(
    episodic: EpisodicMemory,
    profile: UserProfile,
    toolMemory: ToolMemory,
    markdownStore?: MarkdownMemoryStore,
  ) {
    this.episodic = episodic;
    this.profile = profile;
    this.toolMemory = toolMemory;
    this.markdownStore = markdownStore;
    this.conceptExtractor = new ConceptExtractor();
  }

  /**
   * Analyze a completed interaction and produce memory write decisions.
   */
  analyze(interaction: Interaction): MemoryWriteDecision[] {
    const decisions: MemoryWriteDecision[] = [];

    // 1. Always check for profile-relevant info
    const profileDecisions = this.analyzeProfile(interaction);
    for (const pd of profileDecisions) {
      if (pd.action !== "ignore") {
        decisions.push(pd);
      }
    }

    // 2. Check for episodic events (goals, decisions, milestones)
    const episodicDecision = this.analyzeEpisodic(interaction);
    if (episodicDecision.action !== "ignore") {
      decisions.push(episodicDecision);
    }

    // 3. Check for semantic knowledge (facts worth remembering)
    const semanticDecision = this.analyzeSemantic(interaction);
    if (semanticDecision.action !== "ignore") {
      decisions.push(semanticDecision);
    }

    // 4. Tool usage tracking always records
    decisions.push({
      memoryType: "tool",
      content: `Tool: ${interaction.toolUsed}, confidence: ${interaction.routerConfidence}`,
      importance: 0.3,
      tags: ["tool-usage", interaction.toolUsed],
      action: "append",
      confidence: 1.0,
    });

    return decisions;
  }

  /**
   * Execute the memory write decisions.
   */
  commit(decisions: MemoryWriteDecision[], interaction: Interaction): void {
    for (const d of decisions) {
      switch (d.memoryType) {
        case "episodic":
          if (d.action === "append") {
            // Consolidation check: skip if similar memory exists
            const existingActive = this.episodic.getActiveEntries();
            const scoredExisting: ScoredMemory[] = existingActive.map(e => ({
              id: e.id,
              importanceScore: e.importanceScore ?? e.importance,
              usageFrequency: e.usageFrequency ?? 0,
              lastAccessTime: e.lastAccessTime ?? e.timestamp,
              decayScore: e.decayScore ?? 1.0,
              usefulnessScore: e.usefulnessScore ?? 0.5,
              markedForRemoval: e.markedForRemoval ?? false,
              content: `${e.summary} ${e.detail}`.substring(0, 500),
              tags: e.tags,
            }));

            const newScored: ScoredMemory = {
              id: "",
              importanceScore: d.importance,
              usageFrequency: 0,
              lastAccessTime: Date.now(),
              decayScore: 1.0,
              usefulnessScore: 0.5,
              markedForRemoval: false,
              content: d.content.substring(0, 500),
              tags: d.tags,
            };

            const consolidation = consolidate(newScored, scoredExisting);
            if (consolidation?.merged) {
              // Merge: reinforce existing instead of creating duplicate
              this.episodic.reinforce(consolidation.targetId, 0.02);
              break;
            }

            const entryType = this.classifyEpisodicType(interaction, d.tags);
            const newEntry = this.episodic.add({
              type: entryType,
              summary: d.content.substring(0, 200),
              detail: `User: ${interaction.userMessage.substring(0, 300)}\nAgent: ${interaction.assistantResponse.substring(0, 300)}`,
              importance: d.importance,
              tags: d.tags,
              relatedFiles: [],
              importanceScore: d.importance,
              usageFrequency: 0,
              lastAccessTime: Date.now(),
              decayScore: 1.0,
              usefulnessScore: 0.5,
              markedForRemoval: false,
            });
            // Immediate markdown write for new episodic entry
            if (this.markdownStore) {
              this.markdownStore.writeEpisode(newEntry).catch(() => { /* best-effort */ });
              // Concept extraction: surface key concepts from this episode
              this.extractAndLinkConcepts(newEntry).catch(() => { /* best-effort */ });
            }
          }
          break;

        case "profile":
          if (d.action === "update" && d.targetField) {
            const currentValue = this.profile.get(d.targetField as any);
            // For array fields, append. For scalar fields, update.
            if (Array.isArray(currentValue)) {
              this.profile.addToArray(d.targetField as any, d.content);
            } else {
              this.profile.set(d.targetField as any, d.content as any, d.confidence);
            }
          }
          break;

        case "semantic":
          // Store as episodic with "knowledge" type for now
          // Future: dedicated semantic memory store
          this.episodic.add({
            type: "event",
            summary: `[Knowledge] ${d.content.substring(0, 200)}`,
            detail: d.content,
            importance: d.importance,
            tags: [...d.tags, "semantic", "knowledge"],
            relatedFiles: [],
          });
          break;

        case "tool":
          // Tool tracking handled separately by ToolMemory.recordCall()
          break;

        case "ignore":
          break;
      }
    }
  }

  // ── Private Analyzers ─────────────────────────────────────

  private analyzeProfile(interaction: Interaction): MemoryWriteDecision[] {
    const { userMessage, assistantResponse } = interaction;
    const combined = `${userMessage} ${assistantResponse}`;

    const profilePatterns: Array<{
      regex: RegExp;
      field: string;
      weight: number;
    }> = [
      { regex: /(?:我叫|我的名字是|称呼我|请叫我)(.{1,20}?)(?:，|。|$|\.)/, field: "preferredName", weight: 0.9 },
      { regex: /(?:我是|我做|我是做|我是搞)(.{1,30}?)(?:的|，|。|$)/, field: "role", weight: 0.8 },
      { regex: /(?:我对|我喜欢|我感兴趣).{0,5}(.{1,30}?)(?:感兴趣|有研究|在做|，|。|$)/, field: "interests", weight: 0.7 },
      { regex: /(?:我擅长|我精通|我会|我熟悉)(.{1,30}?)(?:，|。|$)/, field: "expertise", weight: 0.8 },
      { regex: /(?:我在做|我在开发|我在写|我在弄|我的项目)(.{1,40}?)(?:，|。|$)/, field: "activeProjects", weight: 0.75 },
      { regex: /(?:我习惯|我一般|我通常|我喜欢用)(.{1,40}?)(?:，|。|$)/, field: "workHabits", weight: 0.6 },
      { regex: /(?:我用|我使用|我的工具)(.{1,30}?)(?:，|。|$|开发|写代码|编程)/, field: "commonTools", weight: 0.7 },
    ];

    // Collect ALL profile matches, not just the first one
    const decisions: MemoryWriteDecision[] = [];
    for (const pp of profilePatterns) {
      const match = combined.match(pp.regex);
      if (match) {
        const value = match[1].trim();
        if (value.length >= 1 && value.length <= 50) {
          decisions.push({
            memoryType: "profile",
            content: value,
            importance: pp.weight,
            tags: ["profile", pp.field],
            action: "update",
            targetField: pp.field,
            confidence: pp.weight,
          });
        }
      }
    }
    return decisions.length > 0 ? decisions : [{ memoryType: "profile", content: "", importance: 0, tags: [], action: "ignore", confidence: 0 }];
  }

  private analyzeEpisodic(interaction: Interaction): MemoryWriteDecision {
    const { userMessage, assistantResponse } = interaction;

    // Detect goals/decisions/milestones
    const goalPatterns = [
      /(?:我的目标是|目标是|我要|我想|我打算|我计划|目标)(.{1,60}?)(?:，|。|$)/,
      /(?:决定了|确定|定下来了|就这样)(.{1,40}?)(?:，|。|$)/,
      /(?:完成了|做完了|搞定了|实现了)(.{1,40}?)(?:，|。|$)/,
    ];

    for (const pattern of goalPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        const content = match[1].trim();
        if (content.length >= 3) {
          const isGoal = /目标|我要|我想|打算|计划/.test(match[0]);
          const isDecision = /决定|确定|定下来/.test(match[0]);
          const isMilestone = /完成|做完|搞定|实现/.test(match[0]);

          return {
            memoryType: "episodic",
            content,
            importance: isGoal ? 0.85 : isMilestone ? 0.9 : 0.7,
            tags: [isGoal ? "goal" : isDecision ? "decision" : "milestone"],
            action: "append",
            confidence: 0.8,
          };
        }
      }
    }

    // Check if this is a significant question (potential knowledge gap)
    if (userMessage.endsWith("?") || userMessage.endsWith("？") || /^(?:怎么|如何|为什么|什么是)/.test(userMessage)) {
      return {
        memoryType: "episodic",
        content: userMessage.substring(0, 200),
        importance: 0.5,
        tags: ["question"],
        action: "append",
        confidence: 0.6,
      };
    }

    return { memoryType: "episodic", content: "", importance: 0, tags: [], action: "ignore", confidence: 0 };
  }

  private analyzeSemantic(interaction: Interaction): MemoryWriteDecision {
    const { userMessage, assistantResponse } = interaction;

    // Extract factual statements worth remembering
    const factPatterns = [
      /(?:其实|实际上|事实是|真相是)(.{1,80}?)(?:，|。|$)/,
      /(?:根据|按照|参考).{0,10}(.{1,60}?)(?:，|。|$)/,
      /(?:笔记里写了|之前记录过|我记得)(.{1,60}?)(?:，|。|$)/,
    ];

    for (const pattern of factPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        const content = match[1].trim();
        if (content.length >= 5) {
          return {
            memoryType: "semantic",
            content,
            importance: 0.6,
            tags: ["fact", "user-stated"],
            action: "append",
            confidence: 0.7,
          };
        }
      }
    }

    // Detect when assistant shared knowledge worth remembering
    if (assistantResponse.length > 200 && interaction.toolUsed === "wiki_search") {
      return {
        memoryType: "semantic",
        content: `Wiki knowledge was retrieved for query: ${userMessage.substring(0, 100)}`,
        importance: 0.4,
        tags: ["wiki-retrieval"],
        action: "append",
        confidence: 0.5,
      };
    }

    return { memoryType: "semantic", content: "", importance: 0, tags: [], action: "ignore", confidence: 0 };
  }

  private classifyEpisodicType(
    _interaction: Interaction,
    tags: string[],
  ): EpisodicEntry["type"] {
    if (tags.includes("goal")) return "goal";
    if (tags.includes("decision")) return "decision";
    if (tags.includes("milestone")) return "milestone";
    if (tags.includes("question")) return "question";
    return "event";
  }

  // ── Concept Extraction Pipeline ───────────────────────────

  /**
   * After writing an episode to markdown, extract key concepts,
   * create/update concept files, and cross-link episode ↔ concept.
   */
  private async extractAndLinkConcepts(entry: EpisodicEntry): Promise<void> {
    if (!this.markdownStore) return;

    try {
      // Build content string for extraction
      const episodeContent = `# ${entry.summary}\n\n${entry.detail}\n\nTags: ${entry.tags.join(", ")}`;

      // Load existing concept slugs for matching
      const existingSlugs = await this.markdownStore.getAllConceptSlugs();

      // Extract concepts via heuristic
      const concepts = this.conceptExtractor.extract(episodeContent, existingSlugs);
      if (concepts.length === 0) return;

      // Get the episode file name for linking
      const episodeFileName = this.markdownStore.episodeFileName(entry);

      const linkedSlugs: string[] = [];

      for (const concept of concepts) {
        // Write concept file (create or update)
        await this.markdownStore.writeConcept({
          id: `concept-${concept.slug}`,
          name: concept.name,
          slug: concept.slug,
          tags: ["concept", ...entry.tags.slice(0, 2)],
          related: [],
          sourceEpisodes: episodeFileName ? [episodeFileName] : [],
          definition: `Concept extracted from episode: ${entry.summary.substring(0, 100)}`,
          created: Date.now(),
          updated: Date.now(),
          confidence: concept.confidence,
        });

        linkedSlugs.push(concept.slug);
      }

      // Update the episode file with [[concept]] wikilinks
      if (linkedSlugs.length > 0) {
        await this.markdownStore.updateEpisodeConceptLinks(entry.id, linkedSlugs);
      }
    } catch {
      // Concept extraction is best-effort; never block memory writes
    }
  }

  // ── Memory Maintenance Cycle ──────────────────────────────

  /**
   * Run periodic memory maintenance: decay, reinforcement,
   * consolidation, and soft removal marking.
   * Call every ~10 interactions.
   */
  runMemoryMaintenance(): {
    decayed: number;
    reinforced: number;
    consolidated: number;
    markedForRemoval: number;
  } {
    // 1. Apply decay to all episodic entries
    const decayed = this.episodic.applyDecay(1);

    // 2. Check for candidates for removal
    const candidates = this.episodic.getCandidatesForRemoval();
    const markedForRemoval = candidates.length;

    // 3. Consolidation pass: merge highly similar active entries
    const active = this.episodic.getActiveEntries();
    let consolidated = 0;
    const mergedIds = new Set<string>();

    for (let i = 0; i < active.length; i++) {
      if (mergedIds.has(active[i].id)) continue;
      for (let j = i + 1; j < active.length; j++) {
        if (mergedIds.has(active[j].id)) continue;
        const a: ScoredMemory = {
          id: active[i].id,
          importanceScore: active[i].importanceScore ?? active[i].importance,
          usageFrequency: active[i].usageFrequency ?? 0,
          lastAccessTime: active[i].lastAccessTime ?? active[i].timestamp,
          decayScore: active[i].decayScore ?? 1.0,
          usefulnessScore: active[i].usefulnessScore ?? 0.5,
          markedForRemoval: false,
          content: `${active[i].summary} ${active[i].detail}`.substring(0, 500),
          tags: active[i].tags,
        };
        const b: ScoredMemory = {
          id: active[j].id,
          importanceScore: active[j].importanceScore ?? active[j].importance,
          usageFrequency: active[j].usageFrequency ?? 0,
          lastAccessTime: active[j].lastAccessTime ?? active[j].timestamp,
          decayScore: active[j].decayScore ?? 1.0,
          usefulnessScore: active[j].usefulnessScore ?? 0.5,
          markedForRemoval: false,
          content: `${active[j].summary} ${active[j].detail}`.substring(0, 500),
          tags: active[j].tags,
        };

        const result = consolidate(a, [b]);
        if (result?.merged) {
          const merged = mergeMemories(a, b);
          // Update target entry with merged values
          this.episodic.update(a.id, {
            importanceScore: merged.importanceScore,
            usageFrequency: merged.usageFrequency,
            usefulnessScore: merged.usefulnessScore,
            tags: merged.tags,
          });
          // Mark source for removal
          this.episodic.update(b.id, { markedForRemoval: true });
          mergedIds.add(b.id);
          consolidated++;
        }
      }
    }

    return { decayed, reinforced: 0, consolidated, markedForRemoval };
  }
}
