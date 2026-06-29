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
main.ts              # 插件入口，全部类型、常量、类（~2300行）
manifest.json        # 插件元数据（id, name, minAppVersion）
esbuild.config.mjs   # esbuild 打包配置
styles.css           # 日历 hover 样式
```

### 核心类

| 类 | 职责 |
|----|------|
| `HomepagePlugin` | 插件入口，注册 view/command/settingTab，管理 settings |
| `HomepageView` | ItemView，渲染整个首页 UI，包含所有组件和交互逻辑 |
| `HomepageSettingTab` | 设置面板 |
| `TodoAddModal` | 添加待办的弹窗（继承 Modal） |
| `DesktopFolderModal` | 超级桌面文件夹路径配置弹窗（继承 Modal） |

### 组件系统

首页采用**组件化架构**，每个功能模块是一个"组件"：

- `ComponentInfo` 接口：`{ id, name, added }`，存储在 `settings.components` 中
- 侧边栏显示「已添加组件」和「待添加组件」两个拖拽区域
- 组件卡片支持**点击切换**和**拖拽**在两组间移动
- 页面只渲染 `added: true` 的组件

当前组件：
- **日程中心** (`id: "schedule"`)：日历 + 待办 + 柱状图 + 昨日复盘（显示昨日未完成待办，支持逐项/全部同步到今天），打包在可拖拽、可缩放的圆角矩形卡片中
- **计时器** (`id: "timer"`)：表盘/数字双模式倒计时，滚动选择器设定时间，到点弹窗提醒，默认未添加
- **超级桌面** (`id: "desktop"`)：多实例文件浏览器，每个实例可绑定 vault 下不同文件夹，网格展示文件/文件夹（emoji 图标），双击 md 文件在 Obsidian 新标签页打开，其余类型用系统默认应用打开。支持 `+` 按钮新增实例、`×` 删除实例（≥2 个时显示）、标题可内联编辑，默认未添加。实例通过 `desktopFolders[i]` / `desktopNames[i]` 存储，卡片布局键为 `desktop-{i}`
- **待办列表** (`id: "todolist"`)：时间范围待办视图，Tab 切换今天/本周/本月。今天模式支持纵向甘特图（细线+右侧文字），按开始/结束时间展示时间段。待办项复用 `todos` 数组与日程中心双向同步。与日程中心同时启用时，待办列表卡片隐藏，内容嵌入日程中心右侧面板替代原始待办区域。默认未添加

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
- `isInteractiveTarget(target)` 检查点击目标是否为交互元素，决定是否触发拖拽。需包含所有可点击元素（`.yesterday-sync-one`、`.yesterday-sync-all` 等），否则卡片拖拽会吞掉点击事件
- 缩放手柄检测：pointerdown 中判断点击是否在右下角 20px 区域（`e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20`），是则设 `isResizing = true` 跳过拖拽
- `constrainNoOverlap()` 检测卡片间碰撞，沿最短方向推开（含 12px 间隙）
- `expandContentHeight()` 根据最低卡片的底部位置动态设 `minHeight`，确保内容区可滚动到所有卡片
- `observeCardResizes()` 用 ResizeObserver 监听卡片尺寸变化，仅保存宽高，不操作 DOM 位置（避免与浏览器原生 resize 冲突）
- `renderTimerPicker(field, label, max, cur)` 生成 H/M/S 滚动选择器 HTML，消除三份重复模板
- `initTimerDisplay` 的 outside-click 监听用存储 handler 引用 + removeEventListener 防止重复绑
- 昨日复盘：`syncTodoToToday(id)` 逐项同步，`syncAllYesterday()` 一键同步全部，直接修改 `todo.date` 并刷新三个面板
- 超级桌面多实例：`desktopCurrentPaths: string[]` 为非持久化导航状态，`desktopFolders: string[]` / `desktopNames: string[]` 持久化在 settings 中，`addDesktopInstance()` / `removeDesktopInstance(i)` 增删实例后调用 `render()` 重建 DOM
- 侧边栏：作为 container 直接子元素（非 `#homepage-content` 子元素），`position: absolute` + 动态 `top = header.offsetHeight` 使其固定在 header 下方不随内容滚动。展开宽度 236px（刚好容纳 3 个 64px 组件图标横向排列）。展开时点击 overlay 自动关闭
- TodoItem 新增可选字段 `startTime?: string` / `endTime?: string`（"HH:MM"），兼容旧数据。`TodoAddModal` 新增时间选择器（`<input type="time">`），`addTodo` 签名改为 5 参数
- 待办列表甘特图：`renderGanttView()` 以 `HOUR_H=40` + `STRIP_W=5` 细线 + 右侧文字展示，`parseMinutes()` 解析时间字符串，`getWeekRange()` / `getMonthRange()` 计算周/月范围
- 待办列表联动：`refreshTodoListView()` 根据两者是否同时启用自动分发 → `renderTodoListEmbedded()`（嵌入日程右侧面板，渲染完整 Tab+内容到 `#homepage-todo`）或 `renderTodoListStandalone()`（独立卡片，渲染到 `#homepage-todolist-content`），共享渲染逻辑在 `renderTodoListContent()`
- 所有卡片 wrapper 必须在 `#homepage-content` 内部（`position: relative`），否则不跟随滚动且碰撞检测感知不到

## 部署到 Obsidian

编译产物直接输出到 vault 插件目录（`/Users/xuejingchen/Obsidian/Silence/.obsidian/plugins/homepage/main.js`），`manifest.json` 和 `styles.css` 通过 symlink 指向开发目录。

### 热重载

vault 中安装了 `hot-reload` 插件，需要在 homepage 插件目录有 `.hotreload` 标记文件才会监听变化。标签页中已有此文件，新增 vault 时需重新创建 `touch .hotreload`。

### 已知问题

1. **修改默认文本不生效：** ✅ 已解决 — v2 改为 `ItemView`。
2. **render() 重复绑事件**：每次 render 重建 DOM 后重新绑定事件，目前各 render 方法内部用 querySelector + addEventListener 处理，无重复绑定问题（innerHTML 替换会销毁旧 DOM）。
