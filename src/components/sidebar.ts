import type HomepageView from "../view";

export class SidebarComponent {
  private view: HomepageView;
  isOpen = false;
  searchQuery = "";
  private searchTimer: number | null = null;

  constructor(view: HomepageView) {
    this.view = view;
  }

  render() {
    const sidebar = this.view.containerEl.querySelector("#homepage-sidebar") as HTMLElement;
    if (!sidebar) return;

    const isOpen = this.isOpen;
    sidebar.style.width = isOpen ? "236px" : "28px";
    sidebar.style.minWidth = isOpen ? "236px" : "28px";

    const header = this.view.containerEl.querySelector("#homepage-header") as HTMLElement;
    sidebar.style.top = header ? header.offsetHeight + "px" : "48px";

    let overlay = this.view.containerEl.querySelector("#homepage-overlay") as HTMLElement;
    if (isOpen) {
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "homepage-overlay";
        const content = this.view.containerEl.querySelector("#homepage-content") as HTMLElement;
        content?.appendChild(overlay);
        overlay.addEventListener("click", () => {
          this.isOpen = false;
          this.render();
        });
      }
      overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        background: transparent;
        pointer-events: auto;
      `;
    } else if (overlay) {
      overlay.remove();
    }

    sidebar.innerHTML = `
      <div id="sidebar-toggle" style="
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 6px;
        cursor: pointer;
        color: var(--text-muted);
        font-size: 13px;
        white-space: nowrap;
        border-bottom: ${isOpen ? "1px solid var(--background-modifier-border)" : "none"};
        user-select: none;
      ">
        <span style="font-size: 12px;">${isOpen ? "▶" : "◀"}</span>
        ${isOpen ? '<span style="font-size: 13px;">组件列表</span>' : ""}
      </div>
      ${isOpen ? `
        <div style="padding: 10px 10px 0 10px;">
          <input id="sidebar-search" type="text" placeholder="搜索组件..." value="${this.searchQuery}" style="
            width: 100%;
            padding: 5px 8px;
            font-size: 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 5px;
            background: var(--background-modifier-hover);
            color: var(--text-normal);
            outline: none;
            font-family: inherit;
            box-sizing: border-box;
          "/>
        </div>
        <div style="
          flex: 1;
          overflow-y: auto;
          padding: 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        ">
          ${this.renderComponentSection("added", "已添加组件")}
          ${this.renderComponentSection("pending", "待添加组件")}
        </div>
      ` : ""}
    `;

    sidebar.querySelector("#sidebar-toggle")?.addEventListener("click", () => {
      this.isOpen = !this.isOpen;
      if (!this.isOpen) this.searchQuery = "";
      this.render();
    });

    sidebar.querySelector("#sidebar-search")?.addEventListener("input", (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      if (this.searchTimer) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = null;
        this.render();
      }, 150);
    });

    if (isOpen) this.bindDragEvents();
  }

  componentIcon(id: string): string {
    const icons: Record<string, string> = {
      schedule: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="4" y="5" width="20" height="19" rx="2"/><line x1="4" y1="11" x2="24" y2="11"/><line x1="9" y1="2" x2="9" y2="7"/><line x1="19" y1="2" x2="19" y2="7"/><line x1="10" y1="15" x2="18" y2="15"/><line x1="12" y1="19" x2="16" y2="19"/></svg>`,
      timer: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><circle cx="14" cy="15" r="9"/><line x1="14" y1="15" x2="14" y2="9"/><line x1="14" y1="15" x2="17" y2="15"/><line x1="11" y1="3" x2="17" y2="3"/><line x1="14" y1="3" x2="14" y2="6"/></svg>`,
      desktop: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="2" y="3" width="24" height="17" rx="2"/><line x1="8" y1="23" x2="20" y2="23"/><line x1="14" y1="20" x2="14" y2="23"/></svg>`,
      todolist: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="5" y="4" width="18" height="20" rx="2"/><line x1="9" y1="10" x2="19" y2="10"/><line x1="9" y1="14" x2="19" y2="14"/><line x1="9" y1="18" x2="15" y2="18"/></svg>`,
      study: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="2" y="4" width="24" height="17" rx="2"/><line x1="6" y1="8" x2="22" y2="8"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="14" y2="16"/></svg>`,
    };
    return icons[id] || `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"><rect x="4" y="4" width="20" height="20" rx="3"/></svg>`;
  }

  private renderComponentSection(zone: "added" | "pending", title: string): string {
    const q = this.searchQuery.toLowerCase().trim();
    const comps = this.view.plugin.settings.components.filter(
      c => c.added === (zone === "added") && (!q || c.name.toLowerCase().includes(q))
    );
    return `
      <div>
        <div style="
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          margin-bottom: 8px;
          letter-spacing: 0.5px;
        ">${title}</div>
        <div class="component-drop-zone" data-zone="${zone}" style="
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-height: ${comps.length === 0 ? "48px" : "0"};
          border-radius: 6px;
          transition: background 0.15s;
          padding: 2px;
        ">
          ${comps.length === 0 ? `
            <div style="
              font-size: 12px;
              color: var(--text-faint);
              text-align: center;
              width: 100%;
              padding: 12px 0;
            ">暂无</div>
          ` : comps.map(c => `
            <div class="component-card" draggable="true" data-id="${c.id}" style="
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 4px;
              width: 64px;
              cursor: grab;
              user-select: none;
            ">
              <div style="
                width: 48px;
                height: 48px;
                border-radius: 8px;
                border: 1.5px solid var(--background-modifier-border);
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-muted);
                background: var(--background-modifier-hover);
              ">${this.componentIcon(c.id)}</div>
              <span style="
                font-size: 11px;
                color: var(--text-muted);
                text-align: center;
                line-height: 1.3;
              ">${c.name}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  private bindDragEvents() {
    const cards = this.view.containerEl.querySelectorAll(".component-card");
    const zones = this.view.containerEl.querySelectorAll(".component-drop-zone");

    cards.forEach(card => {
      card.addEventListener("dragstart", (e) => {
        (e as DragEvent).dataTransfer!.setData("text/plain", (card as HTMLElement).dataset.id!);
        (card as HTMLElement).style.opacity = "0.5";
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).style.opacity = "1";
        zones.forEach(z => (z as HTMLElement).style.background = "");
      });
      card.addEventListener("click", () => {
        const id = (card as HTMLElement).dataset.id!;
        const comp = this.view.plugin.settings.components.find(c => c.id === id);
        if (comp) {
          comp.added = !comp.added;
          this.view.plugin.saveSettings().catch(console.error);
          this.render();
          this.view.render();
        }
      });
    });

    zones.forEach(zone => {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
        (zone as HTMLElement).style.background = "var(--background-modifier-hover)";
      });
      zone.addEventListener("dragleave", () => {
        (zone as HTMLElement).style.background = "";
      });
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        (zone as HTMLElement).style.background = "";
        const id = (e as DragEvent).dataTransfer!.getData("text/plain");
        const targetZone = (zone as HTMLElement).dataset.zone!;
        const comp = this.view.plugin.settings.components.find(c => c.id === id);
        if (comp && comp.added !== (targetZone === "added")) {
          comp.added = targetZone === "added";
          this.view.plugin.saveSettings().catch(console.error);
          this.render();
          this.view.render();
        }
      });
    });
  }
}
