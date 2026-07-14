import type HomepageView from "../view";
import type { MemoryCard, QuizQuestion } from "../types";
import { loadApiKeyFromKeychain, escapeHtml, callDeepSeek } from "../utils";

const COUNT_OPTIONS = [10, 20, 30, 50];

function safeStr(val: any): string {
  if (typeof val === "string") return val;
  if (val === null || val === undefined) return "";
  return String(val);
}

export class MemoryReviewComponent {
  private view: HomepageView;
  private items: MemoryCard[] | QuizQuestion[] = [];
  private loading = false;
  private abortController: AbortController | null = null;
  private flippedCards = new Set<number>();
  private selectedChoice = new Map<number, number>();
  private revealedShort = new Set<number>();
  private sourceInfo = "";

  constructor(view: HomepageView) {
    this.view = view;
  }

  cleanup() {
    this.abortController?.abort();
  }

  // ── Render ─────────────────────────────────────────────

  async render() {
    const card = this.view.containerEl.querySelector("#homepage-memoryreview-card") as HTMLElement;
    if (!card) return;

    card.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%;">
        ${this.renderToolbar()}
        <div id="memoryreview-source" style="
          padding: 4px 16px;
          font-size: 11px;
          color: var(--text-faint);
          border-bottom: 1px solid var(--background-modifier-border);
        ">${escapeHtml(this.sourceInfo) || "点击 🔄 生成复习内容"}</div>
        <div id="memoryreview-body" style="
          flex: 1;
          overflow-y: auto;
          padding: 12px 16px;
        ">
          ${this.renderBody()}
        </div>
      </div>
    `;

    this.bindToolbarEvents();
    this.bindBodyEvents();
  }

  private renderToolbar(): string {
    const settings = this.view.plugin.settings.memoryReview;
    const count = settings.questionCount;
    const mode = settings.mode;

    const countBtns = COUNT_OPTIONS.map(c =>
      `<button class="memoryreview-count-btn" data-count="${c}" style="
        padding: 2px 8px; font-size: 11px; border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: ${c === count ? "var(--interactive-accent)" : "transparent"};
        color: ${c === count ? "var(--text-on-accent)" : "var(--text-muted)"};
        cursor: pointer; font-family: inherit;
      ">${c}</button>`
    ).join("");

    const modeSlider = `
      <div class="memoryreview-mode-wrap" style="
        display: flex; align-items: center;
        background: var(--background-modifier-hover);
        border-radius: 16px; padding: 2px;
        border: 1px solid var(--background-modifier-border);
      ">
        <button class="memoryreview-mode-btn" data-mode="cards" style="
          padding: 2px 10px; font-size: 11px; border-radius: 14px;
          border: none;
          background: ${mode === "cards" ? "var(--interactive-accent)" : "transparent"};
          color: ${mode === "cards" ? "var(--text-on-accent)" : "var(--text-muted)"};
          cursor: pointer; font-family: inherit;
          transition: background 0.2s, color 0.2s;
        ">📝 记忆卡片</button>
        <button class="memoryreview-mode-btn" data-mode="quiz" style="
          padding: 2px 10px; font-size: 11px; border-radius: 14px;
          border: none;
          background: ${mode === "quiz" ? "var(--interactive-accent)" : "transparent"};
          color: ${mode === "quiz" ? "var(--text-on-accent)" : "var(--text-muted)"};
          cursor: pointer; font-family: inherit;
          transition: background 0.2s, color 0.2s;
        ">❓ 题目</button>
      </div>
    `;

    return `
      <div style="
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        flex-shrink: 0;
        gap: 8px;
      ">
        <span style="font-size: 13px; font-weight: 600; color: var(--text-normal); white-space: nowrap;">🧠 记忆复习</span>
        <div style="display: flex; align-items: center; gap: 4px;">${countBtns}</div>
        ${modeSlider}
        <button class="memoryreview-refresh-btn" style="
          background: transparent;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          padding: 2px 8px;
          font-family: inherit;
          white-space: nowrap;
        ">🔄 刷新</button>
      </div>
    `;
  }

  private renderBody(): string {
    if (this.loading) return this.renderLoading();
    if (this.items.length === 0) return this.renderEmpty();
    const mode = this.view.plugin.settings.memoryReview.mode;
    return mode === "cards" ? this.renderCards() : this.renderQuiz();
  }

  private renderLoading(): string {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px;">
        <div style="font-size: 32px; animation: memoryreview-spin 1s linear infinite;">⏳</div>
        <div style="font-size: 13px; color: var(--text-muted);">正在生成复习内容...</div>
      </div>
    `;
  }

  private renderEmpty(): string {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; color: var(--text-muted);">
        <div style="font-size: 40px;">📭</div>
        <div style="font-size: 13px;">暂无复习内容</div>
        <div style="font-size: 11px;">点击 🔄 刷新 从最近笔记生成记忆卡片或题目</div>
      </div>
    `;
  }

  // ── Cards mode ─────────────────────────────────────────

  private renderCards(): string {
    const cards = this.items as MemoryCard[];
    return `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${cards.map((c, i) => {
          const flipped = this.flippedCards.has(i);
          return `
            <div class="memoryreview-item memoryreview-card" data-index="${i}" style="
              perspective: 600px;
              cursor: pointer;
            ">
              <div style="
                transition: transform 0.5s;
                transform-style: preserve-3d;
                transform: ${flipped ? "rotateY(180deg)" : "rotateY(0deg)"};
                display: grid;
              ">
                <div style="
                  grid-area: 1/1;
                  padding: 12px 14px;
                  border-radius: 8px;
                  border: 1px solid var(--background-modifier-border);
                  background: var(--background-primary);
                  backface-visibility: hidden;
                ">
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-normal); margin-bottom: 4px;">
                    ${escapeHtml(safeStr(c.question))}
                  </div>
                  <div style="font-size: 11px; color: var(--text-faint);">👆 点击翻转查看答案</div>
                </div>
                <div style="
                  grid-area: 1/1;
                  padding: 12px 14px;
                  border-radius: 8px;
                  border: 1px solid var(--background-modifier-border);
                  border-left: 3px solid #43a047;
                  background: var(--background-primary);
                  backface-visibility: hidden;
                  transform: rotateY(180deg);
                ">
                  <div style="font-size: 11px; color: var(--text-faint); margin-bottom: 4px;">📖 答案</div>
                  <div style="font-size: 13px; color: var(--text-normal); line-height: 1.6; white-space: pre-wrap;">${escapeHtml(safeStr(c.answer))}</div>
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  // ── Quiz mode ──────────────────────────────────────────

  private renderQuiz(): string {
    const questions = this.items as QuizQuestion[];
    return `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${questions.map((q, i) => {
          if (q.type === "choice") {
            return this.renderChoiceQuestion(q, i);
          }
          // Default: treat unknown/missing type as short answer (safe fallback)
          const sq = q as import("../types").ShortAnswerQuestion;
          return this.renderShortQuestion(
            { type: "short", question: safeStr(sq.question), referenceAnswer: safeStr(sq.referenceAnswer) },
            i
          );
        }).join("")}
      </div>
    `;
  }

  private renderChoiceQuestion(q: import("../types").MultipleChoiceQuestion, index: number): string {
    const selected = this.selectedChoice.get(index);
    const labels = ["A", "B", "C", "D"];
    const options = Array.isArray(q.options) ? q.options : [];
    const correctIdx = typeof q.correctIndex === "number" ? q.correctIndex : 0;
    return `
      <div class="memoryreview-item" style="
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
      ">
        <div style="font-size: 13px; font-weight: 600; color: var(--text-normal); margin-bottom: 8px;">
          ${index + 1}. ${escapeHtml(safeStr(q.question))}
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          ${options.map((opt, oi) => {
            let bg = "transparent";
            let border = "1px solid var(--background-modifier-border)";
            let textColor = "var(--text-muted)";
            if (selected !== undefined) {
              if (oi === correctIdx) {
                bg = "rgba(67, 160, 71, 0.15)";
                border = "1px solid #43a047";
                textColor = "#43a047";
              } else if (oi === selected) {
                bg = "rgba(229, 57, 53, 0.1)";
                border = "1px solid #e53935";
                textColor = "#e53935";
              }
            }
            return `
              <button class="memoryreview-option" data-qindex="${index}" data-optindex="${oi}" style="
                padding: 6px 10px; font-size: 12px; border-radius: 6px;
                border: ${border};
                background: ${bg};
                color: ${textColor};
                cursor: ${selected === undefined ? "pointer" : "default"};
                text-align: left;
                font-family: inherit;
                transition: background 0.15s, border-color 0.15s;
              " ${selected !== undefined ? "disabled" : ""}>
                <span style="font-weight: 600; margin-right: 6px;">${labels[oi]}.</span>${escapeHtml(safeStr(opt))}
              </button>
            `;
          }).join("")}
        </div>
        ${selected !== undefined ? `
          <div style="font-size: 11px; color: #43a047; margin-top: 6px;">
            ✓ 正确答案: ${labels[correctIdx]}
          </div>
        ` : ""}
      </div>
    `;
  }

  private renderShortQuestion(q: import("../types").ShortAnswerQuestion, index: number): string {
    const revealed = this.revealedShort.has(index);
    const savedText = escapeHtml(this._savedTextareaValues.get(index) || "");
    return `
      <div class="memoryreview-item" style="
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
      ">
        <div style="font-size: 13px; font-weight: 600; color: var(--text-normal); margin-bottom: 8px;">
          ${index + 1}. ${escapeHtml(safeStr(q.question))}
        </div>
        <textarea class="memoryreview-short-input" data-qindex="${index}" placeholder="输入你的答案..." style="
          width: 100%; min-height: 48px; padding: 8px 10px;
          font-size: 12px; font-family: inherit;
          border: 1px solid var(--background-modifier-border);
          border-radius: 6px;
          background: var(--background-primary);
          color: var(--text-normal);
          resize: vertical;
          box-sizing: border-box;
          outline: none;
        ">${savedText}</textarea>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
          <button class="memoryreview-reveal-btn" data-qindex="${index}" style="
            padding: 3px 12px; font-size: 11px; border-radius: 4px;
            border: 1px solid var(--background-modifier-border);
            background: transparent;
            color: var(--text-muted);
            cursor: ${revealed ? "default" : "pointer"};
            font-family: inherit;
          " ${revealed ? "disabled" : ""}>${revealed ? "✅ 已查看" : "💡 查看答案"}</button>
        </div>
        ${revealed ? `
          <div style="
            margin-top: 8px; padding: 10px 12px;
            border-left: 3px solid #43a047;
            background: rgba(67, 160, 71, 0.05);
            border-radius: 0 6px 6px 0;
            font-size: 12px; color: var(--text-normal);
            line-height: 1.6; white-space: pre-line;
          ">
            <div style="font-size: 10px; color: var(--text-faint); margin-bottom: 4px;">📖 参考答案</div>
${escapeHtml(safeStr(q.referenceAnswer).trim())}
          </div>
        ` : ""}
      </div>
    `;
  }

  // ── Events ─────────────────────────────────────────────

  // Saved textarea values so they survive DOM replacement during updateBody
  private _savedTextareaValues = new Map<number, string>();

  /** Bind toolbar buttons — called only from render(), never from updateBody() */
  private bindToolbarEvents() {
    const card = this.view.containerEl.querySelector("#homepage-memoryreview-card") as HTMLElement;
    if (!card) return;

    card.querySelectorAll(".memoryreview-count-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const count = parseInt((btn as HTMLElement).dataset.count!);
        this.handleCountChange(count);
      });
    });

    card.querySelectorAll(".memoryreview-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = (btn as HTMLElement).dataset.mode as "cards" | "quiz";
        this.handleModeToggle(mode);
      });
    });

    const refreshBtn = card.querySelector(".memoryreview-refresh-btn");
    refreshBtn?.addEventListener("click", () => this.handleRefresh());
  }

  /** Bind body-only events — called from render() and updateBody(). Safe to re-call since old DOM is destroyed. */
  private bindBodyEvents() {
    const body = this.view.containerEl.querySelector("#memoryreview-body") as HTMLElement;
    if (!body) return;

    // Textarea focus/blur (replaces inline onfocus/onblur)
    body.querySelectorAll(".memoryreview-short-input").forEach(el => {
      const ta = el as HTMLTextAreaElement;
      ta.addEventListener("focus", () => {
        ta.style.borderColor = "var(--interactive-accent)";
      });
      ta.addEventListener("blur", () => {
        ta.style.borderColor = "var(--background-modifier-border)";
        // Save value on blur so it survives DOM replacement
        const qIdx = parseInt(ta.dataset.qindex!);
        if (!isNaN(qIdx)) this._savedTextareaValues.set(qIdx, ta.value);
      });
      ta.addEventListener("input", () => {
        const qIdx = parseInt(ta.dataset.qindex!);
        if (!isNaN(qIdx)) this._savedTextareaValues.set(qIdx, ta.value);
      });
    });

    // Card flip
    body.querySelectorAll(".memoryreview-card").forEach(el => {
      el.addEventListener("click", () => {
        const idx = parseInt((el as HTMLElement).dataset.index!);
        this.handleCardFlip(idx);
      });
    });

    // Choice options
    body.querySelectorAll(".memoryreview-option").forEach(btn => {
      btn.addEventListener("click", () => {
        const qIdx = parseInt((btn as HTMLElement).dataset.qindex!);
        const optIdx = parseInt((btn as HTMLElement).dataset.optindex!);
        this.handleOptionSelect(qIdx, optIdx);
      });
    });

    // Short answer reveal
    body.querySelectorAll(".memoryreview-reveal-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const qIdx = parseInt((btn as HTMLElement).dataset.qindex!);
        this.handleRevealAnswer(qIdx);
      });
    });
  }

  private handleCardFlip(index: number) {
    if (this.flippedCards.has(index)) {
      this.flippedCards.delete(index);
    } else {
      this.flippedCards.add(index);
    }
    this.updateBody();
  }

  private handleOptionSelect(qIndex: number, optIndex: number) {
    if (this.selectedChoice.has(qIndex)) return;
    this.selectedChoice.set(qIndex, optIndex);
    this.updateBody();
  }

  private handleRevealAnswer(qIndex: number) {
    // Save textarea value before DOM replacement
    const ta = this.view.containerEl.querySelector(
      `.memoryreview-short-input[data-qindex="${qIndex}"]`
    ) as HTMLTextAreaElement | null;
    if (ta) this._savedTextareaValues.set(qIndex, ta.value);

    this.revealedShort.add(qIndex);
    this.updateBody();
  }

  private handleRefresh() {
    if (this.loading) return;
    this.loading = true;
    this.updateBody();
    this._doRefresh();
  }

  private async _doRefresh() {
    try {
      const notes = await this.findRecentNotes();
      if (notes.length === 0) {
        this.sourceInfo = "未找到最近修改的笔记";
        this.items = [];
      } else {
        await this.generateItems(notes);
      }
    } catch (e: any) {
      this.sourceInfo = `生成失败: ${escapeHtml(e.message || "未知错误")}`;
      this.items = [];
    } finally {
      this.loading = false;
      this.flippedCards.clear();
      this.selectedChoice.clear();
      this.revealedShort.clear();
      this._savedTextareaValues.clear();
      this.render();
    }
  }

  private handleCountChange(count: number) {
    const settings = this.view.plugin.settings.memoryReview;
    if (settings.questionCount !== count) {
      settings.questionCount = count;
      this.view.plugin.saveSettings().catch(console.error);
      this.handleRefresh();
    }
  }

  private handleModeToggle(mode: "cards" | "quiz") {
    const settings = this.view.plugin.settings.memoryReview;
    if (settings.mode !== mode) {
      settings.mode = mode;
      this.view.plugin.saveSettings().catch(console.error);
      this.handleRefresh();
    }
  }

  /** Replace body content only (not toolbar), then re-bind body events. Safe — old DOM is destroyed. */
  private updateBody() {
    const body = this.view.containerEl.querySelector("#memoryreview-body") as HTMLElement;
    if (body) {
      body.innerHTML = this.renderBody();
      this.bindBodyEvents();
    }
  }

  // ── Vault scanning ─────────────────────────────────────

  private async findRecentNotes(): Promise<{ path: string; content: string; mtime: number }[]> {
    const vault = this.view.plugin.app.vault;
    const allFiles = vault.getFiles();
    const wikiFolder = this.view.plugin.settings.llmWiki.wikiFolder || "llm-wiki";

    const excludeDirs = [".obsidian", ".trash", ".git", wikiFolder, "agent-memory", "_attachments", "assets"];

    const mdFiles = allFiles.filter(f => {
      if (f.extension !== "md") return false;
      for (const dir of excludeDirs) {
        if (f.path.startsWith(dir + "/") || f.path === dir) return false;
      }
      return true;
    });

    // Sort by mtime descending
    mdFiles.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));

    const now = Date.now();
    const windows = [24, 48, 72, 168, 720]; // hours

    let selectedFiles: typeof mdFiles = [];
    for (const hours of windows) {
      const cutoff = now - hours * 3600 * 1000;
      selectedFiles = mdFiles.filter(f => (f.stat?.mtime ?? 0) >= cutoff);
      if (selectedFiles.length >= 3) break;
    }

    // Fallback: if still < 3, take the most recent up to 20
    if (selectedFiles.length < 3) {
      selectedFiles = mdFiles.slice(0, 20);
    }

    // Cap at 20
    const topFiles = selectedFiles.slice(0, 20);

    // Compute time window description
    const oldestMtime = topFiles.length > 0
      ? Math.min(...topFiles.map(f => f.stat?.mtime ?? now))
      : now;
    const hoursAgo = Math.round((now - oldestMtime) / 3600000);
    this.sourceInfo = `📋 来源: ${topFiles.length} 篇笔记 (最近 ${hoursAgo < 24 ? hoursAgo + " 小时" : Math.round(hoursAgo / 24) + " 天"})`;

    // Read in parallel
    const reads = await Promise.allSettled(topFiles.map(async (file) => {
      let content = await vault.read(file);
      const mtime = file.stat?.mtime ?? 0;
      if (content.length > 3000) {
        content = content.slice(0, 1500)
          + "\n\n...(中间内容已省略)...\n\n"
          + content.slice(-1500);
      }
      return { path: file.path, content, mtime };
    }));

    const results: { path: string; content: string; mtime: number }[] = [];
    let skippedCount = 0;
    for (const r of reads) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        skippedCount++;
      }
    }

    // Correct sourceInfo if files were skipped
    if (skippedCount > 0) {
      this.sourceInfo = `📋 来源: ${results.length} 篇笔记 (${topFiles.length} 篇中有 ${skippedCount} 篇读取失败) (最近 ${hoursAgo < 24 ? hoursAgo + " 小时" : Math.round(hoursAgo / 24) + " 天"})`;
    }

    return results;
  }

  // ── LLM generation ─────────────────────────────────────

  private async generateItems(notes: { path: string; content: string; mtime: number }[]) {
    this.abortController?.abort();
    this.abortController = new AbortController();

    const key = loadApiKeyFromKeychain() || this.view.plugin.settings.llmWiki.apiKey;
    if (!key) throw new Error("请先在 LLM Wiki 设置中配置 DeepSeek API Key");

    const s2 = this.view.plugin.settings.llmWiki;
    const endpoint = (s2.apiEndpoint || "https://api.deepseek.com/v1").replace(/\/$/, "");
    const model = s2.model || "deepseek-chat";
    const { mode, questionCount: count } = this.view.plugin.settings.memoryReview;

    const messages = this.buildPrompt(notes, count, mode);

    const timeoutId = setTimeout(() => this.abortController!.abort(), 60000);
    let text: string;
    try {
      text = await callDeepSeek(messages, { apiKey: key, endpoint, model, signal: this.abortController.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    this.items = this.parseResponse(text, mode);
  }

  /** Build the system + user messages for the LLM API call. */
  private buildPrompt(
    notes: { path: string; content: string; mtime: number }[],
    count: number,
    mode: string,
  ): Array<{ role: string; content: string }> {
    const noteContext = notes.map((n, i) => {
      const d = new Date(n.mtime);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return `### 笔记 ${i + 1}: ${n.path} (修改于 ${dateStr})\n\n${n.content}`;
    }).join("\n\n---\n\n");

    let systemPrompt: string;
    let outputFormat: string;

    if (mode === "cards") {
      systemPrompt = "你是一个学习助手，擅长从笔记内容中提炼关键知识点，制作成记忆卡片。记忆卡片正面是问题或概念，背面是答案或解释。题目应覆盖核心概念、关键定义、重要关系。";
      outputFormat = `请严格按以下 JSON 数组格式返回 ${count} 张记忆卡片：
[
  {"question": "问题或概念", "answer": "答案或解释"},
  ...
]
只返回 JSON 数组，不要包含其他文字。`;
    } else {
      systemPrompt = "你是一个学习助手，擅长从笔记内容中提炼关键知识点，制作成测试题目。题目应混合选择题和简答题，覆盖核心概念、关键定义、重要关系。选择题提供 4 个选项（A/B/C/D），简答题提供参考答案。";
      outputFormat = `请严格按以下 JSON 数组格式返回 ${count} 道题目（混合选择题和简答题）：
[
  {"type": "choice", "question": "题目", "options": ["选项A", "选项B", "选项C", "选项D"], "correctIndex": 0},
  {"type": "short", "question": "题目", "referenceAnswer": "参考答案"},
  ...
]
只返回 JSON 数组，不要包含其他文字。`;
    }

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: `以下是我最近笔记的内容。请基于这些内容生成复习材料。\n\n${noteContext}\n\n${outputFormat}` },
    ];
  }

  /** Parse LLM response text into validated MemoryCard[] or QuizQuestion[]. */
  private parseResponse(text: string, mode: string): MemoryCard[] | QuizQuestion[] {
    text = text.trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) text = jsonMatch[1].trim();

    let parsed: any[];
    try {
      parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("返回格式不是数组");
    } catch {
      if (mode === "cards") {
        return [{ question: "生成内容", answer: text }] as MemoryCard[];
      }
      return [{ type: "short", question: "生成内容", referenceAnswer: text }] as QuizQuestion[];
    }

    if (mode === "cards") {
      return parsed.map(item => ({
        question: safeStr((item as any).question || ""),
        answer: safeStr((item as any).answer || ""),
      })) as MemoryCard[];
    }
    return parsed.map(item => {
      const it = item as any;
      if (it.type === "choice") {
        return {
          type: "choice" as const,
          question: safeStr(it.question || ""),
          options: Array.isArray(it.options) ? it.options.map((o: any) => safeStr(o)) : ["A", "B", "C", "D"],
          correctIndex: typeof it.correctIndex === "number" ? it.correctIndex : 0,
        };
      }
      return {
        type: "short" as const,
        question: safeStr(it.question || ""),
        referenceAnswer: safeStr(it.referenceAnswer || ""),
      };
    }) as QuizQuestion[];
  }
}
