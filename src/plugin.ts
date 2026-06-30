import { Plugin } from "obsidian";
import type { HomepageSettings } from "./types";
import { VIEW_TYPE_HOMEPAGE, DEFAULT_COMPONENTS, DEFAULT_SETTINGS } from "./constants";
import HomepageView from "./view";
import { HomepageSettingTab } from "./settings";

export default class HomepagePlugin extends Plugin {
  settings: HomepageSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_HOMEPAGE, (leaf) => new HomepageView(leaf, this));

    this.addCommand({
      id: "open-homepage",
      name: "打开首页",
      callback: () => this.openHomepage(),
    });

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
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
