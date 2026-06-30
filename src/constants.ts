import type { ComponentInfo, HomepageSettings } from "./types";

export const VIEW_TYPE_HOMEPAGE = "homepage-view";

export const DEFAULT_COMPONENTS: ComponentInfo[] = [
  { id: "schedule", name: "日程中心", added: true },
  { id: "timer", name: "计时器", added: false },
  { id: "desktop", name: "超级桌面", added: false },
  { id: "todolist", name: "待办列表", added: false },
];

export const DEFAULT_SETTINGS: HomepageSettings = {
  userName: "",
  todos: [],
  components: DEFAULT_COMPONENTS,
  cardLayouts: {},
  desktopFolders: [""],
  desktopNames: [""],
};

export const TODO_COLORS = [
  { value: "#e53935", label: "高" },
  { value: "#fb8c00", label: "中高" },
  { value: "#fdd835", label: "中" },
  { value: "#43a047", label: "低" },
];
