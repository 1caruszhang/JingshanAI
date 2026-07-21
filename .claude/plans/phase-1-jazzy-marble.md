# AI Agent 聊天界面 redesign 计划

> **Context:** 用户提供了参考截图，希望把当前 `ChatInterface` 的输入区重写成更优雅的漂浮药丸风格（attachment menu + Inspiration dropdown + model selector + mic + send）。`/design-taste-frontend` 已加载。

## Design Read

Reading this as: **a product UI component redesign (chat input shell)** for a desktop AI agent app, with a **premium-consumer / clean-glassy** language, leaning toward Tailwind v4 + shadcn/ui + motion.

*Note: This is a product surface, not a landing page. I will apply the skill's anti-slop, contrast, motion, and shape-consistency rules only to the chat component, not its surrounding dashboard patterns.*

## Dials

- `DESIGN_VARIANCE: 5` — clean centered input, slight left/right toolbar asymmetry
- `MOTION_INTENSITY: 5` — subtle spring on focus, button hover, dropdown open
- `VISUAL_DENSITY: 5` — compact toolbar, readable touch targets

## 目标

1. 把输入区从“盒中盒”改成**单层漂浮圆角容器**（参考截图中的大圆角药丸）。
2. 用 shadcn `DropdownMenu` 实现附件菜单：**Add photos or videos / Add 3D objects / Add files (docs, PDF...)**。
3. 用 shadcn `DropdownMenu` 替换现有 `Inspiration` 自定义 popup。
4. 用 shadcn `Select` 替换现有 `Model` 自定义 popup。
5. 保留并整理 `Mic`、`Submit` 按钮，使风格一致。
6. 保留所有现有行为：文件拖拽、粘贴上传、Enter 发送、Shift+Enter 换行、附件清理、流式 Markdown 渲染、暗色模式。

## 关键文件

- `src/components/chat/ChatInterface.tsx` — 主组件，重写输入区外壳与工具栏
- `src/components/ai-elements/prompt-input.tsx` — 已修复 TooltipProvider；必要时调整 `PromptInputButton` 样式以支持无边框/透明外观
- `src/components/ui/dropdown-menu.tsx` — 已存在，直接使用
- `src/components/ui/select.tsx` — 已存在，直接使用
- `src/lib/i18n.ts` — 补充附件菜单、模型选择、灵感等文案的 key
- `src/index.css` — 若需要新增 glassmorphism 工具类

## 实现要点

### 1. 输入外壳 `ChatInputShell`

在 `ChatInterface.tsx` 内提取一个局部组件（不新增文件），替代当前 inline 的 `rounded-[24px]` div + 内部 `InputGroup`：

- 单层容器：`rounded-[28px]`、`p-3`、`bg-white dark:bg-[#18181b]`、柔和阴影。
- 内部不再套 `border border-input` 的 `InputGroup`，直接用 flex 布局放置 textarea 和 toolbar。
- focus 状态由容器统一处理：`ring-2 ring-primary/30`。
- 保留拖拽文件到输入区触发上传。

### 2. Textarea

- 使用 `PromptInputTextarea`（保留 auto-resize、Enter/Shift+Enter 行为）。
- 样式改为无背景、无边框：`bg-transparent border-0 focus-visible:ring-0 resize-none`。
- placeholder 保持当前 i18n key。

### 3. Toolbar 布局

容器内分三行/区域：

```
[textarea 区域，占满宽度]
[左侧工具：附件 + Inspiration] [中间占位] [右侧：Model + Mic + Send]
```

使用 flex `justify-between` + `items-center`：

- **左侧**
  - 附件按钮（`Plus` icon）触发 `DropdownMenu`：
    - `Image` — Add photos or videos
    - `Box` / `Cube` — Add 3D objects
    - `FileText` — Add files (docs, PDF...)
  - Inspiration dropdown（`Zap` / `Sparkles` icon + 文字）触发 `DropdownMenu`，列出当前 teams/mock 项目。
- **右侧**
  - Model selector：shadcn `Select` 或 `DropdownMenu`，显示 `Brainwave 2.5` 等模型名。
  - Mic button：圆形 ghost 按钮。
  - Submit button：圆形主色填充按钮（primary `#F37021`），禁用态变灰。

### 4. 移除/替换自定义 popup

删除现有 `InspirationPopup` 和 `ModelPopup` 的 `motion.div` 实现，改用 shadcn 组件。

### 5. 附件文件显示

保留现有文件 chip，但样式与新的输入外壳协调：小圆角、浅色背景、暗色 `bg-white/5`。

### 6. 建议 chips

保留当前欢迎页的建议 chips，但微调：统一圆角、hover 态更柔和。

### 7. i18n

新增 key：

- `addPhotosOrVideos`
- `add3DObjects`
- `addFiles`
- `inspiration`
- `model`
- 保留现有 `chatPlaceholder`、`newChat` 等。

## 约束

- 不引入新依赖。使用已有：`lucide-react`、`radix-ui`（shadcn）、`motion/react`。
- 不修改 conversation / message 渲染逻辑。
- 不改动 service / context（Phase 2 已完成）。
- 所有交互按钮保留 aria-label。
- `npm run lint` 通过。

## 验证

- [ ] `npm run lint` 无 TypeScript 错误。
- [ ] Electron dev 启动后进入 AI Agent 视图，输入区为单层圆角药丸。
- [ ] 点击 `+` 展开附件菜单，三项可见。
- [ ] Inspiration 下拉列出项目。
- [ ] Model selector 显示模型并支持切换。
- [ ] 暗色/浅色切换后输入区外观协调。
- [ ] 控制台无 Tooltip/Provider 或 Radix 错误。
