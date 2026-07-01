import type HomepageView from "../view";

interface GraphNode {
  id: string;
  label: string;
  type: "source" | "summary" | "concept" | "index" | "folder";
  path: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  degree: number;
}

interface GraphEdge {
  source: string; // node id
  target: string;
}

const NODE_COLORS: Record<GraphNode["type"], string> = {
  source: "#e67e22",
  summary: "#27ae60",
  concept: "#3498db",
  index: "#9b59b6",
  folder: "#e8c84c",
};

const NODE_BASE_RADII: Record<GraphNode["type"], number> = {
  source: 4,
  summary: 5,
  concept: 6,
  index: 7,
  folder: 7,
};

export class WikiGraphComponent {
  view: HomepageView;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private nodeMap: Map<string, GraphNode> = new Map();

  // View state
  private offsetX = 0;
  private offsetY = 0;
  private scale = 1;
  private dragging: string | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragMoved = false;
  private hovering: string | null = null;
  private animFrame = 0;
  private simulationFrames = 0;
  private MAX_SIM_FRAMES = 300;
  private panning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartOffX = 0;
  private panStartOffY = 0;

  // Card dimensions
  private cardW = 0;
  private cardH = 0;
  private dpr = 1;

  // Dynamic scale factor — all visual/physics params scale relative to reference 600×500
  private get s(): number {
    return Math.sqrt(this.cardW * this.cardH) / 548; // 548 = sqrt(600*500)
  }

  constructor(view: HomepageView) {
    this.view = view;
  }

  private get wikiFolder(): string {
    return this.view.plugin.settings.llmWiki.wikiFolder;
  }

  async render() {
    const card = this.view.containerEl.querySelector("#homepage-wikigraph-card") as HTMLElement;
    if (!card) return;

    card.innerHTML = `
      <canvas id="wikigraph-canvas" style="
        position:absolute;top:0;left:0;width:100%;height:100%;
        cursor:grab;background:var(--background-primary);
      "></canvas>
      <div id="wikigraph-tooltip" style="
        position:absolute;pointer-events:none;display:none;
        background:var(--background-secondary);color:var(--text-normal);
        padding:4px 8px;border-radius:4px;font-size:11px;
        box-shadow:0 2px 8px rgba(0,0,0,0.15);white-space:nowrap;
      "></div>
      <div id="wikigraph-toolbar" style="
        display:flex;align-items:center;justify-content:space-between;
        padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);
        position:absolute;top:0;left:0;right:0;z-index:1;
        background:var(--background-primary);
        border-radius:14px 14px 0 0;
      ">
        <span style="font-size:13px;font-weight:600;color:var(--text-normal);">🔗 Wiki 图谱</span>
        <div style="display:flex;gap:6px;align-items:center;font-size:10px;color:var(--text-muted);">
          ${Object.entries(NODE_COLORS).map(([type, color]) =>
            `<span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>${this.typeLabel(type as GraphNode["type"])}</span>`
          ).join("")}
          <button id="wikigraph-refresh-btn" style="
            background:var(--interactive-accent);color:#fff;border:none;padding:2px 8px;
            border-radius:4px;font-size:10px;cursor:pointer;margin-left:4px;
          ">刷新</button>
        </div>
      </div>`;

    this.canvas = card.querySelector("#wikigraph-canvas") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.bindEvents();

    card.querySelector("#wikigraph-refresh-btn")?.addEventListener("click", () => this.rebuild());

    // Wait for browser layout to complete so clientWidth/clientHeight are non-zero
    let attempts = 0;
    while ((this.cardW === 0 || this.cardH === 0) && attempts < 10) {
      await new Promise<void>(resolve => requestAnimationFrame(() => {
        this.setupCanvasSize();
        resolve();
      }));
      attempts++;
    }
    if (this.cardW === 0 || this.cardH === 0) return; // card not visible
    await this.rebuild();
  }

  private typeLabel(type: GraphNode["type"]): string {
    const labels: Record<string, string> = { source: "源笔记", summary: "摘要", concept: "概念", index: "索引", folder: "文件夹" };
    return labels[type] || type;
  }

  private setupCanvasSize() {
    const card = this.view.containerEl.querySelector("#homepage-wikigraph-card") as HTMLElement;
    if (!card) return;
    this.dpr = window.devicePixelRatio || 1;
    const w = card.clientWidth;
    const h = card.clientHeight;
    if (w === 0 || h === 0) return; // layout not ready
    this.cardW = w;
    this.cardH = h;
    this.canvas.width = this.cardW * this.dpr;
    this.canvas.height = this.cardH * this.dpr;
    this.canvas.style.width = `${this.cardW}px`;
    this.canvas.style.height = `${this.cardH}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private bindEvents() {
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));
    this.canvas.addEventListener("mouseleave", () => { this.dragging = null; this.panning = false; });
    this.canvas.addEventListener("wheel", (e) => this.onWheel(e as WheelEvent));
    this.canvas.addEventListener("dblclick", (e) => this.onDblClick(e));

    // Resize observer on the card
    const cardEl = this.view.containerEl.querySelector("#homepage-wikigraph-card") as HTMLElement;
    if (cardEl) {
      new ResizeObserver(() => {
        this.setupCanvasSize();
        this.draw();
      }).observe(cardEl);
    }
  }

  // ── Data parsing ──────────────────────────────────────────

  private async rebuild() {
    if (this.cardW === 0 || this.cardH === 0) return;
    this.nodes = [];
    this.edges = [];
    this.nodeMap.clear();
    this.simulationFrames = 0;
    this.MAX_SIM_FRAMES = 300;
    await this.parseWikiFiles();
    // Remove isolated nodes (no connections)
    this.nodes = this.nodes.filter(n => n.degree > 0);
    this.edges = this.edges.filter(e => this.nodeMap.has(e.source) && this.nodeMap.has(e.target));
    this.nodeMap.clear();
    for (const n of this.nodes) this.nodeMap.set(n.id, n);
    this.initializePositions();
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
    this.startSimulation();
  }

  private async parseWikiFiles() {
    const vault = this.view.plugin.app.vault;
    const files = vault.getFiles();
    const wikiFolder = this.wikiFolder;
    const excludeDirs = [".obsidian", ".trash", ".git", wikiFolder, "_attachments", "assets"];

    // Source notes
    const sourceFiles = files.filter(f => {
      if (f.extension !== "md") return false;
      for (const dir of excludeDirs) {
        if (f.path.startsWith(dir + "/") || f.path === dir) return false;
      }
      return true;
    });

    for (const f of sourceFiles) {
      this.addNode(f.path, f.name.replace(/\.md$/, ""), "source", f.path);
    }

    // Folder nodes — extract unique directory paths from source files,
    // create folder nodes with parent→child and folder→file edges
    const dirSet = new Set<string>();
    for (const f of sourceFiles) {
      const parts = f.path.split("/");
      // Build all parent dirs: "a/b/c.md" → "a", "a/b"
      for (let i = 1; i < parts.length; i++) {
        dirSet.add(parts.slice(0, i).join("/"));
      }
    }
    for (const dir of dirSet) {
      const name = dir.split("/").pop()!;
      this.addNode(`[dir]${dir}`, `📁 ${name}`, "folder", dir);
      // Edge: folder → file (unidirectional, outward from folder)
      for (const f of sourceFiles) {
        const fDir = f.path.substring(0, f.path.lastIndexOf("/"));
        if (fDir === dir) {
          this.addEdge(`[dir]${dir}`, f.path);
        }
      }
      // Edge: parent → child folder (unidirectional, top-down)
      const parentDir = dir.substring(0, dir.lastIndexOf("/"));
      if (parentDir && dirSet.has(parentDir)) {
        this.addEdge(`[dir]${parentDir}`, `[dir]${dir}`);
      }
    }

    // Wiki pages
    const wikiFiles = files.filter(f =>
      f.extension === "md" && f.path.startsWith(wikiFolder + "/")
    );

    for (const f of wikiFiles) {
      const name = f.name.replace(/\.md$/, "");
      let type: GraphNode["type"];
      if (f.path.startsWith(`${wikiFolder}/summaries/`)) {
        type = "summary";
      } else if (f.path.startsWith(`${wikiFolder}/concepts/`)) {
        type = "concept";
      } else {
        type = "index";
      }
      this.addNode(f.path, name, type, f.path);
    }

    // Parse content for [[wikilinks]] to build edges
    for (const f of wikiFiles) {
      try {
        const content = await vault.read(f);
        // Extract [[links]] from content
        const links = this.extractLinks(content);
        for (const link of links) {
          const target = this.resolveLink(link, wikiFolder);
          if (target && target !== f.path) {
            this.addEdge(f.path, target);
          }
        }


        // For index: extract links from markdown link format too
        if (f.path === `${wikiFolder}/index.md` || f.path === `${wikiFolder}/overview.md`) {
          const mdLinks = content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
          for (const m of mdLinks) {
            const targetPath = m[2].trim();
            if (this.nodeMap.has(targetPath)) {
              this.addEdge(f.path, targetPath);
            }
          }
        }
      } catch {
        // skip unreadable
      }
    }

    // ── Folder-centric topology: index → folders → sources/summaries/concepts ──

    // For each summary, find its source file and the folder containing that source
    const summarySourceFolder = new Map<string, string>(); // summaryPath → folderDir
    for (const f of wikiFiles) {
      if (!f.path.startsWith(`${wikiFolder}/summaries/`)) continue;
      const summaryName = f.name.replace(/\.md$/, "");
      for (const sf of sourceFiles) {
        if (sf.name.replace(/\.md$/, "") === summaryName) {
          const fDir = sf.path.substring(0, sf.path.lastIndexOf("/"));
          summarySourceFolder.set(f.path, fDir);
          // Folder → summary edge
          if (fDir && dirSet.has(fDir)) {
            this.addEdge(`[dir]${fDir}`, f.path);
          }
          break;
        }
      }
    }

    // Index → top-level folders
    const indexPath = `${wikiFolder}/index.md`;
    for (const dir of dirSet) {
      if (!dir.includes("/")) {
        this.addEdge(indexPath, `[dir]${dir}`);
      }
    }

    // Folder → concepts: connect concept to folder if name matches
    // or if the concept is referenced from summaries in that folder
    for (const f of wikiFiles) {
      if (!f.path.startsWith(`${wikiFolder}/concepts/`)) continue;
      const conceptName = f.name.replace(/\.md$/, "");
      // Match concept to folder by name
      for (const dir of dirSet) {
        const dirName = dir.split("/").pop()!;
        if (dirName === conceptName) {
          this.addEdge(`[dir]${dir}`, f.path);
        }
      }
      // Also connect concept to folders whose summaries reference it
      const conceptLink = `[[${conceptName}]]`;
      for (const [sumPath, folderDir] of summarySourceFolder) {
        if (!folderDir || !dirSet.has(folderDir)) continue;
        try {
          const sumContent = await vault.read(vault.getFiles().find(x => x.path === sumPath)!);
          if (sumContent.includes(conceptLink) || sumContent.includes(`[[${conceptName}]]`)) {
            this.addEdge(`[dir]${folderDir}`, f.path);
          }
        } catch { /* skip */ }
      }
    }
  }

  private addNode(id: string, label: string, type: GraphNode["type"], path: string) {
    if (this.nodeMap.has(id)) return;
    const node: GraphNode = {
      id, label, type, path,
      x: 0, y: 0, vx: 0, vy: 0,
      radius: NODE_BASE_RADII[type] * this.s,
      degree: 0,
    };
    this.nodes.push(node);
    this.nodeMap.set(id, node);
  }

  private addEdge(source: string, target: string) {
    // Dedupe
    if (this.edges.some(e =>
      (e.source === source && e.target === target) ||
      (e.source === target && e.target === source)
    )) return;
    this.edges.push({ source, target });
    const sn = this.nodeMap.get(source);
    const tn = this.nodeMap.get(target);
    if (sn) sn.degree++;
    if (tn) tn.degree++;
  }

  private extractLinks(content: string): string[] {
    const links: string[] = [];
    // [[Page Name]], [[Page Name|Display]], [[Page#Heading]]
    const regex = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      links.push(match[1].trim());
    }
    return links;
  }

  private resolveLink(name: string, wikiFolder: string): string | null {
    // Try exact match first
    if (this.nodeMap.has(name)) return name;
    // Try with .md extension
    if (this.nodeMap.has(`${name}.md`)) return `${name}.md`;
    // Try in wiki folder paths
    for (const id of this.nodeMap.keys()) {
      if (id.endsWith(`/${name}.md`) || id.endsWith(`/${name}`)) {
        return id;
      }
      // Match by basename
      const base = id.split("/").pop()?.replace(/\.md$/, "");
      if (base === name) return id;
    }
    return null;
  }

  // ── Position initialization ──────────────────────────────

  private initializePositions() {
    const cx = this.cardW / 2;
    const cy = this.cardH / 2 + 30; // shift down for toolbar
    const r = Math.min(cx, cy) * 0.3;
    for (let i = 0; i < this.nodes.length; i++) {
      const angle = (2 * Math.PI * i) / this.nodes.length;
      const jitter = (Math.random() - 0.5) * r * 0.3;
      this.nodes[i].x = Math.max(0, Math.min(this.cardW, cx + Math.cos(angle) * (r + jitter)));
      this.nodes[i].y = Math.max(60, Math.min(this.cardH, cy + Math.sin(angle) * (r + jitter)));
      this.nodes[i].vx = 0;
      this.nodes[i].vy = 0;
    }
  }

  // ── Force simulation ─────────────────────────────────────

  private startSimulation() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.simulationFrames = 0;
    this._fitted = false;
    this._settled = false;
    this.tick();
  }

  private _fitted = false;
  private _settled = false;

  private tick = () => {
    const active = this.simulationFrames < this.MAX_SIM_FRAMES;
    if (active) {
      this.applyForces();
      this.simulationFrames++;
    }
    // Auto-fit after some settling, then stop the physics loop
    if (!this._fitted && this.nodes.length > 0 &&
        (this.simulationFrames >= this.MAX_SIM_FRAMES || this.simulationFrames >= 60)) {
      this.fitToView();
      this._fitted = true;
      this._settled = true;
    }
    this.draw();
    if (active || !this._settled) {
      this.animFrame = requestAnimationFrame(this.tick);
    } else {
      this.animFrame = 0; // loop stopped; clear handle so wake can restart
    }
  };

  private applyForces() {
    const n = this.nodes.length;
    if (n < 2) return;

    const area = this.cardW * this.cardH;
    const k = Math.sqrt(area / n); // ideal edge length (Fruchterman-Reingold)
    const baseStrength = 0.03;

    // ── Degree-driven force scaling ─────────────────────────
    const maxDegree = Math.max(1, ...this.nodes.map(nd => nd.degree));
    const degreeScale = (d: number) => 0.1 + 0.9 * (d / maxDegree);

    // ── Repulsion (all pairs) ───────────────────────────────
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const dist = Math.sqrt(d2);
        if (dist < this.s) {
          if (a.id !== this.dragging) a.x -= this.s;
          if (b.id !== this.dragging) b.x += this.s;
          continue;
        }
        const scale = Math.max(degreeScale(a.degree), degreeScale(b.degree));
        const f = (k * k) / dist * baseStrength * scale;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        if (a.id !== this.dragging) { a.vx -= fx; a.vy -= fy; }
        if (b.id !== this.dragging) { b.vx += fx; b.vy += fy; }
      }
    }

    // ── Attraction (edges) ──────────────────────────────────
    const isDraggedEdge = (aId: string, bId: string) =>
      aId === this.dragging || bId === this.dragging;
    for (const e of this.edges) {
      const a = this.nodeMap.get(e.source);
      const b = this.nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;
      const avgScale = (degreeScale(a.degree) + degreeScale(b.degree)) / 2;
      const dragBoost = isDraggedEdge(e.source, e.target) ? 4 : 1;
      const f = (dist * dist) / k * baseStrength * avgScale * dragBoost;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // ── Center gravity ──────────────────────────────────────
    // Degree-proportional pull toward viewport center:
    //   hubs (high degree) → strongly anchored near center
    //   leaves (low degree) → weak pull, can orbit outward
    const cx = this.cardW / 2;
    const cy = this.cardH / 2 + 30;
    const maxSpeed = 10 * this.s;
    for (const node of this.nodes) {
      if (node.id === this.dragging) continue;
      const dxc = cx - node.x;
      const dyc = cy - node.y;
      const g = 0.01 + 0.09 * degreeScale(node.degree);
      node.vx += dxc * g;
      node.vy += dyc * g;
      // Clamp velocity
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > maxSpeed) {
        node.vx = (node.vx / speed) * maxSpeed;
        node.vy = (node.vy / speed) * maxSpeed;
      }
      // Damping
      node.vx *= 0.5;
      node.vy *= 0.5;
      // Apply
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  // ── Auto-fit ─────────────────────────────────────────────

  private fitToView() {
    if (this.nodes.length === 0) return;
    const pad = 40 * this.s;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    if (bw <= 0 || bh <= 0) return;

    const scaleX = this.cardW / bw;
    const scaleY = this.cardH / bh;
    this.scale = Math.max(0.5, Math.min(scaleX, scaleY, 1.5));
    this.offsetX = (this.cardW - (minX + maxX) * this.scale) / 2;
    this.offsetY = (this.cardH - (minY + maxY) * this.scale) / 2;
  }

  // ── Rendering ────────────────────────────────────────────

  private draw() {
    const ctx = this.ctx;
    const w = this.cardW;
    const h = this.cardH;
    if (!ctx || !w || !h) return;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // Edges
    for (const e of this.edges) {
      this.drawEdge(ctx, e);
    }

    // Nodes
    for (const node of this.nodes) {
      this.drawNode(ctx, node);
    }

    ctx.restore();
  }

  private drawEdge(ctx: CanvasRenderingContext2D, edge: GraphEdge) {
    const a = this.nodeMap.get(edge.source);
    const b = this.nodeMap.get(edge.target);
    if (!a || !b) return;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(160,160,160,0.4)";
    ctx.lineWidth = Math.max(0.8 * this.s, 1.5 * this.s / this.scale);
    ctx.stroke();
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: GraphNode) {
    // Radius: base × (1 + degree/2), capped at 4× base, scaled by s
    const maxDegree = Math.max(1, ...this.nodes.map(nd => nd.degree));
    const degreeBoost = 1 + (node.degree / Math.max(1, maxDegree)) * 3; // 1× → 4×
    const r = Math.min(16 * this.s, node.radius * degreeBoost);
    const isHovered = this.hovering === node.id;

    // Glow on hover
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 6 * this.s, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = NODE_COLORS[node.type];
    ctx.fill();

    // Border
    ctx.strokeStyle = isHovered ? "#fff" : "rgba(0,0,0,0.2)";
    ctx.lineWidth = isHovered ? Math.max(1.5, 2 * this.s) : Math.max(0.8, this.s);
    ctx.stroke();

    // Label
    const baseFontSize = 11 * this.s;
    const fontSize = Math.max(7 * this.s, Math.min(12 * this.s, baseFontSize / this.scale));
    if (fontSize > 5 * this.s) {
      ctx.font = `${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle = "#d0d0d0";
      ctx.textAlign = "center";
      const maxChars = Math.max(8, Math.round(12 * this.s));
      const truncated = node.label.length > maxChars ? node.label.substring(0, maxChars - 1) + "…" : node.label;
      ctx.fillText(truncated, node.x, node.y + r + fontSize + 2 * this.s);
    }
  }

  // ── Interaction ──────────────────────────────────────────

  private wakeSimulation() {
    this._settled = false;
    this.simulationFrames = 0;
    if (!this.animFrame) this.animFrame = requestAnimationFrame(this.tick);
  }

  private wakeDraw() {
    if (!this.animFrame) {
      // Single-frame draw only, no physics
      this.animFrame = requestAnimationFrame(() => {
        this.draw();
        this.animFrame = 0;
      });
    }
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.offsetX) / this.scale,
      y: (sy - rect.top - this.offsetY) / this.scale,
    };
  }

  private hitTest(wx: number, wy: number): GraphNode | null {
    const hitRadius = 16 * this.s / this.scale;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const r = Math.min(22 * this.s, n.radius + n.degree * 1.5 * this.s) + hitRadius;
      const dx = wx - n.x;
      const dy = wy - n.y;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  }

  private onMouseDown(e: MouseEvent) {
    const world = this.screenToWorld(e.clientX, e.clientY);
    const hit = this.hitTest(world.x, world.y);

    if (hit) {
      this.dragging = hit.id;
      this.dragOffsetX = hit.x - world.x;
      this.dragOffsetY = hit.y - world.y;
      this.dragMoved = false;
      this.wakeSimulation();
      (this.canvas.style as any).cursor = "grabbing";
    } else {
      this.panning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.panStartOffX = this.offsetX;
      this.panStartOffY = this.offsetY;
      this.wakeDraw();
      (this.canvas.style as any).cursor = "grabbing";
    }
  }

  private onMouseMove(e: MouseEvent) {
    const world = this.screenToWorld(e.clientX, e.clientY);

    if (this.dragging) {
      const node = this.nodeMap.get(this.dragging);
      if (node) {
        const newX = world.x + this.dragOffsetX;
        const newY = world.y + this.dragOffsetY;
        const dx = newX - node.x;
        const dy = newY - node.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.dragMoved = true;
        const padX = node.radius + 4;
        const padTop = node.radius + 60;
        const padBottom = node.radius + 4;
        node.x = Math.max(padX, Math.min(this.cardW - padX, newX));
        node.y = Math.max(padTop, Math.min(this.cardH - padBottom, newY));
        node.vx = 0;
        node.vy = 0;
        this.simulationFrames = 0; // keep sim alive so neighbors follow
      }
    } else if (this.panning) {
      this.offsetX = this.panStartOffX + (e.clientX - this.panStartX);
      this.offsetY = this.panStartOffY + (e.clientY - this.panStartY);
      this.wakeDraw();
    } else {
      // Hover
      const hit = this.hitTest(world.x, world.y);
      const prev = this.hovering;
      this.hovering = hit ? hit.id : null;
      if (prev !== this.hovering) {
        this.updateTooltip(hit, e);
        this.canvas.style.cursor = hit ? "pointer" : "grab";
      }
    }
  }

  private onMouseUp(e: MouseEvent) {
    if (this.dragging && !this.dragMoved) {
      // Click — open file
      const node = this.nodeMap.get(this.dragging);
      if (node) {
        this.view.plugin.app.workspace.openLinkText(node.path, "", false);
      }
    }
    this.dragging = null;
    this.panning = false;
    (this.canvas.style as any).cursor = this.hovering ? "pointer" : "grab";
    // If we were dragging a node, restart simulation to settle
    if (this.dragMoved) {
      this.simulationFrames = 0;
      this._settled = false;
      this._fitted = false;
      this.MAX_SIM_FRAMES = 80; // shorter settle after drag
      if (!this.animFrame) this.animFrame = requestAnimationFrame(this.tick);
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldScale = this.scale;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    this.scale = Math.max(0.2, Math.min(3, this.scale * factor));

    // Zoom toward cursor
    const scaleChange = this.scale / oldScale;
    this.offsetX = mx - (mx - this.offsetX) * scaleChange;
    this.offsetY = my - (my - this.offsetY) * scaleChange;
    this.wakeDraw();
  }

  private onDblClick(e: MouseEvent) {
    const world = this.screenToWorld(e.clientX, e.clientY);
    const hit = this.hitTest(world.x, world.y);
    if (hit) {
      this.view.plugin.app.workspace.openLinkText(hit.path, "", false);
    }
  }

  private updateTooltip(node: GraphNode | null, e: MouseEvent) {
    const tip = this.view.containerEl.querySelector("#wikigraph-tooltip") as HTMLElement;
    if (!tip) return;
    if (!node) {
      tip.style.display = "none";
      return;
    }
    const canvas = this.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    tip.textContent = `${node.label} (${this.typeLabel(node.type)})`;
    tip.style.display = "block";
    tip.style.left = `${e.clientX - canvasRect.left + 12}px`;
    tip.style.top = `${e.clientY - canvasRect.top - 28}px`;
  }

  cleanup() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = 0;
    }
  }
}
