# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

NAI Agent（内部也称 GEO Agent）是一款面向生成式引擎优化（GEO）与内容营销的 Electron 桌面应用。前端使用 React + Vite，后端业务逻辑运行在 Electron Main Process 中，Renderer 通过 Preload IPC 与主进程通信。数据持久化使用 SQLite（better-sqlite3 + sqlite-vec），模型调用支持 DeepSeek 与火山方舟/豆包。

## 技术栈

- **前端**：React 19、TypeScript、Vite、Tailwind CSS v4
- **UI 组件**：shadcn/ui（`@/components/ui`）+ AI Elements（`@/components/ai-elements`）+ `lucide-react` 图标
- **图表**：ApexCharts（`react-apexcharts`）
- **动画**：`motion`（framer-motion 继任者）
- **状态**：React Context（`ViewContext`、`AppStateContext`）+ 自定义 Hooks
- **桌面端**：Electron（contextIsolation、nodeIntegration: false、preload 暴露 API）
- **数据库**：SQLite + better-sqlite3 + sqlite-vec，迁移脚本位于 `electron/db/schema`
- **LLM 接入**：DeepSeek（Chat Completions）、豆包 Responses API、豆包 Assistant（可见性检查）
- **Agent**：DeepAgents.js + LangGraph（`@langchain/langgraph`）

## 常用命令

```bash
# 安装依赖
npm install

# 开发（启动 Vite + esbuild 监听 + Electron，端口 5173）
npm run dev

# 仅前端开发（浏览器模式，端口 3000）
npm run dev:web

# 类型检查（项目当前的主要 lint）
npm run lint

# 构建（web + electron main/preload）
npm run build

# 预览生产构建
npm run preview

# 打包（electron-builder）
npm run dist        # 当前平台
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux

# 清理构建产物
npm run clean
```

> 当前仓库没有实际的测试文件；`@playwright/test` 已安装但尚未编写用例。新增测试可用 `npx playwright test` 运行。

## 架构总览

```text
Renderer (src/)
├── components/      # React 组件，按视图分目录
├── context/         # ViewContext（视图路由）、AppStateContext（全局状态）
├── hooks/           # useTheme、useDb、useConfirm
├── lib/             # 工具：electron-api、i18n、toast、file-upload、utils
├── services/        # 渲染层服务，调用 IPC API（chatService、projectService 等）
└── types/domain.ts  # 全栈共享的领域类型

Electron Main (electron/)
├── main.ts          # BrowserWindow、生命周期、IPC 注册
├── preload.ts       # contextBridge 暴露 typed window.electron
├── ipc/
│   ├── channels.ts  # IPC 类型定义
│   ├── schemas.ts   # Zod 校验
│   └── handlers.ts  # IPC 处理器，调用 services
├── db/
│   ├── connection.ts
│   ├── migrations.ts
│   └── schema/*.sql # 版本化迁移
├── services/        # 主进程业务逻辑
│   ├── agent/       # Agent-first Task Runtime（geoAgentRuntime、allowedActionPolicy 等）
│   ├── assistant/   # Assistant Runtime（流式对话、工具审批、队列）
│   ├── models/      # 模型路由与客户端（DeepSeek、豆包）
│   ├── ragService.ts
│   ├── indexingService.ts
│   ├── vectorStore.ts
│   └── ...
└── utils/paths.ts   # userData、db 路径、迁移路径
```

### 关键数据流

1. **Renderer 不直接访问 Node API或数据库**。所有主进程能力通过 `window.electron.invoke(channel, ...args)` 调用。
2. `src/lib/electron-api.ts` 封装了所有 IPC 调用（`dbApi`、`kbApi`、`agentTaskApi`、`assistantApi` 等），并复用 `electron/ipc/channels.ts` 的类型。
3. `src/services/*` 在渲染层进一步封装这些 API，便于组件使用（例如 `chatService.getMessages`、`projectService.getAll`）。
4. Main 端的 `electron/ipc/handlers.ts` 注册所有处理器，进行 Zod 校验后调用 `electron/services/*`。
5. SQLite 数据库位于 Electron `userData/nai-agent.db`，启动时自动执行 `electron/db/schema` 下的迁移。

### 视图路由

`ViewContext` 管理当前视图（`dashboard`、`aiAgent`、`drafts`、`autoLearning`、`aiWebBuilder`、`kbIngest`、`kbCreate`）。`App.tsx` 根据 `activeView` 渲染对应组件，并包裹 `LayoutShell` 与 `ErrorBoundary`。

## 开发约定

- **组件库优先**：基础 UI（按钮、输入、弹窗、Sheet、Card、Badge、Skeleton、Tabs、Select 等）优先使用 shadcn/ui；聊天相关优先使用 AI Elements；图表统一用 ApexCharts。新增组件前先检查 `src/components/ui` 和 `src/components/ai-elements`。
- **样式**：通过 `useTheme` 的 `cls(lightClasses, darkClasses)` 处理亮暗模式，使用 `cn()` 组合条件类名。品牌主色 `#0070F3`。
- **国际化**：文案集中在 `src/lib/i18n.ts`，通过 `useTheme().t` 读取，新增时同时补充 `zh` / `en`。
- **类型**：优先补全 TypeScript 类型，减少 `any`。领域类型位于 `src/types/domain.ts`，IPC 类型位于 `electron/ipc/channels.ts`。
- **最小改动**：只修改与需求直接相关的文件，不附带重构无关代码。

## 环境变量

`.env` 已存在并包含模型 API Key，示例变量如下（**不要在代码或提交中暴露值**）：

- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`
- `ARK_API_KEY` / `ARK_BASE_URL`
- `DOUBAO_MODEL`、`DOUBAO_API_MODE`、`DOUBAO_THINKING_TYPE` 等
- `ARK_EMBEDDING_MODEL`、`ARK_EMBEDDING_DIMENSIONS`

README 提到 `GEMINI_API_KEY`，但当前运行依赖的是 `.env` 中的 DeepSeek/ARK 配置。

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`1caruszhang/jingshanai`), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` at repo root + `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.

## IPC 新增流程

添加新能力时需要同步修改四个文件，缺一不可：

1. `electron/ipc/channels.ts` — 在 `IpcChannels` 接口中声明方法签名
2. `electron/ipc/schemas.ts` — 用 Zod 为入参定义校验 schema
3. `electron/ipc/handlers.ts` — 注册处理器，Zod 解析后调用 service
4. `src/lib/electron-api.ts` — 在对应的 `*Api` 对象中暴露给 Renderer

领域类型如有变动，同步更新 `src/types/domain.ts`（前后端共用）。

## 数据库迁移

- 新迁移文件放在 `electron/db/schema/`，命名格式 `NNN_描述.sql`（三位数字前缀，顺序递增，**不要跳号**）
- 迁移在应用启动时由 `electron/db/migrations.ts` 自动按文件名顺序执行，以 `__migrations` 表记录已应用版本
- 迁移不可回滚；如需修正已应用的 schema，新建下一个编号的迁移文件

## 项目进度基线（Sprint 0）

详见 `doc/Sprint0_代码现状对照表.md`。当前 MVP 范围为 Phase 1–7：

| 状态 | Phase |
|------|-------|
| ✅ 完成 | Phase 0（骨架）、Phase 2–3（项目管理、对话历史）、Phase 4（知识库索引） |
| ⚠️ 骨架 | Phase 1（仪表盘）、Phase 5（Hybrid Retrieval）、Phase 8–9（Assistant/Agent Runtime）、Phase 10（发布/可见性） |
| ❌ 未实现 | **Phase 6（企业事实抽取）**、**Phase 7（文章生成 MVP）**、Phase 11（反思学习）、Phase 12（测试/打包） |

Phase 6 和 Phase 7 是当前最高优先级，是 MVP 的核心价值交付。Phase 7 依赖 Phase 6 的 `confirmed facts`。

## 注意事项

- `scripts/dev.mjs` 同时启动 Vite dev server（5173）、esbuild 监听（main + preload）和 Electron。关闭时会统一清理进程。
- `vite.config.ts` 在 `DISABLE_HMR=true` 时会禁用 HMR 与文件监听，用于 AI 编辑场景避免闪烁。
- `better-sqlite3` 是原生模块，修改 Electron 版本后需重新 rebuild：`npx electron-rebuild`。
- 根目录 `README.md` 是 AI Studio 生成的默认说明，核心运行信息以本文档和 `package.json` 为准。
- 路线图权威文件：`doc/GEO_Agent_长期开发路线图.md`，Phase 编号以该文档为准。
