export interface TodoItem {
  id: string;
  text: string;
  color: string;
  done: boolean;
  date: string;
  startTime?: string;
  endTime?: string;
}

export interface ComponentInfo {
  id: string;
  name: string;
  added: boolean;
}

export interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudySettings {
  defaultUrl: string;
  screenshotFormat: "png" | "jpg";
  screenshotQuality: number;
  history: string[];
}

export interface LlmWikiSettings {
  apiKey: string;
  apiKeyInKeychain: boolean;
  apiEndpoint: string;
  model: string;
  wikiFolder: string;
  autoMaintain: boolean;
  lastMaintenance: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "activity";
  content: string;
  timestamp: number;
}

export interface HomepageSettings {
  userName: string;
  todos: TodoItem[];
  components: ComponentInfo[];
  cardLayouts: Record<string, CardLayout>;
  desktopFolders: string[];
  desktopNames: string[];
  studyMode: StudySettings;
  llmWiki: LlmWikiSettings;
}
