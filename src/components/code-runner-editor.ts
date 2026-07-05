import {
  ViewPlugin, ViewUpdate, Decoration, DecorationSet,
  WidgetType, EditorView, keymap,
} from "@codemirror/view";
import { StateField, StateEffect, EditorSelection } from "@codemirror/state";
import { executeCode, renderOutput, isSupported, normalizedLang } from "./code-runner";
import type { HomepageSettings } from "../types";

// ============================================================
// Output state
// ============================================================
interface OutputEntry {
  result: { stdout: string; stderr: string; exitCode: number; timeMs: number };
  lang: string;
}

let _getSettings: (() => HomepageSettings) | null = null;

function isEnabled(): boolean {
  const s = _getSettings?.();
  if (!s) return false;
  return s.components.some(c => c.id === "coderunner" && c.added);
}

// ============================================================
// Output tracking
// ============================================================
const outputs = new Map<number, OutputEntry>();

// ============================================================
// Run button widget
// ============================================================
class RunBtnWidget extends WidgetType {
  private running = false;

  constructor(
    private lang: string,
    private code: string,
    private blockId: number,
    private view: EditorView,
  ) { super(); }

  toDOM() {
    const btn = document.createElement("span");
    btn.className = "cm-run-btn";
    btn.textContent = "▶";
    btn.title = `Run ${normalizedLang(this.lang)}`;
    btn.style.cssText = "cursor:pointer;opacity:0.55;font-size:11px;padding:0 4px;border-radius:3px;background:var(--background-modifier-hover);color:var(--text-muted);user-select:none;";
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; btn.style.background = "var(--interactive-accent)"; btn.style.color = "#fff"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.55"; btn.style.background = "var(--background-modifier-hover)"; btn.style.color = "var(--text-muted)"; });
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (this.running) return;
      this.running = true;
      btn.textContent = "●";
      btn.style.opacity = "1";

      const result = await executeCode(this.lang, this.code);

      this.running = false;
      btn.textContent = "▶";
      btn.style.opacity = "0.45";

      // Check if the blockId position is still valid
      const mappedPos = this.blockId;
      outputs.set(mappedPos, { result, lang: this.lang });

      this.view.dispatch({ effects: refreshOutputs.of(null) });
    });
    return btn;
  }

  ignoreEvent() { return false; }
}

// ============================================================
// Output widget (block-level)
// ============================================================
class OutputWidget extends WidgetType {
  constructor(private result: OutputEntry["result"], private lang: string) { super(); }

  toDOM() {
    const el = document.createElement("div");
    el.style.cssText = "margin-top:2px;";
    renderOutput(el, this.lang, this.result);
    return el;
  }

  get estimatedHeight() { return 40; }
}

// ============================================================
// State effect
// ============================================================
const refreshOutputs = StateEffect.define<null>();

// ============================================================
// View plugin
// ============================================================
const codeRunnerPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none;

  constructor(readonly view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate) {
    if (!isEnabled()) {
      this.decorations = Decoration.none;
      return;
    }

    if (update.docChanged) {
      // Remap output positions through changes
      const newOutputs = new Map<number, OutputEntry>();
      for (const [pos, out] of outputs) {
        newOutputs.set(update.changes.mapPos(pos), out);
      }
      outputs.clear();
      for (const [pos, out] of newOutputs) outputs.set(pos, out);
    }

    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.build(update.view);
    }
  }

  private build(view: EditorView): DecorationSet {
    const widgets: any[] = [];
    const doc = view.state.doc.toString();
    const re = /^```(\w+)\n([\s\S]*?)^```/gm;
    let m: RegExpExecArray | null;

    while ((m = re.exec(doc)) !== null) {
      const lang = m[1].toLowerCase();
      if (!isSupported(lang)) continue;

      const code = m[2];
      const buttonPos = m.index + m[0].length; // after closing ```

      // Run button
      widgets.push(Decoration.widget({
        widget: new RunBtnWidget(lang, code, m.index, view),
        side: 1,
      }).range(buttonPos));

      // Output (if any)
      const out = outputs.get(m.index);
      if (out) {
        widgets.push(Decoration.widget({
          widget: new OutputWidget(out.result, out.lang),
          block: true,
          side: 1,
        }).range(m.index + m[0].length));
      }
    }

    return Decoration.set(widgets.sort((a, b) => (a as any).from - (b as any).from));
  }

  destroy() {
    outputs.clear();
  }
}, { decorations: v => v.decorations });

// ============================================================
// Export
// ============================================================
export function createCodeRunnerEditorExtension(
  getSettings: () => HomepageSettings,
) {
  _getSettings = getSettings;
  return codeRunnerPlugin;
}
