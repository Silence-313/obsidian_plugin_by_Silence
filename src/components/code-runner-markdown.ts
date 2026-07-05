import type HomepagePlugin from "../plugin";
import { executeCode, renderOutput } from "./code-runner";

const SUPPORTED_LANGS = ["python", "py", "javascript", "js", "bash", "sh", "shell", "c", "cpp", "c++"];

export function registerMarkdownCodeRunners(plugin: HomepagePlugin) {
  for (const lang of SUPPORTED_LANGS) {
    plugin.registerMarkdownCodeBlockProcessor(lang, (source, el) => {
      // Render the code block content
      const pre = el.createEl("pre");
      const codeEl = pre.createEl("code");
      codeEl.className = `language-${lang}`;
      codeEl.textContent = source;

      // Only add run button when component is enabled
      const enabled = plugin.settings.components.some(c => c.id === "coderunner" && c.added);
      if (!enabled) return;

      // Wrap pre + button in a relative container so the button positions correctly
      const wrap = el.createEl("div");
      wrap.className = "code-runner-wrap";
      wrap.style.position = "relative";
      // Move pre into wrap
      el.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const btn = document.createElement("button");
      btn.className = "code-runner-btn";
      btn.textContent = "▶";
      btn.title = `Run ${lang}`;
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (btn.disabled) return;

        const code = codeEl.textContent || source;
        btn.disabled = true;
        btn.classList.add("running");

        const result = await executeCode(lang, code);

        btn.disabled = false;
        btn.classList.remove("running");

        const existing = el.querySelector(".code-runner-output") as HTMLElement | null;
        if (existing) existing.remove();

        const outputWrap = el.createDiv("code-runner-output-wrapper");
        renderOutput(outputWrap, lang, result);
        outputWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });

      wrap.appendChild(btn);
    });
  }
}
