export interface CodeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
}

type LangHandler = (code: string) => { cmd: string; cleanup?: () => void };

// ============================================================
// Command builders
// ============================================================
const ESCAPED_QUOTE = /\\/g;
const SINGLE_QUOTE = /'/g;
const MAX_OUTPUT = 5000;
const EXEC_TIMEOUT = 10000;

function escapeForShell(code: string): string {
  return code.replace(ESCAPED_QUOTE, "\\\\").replace(SINGLE_QUOTE, "'\\''");
}

function interpretCmd(bin: string, flag: string, code: string): string {
  return `${bin} ${flag} '${escapeForShell(code)}'`;
}

function compiledCmd(
  ext: string,
  compiler: string,
  flags: string,
  code: string,
): { cmd: string; cleanup: () => void } {
  const cp = (window as any).require?.("child_process");
  const fs = (window as any).require?.("fs");
  if (!cp || !fs) throw new Error("child_process/fs not available");

  const id = Math.random().toString(36).slice(2, 8);
  const srcPath = `/tmp/obsidian-runner-${id}.${ext}`;
  const binPath = `/tmp/obsidian-runner-${id}`;

  fs.writeFileSync(srcPath, code, "utf-8");
  const compile = `${compiler} ${flags} -o "${binPath}" "${srcPath}"`;
  const cleanup = () => {
    try { fs.unlinkSync(srcPath); } catch { /* ignore */ }
    try { fs.unlinkSync(binPath); } catch { /* ignore */ }
  };
  return { cmd: `${compile} && "${binPath}"`, cleanup };
}

const HANDLERS: Record<string, LangHandler> = {
  python: (c) => ({ cmd: interpretCmd("python3", "-c", c) }),
  py: (c) => ({ cmd: interpretCmd("python3", "-c", c) }),
  javascript: (c) => ({ cmd: interpretCmd("node", "-e", c) }),
  js: (c) => ({ cmd: interpretCmd("node", "-e", c) }),
  bash: (c) => ({ cmd: interpretCmd("bash", "-c", c) }),
  sh: (c) => ({ cmd: interpretCmd("bash", "-c", c) }),
  shell: (c) => ({ cmd: interpretCmd("bash", "-c", c) }),
  c: (c) => compiledCmd("c", "clang", "-Wall -x c", c),
  cpp: (c) => compiledCmd("cpp", "clang++", "-Wall -x c++", c),
  "c++": (c) => compiledCmd("cpp", "clang++", "-Wall -x c++", c),
};

export function isSupported(lang: string): boolean {
  return lang.toLowerCase() in HANDLERS;
}

export function normalizedLang(lang: string): string {
  const l = lang.toLowerCase();
  return l === "py" ? "python"
    : l === "js" ? "javascript"
    : l === "sh" || l === "shell" ? "bash"
    : l === "c++" ? "cpp"
    : l;
}

// ============================================================
// Execution
// ============================================================
export async function executeCode(lang: string, code: string): Promise<CodeResult> {
  const handler = HANDLERS[lang.toLowerCase()];
  if (!handler) return { stdout: "", stderr: `Unsupported language: ${lang}`, exitCode: 1, timeMs: 0 };

  const trimmed = code.trimEnd();
  const cp = (window as any).require?.("child_process");
  if (!cp?.exec) return { stdout: "", stderr: "child_process not available", exitCode: 1, timeMs: 0 };

  let cleanup: (() => void) | undefined;
  let cmd: string;
  try {
    const result = handler(trimmed);
    cmd = result.cmd;
    cleanup = result.cleanup;
  } catch (err: any) {
    return { stdout: "", stderr: err.message || String(err), exitCode: 1, timeMs: 0 };
  }

  return new Promise((resolve) => {
    const start = Date.now();
    cp.exec(cmd, { timeout: EXEC_TIMEOUT, maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
      const timeMs = Date.now() - start;
      try { cleanup?.(); } catch { /* ignore */ }

      if (error?.killed || error?.signal === "SIGTERM") {
        resolve({ stdout: "", stderr: `Timeout (${EXEC_TIMEOUT / 1000}s)`, exitCode: -1, timeMs });
        return;
      }

      const out = stdout.slice(0, MAX_OUTPUT);
      const err = stderr.slice(0, MAX_OUTPUT);
      resolve({ stdout: out, stderr: err, exitCode: error?.code || 0, timeMs });
    });
  });
}

// ============================================================
// Output rendering (shared)
// ============================================================
export function renderOutput(container: HTMLElement, lang: string, result: CodeResult) {
  // Remove existing output
  const existing = container.querySelector(".code-runner-output") as HTMLElement | null;
  if (existing) existing.remove();

  const out = document.createElement("div");
  out.className = "code-runner-output";
  out.style.cssText = "margin-top: 4px; padding: 8px 12px; background: #1e1e1e; border-radius: 6px; font-family: 'SF Mono', Monaco, Menlo, monospace; font-size: 12px; line-height: 1.5; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;";

  const nl = normalizedLang(lang);

  // Header
  const header = document.createElement("div");
  header.style.cssText = "color: #888; font-size: 11px; margin-bottom: 4px; display: flex; gap: 8px;";
  header.textContent = `${nl} · ${result.timeMs}ms`;
  if (result.exitCode !== 0) {
    header.textContent += ` (exit: ${result.exitCode})`;
  }
  out.appendChild(header);

  // Stdout
  if (result.stdout) {
    const so = document.createElement("div");
    so.style.cssText = "color: #98c379;";
    so.textContent = result.stdout;
    out.appendChild(so);
  }

  // Stderr
  if (result.stderr) {
    const se = document.createElement("div");
    se.style.cssText = "color: #e06c75;";
    se.textContent = result.stderr;
    out.appendChild(se);
  }

  // Empty output
  if (!result.stdout && !result.stderr) {
    const empty = document.createElement("div");
    empty.style.cssText = "color: #666;";
    empty.textContent = "(no output)";
    out.appendChild(empty);
  }

  container.appendChild(out);
}
