import type { TodoItem } from "../types";
import type HomepageView from "../view";
import { TODO_COLORS } from "../constants";
import { formatDateKey, escapeHtml } from "../utils";
import { TodoAddModal } from "../modals";

export class ScheduleComponent {
  private view: HomepageView;
  calendarYear: number;
  calendarMonth: number;
  selectedDate: string;
  private activeFilter: string | null = null;
  private searchQuery = "";

  constructor(view: HomepageView) {
    this.view = view;
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth();
    this.selectedDate = formatDateKey(now.getFullYear(), now.getMonth(), now.getDate());
  }

  getFilteredTodos(): TodoItem[] {
    return this.view.plugin.settings.todos.filter(t => {
      if (t.date !== this.selectedDate) return false;
      if (this.activeFilter && t.color !== this.activeFilter) return false;
      if (this.searchQuery && !t.text.toLowerCase().includes(this.searchQuery.toLowerCase())) return false;
      return true;
    });
  }

  getYesterdayKey(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() - 1);
    return formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
  }

  getDateColorStats(dateKey: string) {
    return TODO_COLORS.map(c => {
      const todos = this.view.plugin.settings.todos.filter(t => t.date === dateKey && t.color === c.value);
      return { color: c.value, label: c.label, total: todos.length, done: todos.filter(t => t.done).length };
    });
  }

  renderStats() {
    const statsContainer = this.view.containerEl.querySelector("#homepage-stats");
    if (!statsContainer) return;

    const stats = this.getDateColorStats(this.selectedDate);
    const [, m, d] = this.selectedDate.split("-");

    statsContainer.innerHTML = `
      <div style="font-size: 11px; font-weight: 600; color: var(--text-normal); margin-bottom: 3px;">
        ${Number(m)}月${Number(d)}日
      </div>
      ${stats.map(s => {
        const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
        return `
          <div style="display: flex; flex-direction: column; gap: 1px;">
            <div style="display: flex; align-items: center; gap: 3px;">
              <span style="
                width: 7px; height: 7px; border-radius: 50%; background: ${s.color}; flex-shrink: 0;
              "></span>
              <span style="font-size: 10px; color: var(--text-muted);">${s.label}</span>
              <span style="font-size: 10px; color: var(--text-faint); margin-left: auto;">${s.done}/${s.total}</span>
            </div>
            <div style="
              width: 100%; height: 3px; border-radius: 2px;
              background: var(--background-modifier-border);
              overflow: hidden;
            ">
              <div style="
                width: ${pct}%; height: 100%; border-radius: 2px;
                background: ${s.color};
                transition: width 0.3s;
              "></div>
            </div>
          </div>
        `;
      }).join("")}
      ${(() => {
        const yesterdayKey = this.getYesterdayKey(this.selectedDate);
        const undone = this.view.plugin.settings.todos.filter(t => t.date === yesterdayKey && !t.done);
        if (undone.length === 0) return "";
        const [, yMonth, yDay] = yesterdayKey.split("-");
        return `
          <div style="margin-top: 12px; border-top: 1px solid var(--background-modifier-border); padding-top: 8px;">
            <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
              <span>昨${Number(yMonth)}.${Number(yDay)}</span>
              <span class="yesterday-sync-all" style="cursor: pointer; color: var(--interactive-accent); font-weight: 400;">全→</span>
            </div>
            ${undone.map(t => `
              <div class="yesterday-item" data-id="${t.id}" style="
                display: flex; align-items: center; gap: 3px;
                padding: 2px 0; font-size: 10px;
              ">
                <span style="
                  width: 5px; height: 5px; border-radius: 50%; background: ${t.color}; flex-shrink: 0;
                "></span>
                <span style="
                  flex: 1; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                ">${escapeHtml(t.text)}</span>
                <span class="yesterday-sync-one" style="
                  cursor: pointer; color: var(--text-faint); font-size: 11px; flex-shrink: 0;
                ">→</span>
              </div>
            `).join("")}
          </div>
        `;
      })()}
      ${(() => {
        const doneToday = this.view.plugin.settings.todos.filter(t => t.date === this.selectedDate && t.done);
        if (doneToday.length === 0) return "";
        return `
          <div style="margin-top: 12px; border-top: 1px solid var(--background-modifier-border); padding-top: 8px;">
            <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">已完成</div>
            ${doneToday.map(t => `
              <div style="font-size: 10px; color: var(--text-faint); text-decoration: line-through; padding: 1px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span style="display:inline-block; width:5px; height:5px; border-radius:50%; background:${t.color}; vertical-align:middle; margin-right:3px;"></span>
                ${escapeHtml(t.text)}
              </div>
            `).join("")}
          </div>
        `;
      })()}
    `;

    statsContainer.querySelector(".yesterday-sync-all")?.addEventListener("click", () => this.view.syncAllYesterday());
    statsContainer.querySelectorAll(".yesterday-sync-one").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = (el as HTMLElement).parentElement;
        const id = parent?.dataset?.id;
        if (!id) return;
        this.view.syncTodoToToday(id);
      });
    });
  }

  renderCalendar() {
    const calContainer = this.view.containerEl.querySelector("#homepage-calendar");
    if (!calContainer) return;
    calContainer.empty();

    const today = new Date();
    const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
    const year = this.calendarYear;
    const month = this.calendarMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekHeaders = ["日", "一", "二", "三", "四", "五", "六"];

    const dateColorMap = new Map<string, Set<string>>();
    for (const t of this.view.plugin.settings.todos) {
      if (!dateColorMap.has(t.date)) dateColorMap.set(t.date, new Set());
      dateColorMap.get(t.date)!.add(t.color);
    }

    calContainer.innerHTML = `
      <div id="calendar-nav" style="
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 6px;
      ">
        <button id="calendar-prev" style="
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          padding: 2px 6px;
          border-radius: 4px;
          line-height: 1;
        ">◀</button>
        <span style="
          font-size: 14px;
          font-weight: 600;
          color: var(--text-normal);
          min-width: 90px;
          text-align: center;
        ">${year}年${month + 1}月</span>
        <button id="calendar-next" style="
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          padding: 2px 6px;
          border-radius: 4px;
          line-height: 1;
        ">▶</button>
        <button id="calendar-today-btn" style="
          background: transparent;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          padding: 1px 6px;
          line-height: 1.4;
        ">今天</button>
      </div>
      <div id="calendar-grid" style="
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 1px;
        text-align: center;
      ">
        ${weekHeaders.map(w => `
          <div style="
            font-size: 11px;
            color: var(--text-muted);
            padding: 3px 0;
            font-weight: 500;
          ">${w}</div>
        `).join("")}
        ${(() => {
          let cells = "";
          for (let i = 0; i < firstDay; i++) {
            cells += '<div></div>';
          }
          for (let d = 1; d <= daysInMonth; d++) {
            const key = formatDateKey(year, month, d);
            const isToday = key === todayKey;
            const isSelected = key === this.selectedDate;
            const dotColors = dateColorMap.get(key);

            let bg = "transparent";
            let color = "var(--text-normal)";
            let border = "2px solid transparent";

            if (isToday) {
              bg = "var(--interactive-accent)";
              color = "var(--text-on-accent)";
            }
            if (isSelected && !isToday) {
              border = "2px solid var(--interactive-accent)";
            }

            cells += `
              <div class="calendar-day" data-date="${key}" style="
                font-size: 12px;
                color: ${color};
                padding: 3px 0 10px 0;
                border-radius: 5px;
                cursor: pointer;
                background: ${bg};
                border: ${border};
                position: relative;
                transition: background 0.15s;
                box-sizing: border-box;
              ">${d}${dotColors && dotColors.size > 0 ? `
                <span style="
                  position: absolute;
                  bottom: 1px;
                  left: 50%;
                  transform: translateX(-50%);
                  display: flex;
                  gap: 1px;
                ">${TODO_COLORS.filter(c => dotColors.has(c.value)).map(c => `
                  <span style="
                    width: 3px;
                    height: 3px;
                    border-radius: 50%;
                    background: ${c.value};
                  "></span>
                `).join("")}</span>
              ` : ""}</div>
            `;
          }
          return cells;
        })()}
      </div>
    `;

    calContainer.querySelector("#calendar-prev")?.addEventListener("click", () => {
      this.calendarMonth--;
      if (this.calendarMonth < 0) {
        this.calendarMonth = 11;
        this.calendarYear--;
      }
      this.renderCalendar();
    });

    calContainer.querySelector("#calendar-next")?.addEventListener("click", () => {
      this.calendarMonth++;
      if (this.calendarMonth > 11) {
        this.calendarMonth = 0;
        this.calendarYear++;
      }
      this.renderCalendar();
    });

    calContainer.querySelector("#calendar-today-btn")?.addEventListener("click", () => {
      const now = new Date();
      this.selectedDate = formatDateKey(now.getFullYear(), now.getMonth(), now.getDate());
      this.calendarYear = now.getFullYear();
      this.calendarMonth = now.getMonth();
      this.renderStats();
      this.renderCalendar();
      this.renderTodo();
    });

    calContainer.querySelectorAll(".calendar-day").forEach(el => {
      el.addEventListener("click", (e) => {
        this.selectedDate = (e.currentTarget as HTMLElement).dataset.date!;
        this.renderStats();
        this.renderCalendar();
        this.renderTodo();
      });
    });
  }

  renderTodo() {
    if (this.view.isComponentAdded("todolist")) return;
    const todoContainer = this.view.containerEl.querySelector("#homepage-todo");
    if (!todoContainer) return;

    const filtered = this.getFilteredTodos();

    todoContainer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 13px; font-weight: 600; color: var(--text-normal); white-space: nowrap;">${(() => {
          const [, m, d] = this.selectedDate.split("-");
          return `${Number(m)}月${Number(d)}日`;
        })()}</span>
        <input id="todo-search" type="text" placeholder="搜索..." value="${this.searchQuery}" style="
          flex: 1;
          min-width: 0;
          background: var(--background-modifier-hover);
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          padding: 3px 6px;
          font-size: 12px;
          color: var(--text-normal);
          outline: none;
          font-family: inherit;
          box-sizing: border-box;
        "/>
        <button id="todo-add-btn" style="
          background: var(--interactive-accent);
          color: var(--text-on-accent);
          border: none;
          border-radius: 4px;
          padding: 1px 8px;
          font-size: 15px;
          line-height: 1.4;
          cursor: pointer;
          flex-shrink: 0;
        ">+</button>
      </div>
      <div id="todo-filters" style="display: flex; gap: 5px; flex-wrap: wrap;">
        ${TODO_COLORS.map(c => `
          <span class="todo-filter-chip" data-color="${c.value}" style="
            display: inline-block;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: ${c.value};
            cursor: pointer;
            opacity: ${this.activeFilter === null || this.activeFilter === c.value ? 1 : 0.3};
            outline: ${this.activeFilter === c.value ? "2px solid var(--text-normal)" : "none"};
            outline-offset: 1px;
          " title="${c.label}"></span>
        `).join("")}
        ${this.activeFilter !== null ? `
          <span id="todo-filter-clear" style="
            font-size: 11px;
            color: var(--text-muted);
            cursor: pointer;
            line-height: 14px;
          ">清除</span>
        ` : ""}
      </div>
      <div id="todo-list" style="display: flex; flex-direction: column; gap: 1px;">
        ${filtered.length === 0 ? `
          <div style="text-align: center; color: var(--text-faint); font-size: 12px; padding: 16px 0;">
            ${this.view.plugin.settings.todos.length === 0 ? "暂无待办，点击 + 添加" : this.view.plugin.settings.todos.some(t => t.date === this.selectedDate) ? "无匹配结果" : "该日期暂无待办"}
          </div>
        ` : filtered.map(todo => `
          <div class="todo-item" data-id="${todo.id}" style="
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 4px;
            border-radius: 4px;
            font-size: 12px;
          ">
            <span class="todo-check" style="
              cursor: pointer;
              font-size: 14px;
              color: ${todo.done ? "var(--text-faint)" : todo.color};
              flex-shrink: 0;
            ">${todo.done ? "☑" : "☐"}</span>
            <span style="
              flex: 1;
              color: var(--text-normal);
              text-decoration: ${todo.done ? "line-through" : "none"};
              opacity: ${todo.done ? 0.5 : 1};
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            ">${escapeHtml(todo.text)}</span>
            ${todo.startTime ? `<span style="font-size:10px; color:var(--text-faint); flex-shrink:0;">${todo.startTime}${todo.endTime ? `-${todo.endTime}` : ""}</span>` : ""}
            <span class="todo-delete" style="
              cursor: pointer;
              color: var(--text-faint);
              font-size: 13px;
              flex-shrink: 0;
              visibility: hidden;
            ">×</span>
          </div>
        `).join("")}
      </div>
    `;

    this.bindTodoEvents();
  }

  private bindTodoEvents() {
    this.view.containerEl.querySelector("#todo-add-btn")?.addEventListener("click", () => {
      new TodoAddModal(this.view.app, this.selectedDate, (text, color, date, startTime, endTime) => this.view.addTodo(text, color, date, startTime, endTime)).open();
    });

    this.view.containerEl.querySelector("#todo-search")?.addEventListener("input", (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.renderTodo();
    });

    this.view.containerEl.querySelectorAll(".todo-filter-chip").forEach(el => {
      el.addEventListener("click", (e) => {
        const color = (e.currentTarget as HTMLElement).dataset.color!;
        this.activeFilter = this.activeFilter === color ? null : color;
        this.renderTodo();
      });
    });

    this.view.containerEl.querySelector("#todo-filter-clear")?.addEventListener("click", () => {
      this.activeFilter = null;
      this.renderTodo();
    });

    this.view.containerEl.querySelectorAll(".todo-check").forEach(el => {
      el.addEventListener("click", (e) => {
        const parent = (e.currentTarget as HTMLElement).parentElement;
        const id = parent?.dataset?.id;
        if (!id) return;
        this.view.toggleTodo(id);
      });
    });

    this.view.containerEl.querySelectorAll(".todo-delete").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = (e.currentTarget as HTMLElement).parentElement;
        const id = parent?.dataset?.id;
        if (!id) return;
        this.view.deleteTodo(id);
      });
    });

    this.view.setupHoverDeleteButton(".todo-item", ".todo-delete");
  }
}
