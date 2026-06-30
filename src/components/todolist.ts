import type { TodoItem } from "../types";
import type HomepageView from "../view";
import { formatDateKey, escapeHtml } from "../utils";
import { TodoAddModal } from "../modals";

export class TodoListComponent {
  private view: HomepageView;
  mode: "today" | "week" | "month" = "today";

  constructor(view: HomepageView) {
    this.view = view;
  }

  refresh() {
    if (this.view.isComponentAdded("schedule") && this.view.isComponentAdded("todolist")) {
      this.renderEmbedded();
    } else if (this.view.isComponentAdded("todolist")) {
      this.renderStandalone();
    }
  }

  // Embedded mode: render into schedule's right panel
  renderEmbedded() {
    const container = this.view.containerEl.querySelector("#homepage-todo");
    if (!container) return;

    const oldContent = container.querySelector("#homepage-todolist-embed-content");
    const scrollTop = oldContent ? oldContent.scrollTop : 0;

    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:4px; margin-bottom:6px; flex-shrink:0;">
        <span style="font-size:12px; font-weight:600; color:var(--text-normal);">待办</span>
        <div style="display:flex; gap:3px; flex:1;">
          ${(["today","week","month"] as const).map(m => {
            const labels: Record<string, string> = { today: "今天", week: "本周", month: "本月" };
            return `<button class="todolist-tab" data-mode="${m}" style="
              padding: 1px 6px;
              font-size: 10px;
              border-radius: 3px;
              border: 1px solid var(--background-modifier-border);
              background: ${this.mode === m ? "var(--interactive-accent)" : "transparent"};
              color: ${this.mode === m ? "var(--text-on-accent)" : "var(--text-muted)"};
              cursor: pointer;
              font-family: inherit;
              line-height: 1.5;
            ">${labels[m]}</button>`;
          }).join("")}
        </div>
        <button class="todolist-add" style="
          background: var(--interactive-accent);
          color: var(--text-on-accent);
          border: none;
          border-radius: 3px;
          padding: 0px 6px;
          font-size: 13px;
          line-height: 1.5;
          cursor: pointer;
          flex-shrink: 0;
        ">+</button>
      </div>
      <div id="homepage-todolist-embed-content" style="flex:1; overflow-y:auto;"></div>
    `;

    const newContent = container.querySelector("#homepage-todolist-embed-content") as HTMLElement;
    this.renderContent(newContent);
    newContent.scrollTop = scrollTop;
    this.bindEvents();
  }

  // Standalone mode: render into the separate todolist card
  renderStandalone() {
    const content = this.view.containerEl.querySelector("#homepage-todolist-content");
    if (!content) return;

    this.view.containerEl.querySelectorAll(".todolist-tab").forEach(el => {
      const mode = (el as HTMLElement).dataset.mode;
      const active = mode === this.mode;
      (el as HTMLElement).style.background = active ? "var(--interactive-accent)" : "transparent";
      (el as HTMLElement).style.color = active ? "var(--text-on-accent)" : "var(--text-muted)";
    });

    this.renderContent(content);
    this.bindEvents();
  }

  renderContent(content: Element) {
    const scrollTop = (content as HTMLElement).scrollTop;

    const today = new Date();
    const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());

    let dateFilter: (date: string) => boolean;
    if (this.mode === "today") {
      dateFilter = (d) => d === todayKey;
    } else if (this.mode === "week") {
      const { start, end } = this.getWeekRange();
      dateFilter = (d) => d >= start && d <= end;
    } else {
      const { start, end } = this.getMonthRange();
      dateFilter = (d) => d >= start && d <= end;
    }

    const todos = this.view.plugin.settings.todos.filter(t => dateFilter(t.date));

    if (this.mode === "today") {
      const timed = todos.filter(t => t.startTime && t.endTime);
      const untimed = todos.filter(t => !t.startTime || !t.endTime);

      if (timed.length > 0) {
        this.renderGanttView(content, timed, untimed);
      } else {
        this.renderSimpleList(content, todos, false);
      }
    } else {
      const grouped: Map<string, TodoItem[]> = new Map();
      for (const t of todos) {
        const list = grouped.get(t.date) || [];
        list.push(t);
        grouped.set(t.date, list);
      }
      const sortedDates = [...grouped.keys()].sort();

      if (sortedDates.length === 0) {
        content.innerHTML = `<div style="text-align:center; color:var(--text-faint); font-size:12px; padding:20px 0;">暂无待办</div>`;
      } else {
        content.innerHTML = sortedDates.map(dateKey => {
          const [, m, d] = dateKey.split("-").map(Number);
          const dateLabel = `${m}月${d}日`;
          const items = grouped.get(dateKey)!;
          return `
            <div style="margin-bottom: 10px;">
              <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:4px; padding-bottom:2px; border-bottom:1px solid var(--background-modifier-border);">${dateLabel}</div>
              ${items.map(todo => this.renderListItem(todo, true)).join("")}
            </div>
          `;
        }).join("");
      }
    }

    (content as HTMLElement).scrollTop = scrollTop;
  }

  private parseMinutes(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  }

  private formatDuration(startTime: string, endTime: string): string {
    const mins = this.parseMinutes(endTime) - this.parseMinutes(startTime);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}分钟`;
    if (m === 0) return `${h}小时`;
    return `${h}小时${m}分钟`;
  }

  private renderGanttView(container: Element, timed: TodoItem[], untimed: TodoItem[]) {
    const HOUR_H = 40;
    const LABEL_W = 42;
    const STRIP_W = 5;
    const BAR_LEFT = LABEL_W + 4;
    const BAR_RIGHT = 4;
    const LANE_GAP = 3;

    let minMin = 24 * 60, maxMin = 0;
    for (const t of timed) {
      if (t.startTime) minMin = Math.min(minMin, this.parseMinutes(t.startTime));
      if (t.endTime) maxMin = Math.max(maxMin, this.parseMinutes(t.endTime));
    }
    minMin = Math.min(minMin, 360);
    maxMin = Math.max(maxMin, 1380);
    const startHour = Math.floor(minMin / 60);
    const endHour = Math.ceil(maxMin / 60);
    const totalH = endHour - startHour;
    const totalHeight = totalH * HOUR_H;

    // Assign non-overlapping lanes to prevent text overlap
    const sorted = [...timed].sort((a, b) => {
      const sa = this.parseMinutes(a.startTime!);
      const sb = this.parseMinutes(b.startTime!);
      return sa !== sb ? sa - sb : this.parseMinutes(b.endTime!) - this.parseMinutes(a.endTime!);
    });
    const lanes: Array<{ endMin: number; todo: TodoItem }[]> = [];
    const todoLane: Map<string, number> = new Map();
    for (const t of sorted) {
      const sm = this.parseMinutes(t.startTime!);
      const em = this.parseMinutes(t.endTime!);
      let assigned = false;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i][lanes[i].length - 1].endMin <= sm) {
          lanes[i].push({ endMin: em, todo: t });
          todoLane.set(t.id, i);
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        lanes.push([{ endMin: em, todo: t }]);
        todoLane.set(t.id, lanes.length - 1);
      }
    }
    const laneCount = lanes.length;
    const totalBarW = `calc(100% - ${BAR_LEFT + BAR_RIGHT}px)`;

    let html = `<div style="position:relative; width:100%; height:${totalHeight + 16}px;">`;

    for (let h = startHour; h <= endHour; h++) {
      const top = (h - startHour) * HOUR_H;
      html += `<div style="position:absolute; left:0; top:${top}px; width:${LABEL_W - 4}px; font-size:10px; color:var(--text-faint); text-align:right; padding-right:4px; line-height:1;">${String(h).padStart(2,"0")}:00</div>`;
      html += `<div style="position:absolute; left:${BAR_LEFT}px; right:${BAR_RIGHT}px; top:${top}px; height:0; border-top:1px solid var(--background-modifier-border);"></div>`;
    }

    for (const t of timed) {
      const startMin = this.parseMinutes(t.startTime!);
      const endMin = this.parseMinutes(t.endTime!);
      const top = ((startMin - startHour * 60) / 60) * HOUR_H;
      const h = Math.max(16, ((endMin - startMin) / 60) * HOUR_H);
      const lane = todoLane.get(t.id) ?? 0;
      const laneW = `calc((${totalBarW} - ${(laneCount - 1) * LANE_GAP}px) / ${laneCount})`;
      const laneLeft = `calc(${BAR_LEFT}px + ${lane} * (${laneW} + ${LANE_GAP}px))`;

      html += `
        <div class="todolist-gantt-bar" data-id="${t.id}" style="
          position: absolute;
          left: ${laneLeft};
          width: ${laneW};
          top: ${top}px;
          height: ${h}px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          box-sizing: border-box;
        ">
          <div style="
            width: ${STRIP_W}px;
            height: 100%;
            min-height: 100%;
            background: ${t.color};
            border-radius: 3px;
            flex-shrink: 0;
            opacity: ${t.done ? 0.4 : 0.85};
          "></div>
          <div style="flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:1px;">
            <span style="font-size:11px; color:var(--text-normal); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.3; text-decoration:${t.done ? 'line-through' : 'none'}; opacity:${t.done ? 0.5 : 1};">${escapeHtml(t.text)}</span>
            <span style="font-size:10px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.3;">${t.startTime}-${t.endTime} · ${this.formatDuration(t.startTime!, t.endTime!)}</span>
          </div>
          <span class="todolist-delete" style="cursor:pointer; color:var(--text-faint); font-size:13px; flex-shrink:0; font-weight:bold; visibility:hidden; line-height:1;">×</span>
        </div>`;
    }

    html += `</div>`;

    if (untimed.length > 0) {
      html += `<div style="margin-top:12px; padding-top:8px; border-top:1px solid var(--background-modifier-border);">`;
      html += untimed.map(t => this.renderListItem(t, true)).join("");
      html += `</div>`;
    }

    container.innerHTML = html;
  }

  renderListItem(todo: TodoItem, showTime: boolean): string {
    const timeStr = (showTime && todo.startTime) ? ` ${todo.startTime}${todo.endTime ? `-${todo.endTime}` : ""}` : "";
    return `
      <div class="todolist-item" data-id="${todo.id}" style="display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:4px; font-size:12px;">
        <span class="todolist-check" style="cursor:pointer; font-size:14px; color:${todo.done ? 'var(--text-faint)' : todo.color}; flex-shrink:0;">${todo.done ? '☑' : '☐'}</span>
        <span style="flex:1; color:var(--text-normal); text-decoration:${todo.done ? 'line-through' : 'none'}; opacity:${todo.done ? 0.5 : 1}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(todo.text)}</span>
        ${timeStr ? `<span style="font-size:10px; color:var(--text-faint); flex-shrink:0;">${timeStr}</span>` : ""}
        <span class="todolist-delete" style="cursor:pointer; color:var(--text-faint); font-size:13px; flex-shrink:0; visibility:hidden;">×</span>
      </div>`;
  }

  private renderSimpleList(container: Element, todos: TodoItem[], showTime: boolean) {
    if (todos.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:var(--text-faint); font-size:12px; padding:20px 0;">暂无待办</div>`;
    } else {
      container.innerHTML = todos.map(t => this.renderListItem(t, showTime)).join("");
    }
  }

  bindEvents() {
    this.view.containerEl.querySelectorAll(".todolist-check").forEach(el => {
      el.addEventListener("click", (e) => {
        const parent = (e.currentTarget as HTMLElement).parentElement;
        const id = parent?.dataset?.id;
        if (!id) return;
        this.view.toggleTodo(id);
      });
    });

    this.view.containerEl.querySelectorAll(".todolist-delete").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = (e.currentTarget as HTMLElement).parentElement;
        const id = parent?.dataset?.id;
        if (!id) return;
        this.view.deleteTodo(id);
      });
    });

    this.view.setupHoverDeleteButton(".todolist-item", ".todolist-delete");

    this.view.containerEl.querySelectorAll(".todolist-gantt-bar").forEach(el => {
      el.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".todolist-delete")) return;
        const id = (e.currentTarget as HTMLElement).dataset.id!;
        this.view.toggleTodo(id);
      });
    });
    this.view.setupHoverDeleteButton(".todolist-gantt-bar", ".todolist-delete");

    this.view.containerEl.querySelectorAll(".todolist-tab").forEach(el => {
      el.addEventListener("click", (e) => {
        this.mode = (e.currentTarget as HTMLElement).dataset.mode as "today" | "week" | "month";
        this.refresh();
      });
    });

    this.view.containerEl.querySelector(".todolist-add")?.addEventListener("click", () => {
      const today = new Date();
      const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
      new TodoAddModal(this.view.app, todayKey, (text, color, date, startTime, endTime) => this.view.addTodo(text, color, date, startTime, endTime)).open();
    });
  }

  getWeekRange(): { start: string; end: string } {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: formatDateKey(monday.getFullYear(), monday.getMonth(), monday.getDate()),
      end: formatDateKey(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()),
    };
  }

  getMonthRange(): { start: string; end: string } {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      start: formatDateKey(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate()),
      end: formatDateKey(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate()),
    };
  }
}
