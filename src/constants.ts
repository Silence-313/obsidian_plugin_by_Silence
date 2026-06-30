import type { ComponentInfo, HomepageSettings, LlmWikiSettings, StudySettings } from "./types";

export const VIEW_TYPE_HOMEPAGE = "homepage-view";
export const VIEW_TYPE_STUDY = "study-mode-view";

export const DEFAULT_COMPONENTS: ComponentInfo[] = [
  { id: "schedule", name: "日程中心", added: true },
  { id: "timer", name: "计时器", added: false },
  { id: "desktop", name: "超级桌面", added: false },
  { id: "todolist", name: "待办列表", added: false },
  { id: "study", name: "学习模式", added: false },
  { id: "llmwiki", name: "LLM Wiki", added: false },
  { id: "wikigraph", name: "Wiki 图谱", added: false },
];

export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  defaultUrl: "",
  screenshotFormat: "png",
  screenshotQuality: 90,
  history: [],
};

export const DEFAULT_LLMWIKI_SETTINGS: LlmWikiSettings = {
  apiKey: "",
  apiKeyInKeychain: false,
  apiEndpoint: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  wikiFolder: "llm-wiki",
  autoMaintain: true,
  lastMaintenance: "",
};

export const DEFAULT_SETTINGS: HomepageSettings = {
  userName: "",
  todos: [],
  components: DEFAULT_COMPONENTS,
  cardLayouts: {},
  desktopFolders: [""],
  desktopNames: [""],
  studyMode: DEFAULT_STUDY_SETTINGS,
  llmWiki: DEFAULT_LLMWIKI_SETTINGS,
};

export const TODO_COLORS = [
  { value: "#e53935", label: "高" },
  { value: "#fb8c00", label: "中高" },
  { value: "#fdd835", label: "中" },
  { value: "#43a047", label: "低" },
];
