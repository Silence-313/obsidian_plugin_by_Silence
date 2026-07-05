import {
  ViewPlugin, ViewUpdate, Decoration, DecorationSet,
  WidgetType, EditorView, keymap,
} from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { requestUrl } from "obsidian";
import type { HomepageSettings } from "../types";

// ============================================================
// Types
// ============================================================
interface Prediction {
  text: string;     // full prediction text
  from: number;     // prediction start position (document offset)
  display: string;  // currently displayed ghost text
}

// ============================================================
// Helpers
// ============================================================
// Strip prefix of prediction that overlaps with suffix of context
function stripOverlap(context: string, prediction: string): string {
  const maxLen = Math.min(context.length, prediction.length);
  for (let i = maxLen; i > 0; i--) {
    const suffix = context.slice(-i);
    const prefix = prediction.slice(0, i);
    if (suffix === prefix) return prediction.slice(i);
  }
  return prediction;
}

// ============================================================
// State management
// ============================================================
const setPrediction = StateEffect.define<Prediction | null>();

const predictionField = StateField.define<Prediction | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setPrediction)) return e.value;
    }
    if (!value) return null;

    // Doc changed: check if typed text matches prediction prefix
    if (tr.docChanged) {
      const newFrom = tr.changes.mapPos(value.from);
      const cursor = tr.selection?.main.head ?? tr.startState.selection.main.head;
      if (cursor <= newFrom) return null;
      const typed = tr.newDoc.sliceString(newFrom, cursor);
      if (typed.length > 0 && value.text.startsWith(typed)) {
        const remaining = value.text.slice(typed.length);
        if (remaining.length === 0) return null;
        return { text: value.text, from: cursor, display: remaining };
      }
      return null;
    }

    // Pure cursor movement: clear if cursor left the prediction position
    if (tr.selection) {
      if (tr.selection.main.head !== value.from) return null;
    }

    return value;
  },
});

// ============================================================
// Ghost text widget
// ============================================================
class PredictionWidget extends WidgetType {
  constructor(readonly text: string) { super(); }

  toDOM() {
    const span = document.createElement("span");
    span.className = "inline-prediction-ghost";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() { return true; }
}

// ============================================================
// View plugin
// ============================================================
let _getSettings: (() => HomepageSettings) | null = null;

// APISecret for Spark Lite — appended when apiKey is stored in old key-only format
const SPARK_API_SECRET = "MDIxZGFkNzhmNjNmNjU4ZTlkMDZhYTA3";

function getAuthKey(): string {
  const key = _getSettings?.()?.inlinePredict.apiKey || "";
  if (!key) return "";
  if (key.includes(":")) return key;
  return `${key}:${SPARK_API_SECRET}`;
}

function isEnabled(): boolean {
  const s = _getSettings?.();
  if (!s) return false;
  return s.components.some(c => c.id === "inlinepredict" && c.added);
}

class InlinePredictPlugin {
  decorations: DecorationSet = Decoration.none;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fetchSeq = 0;

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    const pred = update.view.state.field(predictionField);

    if (pred && pred.display.length > 0) {
      this.decorations = Decoration.set([
        Decoration.widget({
          widget: new PredictionWidget(pred.display),
          side: 1,
        }).range(pred.from),
      ]);
    } else {
      this.decorations = Decoration.none;
    }

    if (update.docChanged || update.selectionSet) {
      this.schedule();
    }
  }

  private schedule() {
    if (!isEnabled()) return;
    const s = _getSettings?.();
    if (!s || !getAuthKey()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fetch(), s.inlinePredict.debounceMs);
  }

  private async fetch() {
    this.fetchSeq++;
    const seq = this.fetchSeq;

    if (!isEnabled()) return;
    const s = _getSettings?.();
    if (!s || !getAuthKey()) return;

    const { state } = this.view;
    const pos = state.selection.main.head;
    if (!state.selection.main.empty) return;

    const text = state.doc.toString();

    // Extract only the current paragraph for focused context
    const before = text.slice(0, pos);
    const lastBreak = Math.max(
      before.lastIndexOf("\n\n"),
      before.lastIndexOf("\n#"),
    );
    const paragraph = before.slice(lastBreak + 1).trimEnd();
    const context = paragraph.length <= 300 ? paragraph : paragraph.slice(-300);
    if (context.length < 6) return;

    try {
      const res = await requestUrl({
        url: "https://spark-api-open.xf-yun.com/v1/chat/completions",
        method: "POST",
        contentType: "application/json",
        headers: {
          "Authorization": `Bearer ${getAuthKey()}`,
        },
        body: JSON.stringify({
          model: "lite",
          messages: [
            { role: "user", content: `你是一个写作助手。根据上文，自然流畅地补充一句话作为延续。\n\n上文：${context}` },
          ],
          max_tokens: 40,
          temperature: 0.3,
          stream: false,
        }),
      });

      // Stale request — a newer fetch has started
      if (seq !== this.fetchSeq) return;

      if (res.status !== 200) {
        console.warn(`[InlinePredict] API returned ${res.status}`);
        return;
      }

      const raw: string = res.json.choices?.[0]?.message?.content?.trim() || "";
      if (!raw) return;

      // Strip overlap: remove prefix of prediction that repeats context suffix
      const prediction = stripOverlap(context, raw);
      if (prediction.length < 2) return;

      this.view.dispatch({
        effects: setPrediction.of({ text: prediction, from: pos, display: prediction }),
      });
    } catch (err) {
      console.warn("[InlinePredict] request error:", err);
    }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
  }
}

// ============================================================
// Keymap: right arrow to accept prediction
// ============================================================
const predictKeymap = keymap.of([{
  key: "ArrowRight",
  run: (view) => {
    const pred = view.state.field(predictionField);
    if (!pred) return false;
    const cursor = view.state.selection.main.head;
    if (cursor !== pred.from || !view.state.selection.main.empty) return false;

    view.dispatch({
      changes: { from: cursor, insert: pred.display },
      effects: setPrediction.of(null),
      selection: { anchor: cursor + pred.display.length },
    });
    return true;
  },
}]);

// ============================================================
// Export
// ============================================================
export function createInlinePredictExtension(
  getSettings: () => HomepageSettings,
) {
  _getSettings = getSettings;
  return [
    predictionField,
    predictKeymap,
    ViewPlugin.fromClass(InlinePredictPlugin, {
      decorations: (v) => v.decorations,
    }),
  ];
}
