// ── Read Local File Skill ────────────────────────────────────
// Safely reads files from within the Obsidian vault.
// Enforces strict security: no path traversal, no system files,
// restricted extensions only (.md, .txt, .json).

import type { Skill, SkillResult, SkillContext } from "./skill_registry";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const MAX_FILE_SIZE_BYTES = 500_000; // 500KB limit

async function execute(
  args: Record<string, unknown>,
  context: SkillContext,
): Promise<SkillResult> {
  const filePath = typeof args.path === "string" ? args.path.trim() : "";
  if (!filePath) {
    return { success: false, data: null, error: "path is required" };
  }

  // ── Security Checks ────────────────────────────────────────

  // 1. Block path traversal attempts
  if (filePath.includes("..")) {
    return {
      success: false,
      data: null,
      error: "Path traversal detected: '..' is not allowed",
    };
  }

  // 2. Block absolute paths
  if (filePath.startsWith("/") || /^[A-Za-z]:\\/.test(filePath)) {
    return {
      success: false,
      data: null,
      error: "Absolute paths are not allowed. Use a path relative to the vault root.",
    };
  }

  // 3. Validate file extension
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return {
      success: false,
      data: null,
      error: `File type "${ext || "unknown"}" is not allowed. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
    };
  }

  // 4. Heuristic: block common system paths
  const blockedPrefixes = ["/etc/", "/System/", "/proc/", "/dev/", "C:\\Windows\\", "/var/", "/tmp/"];
  const lowerPath = filePath.toLowerCase();
  for (const prefix of blockedPrefixes) {
    if (lowerPath.startsWith(prefix.toLowerCase())) {
      return { success: false, data: null, error: `Access to system path is not allowed` };
    }
  }

  // ── Read File ──────────────────────────────────────────────

  try {
    const vault = context.vault as { adapter?: { read: (path: string) => Promise<string> }; read?: (file: unknown) => Promise<string> } | undefined;

    if (!vault) {
      return { success: false, data: null, error: "Vault context is not available" };
    }

    // Use Obsidian Vault API if available
    let content: string;
    if (vault.adapter?.read) {
      content = await vault.adapter.read(filePath);
    } else {
      return { success: false, data: null, error: "Vault read API is not available in this context" };
    }

    // Enforce file size limit
    if (content.length > MAX_FILE_SIZE_BYTES) {
      return {
        success: true,
        data: {
          path: filePath,
          content: content.substring(0, MAX_FILE_SIZE_BYTES),
          truncated: true,
          totalSize: content.length,
          extension: ext,
        },
      };
    }

    return {
      success: true,
      data: {
        path: filePath,
        content,
        truncated: false,
        size: content.length,
        extension: ext,
      },
    };
  } catch (e: any) {
    // Check if file doesn't exist
    const msg = e?.message || String(e);
    if (msg.includes("ENOENT") || msg.includes("not found") || msg.includes("does not exist")) {
      return { success: false, data: null, error: `File not found: ${filePath}` };
    }
    return { success: false, data: null, error: `Failed to read file: ${msg}` };
  }
}

export const readLocalFileSkill: Skill = {
  name: "read_local_file",
  description: "读取 Obsidian vault 中的文件内容（仅限 .md/.txt/.json）。禁止路径遍历和绝对路径。",
  permissions: "privileged",
  execute,
};
