// ── User Profile ────────────────────────────────────────────
// Persistent structured user attributes.
// Stores stable facts about the user, distinct from episodic events.

export interface UserProfileData {
  // Basic info
  name: string;
  preferredName: string;
  role: string;
  timezone: string;
  language: string;

  // Interests & expertise
  interests: string[];
  expertise: string[];

  // Work patterns
  workHabits: string[];
  activeProjects: string[];
  commonTools: string[];

  // Communication preferences
  responseStyle: string;  // "concise" | "detailed" | "casual"
  preferredFormat: string; // "bullet" | "paragraph" | "mixed"

  // Goals & focus
  currentFocus: string[];
  longTermGoals: string[];

  // Meta
  lastUpdated: number;
  confidenceScores: Record<string, number>; // attribute → confidence 0..1
}

const DEFAULT_PROFILE: UserProfileData = {
  name: "",
  preferredName: "",
  role: "",
  timezone: "Asia/Shanghai",
  language: "zh-CN",
  interests: [],
  expertise: [],
  workHabits: [],
  activeProjects: [],
  commonTools: [],
  responseStyle: "concise",
  preferredFormat: "mixed",
  currentFocus: [],
  longTermGoals: [],
  lastUpdated: 0,
  confidenceScores: {},
};

function cloneProfileData(): UserProfileData {
  return {
    ...DEFAULT_PROFILE,
    interests: [...DEFAULT_PROFILE.interests],
    expertise: [...DEFAULT_PROFILE.expertise],
    workHabits: [...DEFAULT_PROFILE.workHabits],
    activeProjects: [...DEFAULT_PROFILE.activeProjects],
    commonTools: [...DEFAULT_PROFILE.commonTools],
    currentFocus: [...DEFAULT_PROFILE.currentFocus],
    longTermGoals: [...DEFAULT_PROFILE.longTermGoals],
    confidenceScores: { ...DEFAULT_PROFILE.confidenceScores },
  };
}

export class UserProfile {
  private data: UserProfileData = cloneProfileData();

  get profile(): Readonly<UserProfileData> {
    return this.data;
  }

  // ── Getters ───────────────────────────────────────────────

  get<K extends keyof UserProfileData>(key: K): UserProfileData[K] {
    return this.data[key];
  }

  // ── Setters with confidence tracking ──────────────────────

  set<K extends keyof UserProfileData>(key: K, value: UserProfileData[K], confidence: number = 0.5): void {
    this.data[key] = value;
    this.data.confidenceScores[key] = confidence;
    this.data.lastUpdated = Date.now();
  }

  // ── Array field helpers ──────────────────────────────────

  addToArray(field: "interests" | "expertise" | "workHabits" | "activeProjects" | "commonTools" | "currentFocus" | "longTermGoals", value: string): void {
    const arr = this.data[field];
    if (!arr.includes(value)) {
      arr.push(value);
      this.data.lastUpdated = Date.now();
    }
  }

  removeFromArray(field: "interests" | "expertise" | "workHabits" | "activeProjects" | "commonTools" | "currentFocus" | "longTermGoals", value: string): void {
    const arr = this.data[field];
    const idx = arr.indexOf(value);
    if (idx !== -1) {
      arr.splice(idx, 1);
      this.data.lastUpdated = Date.now();
    }
  }

  // ── Context formatting ────────────────────────────────────

  formatForContext(): string {
    const p = this.data;
    if (!p.name && p.interests.length === 0 && p.currentFocus.length === 0) {
      return "";
    }

    const lines: string[] = [];
    if (p.name) lines.push(`- 名称: ${p.name}`);
    if (p.role) lines.push(`- 角色: ${p.role}`);
    if (p.interests.length > 0) lines.push(`- 兴趣: ${p.interests.join(", ")}`);
    if (p.expertise.length > 0) lines.push(`- 专长: ${p.expertise.join(", ")}`);
    if (p.currentFocus.length > 0) lines.push(`- 当前关注: ${p.currentFocus.join(", ")}`);
    if (p.activeProjects.length > 0) lines.push(`- 活跃项目: ${p.activeProjects.join(", ")}`);
    if (p.workHabits.length > 0) lines.push(`- 工作习惯: ${p.workHabits.join(", ")}`);

    return lines.length > 0 ? `## 用户画像\n${lines.join("\n")}` : "";
  }

  // ── Serialization ─────────────────────────────────────────

  serialize(): string {
    return JSON.stringify(this.data, null, 2);
  }

  deserialize(json: string): void {
    try {
      const parsed = JSON.parse(json);
      this.data = { ...cloneProfileData(), ...parsed };
      if (!this.data.confidenceScores) this.data.confidenceScores = {};
    } catch {
      this.data = { ...DEFAULT_PROFILE };
    }
  }

  isInitialized(): boolean {
    return this.data.lastUpdated > 0;
  }
}
