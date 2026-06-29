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
main.ts              # 插件入口，全部类型、常量、类（~1000行）
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

### 组件系统

首页采用**组件化架构**，每个功能模块是一个"组件"：

- `ComponentInfo` 接口：`{ id, name, added }`，存储在 `settings.components` 中
- 侧边栏显示「已添加组件」和「待添加组件」两个拖拽区域
- 组件卡片支持**点击切换**和**拖拽**在两组间移动
- 页面只渲染 `added: true` 的组件

当前组件：
- **日程中心** (`id: "schedule"`)：日历 + 待办 + 柱状图，打包在可拖拽、可缩放的圆角矩形卡片中

### 关键实现细节

- `formatDateKey(y, m, d)` 生成 `"YYYY-MM-DD"` 格式的日期键
- TodoItem 的 `date` 字段关联日期，`color` 字段对应 `TODO_COLORS`（红/橙/黄/绿）
- 日历日期选中态用 `2px solid var(--interactive-accent)` 描边（非今日），今日用 accent 实心填充
- 卡片拖拽用 `setPointerCapture` 而非 document 级事件，避免泄漏
- 卡片缩放用 CSS `resize: both` + `overflow: hidden`，最小 520×320px

## 部署到 Obsidian

编译产物直接输出到 vault 插件目录（`/Users/xuejingchen/Obsidian/Silence/.obsidian/plugins/homepage/main.js`），`manifest.json` 和 `styles.css` 通过 symlink 指向开发目录。

### 热重载

vault 中安装了 `hot-reload` 插件，需要在 homepage 插件目录有 `.hotreload` 标记文件才会监听变化。标签页中已有此文件，新增 vault 时需重新创建 `touch .hotreload`。

### 已知问题

1. **修改默认文本不生效：** ✅ 已解决 — v2 改为 `ItemView`。
2. **render() 重复绑事件**：每次 render 重建 DOM 后重新绑定事件，目前各 render 方法内部用 querySelector + addEventListener 处理，无重复绑定问题（innerHTML 替换会销毁旧 DOM）。
