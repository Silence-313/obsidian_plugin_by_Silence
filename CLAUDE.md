# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Obsidian 插件，启动时自动展示一个**自定义交互首页**（`ItemView`），顶部 header 栏显示：
- 左侧：时段问候语（早上好/上午好/中午好/下午好/晚上好）+ 可编辑名字（内联输入框，失焦保存）
- 中间：实时时钟（`HH:MM:SS`，每秒更新）
- 右侧：日期 + 星期

名字保存在插件 data.json 中，下次启动自动恢复。不再依赖 Markdown 笔记。

## 技术栈

- TypeScript + esbuild 打包
- 输出 `main.js`（CommonJS 格式），供 Obsidian 加载
- 依赖类型库 `obsidian`（仅在编译时使用，external 不打包）

## 命令

```bash
npm run build      # 编译并打包（生产模式，无 sourcemap）
npm run dev        # 开发模式（watch + inline sourcemap）
npm run lint       # TypeScript 类型检查
```

## 文件结构

```
src/                 # 源码目录
  main.ts            # 入口文件，单行 re-export plugin.ts
  types.ts           # 所有 interface/type（TodoItem, ComponentInfo, CardLayout, HomepageSettings, StudySettings, MemoryReviewSettings）
  constants.ts       # 常量（VIEW_TYPE_HOMEPAGE, VIEW_TYPE_STUDY, DEFAULT_COMPONENTS, DEFAULT_SETTINGS, TODO_COLORS）
  utils.ts           # 纯工具函数（formatDateKey, getTimePeriod, escapeHtml, formatTime, formatDate）+ callDeepSeek 共享 API 客户端
  plugin.ts          # HomepagePlugin 类 — 插件入口，注册 view/command/settingTab
  modals.ts          # TodoAddModal + DesktopFolderModal 弹窗类
  settings.ts        # HomepageSettingTab 设置面板
  view.ts            # HomepageView 类 — 首页视图核心骨架：生命周期、卡片系统、Header、协调方法
  study-view.ts      # StudyView 类 — 学习模式 ItemView：iframe 浏览器、视频平台识别、拖拽选取框
  study-controller.ts # StudyController 类 — 学习模式编排：split 管理、截图（4 层策略）、编辑器插入
  components/        # 组件模块目录
    schedule.ts      # ScheduleComponent — 日程中心：统计栏、日历、待办、昨日复盘
    timer.ts         # TimerComponent — 计时器：表盘/数字显示、选择器、倒计时通知
    desktop.ts       # DesktopComponent — 超级桌面：文件网格、导航、多实例管理
    sidebar.ts       # SidebarComponent — 侧边栏：组件列表、拖拽、搜索过滤
    todolist.ts      # TodoListComponent — 待办列表：嵌入/独立模式、甘特图、Tab 切换
    llmwiki.ts       # LlmWikiComponent — LLM Wiki：DeepSeek API 对话、知识库维护、委托 AgentOrchestrator
	    wiki-graph.ts    # WikiGraphComponent — Wiki 图谱：Canvas 2D 力导向布局、拖拽/缩放/点击交互
	    app-launcher.ts  # AppLauncherComponent — 应用启动器：网格图标、AppleScript 窗口定位、启动/关闭/对齐
	    inline-predict.ts # InlinePredictPlugin — 内联预测：CM6 ViewPlugin + StateField，幽灵文本补全
	    code-runner.ts       # CodeRunner 执行引擎 — executeCode() 支持 py/js/sh/c/cpp
	    code-runner-markdown.ts # 阅读视图：registerMarkdownCodeBlockProcessor 注入 Run 按钮
	    code-runner-editor.ts   # 实时预览：CM6 ViewPlugin 扫描代码块 + Decoration.widget
tt    note-assistant.ts  # NoteAssistantComponent — 笔记助手：悬浮窗聊天 UI、标记式编辑、静默总结
tt    memory-review.ts   # MemoryReviewComponent — 记忆复习：扫描最近笔记、LLM 生成卡片/题目、翻转/选择交互
  agent/             # Agent 模块 — 5 层认知系统
    index.ts          # 模块 barrel export
    agent_orchestrator.ts  # AgentOrchestrator — 中央管线（5 层全集成）
    tool_router.ts    # 工具路由：评分式意图分类（keywords+patterns+adaptive thresholds）
    vector_wiki_store.ts   # TF-IDF + 余弦相似度语义检索，RAG 反馈权重调整
    router_telemetry.ts    # 路由学习：自适应阈值、策略权重演化、per-tool 成功率追踪
    rag_feedback.ts        # RAG 反馈环：文档权重调整、查询聚类、负信号下权重
    system_evolution.ts    # 系统演化：记忆衰减/强化/合并、安全门（±0.05 clamp、3次确认）
    memory/           # Layer 1-2：记忆 + 概念
      working_memory.ts    # 短期记忆：最近 N 条对话（纯内存）
      episodic_memory.ts   # 情景记忆：事件/目标/决策，演化评分字段，衰减+强化
      user_profile.ts      # 用户画像：结构化属性+置信度追踪
      tool_memory.ts       # 工具记忆：使用频率/成功率/上下文有效性
      memory_writer.ts     # 记忆写入：交互后分类+合并去重+概念提取+链接
      memory_store.ts      # MarkdownMemoryStore：Markdown 持久化（episodes/concepts/reasoning/policy 全管理）
      concept_extractor.ts # 启发式概念提取（标题/二元组/三元组/英文复合词）
    reasoning/        # Layer 3-4：推理 + 反馈
      concept_graph_builder.ts # 概念图构建 + 1-hop 子图展开
      concept_reasoner.ts      # 3 策略推理引擎（图遍历/模式匹配/抽象）
      feedback_processor.ts    # 认知反馈：追踪存储 + 权重增强 + 策略学习
      concept_evolver.ts       # 概念演化：合并/分裂/衰减
    policy/           # Layer 5：全局认知控制
      drift_controller.ts      # 漂移控制：偏好平衡/稳定性约束/压缩信号/健康监测
    tools/            # 工具决策层
      tool_decision_policy.ts  # ToolDecisionPolicy：LLM 自主决策工具/技能使用
    skills/           # 技能层（系统特权能力）
      skill_registry.ts        # SkillRegistry：注册/执行/权限校验
      get_current_location.ts  # 浏览器 geolocation + 优雅降级
      read_local_file.ts       # 安全文件读取（6 层沙箱 + 路径遍历防护）
      index.ts                 # createDefaultSkillRegistry()
  core/              # 核心架构层
    cognitive_state.ts         # CognitiveState SSOT + createEmptyState()
    state_mutation_engine.ts   # StateMutation 联合类型 + validate/apply/applyBatch（±0.05 clamp）
    mutation_queue.ts          # add/dedup/sort/flush 突变管线
manifest.json        # 插件元数据
DESCRIPTION.md       # 插件功能详细描述文档（面向用户，完整功能说明）
esbuild.config.mjs   # esbuild 打包配置（入口 src/main.ts，输出到 vault）
styles.css           # 日历 hover 样式
```

### 核心类

| 类 | 文件 | 职责 |
|----|------|------|
| `HomepagePlugin` | `plugin.ts` | 插件入口，注册 view/command/settingTab，管理 settings |
| `HomepageView` | `view.ts` | ItemView，核心骨架：生命周期、卡片系统（拖拽/缩放/碰撞检测）、Header 时钟、待办 CRUD 协调 |
| `ScheduleComponent` | `components/schedule.ts` | 日程中心：左侧统计柱状图、日历、右侧待办列表、昨日复盘同步 |
| `TimerComponent` | `components/timer.ts` | 计时器：表盘/数字双模式、H/M/S 滚动选择器、倒计时、到点通知 |
| `DesktopComponent` | `components/desktop.ts` | 超级桌面：多实例文件浏览器、网格展示、导航进入/返回、双击打开 |
| `SidebarComponent` | `components/sidebar.ts` | 侧边栏：组件列表、搜索过滤、点击切换/拖拽添加移除组件 |
| `TodoListComponent` | `components/todolist.ts` | 待办列表：今天/本周/本月 Tab、纵向甘特图、嵌入/独立双模式 |
| `HomepageSettingTab` | `settings.ts` | 设置面板 |
| `TodoAddModal` | `modals.ts` | 添加待办的弹窗（继承 Modal） |
| `DesktopFolderModal` | `modals.ts` | 超级桌面文件夹路径配置弹窗（继承 Modal） |
| `LlmWikiComponent` | `components/llmwiki.ts` | LLM Wiki：UI 渲染、对话管理、知识库维护（委托 AgentOrchestrator 处理 agent 逻辑） |
| `AgentOrchestrator` | `agent/agent_orchestrator.ts` | Agent 中央管线：Tool Router → Memory Retrieval → LLM → Tools → Memory Writer → Response |
| `RouterTelemetry` | `agent/router_telemetry.ts` | 路由学习：自适应阈值、策略权重演化、成功率追踪 |
| `RagFeedback` | `agent/rag_feedback.ts` | RAG 反馈环：文档权重调整、查询聚类、负信号处理 |
| `StudyView` | `study-view.ts` | 学习模式 ItemView：iframe 浏览器、视频平台 embed 转换、拖拽选取框 |
| `StudyController` | `study-controller.ts` | 学习模式编排：split 布局、4 层截图策略、编辑器插入 |
| `WikiGraphComponent` | `components/wiki-graph.ts` | Wiki 图谱：Canvas 2D 渲染、Fruchterman-Reingold 力导向布局、拖拽/缩放/点击打开文件 |
| `AppLauncherComponent` | `components/app-launcher.ts` | 应用启动器：网格 emoji 图标、AppleScript 窗口定位到卡片位置、启用/关闭/重新对齐 macOS 应用 |
| `MarkdownMemoryStore` | `agent/memory/memory_store.ts` | Markdown 记忆持久化：episodes/concepts/reasoning traces/policy 全管理，YAML frontmatter 序列化 |
| `ConceptExtractor` | `agent/memory/concept_extractor.ts` | 启发式概念提取：标题/二元组/三元组/英文复合词评分 |
| `ConceptGraphBuilder` | `agent/reasoning/concept_graph_builder.ts` | 概念图构建：3 种边类型（related/shared-episode/tag-overlap），1-hop 子图展开 |
| `ConceptReasoner` | `agent/reasoning/concept_reasoner.ts` | 3 策略推理：图遍历（关系+桥接）/模式匹配（关键概念+强关联）/抽象（概念簇+洞察+矛盾） |
| `FeedbackProcessor` | `agent/reasoning/feedback_processor.ts` | 认知反馈：推理追踪存储、概念权重增强、策略学习、洞察频率追踪 |
| `ConceptEvolver` | `agent/reasoning/concept_evolver.ts` | 概念演化：合并（≥70% episode 重叠）、分裂检测、衰减（≥7天未使用 -0.05） |
| `DriftController` | `agent/policy/drift_controller.ts` | 全局认知控制：偏好平衡、稳定性约束、压缩信号检测、认知健康评分 |
| `ToolDecisionPolicy` | `agent/tools/tool_decision_policy.ts` | LLM 自主工具决策：JSON 决策提示、3 层 JSON 容错、保守启发式 fallback |
| `SkillRegistry` | `agent/skills/skill_registry.ts` | 技能注册表：register/execute/validatePermissions，safe/privileged 权限 |
| `StateMutationEngine` | `agent/core/state_mutation_engine.ts` | SSOT 变更权威：7 种突变类型、±0.05 clamp 校验、批量 apply |
| `MutationQueue` | `agent/core/mutation_queue.ts` | 突变缓冲区：add/dedup（合并重复）/sort（优先级）/flush（批量提交） |
| `InlinePredictPlugin` | `components/inline-predict.ts` | CM6 ViewPlugin：debounce 触发、Spark Lite API 调用、幽灵文本 Decoration.widget、前缀匹配裁剪 |
| `PredictionWidget` | `components/inline-predict.ts` | CM6 WidgetType：渲染半透明斜体幽灵文本 |
| `RunBtnWidget` | `components/code-runner-editor.ts` | CM6 WidgetType：代码块行尾 ▶ 按钮，点击执行 |
| `OutputWidget` | `components/code-runner-editor.ts` | CM6 WidgetType：block-level 输出渲染 |
| `CodeRunner` (共享引擎) | `components/code-runner.ts` | `executeCode(lang, code)` + `renderOutput()` 纯逻辑，被两个入口共用 |
| `NoteAssistantComponent` | `components/note-assistant.ts` | 笔记助手：悬浮窗聊天 UI、拖拽/缩放/FAB 最小化、笔记内容同步、编辑器写入回调 |
| `MemoryReviewComponent` | `components/memory-review.ts` | 记忆复习：扫描最近修改笔记、DeepSeek API 生成记忆卡片/题目、翻转/选择交互、数量/模式可配置 |

### 组件架构

每个组件类构造函数接收 `HomepageView` 引用，通过 `this.view.xxx` 访问插件实例、containerEl、app 及共享方法。`HomepageView` 作为协调层，持有所有组件实例。

LlmWikiComponent 的 agent 逻辑全部委托给 `AgentOrchestrator`（`src/agent/agent_orchestrator.ts`），组件仅负责 UI 渲染、对话管理、知识库维护。

### 组件系统

首页采用**组件化架构**，每个功能模块是一个"组件"：

- `ComponentInfo` 接口：`{ id, name, added }`，存储在 `settings.components` 中
- 侧边栏显示「已添加组件」和「待添加组件」两个拖拽区域
- 组件卡片支持**点击切换**和**拖拽**在两组间移动
- 页面只渲染 `added: true` 的组件

当前组件：
- **日程中心** (`id: "schedule"`)：日历 + 待办 + 柱状图 + 昨日复盘（显示昨日未完成待办，支持逐项/全部同步到今天），打包在可拖拽、可缩放的圆角矩形卡片中
- **计时器** (`id: "timer"`)：表盘/数字双模式倒计时，滚动选择器设定时间，到点弹窗提醒，默认未添加
- **超级桌面** (`id: "desktop"`)：多实例文件浏览器，每个实例可绑定 vault 下不同文件夹，网格展示文件/文件夹（emoji 图标），双击 md 文件在 Obsidian 新标签页打开，其余类型用系统默认应用打开。支持 `📁+`/`📝+` 内联创建文件夹/Markdown 文件（输入框直接出现在图标下方，回车确认、Esc 取消）、右键菜单删除文件/文件夹（移至回收站）、`+` 新增实例、`×` 删除实例（≥2 个时显示）、标题可内联编辑，默认未添加。实例通过 `desktopFolders[i]` / `desktopNames[i]` 存储，卡片布局键为 `desktop-{i}`
- **待办列表** (`id: "todolist"`)：时间范围待办视图，Tab 切换今天/本周/本月。今天模式支持纵向甘特图（细线+右侧文字），按开始/结束时间展示时间段。待办项复用 `todos` 数组与日程中心双向同步。与日程中心同时启用时，待办列表卡片隐藏，内容嵌入日程中心右侧面板替代原始待办区域。默认未添加
- **学习模式** (`id: "study"`)：打开 Markdown 文件时自动在左侧创建 split，iframe 内嵌浏览器。输入网址或关键词即可搜索浏览，YouTube/Bilibili/Vimeo 等视频平台自动转为嵌入式播放器（embed URL），支持一边看视频一边记笔记。工具栏有前进/后退/刷新/截图/历史记录。截图点击后显示可拖拽选取框（Enter 截取/Esc 取消），4 层截图策略：Canvas → macOS `screencapture` → `getUserMedia` → 视频缩略图。默认未添加
- **LLM Wiki** (`id: "llmwiki"`)：用户提供 DeepSeek API Key（存储在 macOS Keychain 中），插件读取 vault 笔记 + 待办 + 日程构建知识库（karpathy 方法论：Raw Sources → Wiki → Schema 三层架构）。支持与知识库对话（Agent 模式，含 `get_current_time`、`get_todos`、`get_todo_stats` 工具调用）。对话记录持久化到 `chat-log.md`，维护时自动消化并更新 `concepts/用户画像.md`。每日 13:00 自动维护，也可手动触发。默认未添加
- **Wiki 图谱** (`id: "wikigraph"`)：Canvas 2D 渲染 LLM Wiki 关系图谱。解析 wiki 目录（summaries/concepts/index/overview）和源笔记，提取 [[wikilinks]] 构建节点和边（4 种类型着色：橙/绿/蓝/紫）。Fruchterman-Reingold 力导向布局（斥力/引力等比 strength=0.12），拖拽节点、滚轮缩放、平移、点击打开文件，稳定后自动停止物理循环。所有参数通过 sizeScale 动态适配视口。默认未添加
- **应用启动器** (`id: "applauncher"`)：macOS 应用启动面板，emoji 图标网格展示。点击后 `open -a` 启动应用，AppleScript 自动定位应用窗口到卡片屏幕位置（`activate` + `set position/size`），实现"视觉嵌入"效果。启动后卡片显示运行状态，支持 📍 重新对齐、✕ 关闭应用。默认预置 VS Code、终端、Chrome、访达等 8 个应用，可自定义添加（名称/图标/AppleScript 名称/启动命令）。默认未添加
- **内联预测** (`id: "inlinepredict"`)：编辑器中输入时，获取光标前当前段落文本，发送星火 Spark Lite API 预测后续内容，以半透明斜体幽灵文本显示在光标后。前缀匹配裁剪（用户输入匹配时只显示剩余部分），→ 右键接受，输入偏离时消失。CM6 ViewPlugin + StateField 实现，适用于所有 Markdown 编辑器。`requestUrl` 绕过 CORS。默认未添加
- **代码运行** (`id: "coderunner"`)：笔记中代码块可点击运行，结果显示在代码块下方终端风格区域。支持 Python/JavaScript/Bash/C/C++，解释型直接 `exec`、编译型写临时文件编译运行。阅读视图用 `registerMarkdownCodeBlockProcessor`（**会替换默认渲染，必须自行渲染代码块内容**），实时预览用 CM6 ViewPlugin + Decoration.widget。10s 超时，输出截断 5000 字符。默认未添加
- **笔记助手** (`id: "noteassistant"`)：编辑 Markdown 笔记时自动出现悬浮对话窗口（`position: fixed`，非 Obsidian ItemView），可与 AI Agent 讨论知识点。Header 可拖拽移动，CSS resize 缩放，`—` 最小化为可拖拽 FAB（💬），最小化/展开时浮窗右下角与 FAB 中心对称对齐。工具栏 `📄 同步` 开关注入笔记内容到提问上下文，`📝 总结` 按钮生成结构化总结写入笔记末尾（自动检测替换已有总结）。Agent 通过标记代码块（note-insert/append/replace/delete）直接编辑笔记，打开笔记时静默生成概要。复用 LLM Wiki API Key。仅在活跃 markdown leaf 时显示，切换视图自动最小化。默认未添加
- **记忆复习** (`id: "memoryreview"`)：扫描最近 24h 内修改的笔记，无结果则自动拓展时间窗口（48h→72h→168h→720h），排除系统目录。调用 DeepSeek API 基于笔记内容生成记忆卡片或测验题目。**记忆卡片**：正面问题 + 点击 CSS 3D 翻转查看答案，Grid 叠放自适应高度。**题目模式**：混合选择题（4 选项，点击高亮正确/错误）+ 简答题（textarea 输入 + 查看参考答案）。数量可选 10/20/30/50，segmented control 切换模式。API Key 复用 LLM Wiki Keychain。默认未添加

### 卡片系统

所有组件卡片均为 `position: absolute` 的圆角矩形，统一特性：
- **位置/大小持久化**：`CardLayout { x, y, width, height }`，存储在 `settings.cardLayouts` 中，`setupCardPosition()` 恢复，拖拽结束时保存，`observeCardResizes()` 监听缩放并保存尺寸
- **拖拽**：点击卡片任意非功能区域即可拖拽（排除按钮、输入框、日历日、待办勾选/删除、同步按钮等交互元素），不再依赖独立拖拽手柄
- **缩放**：CSS `resize: both` + `overflow: hidden`，右下角浏览器原生 resize handle。pointerdown 中检测缩放手柄区域（右下角 20px），跳过拖拽让浏览器原生处理，pointerup 时恢复位置
- **碰撞检测**：`constrainNoOverlap()` 检测卡片间重叠，以 12px 间隙推开到最近边缘
- **纵向无限**：内容区 `overflow-y: auto`，卡片可向下任意拖放，`expandContentHeight()` 动态撑开滚动高度

### 关键实现细节

- `formatDateKey(y, m, d)` 生成 `"YYYY-MM-DD"` 格式的日期键
- `getYesterdayKey(dateKey)` 根据指定日期计算前一天的 dateKey
- TodoItem 的 `date` 字段关联日期，`color` 字段对应 `TODO_COLORS`（红/橙/黄/绿）
- 日历日期选中态用 `2px solid var(--interactive-accent)` 描边（非今日），今日用 accent 实心填充
- `setupCardPosition(container, componentId, wrapperSelector)` 统一的卡片定位方法，恢复布局/居中、处理拖拽、碰撞检测、保存位置
- `isInteractiveTarget(target)` 检查点击目标是否为交互元素，决定是否触发拖拽。需包含所有可点击元素（`canvas`、`.llmwiki-link`、`.yesterday-sync-one`、`.yesterday-sync-all` 等），否则卡片 `pointerdown` + `setPointerCapture` 会吞掉点击事件
- 缩放手柄检测：pointerdown 中判断点击是否在右下角 20px 区域（`e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20`），是则设 `isResizing = true` 跳过拖拽
- `constrainNoOverlap()` 检测卡片间碰撞，沿最短方向推开（含 12px 间隙）。外层循环迭代直到位置稳定（最多 10 次），避免解决 A 与 B 重叠后被推回 A 的连锁问题
- `expandContentHeight()` 根据最低卡片的底部位置动态设 `minHeight`，确保内容区可滚动到所有卡片
- `observeCardResizes()` 用 ResizeObserver 监听卡片尺寸变化，仅保存宽高，不操作 DOM 位置（避免与浏览器原生 resize 冲突）
- `renderTimerPicker(field, label, max, cur)` 生成 H/M/S 滚动选择器 HTML，消除三份重复模板
- `initTimerDisplay` 的 outside-click 监听用存储 handler 引用 + removeEventListener 防止重复绑
- 昨日复盘：`syncTodoToToday(id)` 逐项同步，`syncAllYesterday()` 一键同步全部，直接修改 `todo.date` 并刷新三个面板
- 超级桌面多实例：`desktopCurrentPaths: string[]` 持久化在 settings 中，每次导航自动保存。`desktopFolders: string[]` / `desktopNames: string[]` 同样持久化。`addDesktopInstance()` / `removeDesktopInstance(i)` 同步维护三个数组后调用 `render()` 重建 DOM。view.ts 初始化时做长度对齐 guard 兼容旧数据
- 侧边栏：作为 container 直接子元素（非 `#homepage-content` 子元素），`position: absolute` + 动态 `top = header.offsetHeight` 使其固定在 header 下方不随内容滚动。展开宽度 236px（刚好容纳 3 个 64px 组件图标横向排列）。展开时点击 overlay 自动关闭
- TodoItem 新增可选字段 `startTime?: string` / `endTime?: string`（"HH:MM"），兼容旧数据。`TodoAddModal` 新增时间选择器（`<input type="time">`），`addTodo` 签名改为 5 参数
- 待办列表甘特图：`renderGanttView()` 以 `HOUR_H=40` + `STRIP_W=5` 细线 + 右侧文字展示，`parseMinutes()` 解析时间字符串。时间重叠的待办通过贪心泳道分配算法（按开始时间排序→分配非重叠 lane→平分宽度）避免文字叠压，`getWeekRange()` / `getMonthRange()` 计算周/月范围
- 待办列表联动：`refreshTodoListView()` 根据两者是否同时启用自动分发 → `renderTodoListEmbedded()`（嵌入日程右侧面板，渲染完整 Tab+内容到 `#homepage-todo`）或 `renderTodoListStandalone()`（独立卡片，渲染到 `#homepage-todolist-content`），共享渲染逻辑在 `renderTodoListContent()`
- 所有卡片 wrapper 必须在 `#homepage-content` 内部（`position: relative`），否则不跟随滚动且碰撞检测感知不到
- `getOtherCardBounds()` 用 `[data-component-wrapper]` 属性选择器选中所有卡片，排除自身并跳过 `!el.style.left` 的未定位卡片。`data-component-wrapper="true"` 在 render() 中统一添加到各 wrapper div
- pointermove 拖拽时，`constrainNoOverlap` 可能把卡片推出边界（如 y=−252），`Math.max(0, y)` 裁切后可能仍重叠。因此 pointermove 做了 constrain+clamp 循环（最多 5 次），直到位置稳定
- 卡片拖拽边界：`getSidebarWidth()` 实时读取侧边栏宽度（28px/236px），`maxX` 计算中减去侧边栏宽度防止卡片拖到侧边栏下方
- `registerMarkdownCodeBlockProcessor` 会**完全替换**该语言的默认渲染，必须自行创建 `<pre><code>` 结构，否则代码块空白
- 内联预测使用 `requestUrl`（Obsidian 内置 API）而非 `fetch`，绕过 `app://obsidian.md` 的 CORS 限制
- 星火 Spark Lite HTTP API：端点 `https://spark-api-open.xf-yun.com/v1/chat/completions`，模型名 `lite`，认证 `Bearer apiKey:apiSecret`（冒号拼接），**不支持 system 角色**

### Agent 架构（5 层认知系统）

Agent 系统已演化为 **5 层自我改进认知系统**，所有逻辑从 UI 组件中解耦到 `src/agent/` 目录。

**执行管线**（`AgentOrchestrator.process()`）：

```
User Input
  → Tool Router (评分式意图分类)
  → Memory Retrieval (vector wiki + episodic + profile)
  → Concept Reasoning (子图构建 + 3策略推理 + 策略感知种子选择)
  → Enhanced Prompt (注入推理上下文: 关键概念/关系/洞察/桥接/矛盾)
  → LLM Probe + Stream
  → Tool Execution (本地 switch/case)
  → Memory Writer (episode 持久化)
  → Concept Extraction (启发式提取 + 概念文件 + episode↔concept 链接)
  → Cognitive Feedback (追踪存储 + 概念权重增强 + 策略学习)
  → Periodic Health Check (每15次: 压缩信号/认知健康评分)
  → Evolution Cycle (每10次: 记忆衰减+合并; 每20次: 概念演化合并/分裂/衰减)
```

**5 层架构**：

| 层 | 目录 | 职责 | 存储 |
|----|------|------|------|
| **Layer 1: Memory** | `memory/` | 短期工作记忆 + 情景记忆(演化评分) + 用户画像 + 工具统计，Markdown 持久化 | `agent-memory/episodes/*.md`, `profile.md` |
| **Layer 2: Concepts** | `memory/` | 启发式概念提取 + 概念 Markdown 文件 + episode↔concept [[wikilink]] 双向链接 | `agent-memory/concepts/*.md` |
| **Layer 3: Reasoning** | `reasoning/` | 概念图(3边类型) + 1-hop 子图 + 3策略推理(图遍历/模式匹配/抽象) + 提示增强 | 内存(无持久化) |
| **Layer 4: Feedback** | `reasoning/` | 推理追踪存储 + 概念权重增强(±0.05) + 概念演化(合并/分裂/衰减) + 洞察频率追踪 | `agent-memory/reasoning/*.md` |
| **Layer 5: Policy** | `policy/` | 全局认知策略(领域偏好/策略权重/探索率) + 漂移控制(平衡/约束) + 压缩信号 + 健康监测 | `agent-memory/policy/cognitive_policy.json` |

**核心类**：

| 类 | 层 | 文件 | 职责 |
|----|-----|------|------|
| `MarkdownMemoryStore` | 1-5 | `memory/memory_store.ts` | 统一 Markdown 持久化：episodes/concepts/reasoning traces/policy 的 CRUD + 概念合并/权重调整/关系标记 |
| `ConceptExtractor` | 2 | `memory/concept_extractor.ts` | 启发式概念提取：标题(+0.35)/二元组(×0.3)/三元组(×0.5)/英文复合词(×0.4) |
| `ConceptGraphBuilder` | 3 | `reasoning/concept_graph_builder.ts` | 概念图构建：related 边(0.8)/shared-episode 边(0.3+)/tag-overlap 边(0.3+) |
| `ConceptReasoner` | 3 | `reasoning/concept_reasoner.ts` | 3策略推理：图遍历→关系+桥接 / 模式匹配→关键概念+强关联 / 抽象→概念簇+洞察+矛盾 |
| `FeedbackProcessor` | 4 | `reasoning/feedback_processor.ts` | 认知反馈：追踪存储 + 权重增强 + 策略学习(领域/策略自适应) |
| `ConceptEvolver` | 4 | `reasoning/concept_evolver.ts` | 概念演化：合并(≥70% episode 重叠或强边) / 分裂检测 / 衰减(≥7天未使用 -0.05) |
| `DriftController` | 5 | `policy/drift_controller.ts` | 全局控制：偏好平衡(spread>0.6→均衡) / 约束(0.1-1.0 clamp) / 压缩信号(4种) / 健康评分(复合) |
| `AgentOrchestrator` | 全 | `agent_orchestrator.ts` | 中央管线：5层全集成，策略感知种子选择，周期健康检查 |
| `MemoryWriter` | 1-2 | `memory/memory_writer.ts` | 记忆写入 + 概念提取触发 + 链接创建 |

**Vault 记忆结构**：

```
agent-memory/              （全部 Markdown，用户可见可搜索可编辑）
  episodes/                Layer 1 — 情景记忆文件
    2026-06-30-goal-xxx.md (YAML frontmatter + 正文)
  concepts/                Layer 2 — 提取的概念
    memory-system.md        (frontmatter: id/name/slug/related/sourceEpisodes/confidence)
  reasoning/               Layer 4 — 推理追踪
    reasoning-xxx.md        (frontmatter: query/keyConcepts/confidence)
  policy/                  Layer 5 — 全局策略
    cognitive_policy.json   (conceptPreferences/strategyWeights/explorationRate)
  profile.md               Layer 1 — 用户画像
  INDEX.md                 Layer 1 — 全量索引(含概念统计+概念簇)
```

**3 个演化闭环（原始）+ 2 个新闭环**：

| 闭环 | 层 | 功能 |
|------|-----|------|
| Memory Evolution | 1 | 衰减（指数+使用阻尼）、强化（5信号类型）、合并（Jaccard >0.85）、软删除 |
| Router Learning | — | Per-tool 成功率追踪、自适应阈值、策略权重演化（不变） |
| RAG Optimization | — | 检索反馈、查询聚类、负信号下权重（不变） |
| **Concept Evolution** | 4 | 概念合并（共享episode≥70%）、分裂检测（冲突关系）、衰减（7天未使用） |
| **Policy Learning** | 5 | 领域强化（成功推理+0.02）、策略自适应（成功率 >80% → +0.02, <40% → -0.03）、探索率自适应 |

**安全约束**：所有学习更新 ±0.05/clamp、至少 3 次确认才触发策略变更、低置信度记忆（<0.3）隔离、软删除（mark 而非 delete）、策略权重范围 [0.1, 1.0]、偏好平衡强制（spread ≤ 0.6）。

**API Key 存储**：macOS Keychain（`security` 命令），data.json 只存 `apiKeyInKeychain: true` 标记位。

**Agent 工具系统**：`executeToolLocal()` switch/case 分发，工具定义在 `AGENT_TOOLS` 数组。当前工具：`get_current_time`、`get_todos`、`get_todo_stats`、`add_todos`、`delete_todo`（支持文本/ID/时间段三层匹配，可选 `mark_done` 标记完成）、`web_search`（Bing HTML 抓取 + DuckDuckGo HTML 后备，均国内直连无需 API Key）、`list_wiki_files`、`read_wiki_file`、`write_wiki_file`、`delete_wiki_file`、`search_wiki`。Wiki CRUD 工具含路径遍历防护 + 文件大小限制 + 关键文件保护（SCHEMA/index/log/overview 不可删），写入/删除后自动重建向量索引。

**3 层执行架构**：Reasoning（推理，无限制）→ Tool（工具，外部世界 — web_search/todos/wiki_crud）→ Skill（技能，系统特权 — read_local_file/get_current_location）。`ToolDecisionPolicy` 通过 LLM 自主决策工具/技能使用，替代关键词触发。决策 LLM 输出的 JSON 中包含可选 `tool_args` 字段（结构化参数，如 `{"date":"2026-07-04","todos":[...]}`），`executeToolLocal` 优先使用 LLM 提取的参数，无 `tool_args` 时回退到启发式提取。`SkillRegistry` 管理技能注册和权限校验，`read_local_file` 含 6 层安全沙箱（路径遍历/绝对路径/扩展名/系统路径/文件大小/ENOENT）。

**DeepSeek 函数调用限制**：DeepSeek API 不支持 OpenAI 原生的 function calling，若将 `tools` 传入 API，模型会用文本模拟工具调用（`<invoke>` / DSML 等格式），输出为可见文本而非执行。**已移除所有 LLM 调用中的 `tools` 参数**，工具执行完全由 LLM 调用之前的 `ToolDecisionPolicy` 自主决策层完成，结果注入 system prompt 供 LLM 使用。`stripToolCallText()` 作为安全网后处理，过滤 XML 格式（DSML/invoke/tool_calls）及纯文本格式（"工具调用\nxxx"）的模拟调用。System prompt 已移除"拥有工具调用能力"等误导性描述，改为"工具已在后台自动执行"。

**流式渲染**：SSE 解析 → `requestAnimationFrame` DOM patch，50ms 节流。

**Markdown 渲染**：4 阶段 — 代码块保护 → 块级元素 → 内联元素 → 代码块还原。System prompt 禁止 Markdown 表格，规则中包含概念推理优先。

### 预防性维护（健壮性增强）

**并发保护**：`process()` 内置 ReentrancyGuard（`processing` 布尔锁），并发调用返回"系统正忙"而非状态损坏，`reentrancyBlocked` 计数。

**LLM 容错**：LLM 调用包裹 try-catch，失败时优雅降级到中文错误提示。`callLLMWithTimeout()` / `streamLLMWithTimeout()` 使用 AbortController 60s 超时。`consecutiveErrors` 跟踪，≥5 次时 `healthCheck().status === "error"`。

**输入消毒**：`sanitizeInput()` 清除 Markdown 代码块注入、`{role:"system"}` 提示注入、截断 >4000 字符。所有内部引用使用消毒后的文本。

**健康检查**：`healthCheck(): AgentHealth` 返回 status（healthy/degraded/error）、错误计数、内存统计、认知健康评分、运行时长。

**提示长度保护**：`MAX_SYSTEM_PROMPT_CHARS=8000`，超过时保留规则部分，截断 wiki/episodic 中间内容。

### 测试

测试使用纯 TypeScript + 自定义 assert 框架，通过 `npx tsx` 直接运行（无 Jest/Mocha 依赖）。

```bash
npx tsx src/tests/unit_test_agent.ts          # 单元测试：每个模块独立验证
npx tsx src/tests/integration_test_agent.ts   # 集成测试：跨模块联动流程
npx tsx src/tests/e2e_test_agent.ts           # E2E 测试：6 场景 + 系统稳定性
```

**测试覆盖**：13 个模块（7 原有 + 6 新增），9 个集成流程，7 个 E2E 场景 + 6 个稳定性检查，共 243 个断言。

| 套件 | 测试数 | 覆盖 |
|------|--------|------|
| 单元 | 176 | tool_router, vector_wiki_store, working_memory, episodic_memory, user_profile, tool_memory, memory_writer, concept_extractor, concept_graph_builder, concept_reasoner, drift_controller, router_telemetry, input_sanitization |
| 集成 | 54 | Router→Wiki, MemoryWriter→Stores, Router+ToolMem, WM+EM, Full Pipeline, Concept Extraction Pipeline, Graph→Reasoning, Feedback→Policy, Router+Telemetry |
| E2E | 13 | 6 业务场景 + 6 稳定性检查 + 1 边界情况 |

### Wiki 图谱实现细节

- **数据解析**：`parseWikiFiles()` 扫描 vault 源笔记 + wiki 目录文件，从内容中正则提取 `[[wikilinks]]` 构建边，YAML frontmatter `source:` 字段链接摘要
- **文件夹节点**：从源文件路径提取目录层级，创建 `folder` 类型节点（金色 `#e8c84c`），作为图谱的结构骨架。节点 ID 带 `[dir]` 前缀避免与同名文件冲突
- **DAG 拓扑（不可成环）**：所有结构边单向 — `index → folder → {source, summary, concept}` + `parent folder → child folder`。移除了 `summary → source`（YAML source link）和 `file → folder` 反向边
- **孤立节点过滤**：`rebuild()` 中过滤 `degree === 0` 的节点，不渲染无连接的孤立节点
- **力导向布局**：Fruchterman-Reingold 算法，度驱动动态缩放。斥力 = `(k²/dist) × strength × max(degreeScale(a), degreeScale(b))`，引力 = `(dist²/k) × strength × avg(degreeScale)`。`degreeScale(d) = 0.1 + 0.9 × (d/maxDegree)`，无连接节点 10% 力，hub 节点 100%。中心引力指向视口中心，强度同步随 degree 变化（hub 引力强聚中心，无连接节点漂外围）。节点半径 = `baseRadius × (1 + degree/maxDegree × 3)`，随连接数动态缩放
- **物理循环**：`tick()` 驱动，300 帧自动 fitToView + 停止循环。拖拽节点后重启 80 帧快速 settle。缩放/平移用单帧 wakeDraw() 不启动物理
- **动态适配**：所有视觉/物理参数通过 `s = sqrt(cardW*cardH) / 548` 等比缩放（参考尺寸 600×500），节点半径/边线宽/字号/速度上限等统一乘 s
- **Canvas 渲染**：Retina 适配（devicePixelRatio），节点按类型着色（源笔记橙/摘要绿/概念蓝/索引紫/文件夹金），悬停高亮+tooltip
- **边界约束**：上边界留 60px 给工具栏，其余三边留 radius+4px。重力和初始中心下移 30px 补偿工具栏偏移
- **交互**：mousedown 命中节点→拖拽（保留点击偏移，节点不会跳动），命中空白→平移。wheel→缩放（0.2x-3x）。双击→打开文件（文件夹节点双击静默忽略，无对应文件）
- **节点拖拽联动**：拖拽时模拟持续运行，被拖拽节点跳过所有力计算（位置由光标锁定），关联边吸引力 ×4 形成橡皮筋效果，邻居节点跟随移动，无关节点保持原位置。拖拽结束后 80 帧快速 settle

### 学习模式实现细节

- 打开 md 文件时 `active-leaf-change` 事件自动打开学习模式 split（`createLeafBySplit(activeLeaf, "vertical", true)`），关闭所有 md 文件后 200ms debounce 自动关闭
- 学习模式 split 设置在编辑器左侧，`setActiveLeaf(activeLeaf, { focus: true })` 保持编辑器焦点
- `<webview>` 不可用（Obsidian 未启用 `webviewTag`），改用 `<iframe>` + `sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"`（已移除 `allow-popups` 防止跳转到系统浏览器）+ `referrerpolicy="origin"`
- `convertToEmbedUrl(url)` 检测 YouTube/Bilibili/Vimeo 并转为 embed 播放器 URL，保留时间戳/分P参数。Bilibili 额外加 `as_wide=1&high_quality=1&danmaku=0` 确保完整播放器模式（含倍速控制）
- 搜索：非 URL 格式输入 → `https://www.bing.com/search?q=...`
- 历史记录持久化在 `settings.studyMode.history[]`，最多 50 条，点击历史项恢复导航
- 起始页：搜索栏 + 6 个快捷链接（Bilibili/Bing/百度/知乎/码云/百度百科）
- **已禁用外部浏览器跳转**：iframe 页面被 X-Frame-Options 拒绝时只提示不提供跳转按钮，`window.open()` 已移除

### 截图 4 层策略

| 优先级 | 策略 | 前置条件 | 适用场景 |
|--------|------|---------|---------|
| 1 | Canvas `drawImage` | 同源页面 | 同源 iframe，瞬时 |
| 2 | macOS `screencapture` 命令 | `require("child_process")` 可用 | 跨显示器精确截图 |
| 3 | 旧版 `getUserMedia` | Chrome/Electron 旧版 API | 单显示器 fallback |
| 4 | 视频平台缩略图 API | 平台 API 可访问 | 最后手段 |

- 截图前先获取所有 md leaves（`getLeavesOfType("markdown")`），不依赖活跃焦点
- 拖拽选取框：半透明遮罩 + 虚线选取框 + 4 角拖拽手柄，Enter 截取 / Esc 取消
- 截取时先隐藏遮罩，等 `setTimeout(100ms) + requestAnimationFrame` 确保 DOM 重绘后再执行
- 选取框坐标相对 iframe wrapper → 需加 `wrapper.getBoundingClientRect()` 偏移转视口坐标

### Obsidian Electron API 可用性

- `require("electron")` **不可用**（抛出异常）→ `desktopCapturer` 无法使用
- `navigator.mediaDevices.getDisplayMedia()` **抛出 NotSupportedError**（Obsidian 未配置）
- 旧版 `(navigator.mediaDevices as any).getUserMedia({ video: { mandatory: { chromeMediaSource: "desktop" } } })` **可用**但仅捕获**主显示器**
- `require("child_process")` / `require("fs")` **可用** → 可调用 macOS `screencapture` 命令
- 多显示器：`chromeMediaSource: "desktop"` 只捕获主屏，外接显示器需用 `screencapture`（基于全局桌面坐标）

## 部署到 Obsidian

编译产物直接输出到 vault 插件目录（`/Users/xuejingchen/Obsidian/Silence/.obsidian/plugins/homepage/main.js`），`manifest.json` 和 `styles.css` 通过 symlink 指向开发目录。

### 热重载

vault 中安装了 `hot-reload` 插件，需要在 homepage 插件目录有 `.hotreload` 标记文件才会监听变化。标签页中已有此文件，新增 vault 时需重新创建 `touch .hotreload`。

### 已知问题

1. **修改默认文本不生效：** ✅ 已解决 — v2 改为 `ItemView`。
2. **render() 重复绑事件**：每次 render 重建 DOM 后重新绑定事件，目前各 render 方法内部用 querySelector + addEventListener 处理，无重复绑定问题（innerHTML 替换会销毁旧 DOM）。
3. **超级桌面多实例相互覆盖：** ✅ 已解决 — 根因是 `[id$="-wrapper"]` 选择器匹配不到 `homepage-desktop-wrapper-0`（ID 末尾是 `-0` 而非 `-wrapper`），导致碰撞检测找不到其他桌面实例。修复：选择器改为 `[data-component-wrapper]` 属性选择；`constrainNoOverlap` 改为迭代到稳定；pointermove 做了 constrain+clamp 循环防止边界裁切破坏推离结果；`getOtherCardBounds` 跳过未定位卡片（`!el.style.left`）。
4. **学习模式 `<webview>` 无法跳转：** ✅ 已解决 — 根因是 Obsidian 未启用 Electron `webviewTag`，`<webview>` 标签退化为普通 DOM 元素。修复：改用 `<iframe>` + 视频平台 embed URL 自动转换（YouTube/Bilibili/Vimeo）。
5. **学习模式跨域截图失败：** ✅ 已解决 — Canvas `drawImage` 无法读取跨源 iframe 内容。修复：4 层截图策略，优先使用 macOS `screencapture` 命令（全局桌面坐标，跨显示器精确）。
6. **截图多显示器坐标偏移：** ✅ 已解决 — 旧版 `getUserMedia` 只捕获主显示器，与外接显示器坐标不匹配。修复：`screencapture` 使用 `window.screenX/Y` 全局坐标，不受显示器边界影响；选框坐标加 `wrapper.getBoundingClientRect()` 偏移转视口坐标。同时优化 `captureFromStream` 的 `isFullDesktop` 检测逻辑。
7. **DeepSeek 不支持原生 function calling：** ✅ 已解决（2026-07-01）— 传入 `tools` 参数导致模型用文本模拟工具调用（输出 `<invoke>` / DSML 格式的可见文本），工具未实际执行。修复：移除所有 LLM 调用中的 `tools` 参数，工具执行完全由 `ToolDecisionPolicy` 自主决策层在 LLM 调用前完成，结果注入 system prompt。
8. **LLM Wiki 流式渲染失效：** ✅ 已解决（2026-07-01）— 两重 bug：(1) streaming 消息 push 后未调用 `render()`，DOM 中无 `#llmwiki-streaming` 挂载点；(2) `_streamingIdx` 数组下标在 `clearActivity()` 删除前置 activity 消息时漂移，导致 `id="llmwiki-streaming"` 挂到错误 DOM 元素。修复：push 后加 `render()` + `clearActivity()` 中同步扣减 `_streamingIdx`。
9. **Python SSL 证书缺失：** ✅ 已解决（2026-07-01）— Python 3.13 在 macOS 上缺少根证书，`vision` 脚本报 `CERTIFICATE_VERIFY_FAILED`。修复：运行 `Install Certificates.command` 安装 certifi。
10. **超级桌面路径重复（Agent/Agent）：** ✅ 已解决（2026-07-02）— 根因：Obsidian 的 `adapter.list()` 返回相对 vault 根目录的完整路径（如 `Agent/subdir`），代码将其当作纯文件名渲染，导致导航拼接时路径重复。修复：`renderContents()` 中用 `toName()` 提取最后一个 `/` 之后的纯名称。
11. **LLM Wiki 维护每次都重新处理所有文件：** ✅ 已解决（2026-07-02）— 根因：`generateSummary` 写入的 `source-mtime` 是 `Date.now()`（生成时间），但检查时比对的是 `file.stat.mtime`（文件修改时间），两值永远不同。修复：`generateSummary` 改为接收并使用 `file.stat.mtime`，且 mtime 检查移到读取源文件之前，未变更文件直接跳过不读源文件。
12. **学习模式 Bilibili 播放器无倍速控制：** ✅ 已解决（2026-07-02）— Bilibili 嵌入式播放器在第三方 iframe 中可能加载精简模式。修复：embed URL 增加 `as_wide=1&high_quality=1&danmaku=0` 参数启用完整播放器，iframe 加 `referrerpolicy="origin"`。
13. **DeepSeek 纯文本工具调用泄漏：** ✅ 已解决（2026-07-04）— DeepSeek 在 system prompt 被告知"拥有工具调用能力"但未收到 `tools` 参数时，会在回复中用纯文本模拟工具调用（如"工具调用\\nadd_todos"）。三层修复：(1) `stripToolCallText()` 扩展到匹配纯文本模式 + 行尾孤立工具名；(2) System prompt 移除"拥有工具调用能力"，改为"工具已在后台自动执行，不要模拟函数调用"；(3) `ToolDecision` 新增 `tool_args` 字段，LLM 提取结构化参数 → `executeToolLocal` 正确执行，不再因空参数失败而触发 LLM 的"补救式模拟"。
14. **Agent 缺少 delete_todo 工具：** ✅ 已解决（2026-07-04）— `executeToolLocal` 没有 `delete_todo` case、AGENT_TOOLS 未定义、ToolDecisionPolicy 未注册、OrchestratorConfig 未接线。修复：新增完整链路，`delete_todo` 支持文本关键词/ID/时间段三层匹配，`mark_done: true` 可标记完成而非删除，匹配失败时返回可选列表供 LLM 建议。
15. **超级桌面导航状态丢失：** ✅ 已解决（2026-07-04）— `DesktopComponent.currentPaths` 为内存数组，每次 `view.render()` 重建组件时从 `desktopFolders` 重新初始化，导航到子文件夹后刷新即丢失。修复：新增 `desktopCurrentPaths: string[]` 到 `HomepageSettings`，所有读写改为 `settings.desktopCurrentPaths`，`addInstance`/`removeInstance` 同步维护。
16. **内联预测 CORS 被拒：** ✅ 已解决（2026-07-04）— Obsidian 渲染进程 `fetch` 受 CORS 限制，`app://obsidian.md` 源被拒绝。修复：改用 Obsidian 内置 `requestUrl` API，走 Electron 网络层绕过 CORS。
17. **内联预测 API 401/模型错误：** ✅ 已解决（2026-07-04）— (1) 星火 HTTP API 认证需要 `apiKey:apiSecret` 拼接格式，非单独 apiKey；(2) 模型名为 `lite` 非 `general`；(3) Spark Lite 不支持 `role: system`，需合并进 user message。修复：新增 `getAuthKey()` 自动检测旧格式并拼接 APISecret。
18. **代码运行阅读视图空白：** ✅ 已解决（2026-07-05）— `registerMarkdownCodeBlockProcessor` 替换了默认渲染，但处理器内未自行渲染代码块内容（只 `return` 或找不存在的 `<pre>`）。修复：始终创建 `<pre><code class="language-xxx">` 结构，组件启用时才附加 Run 按钮。

## Python Agent Framework 重建

已生成三份 Python Agent 重建文档，位于项目根目录：

| 文档 | 用途 |
|------|------|
| `PYTHON_RECONSTRUCTION_SPEC.md` | 行为规范 — 从 TypeScript 逆向得出的完整算法/数据模型/生命周期 |
| `PYTHON_AGENT_ARCHITECTURE.md` | 架构设计 — 六边形架构、事件驱动管道、Protocol 驱动的插件系统 |
| `PYTHON_AGENT_DEVELOPMENT_PLAN.md` | 实施计划 — 11 阶段、93 文件、130 小时、3 人分工 |

**核心架构决策：**
- 六边形架构（Ports & Adapters）：所有外部依赖在 Protocol 后面
- 事件驱动管道：12 个 PipelineStage 通过 EventBus 解耦
- 能力层三层统一：Tool / Skill / SearchProvider 都实现 Capability 抽象
- Planner + Execution Engine：替代 switch/case 工具选择
- 不可变 PipelineContext：每个 stage 返回新实例

### 笔记助手实现细节

- **悬浮框架构**：`NoteAssistantComponent` 直接操作 `document.body`，不经过 Obsidian ItemView 或 WorkspaceLeaf。`position: fixed; z-index: 1000` 的 div，挂载在 body 上。生命周期由 `plugin.ts` 的 `active-leaf-change` 事件驱动，检查 `activeLeaf?.view?.getViewType() === "markdown"` 而非仅检查 `mdLeaves.length`。
- **拖拽**：Header 区域 `pointerdown/move/up` + `setPointerCapture`，排除 button 子元素。`Math.max(0, ...)` 防越界。
- **缩放**：CSS `resize: both` + `ResizeObserver` 保存 `floatW/floatH`。
- **FAB 悬浮球**：44×44px 圆形 `position: fixed`，click 展开、pointer 拖拽（保留 right/bottom 偏移存储，拖拽后不丢失位置）。hover `scale(1.1)`。
- **最小化/展开对称**：`minimize()` 将 FAB 中心置于浮窗右下角（`fabCenter = (floatX+floatW, floatY+floatH)`）；`restore()` 将浮窗右下角对齐 FAB 中心（`floatX = fabCenterX - floatW`），产生"从按钮展开"效果。
- **API Key**：3 层加载 — Keychain → 明文 `settings.llmWiki.apiKey`（自动迁移到 Keychain）→ 空。与 LLM Wiki 共享同一 Keychain service name。
- **笔记同步**：`syncNoteContent` 开启时，`handleSend()` 通过 `editor.getValue()` 从编辑器缓冲区读取笔记内容（而非 `vault.read()` 读磁盘——确保未保存编辑和 Agent 自己的修改可见），用 markdown code fence 包裹后注入用户消息。超长笔记用头+尾智能截断（前 1500 + 后 2500 字符，中间省略）而非仅截头部。
- **笔记编辑（标记后处理模式）**：`insert_into_note`/`replace_in_note`/`append_to_note`/`delete_from_note` 四个工具仅通过 LLM 回复中的标记代码块（````note-insert````/````note-append````/````note-replace old=xxx````/````note-delete old=xxx````）触发，由 `processNoteEdits()` 扫描回复并执行编辑器操作，`stripEditMarkers()` 从显示中剥离标记。**不从预执行路径调用**——因为内容需 LLM 先生成，`ToolDecisionPolicy` 的 `availableTools` 中仅保留 `get_note_selection`（只读）。`executeToolLocal` 仍保留这些工具的 case（供未来其他场景使用），但不在预执行列表中。
- **`OrchestratorConfig` 新增字段**：`getActiveNoteContent?`、`insertIntoNote?`、`replaceInNote?`、`appendToNote?`、`getNoteSelection?`、`deleteFromNote?`，均为可选。`availableTools` 中仅 `get_note_selection` 条件性包含。
- **静默笔记总结**：`plugin.ts` 的 `handleNoteAssistantVisibility()` 追踪 `_lastNoteAssistantPath`，切换到新笔记时自动调用 `summarizeCurrentNote()`——发送总结 prompt 给 Agent，结果以 `📝 **笔记概要**: ...` 消息插入聊天顶部（`assistant` 角色，参与对话历史），最多保留 3 条。笔记 ≤3000 字符全文发送，>3000 字符按间隔采样（取 1000 字符 / 跳 1000 字符循环），用 `\n\n...\n\n` 拼接。
- **📝 总结按钮**：Header 栏按钮，`summarizeToNote()` 读取编辑器全文（无截断），正则检测 `## 总结`/`## AI 总结` 等已有总结段落——存在则截掉后基于剩余内容生成新总结替换，不存在则追加 `---\n## AI 总结\n\n{内容}` 到笔记末尾。结构化输出（核心主题/关键要点/整体概要）。
- **无关闭按钮**：Header 仅保留 `📄 同步`、`📝 总结`、`🗑 清空`、`—` 最小化按钮，无 `✕` 关闭。切换到非 markdown 视图时自动隐藏（`hide()`，完全移除浮窗和 FAB，不在首页显示悬浮球）。手动点击 `—` 最小化仍显示 FAB。

### 记忆复习实现细节

- **文件扫描**：`vault.getFiles()` + 按扩展名 `.md` 过滤，排除 `.obsidian`/`.trash`/`.git`/`llm-wiki`/`agent-memory`/`_attachments`/`assets` 目录。按 `file.stat.mtime` 降序排列，时间窗口递进直到找到 ≥3 篇笔记，最多 20 篇。
- **内容截断**：每篇笔记头 1500 + 尾 1500 字符（中间省略），`Promise.allSettled` 并行读取。跳过读取失败的文件并在 `sourceInfo` 中报告。
- **API 调用**：复用 `utils.ts` 中的 `callDeepSeek()` 共享客户端，60s AbortController 超时。API Key 从 Keychain 加载（`loadApiKeyFromKeychain()`），失败回退到 `settings.llmWiki.apiKey` 明文。
- **JSON 解析**：`parseResponse()` 从 LLM 响应中正则提取 code fence 内的 JSON，失败时回退为纯文本单卡片。每项逐字段 `safeStr()` 强转字符串 + 验证类型。
- **XSS 防护**：所有外部数据（LLM 响应、API 错误消息）渲染前经 `safeStr()` + `escapeHtml()` 双层净化，textarea 用户输入回显时也转义。
- **重入保护**：`handleRefresh()` 用 `this.loading` 布尔锁防止并发 API 调用。`bindToolbarEvents()` 与 `bindBodyEvents()` 分离，避免 updateBody 累加重复监听器。
- **设置持久化**：`MemoryReviewSettings` 存储在 `settings.memoryReview` 中。设置面板提供题目数量下拉框（10/20/30/50）和默认模式下拉框（记忆卡片/题目）。
