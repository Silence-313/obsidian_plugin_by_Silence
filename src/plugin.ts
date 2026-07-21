import { Plugin } from "obsidian";
import type { HomepageSettings } from "./types";
import { VIEW_TYPE_HOMEPAGE, VIEW_TYPE_STUDY, DEFAULT_COMPONENTS, DEFAULT_SETTINGS, DEFAULT_STUDY_SETTINGS, DEFAULT_LLMWIKI_SETTINGS, DEFAULT_APP_LAUNCHER_SETTINGS, DEFAULT_INLINE_PREDICT_SETTINGS, DEFAULT_NOTE_ASSISTANT_SETTINGS, DEFAULT_MEMORY_REVIEW_SETTINGS } from "./constants";
import { loadApiKeyFromKeychain } from "./utils";
import HomepageView from "./view";
import StudyView from "./study-view";
import { StudyController } from "./study-controller";
import { HomepageSettingTab } from "./settings";
import { createInlinePredictExtension } from "./components/inline-predict";
import { registerMarkdownCodeRunners } from "./components/code-runner-markdown";
import { createCodeRunnerEditorExtension } from "./components/code-runner-editor";
import { NoteAssistantComponent } from "./components/note-assistant";

export default class HomepagePlugin extends Plugin {
  settings: HomepageSettings = DEFAULT_SETTINGS;
  studyController!: StudyController;
  noteAssistant: NoteAssistantComponent | null = null;
  private studyCloseTimer: number | null = null;
  private noteAssistantCloseTimer: number | null = null;
  private wikiMaintenanceTimer: number | null = null;

  async onload() {
    await this.loadSettings();

    this.studyController = new StudyController(this);

    this.registerView(VIEW_TYPE_HOMEPAGE, (leaf) => new HomepageView(leaf, this));
    this.registerView(VIEW_TYPE_STUDY, (leaf) => new StudyView(leaf, this, this.studyController));

    this.addCommand({
      id: "open-homepage",
      name: "打开首页",
      callback: () => this.openHomepage(),
    });

    this.addCommand({
      id: "open-study-mode",
      name: "打开学习模式",
      callback: () => this.studyController.openStudyMode(),
    });

    this.addCommand({
      id: "close-study-mode",
      name: "关闭学习模式",
      callback: () => this.studyController.closeStudyMode(),
    });

    this.addCommand({
      id: "study-capture-screenshot",
      name: "学习模式：截图",
      callback: () => this.studyController.captureScreenshot(),
    });

    this.addCommand({
      id: "llmwiki-maintain",
      name: "LLM Wiki：维护知识库",
      callback: () => this.runWikiMaintenance(),
    });

    this.addCommand({
      id: "open-note-assistant",
      name: "打开笔记助手",
      callback: () => this.showNoteAssistant(),
    });

    this.addCommand({
      id: "toggle-note-assistant",
      name: "笔记助手：显示/隐藏",
      callback: () => this.toggleNoteAssistant(),
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.studyController.isEnabled()) return;
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STUDY);

        // Check if any markdown views exist
        const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
        if (mdLeaves.length === 0) {
          // debounce close — leaf removal may fire before getLeavesOfType updates
          if (this.studyCloseTimer) window.clearTimeout(this.studyCloseTimer);
          this.studyCloseTimer = window.setTimeout(() => {
            this.studyCloseTimer = null;
            if (this.app.workspace.getLeavesOfType("markdown").length === 0) {
              this.studyController.closeStudyMode();
            }
          }, 200);
          return;
        }

        // markdown exists — cancel any pending close, open study if needed
        if (this.studyCloseTimer) {
          window.clearTimeout(this.studyCloseTimer);
          this.studyCloseTimer = null;
        }
        if (existing.length > 0) return;
        this.studyController.openStudyMode();
      })
    );

    // Note Assistant: auto show/hide when editing markdown
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.handleNoteAssistantVisibility();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOMEPAGE);
      if (existing.length === 0) {
        this.openHomepage();
      }
    });

    this.registerEditorExtension(
      createInlinePredictExtension(() => this.settings),
    );

    this.registerEditorExtension(
      createCodeRunnerEditorExtension(() => this.settings),
    );

    registerMarkdownCodeRunners(this);

    this.startWikiMaintenanceTimer();
    this.addSettingTab(new HomepageSettingTab(this.app, this));
  }

  onunload() {
    if (this.wikiMaintenanceTimer !== null) {
      window.clearInterval(this.wikiMaintenanceTimer);
      this.wikiMaintenanceTimer = null;
    }
    this.destroyNoteAssistant();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_HOMEPAGE);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STUDY);
  }

  private startWikiMaintenanceTimer() {
    // Check every 60 seconds if it's 13:00
    this.wikiMaintenanceTimer = window.setInterval(() => {
      if (!this.settings.llmWiki.autoMaintain) return;
      if (!this.settings.llmWiki.apiKeyInKeychain && !this.settings.llmWiki.apiKey) return;

      const now = new Date();
      if (now.getHours() === 13 && now.getMinutes() === 0) {
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        if (this.settings.llmWiki.lastMaintenance.startsWith(today)) return;

        this.runWikiMaintenance();
      }
    }, 60000);
  }

  async runWikiMaintenance() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOMEPAGE);
    if (leaves.length === 0) return;

    const view = leaves[0].view as any;
    if (view?.llmwiki?.buildWiki) {
      await view.llmwiki.buildWiki();
    }
  }

  async openHomepage() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOMEPAGE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_HOMEPAGE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // Deep-copy components so mutations don't leak into DEFAULT_COMPONENTS
    this.settings.components = this.settings.components.map(c => ({ ...c }));
    for (const dc of DEFAULT_COMPONENTS) {
      if (!this.settings.components.some(c => c.id === dc.id)) {
        this.settings.components.push({ ...dc });
      }
    }
    if (!this.settings.studyMode) {
      this.settings.studyMode = Object.assign({}, DEFAULT_STUDY_SETTINGS);
    } else {
      this.settings.studyMode = Object.assign({}, DEFAULT_STUDY_SETTINGS, this.settings.studyMode);
    }
    if (!this.settings.llmWiki) {
      this.settings.llmWiki = Object.assign({}, DEFAULT_LLMWIKI_SETTINGS);
    } else {
      this.settings.llmWiki = Object.assign({}, DEFAULT_LLMWIKI_SETTINGS, this.settings.llmWiki);
    }
    if (!this.settings.appLauncher) {
      this.settings.appLauncher = Object.assign({}, DEFAULT_APP_LAUNCHER_SETTINGS);
    } else {
      this.settings.appLauncher = Object.assign({}, DEFAULT_APP_LAUNCHER_SETTINGS, this.settings.appLauncher);
    }
    if (!this.settings.inlinePredict) {
      this.settings.inlinePredict = Object.assign({}, DEFAULT_INLINE_PREDICT_SETTINGS);
    } else {
      this.settings.inlinePredict = Object.assign({}, DEFAULT_INLINE_PREDICT_SETTINGS, this.settings.inlinePredict);
    }
    if (!this.settings.noteAssistant) {
      this.settings.noteAssistant = Object.assign({}, DEFAULT_NOTE_ASSISTANT_SETTINGS);
    } else {
      this.settings.noteAssistant = Object.assign({}, DEFAULT_NOTE_ASSISTANT_SETTINGS, this.settings.noteAssistant);
    }
    if (!this.settings.memoryReview) {
      this.settings.memoryReview = Object.assign({}, DEFAULT_MEMORY_REVIEW_SETTINGS);
    } else {
      this.settings.memoryReview = Object.assign({}, DEFAULT_MEMORY_REVIEW_SETTINGS, this.settings.memoryReview);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Note Assistant ──────────────────────────────────────────

  private handleNoteAssistantVisibility() {
    const enabled = this.settings.components.some(
      c => c.id === "noteassistant" && c.added
    );
    if (!enabled) {
      this.destroyNoteAssistant();
      return;
    }

    // Check if the active leaf is a markdown editor (not just whether any md leaves exist)
    const activeLeaf = this.app.workspace.activeLeaf;
    const isActiveMarkdown = activeLeaf?.view?.getViewType() === "markdown";

    if (!isActiveMarkdown) {
      // User switched away from markdown → hide completely (no FAB on homepage)
      this.noteAssistant?.hide();
      return;
    }

    // Active leaf IS markdown: create/restore floating window
    if (!this.noteAssistant || this.noteAssistant.isDestroyed()) {
      this.noteAssistant = new NoteAssistantComponent(this);
    }

    if (this.noteAssistant.isMinimized() || !this.noteAssistant.isVisible()) {
      this.noteAssistant.restore();
    }

    // Update current note name + trigger summary on note change
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.noteAssistant.updateNoteInfo(activeFile.name);
      // Silently summarize when switching to a new note
      if (activeFile.path !== this._lastNoteAssistantPath) {
        this._lastNoteAssistantPath = activeFile.path;
        this.noteAssistant.summarizeCurrentNote();
      }
    }
  }

  private _lastNoteAssistantPath = "";

  showNoteAssistant() {
    if (!this.noteAssistant || this.noteAssistant.isDestroyed()) {
      this.noteAssistant = new NoteAssistantComponent(this);
    }
    this.noteAssistant.restore();
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.noteAssistant.updateNoteInfo(activeFile.name);
    }
  }

  toggleNoteAssistant() {
    if (this.noteAssistant && this.noteAssistant.isVisible() && !this.noteAssistant.isMinimized()) {
      this.noteAssistant.minimize();
    } else {
      this.showNoteAssistant();
    }
  }

  destroyNoteAssistant() {
    if (this.noteAssistant) {
      this.noteAssistant.destroy();
      this.noteAssistant = null;
    }
  }
}
