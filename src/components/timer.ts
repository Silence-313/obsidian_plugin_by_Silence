import type HomepageView from "../view";

export class TimerComponent {
  private view: HomepageView;
  timerHours = 0;
  timerMinutes = 5;
  timerSeconds = 0;
  timerRemaining = 0;
  timerRunning = false;
  timerFinished = false;
  timerDisplayMode: "clock" | "digital" = "clock";
  private timerIntervalId: number | null = null;
  private outsideClickHandler: ((e: Event) => void) | null = null;

  constructor(view: HomepageView) {
    this.view = view;
  }

  cleanup() {
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  init() {
    this.updateTimerDisplay();

    this.view.containerEl.querySelectorAll(".timer-picker-wrap").forEach(wrap => {
      const el = wrap as HTMLElement;
      const field = el.dataset.field!;
      const label = el.querySelector(".timer-picker-label") as HTMLElement;
      const scroll = el.querySelector(".timer-picker-scroll") as HTMLElement;

      const getVal = () => field === "h" ? this.timerHours : field === "m" ? this.timerMinutes : this.timerSeconds;
      const max = field === "h" ? 99 : 59;

      const isOpen = () => scroll.style.display !== "none";

      const apply = (val: number) => {
        const v = Math.max(0, Math.min(val, max));
        if (field === "h") this.timerHours = v;
        else if (field === "m") this.timerMinutes = v;
        else this.timerSeconds = v;
        this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
        label.textContent = String(v).padStart(2, "0");
        this.updateTimerDisplay();
      };

      const closeAll = () => {
        this.view.containerEl.querySelectorAll(".timer-picker-scroll").forEach(s => {
          (s as HTMLElement).style.display = "none";
        });
        this.view.containerEl.querySelectorAll(".timer-picker-label").forEach(l => {
          (l as HTMLElement).style.display = "flex";
        });
      };

      const open = () => {
        closeAll();
        label.style.display = "none";
        scroll.style.display = "block";
        requestAnimationFrame(() => {
          scroll.scrollTop = getVal() * 28;
          this.updateScrollHighlight(scroll);
        });
      };

      label.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isOpen()) { closeAll(); } else { open(); }
      });

      scroll.querySelectorAll("div").forEach(item => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          apply(parseInt((item as HTMLElement).dataset.value!));
          closeAll();
        });
      });
    });

    if (this.outsideClickHandler) {
      this.view.containerEl.removeEventListener("click", this.outsideClickHandler);
    }
    this.outsideClickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".timer-picker-wrap")) {
        this.view.containerEl.querySelectorAll(".timer-picker-scroll").forEach(s => {
          (s as HTMLElement).style.display = "none";
        });
        this.view.containerEl.querySelectorAll(".timer-picker-label").forEach(l => {
          (l as HTMLElement).style.display = "flex";
        });
      }
    };
    this.view.containerEl.addEventListener("click", this.outsideClickHandler);

    const modeToggle = this.view.containerEl.querySelector("#timer-mode-toggle");
    modeToggle?.addEventListener("click", () => {
      this.timerDisplayMode = this.timerDisplayMode === "clock" ? "digital" : "clock";
      modeToggle.textContent = this.timerDisplayMode === "clock" ? "数字" : "表盘";
      this.updateTimerDisplay();
    });

    const startBtn = this.view.containerEl.querySelector("#timer-start-btn");
    startBtn?.addEventListener("click", () => {
      if (this.timerFinished) this.timerFinished = false;
      if (this.timerRunning) {
        this.pause();
      } else {
        this.start();
      }
    });

    this.view.containerEl.querySelector("#timer-reset-btn")?.addEventListener("click", () => {
      this.timerRunning = false;
      if (this.timerIntervalId !== null) {
        window.clearInterval(this.timerIntervalId);
        this.timerIntervalId = null;
      }
      this.timerFinished = false;
      this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
      this.updateTimerDisplay();
      const startBtn = this.view.containerEl.querySelector("#timer-start-btn") as HTMLButtonElement;
      if (startBtn) startBtn.textContent = "开始";
      const resetBtn = this.view.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
      if (resetBtn) resetBtn.style.display = "none";
      this.setPickersEditable(true);
    });
  }

  renderPicker(field: string, label: string, max: number, cur: number): string {
    const count = max;
    return `
      <div class="timer-picker-wrap" data-field="${field}" style="position: relative; width: 44px; height: 38px;">
        <div class="timer-picker-label" style="
          width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums;
          color: var(--text-normal);
          border: 1px solid var(--background-modifier-border); border-radius: 6px;
          background: var(--background-modifier-hover);
          cursor: pointer; user-select: none;
        ">${String(cur).padStart(2, "0")}</div>
        <div class="timer-picker-scroll" style="
          display: none; position: absolute; top: 0; left: 0;
          width: 100%; height: 84px; overflow-y: auto;
          scroll-snap-type: y mandatory;
          border: 1px solid var(--interactive-accent);
          border-radius: 6px;
          background: var(--background-modifier-hover);
          scrollbar-width: none;
          z-index: 1;
        ">${Array.from({length: count}, (_, i) => `
          <div data-value="${i}" style="
            height: 28px; display: flex; align-items: center; justify-content: center;
            font-size: 14px; font-variant-numeric: tabular-nums;
            color: var(--text-muted);
            scroll-snap-align: center;
            cursor: pointer;
            user-select: none;
          ">${String(i).padStart(2, "0")}</div>
        `).join("")}</div>
      </div>
      <span style="font-size: 12px; color: var(--text-muted);">${label}</span>
    `;
  }

  private updateScrollHighlight(picker: HTMLElement) {
    const idx = Math.round(picker.scrollTop / 28);
    picker.querySelectorAll("div").forEach((d, i) => {
      (d as HTMLElement).style.color = i === idx ? "var(--text-normal)" : "var(--text-muted)";
      (d as HTMLElement).style.fontWeight = i === idx ? "600" : "400";
    });
  }

  private getCurrentDisplayTime(): number {
    const total = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
    if (!this.timerRunning && this.timerRemaining > 0 && this.timerRemaining < total) {
      return this.timerRemaining;
    }
    if (this.timerRunning) {
      return this.timerRemaining;
    }
    return total;
  }

  updateTimerDisplay() {
    const display = this.view.containerEl.querySelector("#timer-display") as HTMLElement;
    if (!display) return;

    const t = this.getCurrentDisplayTime();
    const maxTotal = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
    if (this.timerDisplayMode === "clock") {
      display.innerHTML = this.renderClockFace(t, maxTotal);
    } else {
      display.innerHTML = this.renderDigitalDisplay(t, maxTotal);
    }
  }

  private renderClockFace(total: number, maxTotal: number): string {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const fraction = maxTotal > 0 ? total / maxTotal : 0;

    const size = 140;
    const cx = size / 2;
    const cy = size / 2;
    const r = 56;

    const minAngle = ((m * 60 + s) / 3600) * 360;
    const secAngle = (s / 60) * 360;

    const minRad = (minAngle - 90) * Math.PI / 180;
    const secRad = (secAngle - 90) * Math.PI / 180;
    const minLen = r * 0.7;
    const secLen = r * 0.85;

    const minX = cx + minLen * Math.cos(minRad);
    const minY = cy + minLen * Math.sin(minRad);
    const secX = cx + secLen * Math.cos(secRad);
    const secY = cy + secLen * Math.sin(secRad);

    const circumference = 2 * Math.PI * r;

    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="var(--background-modifier-border)" stroke-width="4"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="var(--interactive-accent)" stroke-width="4"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${circumference * (1 - fraction)}"
          transform="rotate(-90 ${cx} ${cy})"
          style="transition: stroke-dashoffset 1s linear;"/>
        ${[...Array(12)].map((_, i) => {
          const a = (i * 30 - 90) * Math.PI / 180;
          const x1 = cx + (r - 7) * Math.cos(a);
          const y1 = cy + (r - 7) * Math.sin(a);
          const x2 = cx + (r - 3) * Math.cos(a);
          const y2 = cy + (r - 3) * Math.sin(a);
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round"/>`;
        }).join("")}
        <line x1="${cx}" y1="${cy}" x2="${minX}" y2="${minY}" stroke="var(--text-normal)" stroke-width="2" stroke-linecap="round"/>
        <line x1="${cx}" y1="${cy}" x2="${secX}" y2="${secY}" stroke="var(--interactive-accent)" stroke-width="1" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="2.5" fill="var(--text-normal)"/>
      </svg>
      <div style="
        position: absolute;
        text-align: center;
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 4px;
        font-variant-numeric: tabular-nums;
      ">${timeStr}</div>
    `;
  }

  private renderDigitalDisplay(total: number, maxTotal: number): string {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

    const fraction = maxTotal > 0 ? total / maxTotal : 0;

    return `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
        <span style="
          font-size: 36px;
          font-weight: 300;
          font-variant-numeric: tabular-nums;
          color: ${this.timerFinished ? "var(--interactive-accent)" : "var(--text-normal)"};
          letter-spacing: 2px;
        ">${timeStr}</span>
        <div style="
          width: 120px; height: 3px; border-radius: 2px;
          background: var(--background-modifier-border);
          overflow: hidden;
        ">
          <div style="
            width: ${fraction * 100}%; height: 100%; border-radius: 2px;
            background: var(--interactive-accent);
            transition: width 1s linear;
          "></div>
        </div>
      </div>
    `;
  }

  private setPickersEditable(editable: boolean) {
    this.view.containerEl.querySelectorAll(".timer-picker-label").forEach(l => {
      const el = l as HTMLElement;
      if (editable) {
        el.style.border = "1px solid var(--background-modifier-border)";
        el.style.background = "var(--background-modifier-hover)";
        el.style.cursor = "pointer";
        el.style.pointerEvents = "auto";
      } else {
        el.style.border = "1px solid transparent";
        el.style.background = "transparent";
        el.style.cursor = "default";
        el.style.pointerEvents = "none";
      }
    });
  }

  private updatePickerTexts() {
    this.view.containerEl.querySelectorAll(".timer-picker-wrap").forEach(wrap => {
      const el = wrap as HTMLElement;
      const field = el.dataset.field!;
      const label = el.querySelector(".timer-picker-label") as HTMLElement;
      if (!label) return;
      const val = field === "h" ? this.timerHours : field === "m" ? this.timerMinutes : this.timerSeconds;
      label.textContent = String(val).padStart(2, "0");
    });
  }

  start() {
    this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
    if (this.timerRemaining <= 0) return;

    this.timerRunning = true;
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
    }
    this.timerIntervalId = window.setInterval(() => this.tick(), 1000);
    const startBtn = this.view.containerEl.querySelector("#timer-start-btn") as HTMLButtonElement;
    if (startBtn) startBtn.textContent = "暂停";
    const resetBtn = this.view.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
    if (resetBtn) resetBtn.style.display = "none";
    this.updatePickerTexts();
    this.setPickersEditable(false);
  }

  private pause() {
    this.timerRunning = false;
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    const startBtn = this.view.containerEl.querySelector("#timer-start-btn") as HTMLButtonElement;
    if (startBtn) startBtn.textContent = "开始";
    const resetBtn = this.view.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
    if (resetBtn) resetBtn.style.display = "inline-block";
    this.setPickersEditable(true);
  }

  private tick() {
    if (this.timerRemaining <= 0) {
      this.pause();
      this.timerFinished = true;
      this.updateTimerDisplay();
      this.showNotification();
      return;
    }
    this.timerRemaining--;
    this.updateTimerDisplay();
  }

  private showNotification() {
    const existing = this.view.containerEl.querySelector("#timer-notification");
    if (existing) existing.remove();

    const content = this.view.containerEl.querySelector("#homepage-content") as HTMLElement;
    if (!content) return;

    const overlay = document.createElement("div");
    overlay.id = "timer-notification";
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 20;
    `;

    overlay.innerHTML = `
      <div style="
        background: var(--background-primary);
        border-radius: 14px;
        padding: 32px 40px;
        text-align: center;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px var(--background-modifier-border);
      ">
        <div style="font-size: 48px; margin-bottom: 8px;">⏰</div>
        <div style="font-size: 18px; font-weight: 600; color: var(--text-normal); margin-bottom: 6px;">时间到！</div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px;">
          计时器已结束（${this.timerHours}时${this.timerMinutes}分${this.timerSeconds}秒）
        </div>
        <button id="timer-dismiss-btn" style="
          padding: 6px 24px; font-size: 13px; border: none; border-radius: 6px;
          background: var(--interactive-accent); color: var(--text-on-accent);
          cursor: pointer; font-family: inherit;
        ">关闭</button>
      </div>
    `;

    content.appendChild(overlay);

    const dismiss = () => {
      overlay.remove();
      this.timerRemaining = this.timerHours * 3600 + this.timerMinutes * 60 + this.timerSeconds;
      this.timerFinished = false;
      this.updateTimerDisplay();
      const resetBtn = this.view.containerEl.querySelector("#timer-reset-btn") as HTMLElement;
      if (resetBtn) resetBtn.style.display = "none";
      this.setPickersEditable(true);
    };

    overlay.querySelector("#timer-dismiss-btn")?.addEventListener("click", dismiss);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
  }
}
