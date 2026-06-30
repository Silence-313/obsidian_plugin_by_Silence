import { Plugin } from "obsidian";
import type { HomepageSettings } from "./types";
import { VIEW_TYPE_HOMEPAGE, VIEW_TYPE_STUDY, DEFAULT_COMPONENTS, DEFAULT_SETTINGS, DEFAULT_STUDY_SETTINGS } from "./constants";
import HomepageView from "./view";
import StudyView from "./study-view";
import { StudyController } from "./study-controller";
import { HomepageSettingTab } from "./settings";

export default class HomepagePlugin extends Plugin {
  settings: HomepageSettings = DEFAULT_SETTINGS;
  studyController!: StudyController;
  private studyCloseTimer: number | null = null;

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

    this.app.workspace.onLayoutReady(() => {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOMEPAGE);
      if (existing.length === 0) {
        this.openHomepage();
      }
    });

    this.addSettingTab(new HomepageSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_HOMEPAGE);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STUDY);
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
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
