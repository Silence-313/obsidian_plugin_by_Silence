import type { AppLauncherSettings, ComponentInfo, HomepageSettings, LlmWikiSettings, StudySettings } from "./types";

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
  { id: "applauncher", name: "应用启动器", added: false },
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

export const DEFAULT_APP_LAUNCHER_SETTINGS: AppLauncherSettings = {
  apps: [
    { id: "vscode", name: "VS Code", icon: "💻", appName: "Visual Studio Code", command: "open -a 'Visual Studio Code'" },
    { id: "terminal", name: "终端", icon: "⬛", appName: "Terminal", command: "open -a Terminal" },
    { id: "browser", name: "浏览器", icon: "🌐", appName: "Google Chrome", command: "open -a 'Google Chrome'" },
    { id: "finder", name: "访达", icon: "📁", appName: "Finder", command: "open -a Finder" },
    { id: "notes", name: "备忘录", icon: "📝", appName: "Notes", command: "open -a Notes" },
    { id: "calendar", name: "日历", icon: "📅", appName: "Calendar", command: "open -a Calendar" },
    { id: "music", name: "音乐", icon: "🎵", appName: "Music", command: "open -a Music" },
    { id: "settings", name: "系统设置", icon: "⚙️", appName: "System Settings", command: "open -a 'System Settings'" },
  ],
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
  appLauncher: DEFAULT_APP_LAUNCHER_SETTINGS,
};

export const TODO_COLORS = [
  { value: "#e53935", label: "高" },
  { value: "#fb8c00", label: "中高" },
  { value: "#fdd835", label: "中" },
  { value: "#43a047", label: "低" },
];
