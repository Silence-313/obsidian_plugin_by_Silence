import { Notice, WorkspaceLeaf, MarkdownView } from "obsidian";
import type HomepagePlugin from "./plugin";
import { VIEW_TYPE_STUDY } from "./constants";
import StudyView from "./study-view";

export class StudyController {
  plugin: HomepagePlugin;
  private studyLeaf: WorkspaceLeaf | null = null;

  constructor(plugin: HomepagePlugin) {
    this.plugin = plugin;
  }

  isEnabled(): boolean {
    return this.plugin.settings.components.some(c => c.id === "study" && c.added);
  }

  async openStudyMode() {
    if (!this.isEnabled()) {
      new Notice("请先在侧边栏启用「学习模式」组件");
      return;
    }
    const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_STUDY);
    if (existing.length > 0) {
      this.plugin.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const activeLeaf = this.plugin.app.workspace.activeLeaf;
    if (!activeLeaf) {
      const leaf = this.plugin.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_STUDY, active: true });
      this.plugin.app.workspace.revealLeaf(leaf);
      return;
    }
    const studyLeaf = this.plugin.app.workspace.createLeafBySplit(activeLeaf, "vertical", true);
    await studyLeaf.setViewState({ type: VIEW_TYPE_STUDY, active: false });
    this.plugin.app.workspace.setActiveLeaf(activeLeaf, { focus: true });
    this.studyLeaf = studyLeaf;
  }

  closeStudyMode() {
    this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_STUDY);
    this.studyLeaf = null;
  }

  // ── Screenshot with region override (used by drag-select UI) ──

  async captureScreenshot(region?: { x: number; y: number; w: number; h: number }) {
    if (!this.isEnabled()) {
      new Notice("请先在侧边栏启用「学习模式」组件");
      return;
    }

    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_STUDY);
    if (leaves.length === 0) {
      new Notice("请先打开学习模式");
      return;
    }

    const view = leaves[0].view as StudyView;
    const iframe = view.getIframe();
    if (!iframe) { new Notice("没有可截图的页面"); return; }

    const currentUrl = (view as any).currentUrl || "";
    const mdLeaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    const markdownView = mdLeaves.length > 0 ? (mdLeaves[0].view as MarkdownView) : null;

    let dataURL: string | null = null;
    let method = "";

    // Strategy 1: canvas.drawImage (same-origin, instant)
    dataURL = this.tryCanvasCapture(iframe);
    if (dataURL) method = "canvas";

    // Strategy 2: macOS screencapture (works across monitors)
    if (!dataURL) {
      dataURL = await this.tryScreencapture(iframe, region);
      if (dataURL) method = "screencapture";
    }

    // Strategy 3: getUserMedia screen capture (legacy API fallback)
    if (!dataURL) {
      dataURL = await this.tryScreenCapture(iframe, region);
      if (dataURL) method = "screenCapture";
    }

    // Strategy 4: Video platform thumbnail
    if (!dataURL && currentUrl) {
      dataURL = await this.tryVideoThumbnail(currentUrl);
      if (dataURL) method = "thumbnail";
    }

    if (!dataURL) {
      new Notice("截图失败，请查看控制台日志", 8000);
      console.error("[StudyMode] All screenshot strategies failed, url=" + currentUrl);
      return;
    }

    console.log(`[StudyMode] screenshot success via ${method}, dataURL length=${dataURL.length}`);

    if (method === "thumbnail") {
      new Notice("已获取视频封面（屏幕捕获不可用时的替代方案）");
    }

    await this.saveAndInsertScreenshot(dataURL, markdownView);
  }

  // ── Strategy 1: canvas ──

  private tryCanvasCapture(iframe: HTMLIFrameElement): string | null {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = iframe.offsetWidth || 800;
      canvas.height = iframe.offsetHeight || 600;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(iframe as any, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      }
    } catch { /* cross-origin */ }
    return null;
  }

  // ── Strategy 2: macOS screencapture (works across all monitors) ──

  private async tryScreencapture(
    iframe: HTMLIFrameElement,
    region?: { x: number; y: number; w: number; h: number }
  ): Promise<string | null> {
    let cp: any, fs: any;
    try {
      cp = (window as any).require?.("child_process");
      fs = (window as any).require?.("fs");
    } catch {
      return null;
    }
    if (!cp?.execSync || !fs?.readFileSync) return null;

    try {
      const iframeRect = iframe.getBoundingClientRect();
      // Normalize to common coords: region uses {x,y,w,h} relative to wrapper,
      // DOMRect uses {left,top,width,height} relative to viewport
      let rx: number, ry: number, rw: number, rh: number;
      if (region) {
        // Region is relative to wrapper — convert to viewport coords
        const wrapper = iframe.parentElement;
        const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : { left: 0, top: 0 };
        rx = wrapperRect.left + region.x;
        ry = wrapperRect.top + region.y;
        rw = region.w;
        rh = region.h;
      } else {
        rx = iframeRect.left;
        ry = iframeRect.top;
        rw = iframeRect.width;
        rh = iframeRect.height;
      }

      // screencapture uses points (CSS pixels), not device pixels
      const chromeTop = window.outerHeight - window.innerHeight;
      const x = Math.round(window.screenX + rx);
      const y = Math.round(window.screenY + chromeTop + ry);
      const w = Math.round(rw);
      const h = Math.round(rh);

      console.log(`[StudyMode] screencapture -R ${x},${y},${w},${h}`);

      const tmpPath = `/tmp/obsidian-study-ss-${Date.now()}.png`;
      cp.execSync(`screencapture -x -R ${x},${y},${w},${h} "${tmpPath}"`);

      const buffer = fs.readFileSync(tmpPath);
      const base64 = buffer.toString("base64");
      try { fs.unlinkSync(tmpPath); } catch { /* cleanup */ }

      return `data:image/png;base64,${base64}`;
    } catch (err) {
      console.error("[StudyMode] screencapture failed:", err);
      return null;
    }
  }

  // ── Strategy 3: screen capture with multiple modes ──

  private async tryScreenCapture(
    iframe: HTMLIFrameElement,
    region?: { x: number; y: number; w: number; h: number }
  ): Promise<string | null> {
    const stream = await this.acquireScreenStream();
    if (!stream) return null;

    try {
      return await this.captureFromStream(stream, iframe, region);
    } finally {
      stream.getTracks().forEach(t => t.stop());
    }
  }

  // Try multiple APIs to get a screen capture stream
  private async acquireScreenStream(): Promise<MediaStream | null> {
    // Mode A: getDisplayMedia (may show system picker, may fail as NotSupported)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      console.log("[StudyMode] getDisplayMedia succeeded");
      return stream;
    } catch {
      console.log("[StudyMode] getDisplayMedia({video:true}) failed");
    }

    // Mode B: getDisplayMedia with no args
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia();
      console.log("[StudyMode] getDisplayMedia() no-args succeeded");
      return stream;
    } catch {
      console.log("[StudyMode] getDisplayMedia() no-args failed");
    }

    // Mode C: legacy getUserMedia — chromeMediaSource:desktop with max size (all monitors)
    try {
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            maxWidth: 8192,
            maxHeight: 8192,
          },
        },
      });
      console.log(`[StudyMode] legacy desktop max 8192 succeeded, tracks: ${stream.getVideoTracks().length}`);
      return stream;
    } catch (err) {
      console.log("[StudyMode] legacy desktop max 8192 failed:", err);
    }

    // Mode D: legacy getUserMedia — chromeMediaSource:screen
    try {
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "screen",
          },
        },
      });
      console.log(`[StudyMode] legacy screen succeeded, tracks: ${stream.getVideoTracks().length}`);
      return stream;
    } catch (err) {
      console.log("[StudyMode] legacy screen failed:", err);
    }

    // Mode E: legacy getUserMedia — chromeMediaSource:desktop (basic, primary monitor)
    try {
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
          },
        },
      });
      console.log(`[StudyMode] legacy desktop basic succeeded, tracks: ${stream.getVideoTracks().length}`);
      return stream;
    } catch (err) {
      console.log("[StudyMode] legacy desktop basic failed:", err);
    }

    return null;
  }

  private async captureFromStream(
    stream: MediaStream,
    iframe: HTMLIFrameElement,
    region?: { x: number; y: number; w: number; h: number }
  ): Promise<string | null> {
    const track = stream.getVideoTracks()[0];
    if (!track) return null;
    const settings = track.getSettings();
    console.log(`[StudyMode] track: ${settings.width}x${settings.height}, deviceId=${settings.deviceId}`);

    const video = document.createElement("video");
    video.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;opacity:0.01;pointer-events:none;";
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.setAttribute("autoplay", "");
    document.body.appendChild(video);

    try { await video.play(); } catch { video.remove(); return null; }

    let attempts = 0;
    while ((video.videoWidth === 0 || video.videoHeight === 0) && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      video.remove(); return null;
    }

    const vidW = video.videoWidth;
    const vidH = video.videoHeight;
    const dpr = window.devicePixelRatio || 1;

    // Determine crop area
    let srcX: number, srcY: number, srcW: number, srcH: number;

    if (region) {
      // Region is relative to wrapper — convert to viewport coords first
      const wrapper = iframe.parentElement;
      const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : { left: 0, top: 0 };
      const vpX = wrapperRect.left + region.x;
      const vpY = wrapperRect.top + region.y;

      // Viewport coords → screen coords
      const chromeTop = (window.outerHeight - window.innerHeight);
      const windowDeviceW = window.innerWidth * dpr;
      const isFullDesktop = vidW > windowDeviceW + 200;

      if (isFullDesktop) {
        srcX = Math.round((window.screenX + vpX) * dpr);
        srcY = Math.round((window.screenY + chromeTop + vpY) * dpr);
      } else {
        srcX = Math.round(vpX * dpr);
        srcY = Math.round(vpY * dpr);
      }
      srcW = Math.round(region.w * dpr);
      srcH = Math.round(region.h * dpr);
      console.log(`[StudyMode] region capture: wrapper(${region.x},${region.y}) vp(${vpX},${vpY}) → screen(${srcX},${srcY}) ${srcW}x${srcH} isFullDesktop=${isFullDesktop}`);
    } else {
      // Auto-detect: try screen-relative first
      const iframeRect = iframe.getBoundingClientRect();
      const windowDeviceW = window.innerWidth * dpr;
      const isFullDesktop = vidW > windowDeviceW + 200;
      const chromeTop = window.outerHeight - window.innerHeight;

      if (isFullDesktop) {
        srcX = Math.round((window.screenX + iframeRect.left) * dpr);
        srcY = Math.round((window.screenY + chromeTop + iframeRect.top) * dpr);
      } else {
        srcX = Math.round(iframeRect.left * dpr);
        srcY = Math.round(iframeRect.top * dpr);
      }
      srcW = Math.round(iframeRect.width * dpr);
      srcH = Math.round(iframeRect.height * dpr);
      console.log(`[StudyMode] auto crop: ${srcX},${srcY} ${srcW}x${srcH} from ${vidW}x${vidH} isFullDesktop=${isFullDesktop}`);
    }

    // Clamp and validate
    srcX = Math.max(0, Math.min(srcX, vidW - 1));
    srcY = Math.max(0, Math.min(srcY, vidH - 1));
    srcW = Math.min(srcW, vidW - srcX);
    srcH = Math.min(srcH, vidH - srcY);

    if (srcW < 10 || srcH < 10) {
      console.log(`[StudyMode] crop too small (${srcW}x${srcH}), capturing full frame`);
      const canvas = document.createElement("canvas");
      canvas.width = vidW;
      canvas.height = vidH;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0);
      video.remove();
      return canvas.toDataURL("image/png");
    }

    const canvas = document.createElement("canvas");
    canvas.width = srcW;
    canvas.height = srcH;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    video.remove();

    return canvas.toDataURL("image/png");
  }

  // ── Strategy 3: video platform thumbnails ──

  private async tryVideoThumbnail(url: string): Promise<string | null> {
    try {
      // YouTube
      const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
      if (ytMatch) {
        const videoId = ytMatch[1];
        const thumbnails = [
          `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
          `https://img.youtube.com/vi/${videoId}/0.jpg`,
        ];
        for (const thumbUrl of thumbnails) {
          const dataURL = await this.fetchImageAsDataURL(thumbUrl);
          if (dataURL) return dataURL;
        }
      }

      // Bilibili
      const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
      if (bvMatch) {
        const bvid = bvMatch[0];
        const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
        const proxies = [
          `https://corsproxy.io/?url=${encodeURIComponent(apiUrl)}`,
          `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`,
        ];
        for (const proxyUrl of proxies) {
          try {
            const resp = await fetch(proxyUrl);
            const data = await resp.json();
            const picUrl = data?.data?.pic || data?.pic;
            if (picUrl) {
              const dataURL = await this.fetchImageAsDataURL(picUrl);
              if (dataURL) return dataURL;
            }
          } catch { /* next proxy */ }
        }
      }
    } catch (err) {
      console.error("[StudyMode] thumbnail fetch failed:", err);
    }
    return null;
  }

  private async fetchImageAsDataURL(imageUrl: string): Promise<string | null> {
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  // ── Save & insert ──

  private async saveAndInsertScreenshot(dataURL: string, markdownView: MarkdownView | null) {
    console.log(`[StudyMode] saveAndInsertScreenshot, dataURL length=${dataURL.length}, hasMarkdownView=${!!markdownView}`);

    const folder = "assets/study-screenshots";
    try { await this.plugin.app.vault.createFolder(folder); } catch { /* exists */ }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `截图_${timestamp}.png`;
    const filepath = `${folder}/${filename}`;

    const base64 = dataURL.split(",")[1];
    const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    try {
      await this.plugin.app.vault.createBinary(filepath, buffer.buffer);
      console.log(`[StudyMode] saved: ${filepath}`);
    } catch (err) {
      console.error("[StudyMode] save failed:", err);
      new Notice("截图保存失败");
      return;
    }

    if (markdownView) {
      markdownView.editor.replaceSelection(`![[${filepath}]]\n`);
      new Notice("截图已插入笔记");
    } else {
      new Notice(`截图已保存: ${filepath}`);
    }
  }
}
