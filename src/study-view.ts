import { ItemView, WorkspaceLeaf } from "obsidian";
import type HomepagePlugin from "./plugin";
import type { StudyController } from "./study-controller";
import { VIEW_TYPE_STUDY } from "./constants";

// Video platform patterns — convert watch URLs to embeddable player URLs
interface VideoPlatform {
  name: string;
  match: (url: string) => boolean;
  toEmbed: (url: string) => string;
}

const VIDEO_PLATFORMS: VideoPlatform[] = [
  {
    name: "YouTube",
    match: (url) => /(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url),
    toEmbed: (url) => {
      let videoId = "";
      const watchMatch = url.match(/[?&]v=([^&]+)/i);
      if (watchMatch) videoId = watchMatch[1];
      else {
        const shortMatch = url.match(/youtu\.be\/([^?&]+)/i);
        if (shortMatch) videoId = shortMatch[1];
      }
      if (!videoId) return url;
      let embed = `https://www.youtube.com/embed/${videoId}`;
      // preserve start time
      const tMatch = url.match(/[?&]t=(\d+)/i);
      if (tMatch) embed += `?start=${tMatch[1]}`;
      return embed;
    },
  },
  {
    name: "Bilibili",
    match: (url) => /bilibili\.com\/video\/BV/i.test(url),
    toEmbed: (url) => {
      const bvMatch = url.match(/(BV[a-zA-Z0-9]+)/);
      if (!bvMatch) return url;
      let embed = `https://player.bilibili.com/player.html?bvid=${bvMatch[1]}`;
      // preserve page number
      const pMatch = url.match(/[?&]p=(\d+)/i);
      if (pMatch) embed += `&page=${pMatch[1]}`;
      return embed;
    },
  },
  {
    name: "Vimeo",
    match: (url) => /vimeo\.com\/\d+/i.test(url),
    toEmbed: (url) => {
      const idMatch = url.match(/vimeo\.com\/(\d+)/);
      return idMatch ? `https://player.vimeo.com/video/${idMatch[1]}` : url;
    },
  },
];

function convertToEmbedUrl(url: string): { url: string; platform: string | null } {
  for (const p of VIDEO_PLATFORMS) {
    if (p.match(url)) {
      return { url: p.toEmbed(url), platform: p.name };
    }
  }
  return { url, platform: null };
}

export default class StudyView extends ItemView {
  plugin: HomepagePlugin;
  private controller: StudyController;
  private currentUrl = "";
  private isLoading = false;
  private history: string[] = [];
  private historyOpen = false;

  constructor(leaf: WorkspaceLeaf, plugin: HomepagePlugin, controller: StudyController) {
    super(leaf);
    this.plugin = plugin;
    this.controller = controller;
    this.currentUrl = "";
    this.history = [...(plugin.settings.studyMode.history || [])];
  }

  getViewType(): string { return VIEW_TYPE_STUDY; }
  getDisplayText(): string { return "学习模式"; }
  getIcon(): string { return "book-open"; }

  async onOpen() { this.render(); }
  async onClose() {}

  getCurrentUrl(): string { return this.currentUrl; }

  getIframe(): HTMLIFrameElement | null {
    return this.contentEl.querySelector("#study-iframe") as HTMLIFrameElement | null;
  }

  navigate(url: string) {
    let normalized = url.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized)) {
      if (normalized.includes(".") && !normalized.includes(" ")) {
        normalized = "https://" + normalized;
      } else {
        normalized = "https://www.google.com/search?q=" + encodeURIComponent(normalized);
      }
    }

    this.addToHistory(normalized);

    const { url: embedUrl, platform } = convertToEmbedUrl(normalized);
    this.currentUrl = normalized;
    const loadUrl = embedUrl;

    const startPage = this.contentEl.querySelector("#study-start-page") as HTMLElement;
    if (startPage) startPage.style.display = "none";

    const iframe = this.getIframe();
    if (iframe) {
      this.setLoading(true);
      iframe.src = loadUrl;
    }

    const statusBar = this.contentEl.querySelector("#study-statusbar") as HTMLElement;
    if (statusBar) {
      statusBar.textContent = platform
        ? `${normalized}  [${platform} 播放器]`
        : normalized;
    }

    const urlInput = this.contentEl.querySelector("#study-url-input") as HTMLInputElement;
    if (urlInput) urlInput.value = normalized;

    // Update embed hint
    const embedHint = this.contentEl.querySelector("#study-embed-hint") as HTMLElement;
    if (embedHint) {
      embedHint.textContent = platform ? `已转换为 ${platform} 嵌入式播放器` : "";
    }

    this.closeHistoryPanel();
  }

  private addToHistory(url: string) {
    if (this.history.length === 0 || this.history[this.history.length - 1] !== url) {
      this.history.push(url);
      if (this.history.length > 50) this.history.shift();
      this.plugin.settings.studyMode.history = [...this.history];
      this.plugin.saveSettings().catch(console.error);
    }
  }

  private toggleHistory() {
    this.historyOpen = !this.historyOpen;
    this.renderHistoryPanel();
  }

  private closeHistoryPanel() {
    this.historyOpen = false;
    const panel = this.contentEl.querySelector("#study-history-panel");
    if (panel) panel.remove();
  }

  private renderHistoryPanel() {
    const existing = this.contentEl.querySelector("#study-history-panel");
    if (existing) existing.remove();
    if (!this.historyOpen) return;

    const wrapper = this.contentEl.querySelector("#study-iframe-wrapper") as HTMLElement;
    if (!wrapper) return;

    const panel = document.createElement("div");
    panel.id = "study-history-panel";
    panel.style.cssText = `
      position: absolute; top: 0; right: 0; bottom: 0; width: 280px; z-index: 10;
      background: var(--background-primary);
      border-left: 1px solid var(--background-modifier-border);
      display: flex; flex-direction: column;
      box-shadow: -4px 0 16px rgba(0,0,0,0.08);
    `;

    const reversed = [...this.history].reverse();

    panel.innerHTML = `
      <div style="
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; font-size: 13px; font-weight: 600;
        color: var(--text-normal); border-bottom: 1px solid var(--background-modifier-border);
        flex-shrink: 0;
      ">
        <span>浏览历史</span>
        <button id="study-history-close" style="
          background: transparent; border: none; color: var(--text-muted); cursor: pointer;
          font-size: 16px; padding: 0 4px; line-height: 1;
        ">×</button>
      </div>
      <div style="flex: 1; overflow-y: auto; padding: 4px 0;">
        ${reversed.length === 0 ? `
          <div style="padding: 16px; text-align: center; font-size: 12px; color: var(--text-faint);">暂无历史记录</div>
        ` : reversed.map((url, i) => {
          const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
          const short = display.length > 50 ? display.slice(0, 50) + "..." : display;
          const { platform } = convertToEmbedUrl(url);
          const icon = platform ? " ▶" : "";
          return `
            <div class="study-history-item" data-url="${url.replace(/"/g, "&quot;")}" style="
              display: flex; align-items: center; gap: 8px;
              padding: 8px 12px; cursor: pointer;
              font-size: 12px; color: var(--text-muted);
              transition: background 0.1s;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            ">
              <span style="font-size: 13px; flex-shrink: 0;">${reversed.length - i}${icon}</span>
              <span style="overflow: hidden; text-overflow: ellipsis;">${short}</span>
            </div>`;
        }).join("")}
      </div>
    `;

    wrapper.appendChild(panel);
    this.bindHistoryEvents(panel);
  }

  private bindHistoryEvents(panel: HTMLElement) {
    panel.querySelector("#study-history-close")?.addEventListener("click", () => {
      this.closeHistoryPanel();
    });
    panel.querySelectorAll(".study-history-item").forEach(el => {
      const ht = el as HTMLElement;
      ht.addEventListener("click", () => {
        const url = ht.dataset.url!;
        this.closeHistoryPanel();
        this.navigate(url);
      });
      ht.addEventListener("mouseenter", () => { ht.style.background = "var(--background-modifier-hover)"; });
      ht.addEventListener("mouseleave", () => { ht.style.background = ""; });
    });
  }

  render() {
    const container = this.contentEl as HTMLElement;
    container.empty();
    container.style.cssText = "height: 100%; display: flex; flex-direction: column; overflow: hidden;";

    // ── Toolbar ──
    const toolbar = document.createElement("div");
    toolbar.id = "study-toolbar";
    toolbar.style.cssText = `
      display: flex; align-items: center; gap: 4px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--background-modifier-border);
      background: var(--background-primary);
      flex-shrink: 0;
    `;
    toolbar.innerHTML = `
      <button id="study-back-btn" title="后退" style="
        background: transparent; border: 1px solid var(--background-modifier-border);
        border-radius: 4px; color: var(--text-muted); cursor: pointer;
        font-size: 14px; padding: 3px 8px; font-family: inherit; line-height: 1;
      ">◀</button>
      <button id="study-forward-btn" title="前进" style="
        background: transparent; border: 1px solid var(--background-modifier-border);
        border-radius: 4px; color: var(--text-muted); cursor: pointer;
        font-size: 14px; padding: 3px 8px; font-family: inherit; line-height: 1;
      ">▶</button>
      <button id="study-refresh-btn" title="刷新" style="
        background: transparent; border: 1px solid var(--background-modifier-border);
        border-radius: 4px; color: var(--text-muted); cursor: pointer;
        font-size: 14px; padding: 3px 8px; font-family: inherit; line-height: 1;
      ">↻</button>
      <input id="study-url-input" type="text" placeholder="输入网址或搜索关键词..." value="${this.currentUrl}" style="
        flex: 1; padding: 4px 8px; font-size: 13px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px; background: var(--background-modifier-hover);
        color: var(--text-normal); outline: none; font-family: inherit;
        min-width: 0;
      "/>
      <button id="study-go-btn" style="
        background: var(--interactive-accent); color: var(--text-on-accent);
        border: none; border-radius: 4px; cursor: pointer;
        font-size: 12px; padding: 4px 10px; font-family: inherit;
        white-space: nowrap;
      ">前往</button>
      <button id="study-history-btn" title="浏览历史" style="
        background: transparent; border: 1px solid var(--background-modifier-border);
        border-radius: 4px; color: var(--text-muted); cursor: pointer;
        font-size: 14px; padding: 3px 8px; font-family: inherit; line-height: 1;
      ">☰</button>
      <button id="study-screenshot-btn" title="截图插入笔记" style="
        background: transparent; border: 1px solid var(--background-modifier-border);
        border-radius: 4px; color: var(--text-muted); cursor: pointer;
        font-size: 14px; padding: 3px 8px; font-family: inherit; line-height: 1;
      ">📷</button>
    `;
    container.appendChild(toolbar);

    // ── Video embed hint bar ──
    const embedHint = document.createElement("div");
    embedHint.id = "study-embed-hint";
    embedHint.style.cssText = `
      display: none; padding: 2px 10px; font-size: 11px; color: var(--text-accent);
      background: var(--background-primary-alt); flex-shrink: 0;
    `;
    container.appendChild(embedHint);

    // ── iframe wrapper ──
    const wrapper = document.createElement("div");
    wrapper.id = "study-iframe-wrapper";
    wrapper.style.cssText = `
      flex: 1; position: relative; overflow: hidden;
      background: var(--background-primary);
    `;

    // Start page
    const startPage = document.createElement("div");
    startPage.id = "study-start-page";
    startPage.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 1;
      display: ${this.currentUrl ? "none" : "flex"};
      flex-direction: column; align-items: center; justify-content: center;
      background: var(--background-primary);
    `;
    startPage.innerHTML = `
      <div style="font-size: 28px; font-weight: 300; color: var(--text-faint); margin-bottom: 8px;">学习模式</div>
      <div style="font-size: 13px; color: var(--text-faint); margin-bottom: 24px;">一边看视频，一边记笔记</div>
      <div id="study-start-search" style="display: flex; align-items: center; gap: 8px; margin-bottom: 32px;">
        <input id="study-start-input" type="text" placeholder="输入网址或搜索关键词..." style="
          width: 360px; padding: 8px 14px; font-size: 14px;
          border: 1px solid var(--background-modifier-border);
          border-radius: 8px; background: var(--background-modifier-hover);
          color: var(--text-normal); outline: none; font-family: inherit;
        "/>
        <button id="study-start-go" style="
          background: var(--interactive-accent); color: var(--text-on-accent);
          border: none; border-radius: 8px; cursor: pointer;
          font-size: 13px; padding: 8px 18px; font-family: inherit;
        ">前往</button>
      </div>
      <div style="display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; max-width: 480px; margin-bottom: 8px;">
        ${this.renderQuickLink("YouTube", "https://www.youtube.com", "#FF0000")}
        ${this.renderQuickLink("Bilibili", "https://www.bilibili.com", "#FB7299")}
        ${this.renderQuickLink("Vimeo", "https://vimeo.com", "#1AB7EA")}
        ${this.renderQuickLink("Google", "https://www.google.com", "#4285F4")}
        ${this.renderQuickLink("GitHub", "https://github.com", "#24292e")}
        ${this.renderQuickLink("Wikipedia", "https://www.wikipedia.org", "#000000")}
      </div>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 16px;">
        视频网站会自动转为嵌入式播放器
      </div>
    `;
    wrapper.appendChild(startPage);

    // Loading indicator
    const loading = document.createElement("div");
    loading.id = "study-loading";
    loading.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 3;
      display: none; align-items: center; justify-content: center;
      background: var(--background-primary);
    `;
    loading.innerHTML = `<span style="font-size: 14px; color: var(--text-muted);">加载中...</span>`;
    wrapper.appendChild(loading);

    // Error / blocked notice
    const errNotice = document.createElement("div");
    errNotice.id = "study-error-notice";
    errNotice.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2;
      display: none; flex-direction: column; align-items: center; justify-content: center;
      background: var(--background-primary); gap: 12px;
    `;
    errNotice.innerHTML = `
      <div style="font-size: 14px; color: var(--text-muted);">该页面不允许嵌入显示</div>
      <button id="study-error-open" style="
        background: var(--interactive-accent); color: var(--text-on-accent);
        border: none; border-radius: 6px; cursor: pointer;
        font-size: 13px; padding: 8px 18px; font-family: inherit;
      ">用默认浏览器打开</button>
    `;
    wrapper.appendChild(errNotice);

    // iframe
    const iframe = document.createElement("iframe");
    iframe.id = "study-iframe";
    iframe.style.cssText = "width: 100%; height: 100%; border: none;";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation");
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen");
    iframe.setAttribute("allowfullscreen", "");
    // Load current URL if any (with embed conversion)
    if (this.currentUrl) {
      const { url: embedUrl } = convertToEmbedUrl(this.currentUrl);
      iframe.src = embedUrl;
      startPage.style.display = "none";
      this.setLoading(true);
    }
    wrapper.appendChild(iframe);

    container.appendChild(wrapper);

    // ── Status bar ──
    const statusBar = document.createElement("div");
    statusBar.id = "study-statusbar";
    statusBar.style.cssText = `
      padding: 2px 10px; font-size: 11px; color: var(--text-faint);
      border-top: 1px solid var(--background-modifier-border);
      background: var(--background-primary); flex-shrink: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    `;
    statusBar.textContent = this.currentUrl || "就绪";
    container.appendChild(statusBar);

    // ── Bind events ──
    this.bindEvents(iframe);

    if (this.historyOpen) this.renderHistoryPanel();
  }

  private renderQuickLink(name: string, url: string, color: string): string {
    return `
      <div class="study-quick-link" data-url="${url}" style="
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        cursor: pointer; padding: 10px 14px; border-radius: 8px;
        transition: background 0.15s; user-select: none;
      ">
        <div style="
          width: 40px; height: 40px; border-radius: 50%;
          background: ${color}; display: flex; align-items: center; justify-content: center;
          color: white; font-size: 14px; font-weight: 600;
        ">${name.charAt(0)}</div>
        <span style="font-size: 11px; color: var(--text-muted);">${name}</span>
      </div>`;
  }

  setLoading(loading: boolean) {
    this.isLoading = loading;
    const loader = this.contentEl.querySelector("#study-loading") as HTMLElement;
    const errNotice = this.contentEl.querySelector("#study-error-notice") as HTMLElement;
    if (loader) loader.style.display = loading ? "flex" : "none";
    if (errNotice) errNotice.style.display = "none";
  }

  private bindEvents(iframe: HTMLIFrameElement) {
    const urlInput = this.contentEl.querySelector("#study-url-input") as HTMLInputElement;
    const embedHint = this.contentEl.querySelector("#study-embed-hint") as HTMLElement;

    urlInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.navigate(urlInput.value);
    });

    this.contentEl.querySelector("#study-go-btn")?.addEventListener("click", () => {
      if (urlInput) this.navigate(urlInput.value);
    });

    this.contentEl.querySelector("#study-screenshot-btn")?.addEventListener("click", () => {
      this.showSelectionOverlay();
    });

    this.contentEl.querySelector("#study-history-btn")?.addEventListener("click", () => {
      this.toggleHistory();
    });

    // Back/forward via iframe history
    this.contentEl.querySelector("#study-back-btn")?.addEventListener("click", () => {
      try { iframe.contentWindow?.history.back(); } catch {}
    });
    this.contentEl.querySelector("#study-forward-btn")?.addEventListener("click", () => {
      try { iframe.contentWindow?.history.forward(); } catch {}
    });
    this.contentEl.querySelector("#study-refresh-btn")?.addEventListener("click", () => {
      try { iframe.contentWindow?.location.reload(); } catch { iframe.src = iframe.src; }
    });

    // Start page
    const startInput = this.contentEl.querySelector("#study-start-input") as HTMLInputElement;
    startInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && startInput.value.trim()) this.navigate(startInput.value.trim());
    });
    this.contentEl.querySelector("#study-start-go")?.addEventListener("click", () => {
      if (startInput?.value.trim()) this.navigate(startInput.value.trim());
    });

    // Quick links
    this.contentEl.querySelectorAll(".study-quick-link").forEach(el => {
      el.addEventListener("click", () => this.navigate((el as HTMLElement).dataset.url!));
      const ht = el as HTMLElement;
      ht.addEventListener("mouseenter", () => { ht.style.background = "var(--background-modifier-hover)"; });
      ht.addEventListener("mouseleave", () => { ht.style.background = ""; });
    });

    // Error fallback button
    this.contentEl.querySelector("#study-error-open")?.addEventListener("click", () => {
      if (this.currentUrl) window.open(this.currentUrl, "_blank");
    });

    // iframe load handling
    iframe.addEventListener("load", () => {
      this.setLoading(false);
      // Try to detect if page loaded successfully (same-origin only)
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.title) {
          // same-origin — we can read title, all good
        }
      } catch {
        // cross-origin — if load fired, it likely worked
      }

      // Update embed hint
      const { platform } = convertToEmbedUrl(this.currentUrl);
      if (embedHint) {
        if (platform) {
          embedHint.style.display = "block";
          embedHint.textContent = `${platform} 嵌入式播放器`;
        } else {
          embedHint.style.display = "none";
        }
      }
    });

    // iframe error detection (fires for network errors but NOT for X-Frame-Options)
    iframe.addEventListener("error", () => {
      this.setLoading(false);
    });

    // Detect X-Frame-Options blocking via timeout
    // If after 8 seconds the iframe hasn't triggered 'load' and we're not on the start page,
    // assume it's blocked
    if (this.currentUrl) {
      const startTime = Date.now();
      const checkBlocked = () => {
        if (this.isLoading && Date.now() - startTime > 8000) {
          this.setLoading(false);
          const errNotice = this.contentEl.querySelector("#study-error-notice") as HTMLElement;
          if (errNotice) errNotice.style.display = "flex";
        }
      };
      setTimeout(checkBlocked, 8000);
    }
  }

  // ── Drag-select overlay ──

  private selectionOverlayCleanup: (() => void) | null = null;

  private showSelectionOverlay() {
    // Remove any existing overlay
    this.hideSelectionOverlay();

    const wrapper = this.contentEl.querySelector("#study-iframe-wrapper") as HTMLElement;
    if (!wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();

    // Default selection = entire wrapper visible area
    const sel = {
      x: 0,
      y: 0,
      w: wrapperRect.width,
      h: wrapperRect.height,
    };

    // Dark backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "study-select-backdrop";
    backdrop.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 25;
      background: rgba(0,0,0,0.35);
    `;

    // Selection box (the "hole")
    const box = document.createElement("div");
    box.id = "study-select-box";
    box.style.cssText = `
      position: absolute; z-index: 26;
      left: ${sel.x}px; top: ${sel.y}px; width: ${sel.w}px; height: ${sel.h}px;
      outline: 2px dashed var(--interactive-accent);
      outline-offset: -1px;
      cursor: move;
      background: transparent;
    `;

    // Corner handles
    const handleSize = 10;
    const corners = ["tl", "tr", "bl", "br"];
    corners.forEach(c => {
      const h = document.createElement("div");
      h.className = "study-select-handle";
      h.dataset.corner = c;
      const cssPos: Record<string, [string, string]> = {
        tl: ["top: -5px", "left: -5px"],
        tr: ["top: -5px", "right: -5px"],
        bl: ["bottom: -5px", "left: -5px"],
        br: ["bottom: -5px", "right: -5px"],
      };
      const [p1, p2] = cssPos[c];
      h.style.cssText = `
        position: absolute; ${p1}; ${p2}; z-index: 27;
        width: ${handleSize}px; height: ${handleSize}px;
        background: var(--interactive-accent); border: 1px solid var(--background-primary);
        border-radius: 2px; cursor: ${c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize"};
      `;
      box.appendChild(h);
    });

    // Toolbar below the selection
    const toolbar = document.createElement("div");
    toolbar.id = "study-select-toolbar";
    toolbar.style.cssText = `
      position: absolute; z-index: 27;
      left: 50%; transform: translateX(-50%);
      bottom: ${wrapperRect.height - sel.y - sel.h + 40}px;
      display: flex; gap: 8px; align-items: center;
    `;
    toolbar.innerHTML = `
      <button id="study-select-capture" style="
        background: var(--interactive-accent); color: var(--text-on-accent);
        border: none; border-radius: 6px; cursor: pointer;
        font-size: 13px; padding: 6px 18px; font-family: inherit;
      ">截取选中区域</button>
      <button id="study-select-cancel" style="
        background: var(--background-modifier-hover); color: var(--text-muted);
        border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer;
        font-size: 13px; padding: 6px 14px; font-family: inherit;
      ">取消</button>
    `;
    wrapper.appendChild(toolbar);

    wrapper.appendChild(box);
    wrapper.appendChild(backdrop);
    // backdrop goes behind box visually
    wrapper.insertBefore(backdrop, box);

    // ── Drag handling ──

    let dragging: "move" | string | null = null;
    let startX = 0, startY = 0, startSel = { ...sel };

    const updateBox = () => {
      box.style.left = sel.x + "px";
      box.style.top = sel.y + "px";
      box.style.width = sel.w + "px";
      box.style.height = sel.h + "px";
      // reposition toolbar
      toolbar.style.bottom = (wrapperRect.height - sel.y - sel.h + 40) + "px";
    };

    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("study-select-handle")) {
        dragging = target.dataset.corner || null;
      } else if (target === box || target === backdrop) {
        dragging = (target === box) ? "move" : null;
      }
      if (dragging) {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        startSel = { ...sel };
        (box as any).setPointerCapture?.(e.pointerId);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (dragging === "move") {
        sel.x = Math.max(0, Math.min(startSel.x + dx, wrapperRect.width - sel.w));
        sel.y = Math.max(0, Math.min(startSel.y + dy, wrapperRect.height - sel.h));
      } else {
        // Corner resize
        const c = dragging as string;
        if (c.includes("l")) { sel.x = Math.max(0, Math.min(startSel.x + dx, startSel.x + startSel.w - 60)); sel.w = startSel.x + startSel.w - sel.x; }
        if (c.includes("r")) { sel.w = Math.max(60, startSel.w + dx); }
        if (c.includes("t")) { sel.y = Math.max(0, Math.min(startSel.y + dy, startSel.y + startSel.h - 60)); sel.h = startSel.y + startSel.h - sel.y; }
        if (c.includes("b")) { sel.h = Math.max(60, startSel.h + dy); }
      }
      updateBox();
    };

    const onUp = () => {
      dragging = null;
    };

    wrapper.addEventListener("pointerdown", onDown);
    wrapper.addEventListener("pointermove", onMove);
    wrapper.addEventListener("pointerup", onUp);
    wrapper.addEventListener("pointerleave", onUp);

    // Store cleanup so hideSelectionOverlay can remove listeners
    this.selectionOverlayCleanup = () => {
      wrapper.removeEventListener("pointerdown", onDown);
      wrapper.removeEventListener("pointermove", onMove);
      wrapper.removeEventListener("pointerup", onUp);
      wrapper.removeEventListener("pointerleave", onUp);
    };

    // Key: Esc to cancel, Enter to capture
    let keyHandled = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        keyHandled = true;
        this.hideSelectionOverlay();
        document.removeEventListener("keydown", onKey);
      } else if (e.key === "Enter" && !keyHandled) {
        keyHandled = true;
        e.preventDefault();
        e.stopPropagation();
        const captureRegion = { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
        this.hideSelectionOverlay();
        document.removeEventListener("keydown", onKey);
        // Wait for overlay to be removed and painted before capturing
        setTimeout(async () => {
          await new Promise(r => requestAnimationFrame(r));
          this.controller.captureScreenshot(captureRegion);
        }, 100);
      }
    };
    document.addEventListener("keydown", onKey);

    // Buttons
    toolbar.querySelector("#study-select-capture")?.addEventListener("click", async () => {
      // Save region before removing overlay
      const captureRegion = { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
      this.hideSelectionOverlay();
      document.removeEventListener("keydown", onKey);
      // Wait for overlay to be removed from DOM and repainted
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      this.controller.captureScreenshot(captureRegion);
    });
    toolbar.querySelector("#study-select-cancel")?.addEventListener("click", () => {
      this.hideSelectionOverlay();
      document.removeEventListener("keydown", onKey);
    });
  }

  private hideSelectionOverlay() {
    if (this.selectionOverlayCleanup) {
      this.selectionOverlayCleanup();
      this.selectionOverlayCleanup = null;
    }
    this.contentEl.querySelector("#study-select-backdrop")?.remove();
    this.contentEl.querySelector("#study-select-box")?.remove();
    this.contentEl.querySelector("#study-select-toolbar")?.remove();
  }
}
