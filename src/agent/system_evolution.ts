// ── System Evolution ────────────────────────────────────────
// Memory scoring, decay, reinforcement, consolidation.
// Enforces safety constraints: ±0.05 clamp, 3-confirmation gate,
// low-confidence isolation, soft removal only.

// ── Safety Constants ─────────────────────────────────────────

const MAX_UPDATE_PER_CYCLE = 0.05;
const MIN_CONFIRMATIONS = 3;
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const DECAY_RATE = 0.03; // base decay per cycle
const USAGE_DAMPING = 0.6; // each usage reduces decay by this factor
const CANDIDATE_REMOVAL_THRESHOLD = 0.25;
const CANDIDATE_REMOVAL_CYCLES = 14;
const CONSOLIDATION_SIMILARITY = 0.85;

// ── Types ───────────────────────────────────────────────────

export interface ScoredMemory {
  id: string;
  importanceScore: number;   // 0..1
  usageFrequency: number;
  lastAccessTime: number;
  decayScore: number;        // computed
  usefulnessScore: number;   // 0..1
  markedForRemoval: boolean;
  content: string;           // for consolidation similarity
  tags: string[];
}

export interface EvolutionSignal {
  type: "access" | "reuse" | "positive_feedback" | "negative_feedback" | "correction";
  memoryId: string;
  strength: number; // 0..1
  timestamp: number;
}

export interface ConsolidationResult {
  merged: boolean;
  targetId: string;  // id of the memory to merge into
  reason: string;
}

// ── Memory Scoring ──────────────────────────────────────────

export function computeDecayScore(
  importanceScore: number,
  usageFrequency: number,
  cyclesSinceLastAccess: number,
): number {
  // Exponential decay: base decay reduced by usage frequency
  const effectiveRate = DECAY_RATE * (1 - usageFrequency * USAGE_DAMPING);
  const decay = Math.exp(-effectiveRate * Math.max(0, cyclesSinceLastAccess));
  return Number((importanceScore * decay).toFixed(4));
}

export function computeUsefulnessScore(
  accessCount: number,
  positiveFeedbackCount: number,
  negativeFeedbackCount: number,
  totalCycles: number,
): number {
  if (totalCycles === 0) return 0.5; // neutral start
  const accessRate = Math.min(1, accessCount / Math.max(1, totalCycles));
  const feedbackRatio = positiveFeedbackCount + negativeFeedbackCount > 0
    ? positiveFeedbackCount / (positiveFeedbackCount + negativeFeedbackCount)
    : 0.5;
  return Number(((accessRate * 0.4 + feedbackRatio * 0.6)).toFixed(4));
}

export function shouldMarkForRemoval(memory: ScoredMemory, cyclesSinceLastAccess: number): boolean {
  return (
    memory.importanceScore < CANDIDATE_REMOVAL_THRESHOLD &&
    memory.usageFrequency === 0 &&
    cyclesSinceLastAccess >= CANDIDATE_REMOVAL_CYCLES &&
    !memory.markedForRemoval
  );
}

// ── Memory Reinforcement ────────────────────────────────────

export function reinforce(
  memory: ScoredMemory,
  signal: EvolutionSignal,
): ScoredMemory {
  let boost = 0;

  switch (signal.type) {
    case "access":
      boost = 0.02;
      break;
    case "reuse":
      boost = 0.04;
      break;
    case "positive_feedback":
      boost = 0.05;
      break;
    case "negative_feedback":
      boost = -0.03;
      break;
    case "correction":
      boost = -0.05;
      break;
  }

  // Apply strength multiplier
  boost *= signal.strength;

  // Safety clamp
  boost = Math.max(-MAX_UPDATE_PER_CYCLE, Math.min(MAX_UPDATE_PER_CYCLE, boost));

  const newScore = Math.max(0, Math.min(1, memory.importanceScore + boost));
  const newUsefulness = computeUsefulnessScore(
    memory.usageFrequency + (signal.type === "access" || signal.type === "reuse" ? 1 : 0),
    memory.usefulnessScore > 0.5 ? 1 : 0 + (signal.type === "positive_feedback" ? 1 : 0),
    signal.type === "negative_feedback" ? 1 : 0,
    Math.max(1, memory.usageFrequency + 1),
  );

  return {
    ...memory,
    importanceScore: Number(newScore.toFixed(4)),
    usageFrequency: signal.type === "access" || signal.type === "reuse"
      ? memory.usageFrequency + 1
      : memory.usageFrequency,
    lastAccessTime: signal.type === "access" || signal.type === "reuse"
      ? signal.timestamp
      : memory.lastAccessTime,
    usefulnessScore: newUsefulness,
    markedForRemoval: false, // reinforcement clears removal flag
    decayScore: computeDecayScore(
      newScore,
      signal.type === "access" || signal.type === "reuse"
        ? memory.usageFrequency + 1
        : memory.usageFrequency,
      0, // reset decay clock on access
    ),
  };
}

// ── Memory Consolidation ────────────────────────────────────

export function computeSimilarity(a: ScoredMemory, b: ScoredMemory): number {
  // Jaccard-like tag + content overlap similarity
  const tagsA = new Set(a.tags);
  const tagsB = new Set(b.tags);
  const tagIntersection = [...tagsA].filter(t => tagsB.has(t)).length;
  const tagUnion = new Set([...a.tags, ...b.tags]).size;
  const tagSimilarity = tagUnion > 0 ? tagIntersection / tagUnion : 0;

  // Content word overlap
  const wordsA = new Set(a.content.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  const wordsB = new Set(b.content.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  const wordIntersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const wordUnion = new Set([...wordsA, ...wordsB]).size;
  const wordSimilarity = wordUnion > 0 ? wordIntersection / wordUnion : 0;

  // Weighted combination: tags more important for semantic grouping
  return Number((tagSimilarity * 0.6 + wordSimilarity * 0.4).toFixed(4));
}

export function consolidate(
  newMemory: ScoredMemory,
  existingMemories: ScoredMemory[],
): ConsolidationResult | null {
  for (const existing of existingMemories) {
    const sim = computeSimilarity(newMemory, existing);
    if (sim > CONSOLIDATION_SIMILARITY) {
      return {
        merged: true,
        targetId: existing.id,
        reason: `Similarity ${sim.toFixed(3)} > ${CONSOLIDATION_SIMILARITY} with ${existing.id}`,
      };
    }
  }
  return null;
}

export function mergeMemories(target: ScoredMemory, source: ScoredMemory): ScoredMemory {
  return {
    ...target,
    importanceScore: Number(Math.max(target.importanceScore, source.importanceScore).toFixed(4)),
    usageFrequency: target.usageFrequency + source.usageFrequency,
    lastAccessTime: Math.max(target.lastAccessTime, source.lastAccessTime),
    usefulnessScore: Number(Math.max(target.usefulnessScore, source.usefulnessScore).toFixed(4)),
    tags: [...new Set([...target.tags, ...source.tags])],
    content: target.content.length >= source.content.length ? target.content : source.content,
    markedForRemoval: false,
    decayScore: computeDecayScore(
      Math.max(target.importanceScore, source.importanceScore),
      target.usageFrequency + source.usageFrequency,
      0,
    ),
  };
}

// ── Safety Gates ────────────────────────────────────────────

export interface SafetyGate {
  confirmations: Map<string, number>; // signal type → count
}

export function createSafetyGate(): SafetyGate {
  return { confirmations: new Map() };
}

export function checkSafetyGate(gate: SafetyGate, signalType: string): boolean {
  const count = gate.confirmations.get(signalType) || 0;
  return count >= MIN_CONFIRMATIONS;
}

export function recordConfirmation(gate: SafetyGate, signalType: string): void {
  gate.confirmations.set(signalType, (gate.confirmations.get(signalType) || 0) + 1);
}

export function isMemoryIsolated(memory: ScoredMemory): boolean {
  return memory.importanceScore < LOW_CONFIDENCE_THRESHOLD;
}

// ── Batch Decay ─────────────────────────────────────────────

export function applyBatchDecay(
  memories: ScoredMemory[],
  currentTime: number,
  cycleDurationMs: number = 1000 * 60 * 60, // 1 hour per cycle
): ScoredMemory[] {
  return memories.map(m => {
    const cyclesSinceAccess = m.lastAccessTime > 0
      ? Math.floor((currentTime - m.lastAccessTime) / cycleDurationMs)
      : 1;
    const newDecay = computeDecayScore(m.importanceScore, m.usageFrequency, cyclesSinceAccess);

    const mark = shouldMarkForRemoval(
      { ...m, decayScore: newDecay },
      cyclesSinceAccess,
    );

    return {
      ...m,
      decayScore: newDecay,
      markedForRemoval: mark ? true : m.markedForRemoval,
    };
  });
}

// ── Evolution Cycle Result ──────────────────────────────────

export interface EvolutionCycleResult {
  memoriesDecayed: number;
  memoriesReinforced: number;
  memoriesConsolidated: number;
  memoriesMarkedForRemoval: number;
  policyUpdatesApplied: number;
  timestamp: number;
}

export function createEmptyCycleResult(): EvolutionCycleResult {
  return {
    memoriesDecayed: 0,
    memoriesReinforced: 0,
    memoriesConsolidated: 0,
    memoriesMarkedForRemoval: 0,
    policyUpdatesApplied: 0,
    timestamp: Date.now(),
  };
}
