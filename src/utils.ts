export function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getTimePeriod(hours: number): string {
  if (hours >= 6 && hours < 9) return "早上";
  if (hours >= 9 && hours < 12) return "上午";
  if (hours >= 12 && hours < 14) return "中午";
  if (hours >= 14 && hours < 19) return "下午";
  return "晚上";
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function formatDate(date: Date): string {
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const w = weekdays[date.getDay()];
  return `${y}年${m}月${d}日 ${w}`;
}

// ── macOS Keychain helpers ──────────────────────────────────

const KEYCHAIN_SERVICE = "obsidian-homepage-llmwiki";
const KEYCHAIN_ACCOUNT = "deepseek-api-key";

function getCp(): any {
  try {
    return (window as any).require?.("child_process");
  } catch {
    return null;
  }
}

export function saveApiKeyToKeychain(apiKey: string): boolean {
  const cp = getCp();
  if (!cp?.execSync) return false;
  try {
    // Delete existing entry first
    cp.execSync(
      `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
      { encoding: "utf-8" }
    );
    // Add new entry
    cp.execSync(
      `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${apiKey.replace(/"/g, '\\"')}" -U`,
      { encoding: "utf-8" }
    );
    return true;
  } catch {
    return false;
  }
}

export function loadApiKeyFromKeychain(): string | null {
  const cp = getCp();
  if (!cp?.execSync) return null;
  try {
    const result = cp.execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w 2>/dev/null`,
      { encoding: "utf-8" }
    );
    return result?.trim() || null;
  } catch {
    return null;
  }
}

export function deleteApiKeyFromKeychain(): boolean {
  const cp = getCp();
  if (!cp?.execSync) return false;
  try {
    cp.execSync(
      `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
      { encoding: "utf-8" }
    );
    return true;
  } catch {
    return false;
  }
}
