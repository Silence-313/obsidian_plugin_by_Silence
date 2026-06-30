# Obsidian Homepage

启动 Obsidian 时自动展示自定义交互首页，集成日程管理、待办追踪、文件浏览与计时器。

## 主要功能

- 🏠 **自动首页** — 插件加载时自动打开首页，无需手动操作
- 👋 **智能问候** — 根据时段显示"早上好/上午好/中午好/下午好/晚上好"，名字可内联编辑，失焦自动保存
- 🕐 **实时时钟** — `HH:MM:SS` 格式每秒刷新，右上角显示日期和星期
- 🧩 **组件化卡片** — 功能以可拖拽、可缩放的圆角矩形卡片呈现，位置和尺寸自动持久化；卡片间碰撞检测自动避让（12px 间隙）；右侧侧边栏管理组件显隐
- 🤖 **LLM Wiki** — 5 层自我改进认知系统：记忆(Markdown) → 概念(自动提取+链接) → 推理(概念图+3策略) → 反馈(权重学习) → 策略(全局认知控制)；3 层执行架构（推理→工具→技能）；LLM 自主决策工具/技能使用；web_search 使用 Bing 国内直连；全部 Markdown 持久化，用户可见可编辑
- 🔗 **Wiki 图谱** — Canvas 2D 力导向关系图谱，可视化 LLM Wiki 中笔记、摘要、概念之间的引用关系，支持拖拽/缩放/点击交互

### 日程中心

- 📅 月视图日历，点击日期切换选中，今日 accent 实心高亮，有待办日期显示彩色圆点
- ✅ 待办列表 — 添加/勾选/删除待办，四种颜色标记重要程度，支持颜色筛选和文本搜索
- 📊 左侧统计柱状图，按颜色分组展示当天完成进度
- 🔄 昨日复盘 — 显示昨日未完成待办，支持逐项同步或一键全部同步到今天

### 待办列表

- 📋 Tab 切换今天/本周/本月三种时间范围视图
- ⏱ 添加待办时可设定开始/结束时间（`<input type="time">`）
- 📊 今日甘特图 — 纵向时间轴彩色细条展示带时段待办，右侧显示事项文本、时间段和持续时长；时间重叠的待办自动分泳道避免文字叠压；无时段待办列在下方
- 📎 与日程中心同时启用时，内容自动嵌入日程右侧面板；否则显示为独立卡片

### 超级桌面

- 📁 多实例文件浏览器，每个实例可绑定 vault 下不同文件夹
- 🏷 实例标题可内联编辑，`+` 按钮新增实例，`×` 删除（≥2 个时显示）
- 📂 双击文件夹进入下级目录，`← 返回` 回到上级；`.md` 文件在 Obsidian 新标签页打开，其余文件类型用系统默认应用打开
- 🎨 文件/文件夹以 emoji 图标 + 文件名网格展示，按名称排序

### 计时器

- ⏱ 表盘模式（圆形 SVG 进度条 + 指针）与数字模式（大字体倒计时 + 进度条）一键切换
- 🎛 时/分/秒独立滚动选择器，点击标签展开滚轮，点击数值选定
- 🔔 倒计时归零弹窗通知，关闭后自动重置

### 学习模式

- 🎬 打开 Markdown 文件时自动在左侧创建分屏，内嵌浏览器，一边看视频一边记笔记
- 🔍 URL 栏输入网址或关键词（非 URL 自动 Google 搜索）
- 🎥 YouTube / Bilibili / Vimeo 等视频平台自动转为嵌入式播放器，支持完整播放控制
- 📷 可拖拽选取框截图 — 点击截图按钮显示选取框，拖动四角调整范围，Enter 截取 / Esc 取消，自动插入笔记光标处
- 📜 浏览历史持久化存储（侧栏面板），前进/后退/刷新
- 🔗 起始页快捷链接：Google、YouTube、Bilibili、Vimeo、GitHub、Wikipedia
- ⚙ 侧边栏组件开关控制，打开/关闭 md 文件自动联动

### LLM Wiki（5 层认知系统）

- 🧠 **Layer 1 — 记忆系统** — 4 层结构化记忆：短期对话记忆（纯内存）、情景记忆（事件/目标/决策，含演化评分，Markdown 持久化）、用户画像（结构化属性+置信度）、工具记忆（使用统计+有效性追踪）。全部 Markdown 持久化，用户可见可搜索可编辑
- 🔗 **Layer 2 — 概念系统** — 启发式概念自动提取（标题/二元组/三元组/英文复合词评分），概念 Markdown 文件（YAML frontmatter + 正文），episode↔concept [[wikilink]] 双向链接，概念合并去重
- 🧩 **Layer 3 — 推理引擎** — 概念图推理（3 种边类型：related/shared-episode/tag-overlap），1-hop 子图展开，3 策略推理（图遍历→关系+桥接概念 / 模式匹配→关键概念+强关联 / 抽象→概念簇+洞察+矛盾），策略感知种子概念选择
- 🔄 **Layer 4 — 反馈学习** — 推理追踪 Markdown 存储，概念权重自动增强（使用+0.02、桥接+0.03、高置信度+0.01、洞察出现≥2次+0.03），概念演化（合并≥70% episode 重叠概念、分裂检测冲突关系、衰减7天未使用-0.05）
- 🎯 **Layer 5 — 认知策略** — 全局策略 JSON（领域偏好/推理策略权重/探索率），策略学习（领域+0.02、策略自适应调整），漂移控制（偏好平衡强制 spread≤0.6、权重约束[0.1,1.0]），4 种压缩信号检测，认知健康复合评分
- 💬 **Agent 对话** — 完整 5 层管线：工具路由 → 语义检索 → 概念推理 → 增强提示 → LLM 推理 → 工具执行 → 记忆写入 → 概念提取 → 认知反馈 → 周期演化。流式逐字输出，markdown 实时渲染
- 🌐 **网络搜索** — `web_search` 工具通过 Bing HTML 抓取搜索互联网实时信息（国内直连，无需 API Key），DuckDuckGo HTML 作为后备，结果附带来源链接
- 🔧 **工具调用** — `get_current_time` 获取精确时间、`get_todos` 按日期/状态/优先级查询待办、`get_todo_stats` 获取统计概览、`add_todos` 添加待办到指定日期
- 🧠 **自主决策** — `ToolDecisionPolicy` 通过 LLM 自主判断是否需要工具/技能，替代关键词路由触发，含 3 层 JSON 容错和保守启发式 fallback
- 🛡 **技能系统** — `read_local_file` 安全读取 vault 文件（6 层沙箱：禁路径遍历/绝对路径/系统路径，限 .md/.txt/.json，上限 500KB）、`get_current_location` 获取位置（浏览器 API，权限拒绝优雅降级）
- 🔐 **安全存储** — API Key 保存在 macOS 钥匙串中，data.json 不存明文。所有学习更新 ±0.05 clamp，软删除优先，绝不硬删除
- ⏰ **定时维护** — 每天下午 13:00 自动维护知识库（消化对话、更新索引和用户画像），周期演化（记忆衰减+合并、概念演化+策略学习），可手动触发
- 📝 **笔记保护** — 原始笔记只读，绝不修改

### Wiki 图谱

- 🔗 **关系可视化** — Canvas 2D 渲染 LLM Wiki 知识库的关系图谱，节点按类型着色（源笔记橙/摘要绿/概念蓝/索引紫）
- 🧲 **力导向布局** — 自动将关联页面聚集、无关联页面分离，参数动态适配卡片尺寸
- 🖱 **交互探索** — 拖拽节点调整布局（关联节点橡皮筋联动）、滚轮缩放（0.2x-3x）、拖拽空白平移、悬停查看详情、单击/双击打开文件
- 🔄 **刷新重建** — 点击刷新按钮重新解析 wiki 文件重建图谱

## 可用命令

| 命令 | 说明 |
|------|------|
| `打开首页` | 在当前标签页打开首页（若已打开则聚焦） |
| `打开学习模式` | 在编辑器左侧创建分屏，打开学习模式浏览器 |
| `关闭学习模式` | 关闭学习模式分屏 |
| `学习模式：截图` | 截取当前学习模式页面并插入笔记 |
| `LLM Wiki：维护知识库` | 手动触发知识库维护（扫描笔记、更新索引和用户画像） |

## 安装

### 从源码构建

```bash
git clone <repo-url> obsidian-homepage
cd obsidian-homepage
npm install
npm run build
```

将以下两个文件和一个 symlink 复制到 vault 的 `.obsidian/plugins/homepage/` 目录：

- `main.js`（编译产物）
- `manifest.json`
- `styles.css`

在 Obsidian 设置 → 第三方插件中启用 **Homepage**。

### 开发

```bash
npm run dev     # watch 模式 + inline sourcemap，编译产物直接输出到 vault
npm run lint    # TypeScript 类型检查
```

配合 [hot-reload](https://github.com/pjeby/hot-reload) 插件实现修改后自动重载（需在插件目录放置 `.hotreload` 标记文件）。

### 测试

纯 TypeScript 测试框架，无外部依赖，通过 `npx tsx` 运行：

```bash
npx tsx src/tests/unit_test_agent.ts          # 单元测试 — 176 个断言，13 个模块
npx tsx src/tests/integration_test_agent.ts   # 集成测试 — 54 个断言，9 个流程
npx tsx src/tests/e2e_test_agent.ts           # E2E 测试 — 7 场景 + 6 稳定性检查
```

| 套件 | 覆盖 |
|------|------|
| 单元 | tool_router, vector_wiki_store, working_memory, episodic_memory, user_profile, tool_memory, memory_writer, concept_extractor, concept_graph_builder, concept_reasoner, drift_controller, router_telemetry, input_sanitization |
| 集成 | Router→Wiki, MemoryWriter→Stores, Concept Extraction Pipeline, Graph→Reasoning, Feedback→Policy, Router+Telemetry Adaptive |
| E2E | Todo 操作、技术查询、记忆召回、时间查询、系统稳定性 |

## 使用方式

1. 启用插件后，Obsidian 启动时自动打开首页
2. 通过命令面板（`Cmd/Ctrl + P`）搜索"打开首页"可随时手动打开
3. 点击顶部问候语中的名字区域可编辑显示名称，回车或失焦保存
4. 右侧侧边栏 `◀` 点击展开，拖拽组件卡片在"已添加组件"和"待添加组件"之间切换，支持搜索过滤
5. 点击卡片任意非交互区域拖拽移动，拖拽右下角调整大小
6. 使用 LLM Wiki 前，在设置中填入 DeepSeek API Key，或点击卡片内 ⚙ 按钮直接配置
7. 首次使用点击卡片内"🔄 维护"按钮构建知识库，此后每日 13:00 自动维护

---

API 文档：[obsidian.md](https://docs.obsidian.md)
