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

export interface HomepageSettings {
  userName: string;
  todos: TodoItem[];
  components: ComponentInfo[];
  cardLayouts: Record<string, CardLayout>;
  desktopFolders: string[];
  desktopNames: string[];
}
