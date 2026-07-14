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

export interface AppLauncherItem {
  id: string;
  name: string;
  icon: string;
  appName: string;
  command: string;
}

export interface AppLauncherSettings {
  apps: AppLauncherItem[];
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

export interface InlinePredictSettings {
  apiKey: string;
  debounceMs: number;
  contextChars: number;
}

export interface NoteAssistantSettings {
  syncNoteContent: boolean;
}

export interface MemoryReviewSettings {
  questionCount: number;  // 10 | 20 | 30 | 50
  mode: "cards" | "quiz";
}

export interface MemoryCard {
  question: string;
  answer: string;
}

export type QuizQuestion = MultipleChoiceQuestion | ShortAnswerQuestion;

export interface MultipleChoiceQuestion {
  type: "choice";
  question: string;
  options: string[];    // 4 options
  correctIndex: number; // 0-3
}

export interface ShortAnswerQuestion {
  type: "short";
  question: string;
  referenceAnswer: string;
}

export interface HomepageSettings {
  userName: string;
  todos: TodoItem[];
  components: ComponentInfo[];
  cardLayouts: Record<string, CardLayout>;
  desktopFolders: string[];
  desktopNames: string[];
  desktopCurrentPaths: string[];
  studyMode: StudySettings;
  llmWiki: LlmWikiSettings;
  appLauncher: AppLauncherSettings;
  inlinePredict: InlinePredictSettings;
  noteAssistant: NoteAssistantSettings;
  memoryReview: MemoryReviewSettings;
}
