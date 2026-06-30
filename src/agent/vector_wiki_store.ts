// ── Vector Wiki Store ────────────────────────────────────────
// TF-IDF vectorization + cosine similarity semantic search.
// Replaces keyword-matching searchWiki() with vector-based retrieval.
// No external API needed — works entirely offline in Obsidian.

export interface VectorSearchResult {
  content: string;
  sourcePath: string;
  score: number; // cosine similarity 0..1
}

interface TfIdfIndex {
  vocabulary: Record<string, number>;   // term → index in vectors
  idf: number[];                         // IDF value per term
  documents: Array<{
    path: string;
    vector: number[];                    // TF-IDF vector (sparse, same length as vocab)
    content: string;                     // original content
  }>;
  builtAt: number;
}

interface LoadedDoc {
  path: string;
  content: string;
}

export class VectorWikiStore {
  private index: TfIdfIndex | null = null;
  private stopWords: Set<string>;

  constructor() {
    // Common Chinese + English stop words
    this.stopWords = new Set([
      "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
      "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
      "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "can", "shall", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "through", "during",
      "before", "after", "above", "below", "between", "under", "again",
      "further", "then", "once", "here", "there", "when", "where", "why",
      "how", "all", "both", "each", "few", "more", "most", "other", "some",
      "such", "no", "nor", "not", "only", "own", "same", "so", "than",
      "too", "very", "and", "but", "or", "if", "because", "until", "while",
      "about", "this", "that", "these", "those", "it", "its",
    ]);
  }

  // ── Tokenization ──────────────────────────────────────────

  private tokenize(text: string): string[] {
    const tokens: string[] = [];

    // Chinese character bigrams
    const cjkChars = text.replace(/[^一-鿿]/g, "");
    for (let i = 0; i < cjkChars.length - 1; i++) {
      const bigram = cjkChars.substring(i, i + 2);
      if (!this.stopWords.has(bigram)) {
        tokens.push(bigram);
      }
    }
    // Also add unigrams for single-char matching
    for (const ch of cjkChars) {
      if (!this.stopWords.has(ch)) {
        tokens.push(ch);
      }
    }

    // English words (lowercase, 2+ chars)
    const englishWords = text.toLowerCase().match(/[a-z]{2,}/g) || [];
    for (const w of englishWords) {
      if (!this.stopWords.has(w)) {
        tokens.push(w);
      }
    }

    return tokens;
  }

  // ── Build Index ───────────────────────────────────────────

  build(documents: LoadedDoc[]): void {
    if (documents.length === 0) {
      this.index = {
        vocabulary: {},
        idf: [],
        documents: [],
        builtAt: Date.now(),
      };
      return;
    }

    // 1. Tokenize all documents & compute document frequencies
    const docTokens: string[][] = [];
    const df: Map<string, number> = new Map(); // document frequency

    for (const doc of documents) {
      const tokens = this.tokenize(doc.content);
      docTokens.push(tokens);

      const uniqueTokens = new Set(tokens);
      for (const t of uniqueTokens) {
        df.set(t, (df.get(t) || 0) + 1);
      }
    }

    // 2. Build vocabulary (filter rare/common terms)
    const N = documents.length;
    const vocabEntries: Array<[string, number]> = []; // term, docFreq
    for (const [term, freq] of df) {
      // Keep terms that appear in 1..80% of documents
      if (freq >= 1 && freq <= N * 0.8 && term.length >= 1) {
        vocabEntries.push([term, freq]);
      }
    }
    // Sort by frequency descending for consistency
    vocabEntries.sort((a, b) => b[1] - a[1]);

    const vocabulary: Record<string, number> = {};
    const idf: number[] = [];
    for (let i = 0; i < vocabEntries.length; i++) {
      const [term, freq] = vocabEntries[i];
      vocabulary[term] = i;
      idf.push(Math.log((N + 1) / (freq + 1)) + 1); // smoothed IDF
    }

    // 3. Compute TF-IDF vectors for each document
    const indexedDocs = documents.map((doc, idx) => {
      const tokens = docTokens[idx];
      const tf: Record<string, number> = {};
      for (const t of tokens) {
        tf[t] = (tf[t] || 0) + 1;
      }

      // Normalize TF by doc length
      const maxTf = Math.max(1, ...Object.values(tf));
      const vecLen = vocabEntries.length;
      const vector = new Array(vecLen).fill(0);

      for (const [term, freq] of Object.entries(tf)) {
        const vi = vocabulary[term];
        if (vi !== undefined) {
          vector[vi] = (freq / maxTf) * idf[vi];
        }
      }

      return {
        path: doc.path,
        vector,
        content: doc.content,
      };
    });

    this.index = {
      vocabulary,
      idf,
      documents: indexedDocs,
      builtAt: Date.now(),
    };
  }

  // ── Search ────────────────────────────────────────────────

  search(query: string, topK: number = 3): VectorSearchResult[] {
    if (!this.index || this.index.documents.length === 0) return [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    // Compute query TF vector
    const tf: Record<string, number> = {};
    for (const t of queryTokens) {
      tf[t] = (tf[t] || 0) + 1;
    }
    const maxTf = Math.max(1, ...Object.values(tf));

    const queryVec = new Array(this.index.idf.length).fill(0);
    let hasMatch = false;
    for (const [term, freq] of Object.entries(tf)) {
      const vi = this.index.vocabulary[term];
      if (vi !== undefined) {
        queryVec[vi] = (freq / maxTf) * this.index.idf[vi];
        hasMatch = true;
      }
    }

    if (!hasMatch) return [];

    // Compute cosine similarity with all documents
    const queryNorm = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0));
    if (queryNorm === 0) return [];

    const scored = this.index.documents.map(doc => {
      let dotProduct = 0;
      let docNorm = 0;
      for (let i = 0; i < queryVec.length; i++) {
        dotProduct += queryVec[i] * doc.vector[i];
        docNorm += doc.vector[i] * doc.vector[i];
      }
      docNorm = Math.sqrt(docNorm);
      const similarity = docNorm > 0 ? dotProduct / (queryNorm * docNorm) : 0;
      return {
        content: doc.content,
        sourcePath: doc.path,
        score: Math.round(similarity * 1000) / 1000,
      };
    });

    // Sort by score descending, return top-K
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(r => r.score > 0.01).slice(0, topK);
  }

  // ── Serialization (for vault persistence) ─────────────────

  serialize(): string {
    if (!this.index) return JSON.stringify({ vocabulary: {}, idf: [], documents: [], builtAt: 0 });
    return JSON.stringify(this.index);
  }

  deserialize(json: string): void {
    try {
      const data = JSON.parse(json);
      if (data.vocabulary && data.idf && data.documents && data.builtAt) {
        this.index = data;
      }
    } catch {
      this.index = null;
    }
  }

  get documentCount(): number {
    return this.index?.documents.length ?? 0;
  }

  get lastBuilt(): number {
    return this.index?.builtAt ?? 0;
  }

  isLoaded(): boolean {
    return this.index !== null && this.index.documents.length > 0;
  }
}
