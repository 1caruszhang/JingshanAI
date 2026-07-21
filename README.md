# NAI Agent / GEO Agent

> An Electron-based desktop application for Generative Engine Optimization (GEO) and content marketing, powered by LLMs.

## Highlights

- AI Agent task runtime for GEO workflows
- Streaming chat with Assistant and tool approval
- Knowledge base ingestion with RAG and vector search
- Draft generation and dashboard analytics
- Dark / light theme support

## Tech Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Electron · SQLite · better-sqlite3 · sqlite-vec · DeepSeek · Doubao/Ark

## Quick Start

```bash
npm install
npm run dev
```

See below for the full Chinese guide.

---

## 项目介绍 / Introduction

NAI Agent（内部也称 GEO Agent）是一款面向生成式引擎优化（GEO）与内容营销的 Electron 桌面应用。前端基于 React + Vite 构建，后端业务逻辑运行在 Electron Main Process 中，Renderer 通过 Preload IPC 与主进程通信。数据持久化使用 SQLite（better-sqlite3 + sqlite-vec），模型调用支持 DeepSeek 与火山方舟/豆包。

## 功能特性 / Features

- **AI Agent 任务执行**：基于 LLM 的 Agent-first 任务运行时，支撑 GEO 工作流
- **聊天交互**：与 Assistant 的流式对话、工具审批与任务队列
- **知识库管理**：RAG 检索、向量存储与文档 ingest 流程
- **草稿生成**：内容创作与草稿管理
- **数据分析**：Dashboard 图表与活动统计
- **主题切换**：支持暗色/亮色模式

## 技术栈 / Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui
- **UI Components:** shadcn/ui, AI Elements, lucide-react
- **Charts & Motion:** ApexCharts, motion
- **State:** React Context (`ViewContext`, `AppStateContext`), custom Hooks
- **Desktop:** Electron (`contextIsolation`, `nodeIntegration: false`), Preload IPC
- **Database:** SQLite, better-sqlite3, sqlite-vec
- **Models:** DeepSeek, Doubao / Ark

## 快速开始 / Quick Start

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

## 项目结构 / Project Structure

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
│   ├── agent/       # Agent-first Task Runtime
│   ├── assistant/   # Assistant Runtime（流式对话、工具审批、队列）
│   ├── models/      # 模型路由与客户端（DeepSeek、豆包）
│   ├── ragService.ts
│   ├── indexingService.ts
│   ├── vectorStore.ts
│   └── ...
└── utils/paths.ts   # userData、db 路径、迁移路径
```

### 关键数据流

1. **Renderer 不直接访问 Node API 或数据库**。所有主进程能力通过 `window.electron.invoke(channel, ...args)` 调用。
2. `src/lib/electron-api.ts` 封装了所有 IPC 调用（`dbApi`、`kbApi`、`agentTaskApi`、`assistantApi` 等），并复用 `electron/ipc/channels.ts` 的类型。
3. `src/services/*` 在渲染层进一步封装这些 API，便于组件使用（例如 `chatService.getMessages`、`projectService.getAll`）。
4. Main 端的 `electron/ipc/handlers.ts` 注册所有处理器，进行 Zod 校验后调用 `electron/services/*`。
5. SQLite 数据库位于 Electron `userData/nai-agent.db`，启动时自动执行 `electron/db/schema` 下的迁移。

## 开发约定 / Development Conventions

- **组件库优先**：基础 UI（按钮、输入、弹窗、Sheet、Card、Badge、Skeleton、Tabs、Select 等）优先使用 shadcn/ui；聊天相关优先使用 AI Elements；图表统一用 ApexCharts。新增组件前先检查 `src/components/ui` 和 `src/components/ai-elements`。
- **样式**：通过 `useTheme` 的 `cls(lightClasses, darkClasses)` 处理亮暗模式，使用 `cn()` 组合条件类名。品牌主色 `#0070F3`。
- **国际化**：文案集中在 `src/lib/i18n.ts`，通过 `useTheme().t` 读取，新增时同时补充 `zh` / `en`。
- **类型**：优先补全 TypeScript 类型，减少 `any`。领域类型位于 `src/types/domain.ts`，IPC 类型位于 `electron/ipc/channels.ts`。
- **最小改动**：只修改与需求直接相关的文件，不附带重构无关代码。

## 环境变量 / Environment Variables

项目根目录需要 `.env` 文件。所需变量名如下（**不要在代码或提交中暴露值**）：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `ARK_API_KEY`
- `ARK_BASE_URL`
- `DOUBAO_MODEL`
- `DOUBAO_API_MODE`
- `DOUBAO_THINKING_TYPE`
- `ARK_EMBEDDING_MODEL`
- `ARK_EMBEDDING_DIMENSIONS`

> ⚠️ 请勿将 API Key 或真实配置值提交到仓库。

