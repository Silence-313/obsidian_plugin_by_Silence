// ── Concept Extractor ────────────────────────────────────────
// Lightweight heuristic concept extraction from episode content.
// No LLM required — uses headings, term frequency, and pattern
// matching to surface key concepts from markdown memory entries.
//
// Output feeds into Concept Storage Layer (concepts/*.md files)
// forming a lightweight Markdown Knowledge Graph.

export interface ExtractedConcept {
  name: string;        // human-readable label, e.g. "Memory System"
  slug: string;        // file-safe identifier, e.g. "memory-system"
  confidence: number;  // 0..1 extraction confidence
  sourceTerms: string[]; // terms that triggered this concept
}

// Chinese + English stop words (same set used in VectorWikiStore)
const STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
  "什么", "怎么", "如何", "为什么", "可以", "这个", "那个", "还是",
  "但", "因为", "所以", "如果", "虽然", "已经", "正在", "将", "可能",
  "应该", "需要", "知道", "觉得", "认为", "让", "做", "用", "想",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "and", "but", "or", "if", "not", "this", "that",
  "these", "those", "it", "its", "then", "now", "here", "there",
  "about", "just", "over", "also", "very", "too", "only", "own",
  "so", "than", "no", "nor", "such", "each", "all", "both", "few",
  "more", "most", "other", "some", "any",
]);

// Configurable thresholds
const MIN_BIGRAM_COUNT = 2;       // bigram must appear at least this many times
const MAX_CONCEPTS = 6;           // max concepts per episode
const MIN_CONFIDENCE = 0.25;      // discard concepts below this confidence
const HEADING_BONUS = 0.35;       // confidence boost for heading-sourced concepts
const EXISTING_MATCH_BONUS = 0.2; // boost for matching an existing concept name

export class ConceptExtractor {
  private stopWords: Set<string>;

  constructor(customStopWords?: string[]) {
    this.stopWords = new Set(STOP_WORDS);
    if (customStopWords) {
      for (const w of customStopWords) this.stopWords.add(w.toLowerCase());
    }
  }

  /**
   * Extract key concepts from episode markdown content.
   * Returns 2–6 ranked concepts with confidence scores.
   */
  extract(content: string, existingConcepts: string[] = []): ExtractedConcept[] {
    if (!content || content.trim().length < 10) return [];

    const candidates: Map<string, { score: number; sourceTerms: Set<string> }> = new Map();

    // 1. Section headings → strong concept candidates
    this.extractFromHeadings(content, candidates);

    // 2. Frequent Chinese bigrams → concept candidates
    this.extractFromBigrams(content, candidates);

    // 3. English compound terms → concept candidates
    this.extractFromEnglishTerms(content, candidates);

    // 4. Apply existing concept matching bonus
    this.matchExisting(candidates, existingConcepts);

    // 5. Rank and filter
    const ranked = this.rankAndFilter(candidates);

    // 6. Deduplicate similar concepts
    return this.deduplicate(ranked).slice(0, MAX_CONCEPTS);
  }

  // ── Extraction methods ────────────────────────────────────

  private extractFromHeadings(
    content: string,
    candidates: Map<string, { score: number; sourceTerms: Set<string> }>,
  ): void {
    const headingRe = /^#{1,3}\s+(.+)$/gm;
    let match;
    while ((match = headingRe.exec(content)) !== null) {
      const text = match[1].trim();
      if (text.length < 2 || text.length > 80) continue;
      // Skip purely structural headings
      if (/^(Summary|Detail|Meta|Sources|Concepts|Related|Links?)$/i.test(text)) continue;

      const name = this.normalizeName(text);
      if (!name || name.length < 2) continue;

      const existing = candidates.get(name);
      if (existing) {
        existing.score += HEADING_BONUS;
        existing.sourceTerms.add(text);
      } else {
        candidates.set(name, { score: HEADING_BONUS, sourceTerms: new Set([text]) });
      }
    }
  }

  private extractFromBigrams(
    content: string,
    candidates: Map<string, { score: number; sourceTerms: Set<string> }>,
  ): void {
    // Chinese bigram extraction
    const cjkOnly = content.replace(/[^一-鿿]/g, "");
    if (cjkOnly.length < 4) return;

    const bigramFreq = new Map<string, number>();
    for (let i = 0; i < cjkOnly.length - 1; i++) {
      const bg = cjkOnly.substring(i, i + 2);
      if (!this.stopWords.has(bg) && bg.length === 2) {
        bigramFreq.set(bg, (bigramFreq.get(bg) || 0) + 1);
      }
    }

    // Also extract trigrams for longer concept terms
    const trigramFreq = new Map<string, number>();
    for (let i = 0; i < cjkOnly.length - 2; i++) {
      const tg = cjkOnly.substring(i, i + 3);
      if (tg.length === 3) {
        trigramFreq.set(tg, (trigramFreq.get(tg) || 0) + 1);
      }
    }

    // Score bigrams by frequency (normalized)
    const maxBigramFreq = Math.max(1, ...bigramFreq.values());
    for (const [bg, freq] of bigramFreq) {
      if (freq < MIN_BIGRAM_COUNT) continue;
      const name = this.normalizeName(bg);
      if (!name || name.length < 2) continue;

      const freqScore = (freq / maxBigramFreq) * 0.3;
      const existing = candidates.get(name);
      if (existing) {
        existing.score += freqScore;
        existing.sourceTerms.add(bg);
      } else {
        candidates.set(name, { score: freqScore, sourceTerms: new Set([bg]) });
      }
    }

    // Score trigrams (lower weight, but longer = more specific)
    const maxTrigramFreq = Math.max(1, ...trigramFreq.values());
    for (const [tg, freq] of trigramFreq) {
      if (freq < 2) continue;
      if (this.isNoiseTrigram(tg)) continue;

      const name = this.normalizeName(tg);
      if (!name || name.length < 3) continue;

      const freqScore = (freq / maxTrigramFreq) * 0.5;
      const existing = candidates.get(name);
      if (existing) {
        existing.score += freqScore;
        existing.sourceTerms.add(tg);
      } else {
        candidates.set(name, { score: freqScore, sourceTerms: new Set([tg]) });
      }
    }
  }

  private extractFromEnglishTerms(
    content: string,
    candidates: Map<string, { score: number; sourceTerms: Set<string> }>,
  ): void {
    // Extract English compound terms (CamelCase, snake_case, kebab-case)
    const compoundRe = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b|\b[a-z]+(?:[_-][a-z]+){1,3}\b|\b[A-Z][A-Za-z]+\b/g;
    const matches = content.match(compoundRe);
    if (!matches) return;

    const termFreq = new Map<string, number>();
    for (const m of matches) {
      if (m.length < 3 || this.stopWords.has(m.toLowerCase())) continue;
      termFreq.set(m, (termFreq.get(m) || 0) + 1);
    }

    // Also extract 2-word English phrases
    const phraseRe = /\b([A-Z][a-z]+|[a-z]{3,})\s+([A-Z][a-z]+|[a-z]{3,})\b/g;
    let phraseMatch;
    while ((phraseMatch = phraseRe.exec(content)) !== null) {
      const phrase = phraseMatch[0].trim();
      if (phrase.length < 5) continue;
      const lowerWords = phrase.toLowerCase().split(/\s+/);
      if (lowerWords.every(w => this.stopWords.has(w))) continue;
      termFreq.set(phrase, (termFreq.get(phrase) || 0) + 1);
    }

    const maxFreq = Math.max(1, ...termFreq.values());
    for (const [term, freq] of termFreq) {
      if (freq < 2) continue;
      const name = this.normalizeName(term);
      if (!name || name.length < 2) continue;

      const freqScore = (freq / maxFreq) * 0.4;
      const existing = candidates.get(name);
      if (existing) {
        existing.score += freqScore;
        existing.sourceTerms.add(term);
      } else {
        candidates.set(name, { score: freqScore, sourceTerms: new Set([term]) });
      }
    }
  }

  private matchExisting(
    candidates: Map<string, { score: number; sourceTerms: Set<string> }>,
    existingConcepts: string[],
  ): void {
    if (existingConcepts.length === 0) return;

    for (const [candidateName, data] of candidates) {
      for (const existing of existingConcepts) {
        if (this.isSimilar(candidateName, existing)) {
          // Boost confidence — this concept is already known
          data.score += EXISTING_MATCH_BONUS;
          data.sourceTerms.add(`matched:${existing}`);
          break;
        }
      }
    }
  }

  // ── Ranking ───────────────────────────────────────────────

  private rankAndFilter(
    candidates: Map<string, { score: number; sourceTerms: Set<string> }>,
  ): ExtractedConcept[] {
    const results: ExtractedConcept[] = [];

    for (const [name, data] of candidates) {
      const confidence = Math.min(1, data.score);
      if (confidence < MIN_CONFIDENCE) continue;

      results.push({
        name: this.toTitleCase(name),
        slug: this.toSlug(name),
        confidence: Math.round(confidence * 100) / 100,
        sourceTerms: Array.from(data.sourceTerms),
      });
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  // ── Deduplication ─────────────────────────────────────────

  private deduplicate(concepts: ExtractedConcept[]): ExtractedConcept[] {
    const seen = new Set<string>();
    const result: ExtractedConcept[] = [];

    for (const c of concepts) {
      // Check if this concept is subsumed by an already-selected one
      let isSubsumed = false;
      for (const s of seen) {
        if (this.isSubset(c.name, s) || this.isSimilar(c.name, s)) {
          isSubsumed = true;
          break;
        }
      }
      if (!isSubsumed) {
        seen.add(c.name);
        result.push(c);
      }
    }

    return result;
  }

  // ── Utility ───────────────────────────────────────────────

  private normalizeName(text: string): string {
    // Remove markdown syntax, extra spaces, punctuation
    let cleaned = text
      .replace(/[*_~`#\[\]()>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 2 || cleaned.length > 60) return "";
    return cleaned;
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^一-鿿a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 50);
  }

  private toTitleCase(name: string): string {
    // Keep as-is for Chinese, title-case for English
    if (/[一-鿿]/.test(name)) return name;
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }

  private isSimilar(a: string, b: string): boolean {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (al === bl) return true;
    if (al.includes(bl) || bl.includes(al)) return true;
    // Check word overlap
    const aWords = new Set(al.split(/[\s-]+/));
    const bWords = new Set(bl.split(/[\s-]+/));
    const intersection = [...aWords].filter(w => bWords.has(w)).length;
    const union = new Set([...aWords, ...bWords]).size;
    return union > 0 && intersection / union >= 0.6;
  }

  private isSubset(shorter: string, longer: string): boolean {
    const sl = shorter.toLowerCase();
    const ll = longer.toLowerCase();
    if (ll.includes(sl) && ll.length > sl.length) return true;
    return false;
  }

  private isNoiseTrigram(tg: string): boolean {
    // Filter out trigrams that are just grammatical patterns
    const noisePatterns = [
      /^[的是在了和就]/,
      /[的了着过]$/,
      /^[不太也没很都]/,
      /^[这可那哪怎]/,
    ];
    return noisePatterns.some(p => p.test(tg));
  }
}
