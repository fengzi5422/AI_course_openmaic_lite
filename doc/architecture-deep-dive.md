# OpenMAIC 核心实现架构总结

> 本文面向希望复刻类似 AI 互动课堂项目的开发者，提炼 OpenMAIC v1.0.0 的整体架构、核心模块、技术选型与可复用设计决策。

---

## 一、整体架构分层

OpenMAIC 采用 **Next.js 16 全栈 + pnpm Workspace 子包** 的 Monorepo 结构。核心设计原则是：把**课程数据契约**（DSL）下沉为独立包，把持久化、渲染、导入、生成等能力拆分为可替换子包，应用主体负责编排、页面、API 与状态管理。

### 1.1 架构分层表

| 层级 | 主要职责 | 典型目录/文件 |
| --- | --- | --- |
| **前端页面层** | Next.js App Router 页面、路由、全局布局 | `app/page.tsx`、`app/classroom/[id]/page.tsx`、`app/workbench/page.tsx`、`app/layout.tsx` |
| **前端组件层** | React UI 组件：编辑器、播放画布、聊天、设置、白板、场景渲染器 | `components/` 下 `slide-renderer/`、`scene-renderers/`、`chat/`、`whiteboard/`、`agent/`、**`workbench/`** |
| **API 路由层** | Next.js Route Handlers，承接生成、聊天、持久化、Agent 控制面 | `app/api/generate/`、`app/api/chat/`、`app/api/agent/`、`app/api/persistence/`、`app/api/stages/` |
| **核心库层** | 业务逻辑：多智能体编排、播放、动作、Provider 抽象、状态、导出 | `lib/orchestration/`、`lib/playback/`、`lib/action/`、`lib/ai/`、`lib/audio/`、`lib/media/`、`lib/export/`、`lib/store/` |
| **服务端运行时** | 持久化 Agent 会话、技能、工具、材料、课程写入 | `lib/server/agent-runtime/` |
| **工作区包层** | 与运行时无关或可复用的子包：DSL、生成、渲染、导入、存储 | `packages/@openmaic/dsl/`、`packages/@openmaic/generation/`、`packages/@openmaic/renderer/`、`packages/@openmaic/editor/`、`packages/@openmaic/importer/`、`packages/@openmaic/storage/` |
| **可选外部服务** | PostgreSQL、S3、Render Service（MP4 导出）、本地模型/语音服务 | `docker-compose.yml`、`render-service/`、`.env.example` |

### 1.2 层间数据流

```text
用户输入 / 上传材料
        │
        ▼
[ Next.js Pages ] ─────▶ [ React Components ] ─────▶ [ Zustand Stores (lib/store/) ]
        │                                                    │
        │                                                    ▼
[ API Routes (app/api/) ] ◀────────────────────── [ Stage API Facade (lib/api/stage-api.ts) ]
        │                                                    │
        ▼                                                    │
生成流水线 (@openmaic/generation + lib/server/适配)            │
        │                                                    │
        ▼                                                    │
多智能体编排 (lib/orchestration/) ◀─────────────── 课程数据契约 (@openmaic/dsl)
        │                                                    │
        ▼                                                    │
LLM Provider (lib/ai/) ◀──────── resolveModel (lib/server/resolve-model.ts)
        │                                                    │
        ▼                                                    │
媒体/音频 Provider (lib/media/、lib/audio/)              持久化 (@openmaic/storage + lib/persistence/)
        │                                                    │
        ▼                                                    │
播放引擎 (lib/playback/engine.ts) ◀─────────────── 动作引擎 (lib/action/engine.ts)
        │                                                    │
        ▼                                                    │
课堂播放页 (app/classroom/[id]/) ─────▶ 渲染器 (@openmaic/renderer 或 components/slide-renderer)
```

### 1.3 关键交互方式

| 交互 | 方式 | 说明 |
| --- | --- | --- |
| 浏览器 ↔ 服务端 API | Next.js Route Handlers + Server Actions | 生成、聊天、材料、持久化、Agent 控制面均走 `/api/*` |
| 服务端 ↔ LLM | Vercel AI SDK (`@ai-sdk/*`) | 统一适配 18 家 LLM 及 OpenAI 兼容服务 |
| 浏览器 ↔ 持久化 | `@openmaic/storage` HTTP 后端 | 浏览器存储（默认）或 HTTP 到嵌入的 `/api/persistence` |
| 服务端 ↔ PostgreSQL | `@openmaic/storage` PostgreSQL 后端 | 文档、运行时、资产、Agent 会话、素材、用户技能 |
| 浏览器 ↔ 媒体生成 | `/api/generate` 或 Agent 工具 | 图片/视频/TTS 由服务端调用对应 Provider |
| 服务端内部编排 | LangGraph `StateGraph` | `lib/orchestration/director-graph.ts` 管理多智能体轮次 |

---

## 二、核心模块功能与职责

### 2.1 课程数据契约：`@openmaic/dsl`

| 项 | 说明 |
| --- | --- |
| **职责** | 定义课程 `Stage`、场景 `Scene`、幻灯片元素 `PPTElement`、播放动作 `Action`、运行时 `Runtime` 的**纯数据契约**。零运行时依赖，只导出类型、校验器、归一化函数、JSON Schema、版本迁移。 |
| **关键文件** | `packages/@openmaic/dsl/src/stage.ts`、`scene.ts`、`slides.ts`、`action.ts`、`runtime.ts`、`validate.ts`、`normalize.ts`、`version.ts` |
| **关键类型** | `Stage`、`Scene<Content, Action>`、`SlideContent`、`QuizContent`、`PBLContent`、`InteractiveContent`、`PPTElement`（text/image/shape/line/chart/table/latex/video/audio/code）、`Action`（speech / spotlight / laser / wb_* / widget_* / discussion / play_video 等） |
| **主要流程** | 写入前 `normalize` 补默认值 → `validate` 校验；版本迁移由 `version.ts` 的 `migrate` / `migrateRuntime` 负责；构建时生成 JSON Schema 供外部校验 |

**设计要点**：`@openmaic/dsl` 不依赖 React、pptx、echarts 等；`@openmaic/renderer` 和 `@openmaic/importer` 只准依赖它，形成**单向依赖**。

### 2.2 生成流水线：`@openmaic/generation`

| 项 | 说明 |
| --- | --- |
| **职责** | 两阶段课程生成：① 大纲生成 ② 场景内容与动作生成。封装提示词、JSON 修复、重试、PBL v2 规划、交互后处理。 |
| **关键文件** | `outline-generator.ts`、`scene-generator.ts`、`scene-builder.ts`、`action-parser.ts`、`json-repair.ts`、`interactive-post-processor.ts`、`pbl/planner-core.ts`、`pbl/planner-single-call.ts` |
| **关键接口** | `generateSceneOutlinesFromRequirements`、`generateSceneContent`、`generateSceneActions`、`buildCompleteScene`、`AICallFn`、`SceneOutline`、`CompleteScene` |
| **适配层** | `lib/server/classroom-generation.ts`、`lib/server/scene-generation.ts` 负责把应用配置（模型、provider、素材）注入包内函数 |

**业务流程**：
```text
requirements + materials
        │
        ▼
outline-generator ──▶ 可编辑的 Outline[]
        │
        ▼
scene-generator ─────▶ GeneratedSlideContent / QuizContent / InteractiveContent / PBLContent
        │
        ▼
action-parser ───────▶ Action[]（speech / spotlight / wb_draw 等）
        │
        ▼
scene-builder ───────▶ CompleteScene（content + actions）
```

### 2.3 多智能体编排：`lib/orchestration/`

| 项 | 说明 |
| --- | --- |
| **职责** | 驱动课堂中的多智能体讨论、问答、圆桌辩论。使用 LangGraph 状态图管理轮次，保证每轮只有一个智能体发言或动作。 |
| **关键文件** | `director-graph.ts`、`director-prompt.ts`、`prompt-builder.ts`、`ai-sdk-adapter.ts`、`registry/store.ts`、`tool-schemas.ts` |
| **状态图** | `START → director → (end) → END` 或 `director → agent_generate → END`。单轮最多一次 director→agent 循环，客户端通过串行多次请求驱动长讨论。 |
| **关键类型** | `OrchestratorState`、`AgentTurnSummary`、`WhiteboardActionRecord` |

**Director 策略**：
- 单智能体：纯代码逻辑，第 0 轮分派 agent，之后提示用户。
- 多智能体：LLM 决定下一轮由谁发言，并附带白板动作记录。

### 2.4 播放与动作引擎：`lib/playback/` + `lib/action/`

| 项 | 说明 |
| --- | --- |
| **播放引擎** | `PlaybackEngine` 状态机：`idle → playing → paused / live`。消费 `Scene.actions[]`，无中间编译步骤 |
| **动作引擎** | `ActionEngine` 执行 28+ 种动作类型：语音（TTS）、白板绘制/文字/图形/图表、聚光灯、激光笔、widget 交互、讨论触发等 |
| **关键文件** | `lib/playback/engine.ts`、`action-navigation.ts`、`derived-state.ts`；`lib/action/engine.ts` |
| **状态转换** | `start() / pause() / resume()`；讨论触发时进入 `live`，结束后回到 `idle` |

**关键设计**：播放引擎直接消费 DSL 动作列表，而不是预编译视频帧。这让课堂可以实时响应用户打断、问答和讨论。

### 2.5 幻灯片编辑器、渲染器与导入器

| 模块 | 职责 | 关键文件 |
| --- | --- | --- |
| **`@openmaic/dsl`** | 幻灯片数据契约（Slide、PPTElement） | `slides.ts`、`action.ts` |
| **`@openmaic/renderer`** | 将 DSL Slide 渲染为 React 组件（播放态） | `packages/@openmaic/renderer/src/` |
| **`@openmaic/editor`** | 可组合的编辑内核 + React 编辑面（选择、拖拽、缩放、旋转、框选多选） | `packages/@openmaic/editor/src/` |
| **`@openmaic/importer`** | PPTX → OpenMAIC Slide DSL 导入 | `packages/@openmaic/importer/src/` |
| **应用内编辑器** | `components/slide-renderer/` 是旧版编辑/渲染画布，逐渐被 `@openmaic/renderer` v2 替代 | `components/slide-renderer/Editor/Canvas/` |

**演进方向**：将 DSL、渲染、编辑、导入全部 SDK 化，应用层只负责组装。

### 2.6 持久化与存储：`@openmaic/storage`

| 项 | 说明 |
| --- | --- |
| **职责** | 提供**可替换的存储原语**：KV、Asset（资产字节）、Document（课程文档）、Runtime（学习运行时）、AgentSession、Material、UserSkill |
| **依赖关系** | `@openmaic/storage` 仅依赖 `@openmaic/dsl`，保持无环 |
| **后端实现** | 浏览器 IndexedDB、HTTP（调用 `/api/persistence`）、PostgreSQL、S3（资产字节间接下发） |
| **关键文件** | `kv/types.ts`、`kv/browser.ts`、`kv/http.ts`；`asset/types.ts`、`asset/browser-store.ts`、`asset/pg.ts`；`document/types.ts`、`document/browser.ts`、`document/http.ts`、`document/pg.ts`；`runtime/types.ts`、`runtime/browser.ts` |

**存储抽象层次**：
```text
应用代码
   │
   ▼
@openmaic/storage 接口 (KVStore / AssetStore / DocumentStore / RuntimeStore / AgentSessionStore / ...)
   │
   ├─▶ Browser 后端（IndexedDB）
   ├─▶ HTTP 后端（调用 /api/persistence）
   └─▶ PostgreSQL 后端（服务端 / api/persistence 内使用）
```

**关键设计**：
- 资产采用**分配 ID + 内容寻址 blob**：`AssetId` 是引用，底层字节按内容哈希存储，便于去重与回收。
- 服务端资产回收为**离线 collector**：删除引用后，超过 grace 时间无引用的字节被清理。
- 文档使用**数据库触发器维护 per-scene 单调 revision**，保证客户端只刷新变更场景。

### 2.7 服务端 Agent 运行时：`lib/server/agent-runtime/`

| 项 | 说明 |
| --- | --- |
| **职责** | Pro 工作台的"后台大脑"：管理持久化 Agent 会话、技能、工具、材料、课程写入、事件流 |
| **关键文件** | `runner.ts`、`course-tools.ts`、`dsl-tools.ts`、`generation-tools.ts`、`material-tools.ts`、`roster-tools.ts`、`skills.ts`、`store.ts`、`import-pptx.ts` |
| **关键概念** | AgentSessionStore（租约/心跳/崩溃恢复）、`CourseToolDeps`（owner-scoped store）、`LoadedSkill`（加载的技能）、`CheckpointInfo`（写入进度事件） |
| **工具分组** | 课程 DSL 读写、页面生成与编辑、素材读取/搜索、媒体生成、名册与音色、PPTX 导入、技能编辑、个人历史 |

**运行器特点**：
- 数据库支撑：会话可跨进程重启恢复
- 租约 + 心跳：防止并发执行冲突
- 取消与追加指令：支持用户中途取消或 steering
- 事件流：通过 SSE 向工作台实时推送 checkpoint / message / error

### 2.8 Provider 抽象：`lib/ai/`、`lib/audio/`、`lib/media/`、`lib/web-search/`

| Provider 层 | 职责 | 关键文件 |
| --- | --- | --- |
| `lib/ai/` | LLM 统一配置与模型解析 | `providers.ts`、`model-metadata.ts`、`model-aliases.ts`、`thinking-config.ts` |
| `lib/audio/` | TTS / ASR 统一入口 | TTS 适配器、ASR 适配器、音色管理 |
| `lib/media/` | 图像/视频生成统一入口 | 图像适配器、视频适配器 |
| `lib/web-search/` | 联网搜索统一入口 | `tavily.ts`、`brave.ts`、`baidu.ts`、`searxng.ts`、`claude.ts` 等 |

**统一设计**：
- 模型 ID 使用 `<provider>:<model>` 格式，例如 `openai:gpt-5.5`。
- `MODEL_ROUTES` 显式路由智能体驱动模型到具体 provider + dialect。
- 服务端能力发现：浏览器从 `/api/server-providers` 获取可用能力，避免把 API Key 下发到前端。
- 统一开关：`<CAP>_<PREFIX>_ENABLED=false` 可强制关闭任何能力。

### 2.9 API 路由分组

| 路由组 | 职责 | 路径示例 |
| --- | --- | --- |
| `app/api/generate/` | 两阶段生成：大纲、场景内容、PBL 规划 | `/api/generate/outline`、`/api/generate/scenes` |
| `app/api/generate-classroom/` | 异步整门课程生成任务 | `/api/generate-classroom`、`/api/generate-classroom/[id]` |
| `app/api/chat/` | 多智能体聊天 SSE | `/api/chat` |
| `app/api/agent/` | Agent 会话、事件、材料、技能控制面（v1.0.0） | `/api/agent/sessions`、`/api/agent/events` |
| `app/api/stages/` | 课程文档读写、manifest、场景 freshness | `/api/stages/[id]`、`/api/stages/[id]/scenes/[sceneId]` |
| `app/api/persistence/` | 服务端持久化 HTTP 入口（当开启 PG 模式时） | `/api/persistence/kv/*`、`/api/persistence/assets/*` |
| `app/api/materials/` | 材料上传与提取（Agent 工作台） | `/api/materials/upload`、`/api/materials/extract` |
| `app/api/export-video/` | MP4 导出任务提交 | `/api/export-video` |
| `app/api/quiz-grade/` | 测验自动批改 | `/api/quiz-grade` |
| `app/api/transcription/` | 语音转文字 | `/api/transcription` |
| `app/api/web-search/` | 联网搜索代理 | `/api/web-search` |
| `app/api/provider/`、`server-providers/` | 能力发现、模型解析、服务端 provider 配置 | `/api/server-providers` |

---

## 三、技术栈与关键依赖

### 3.1 技术栈

| 领域 | 技术 | 版本 |
| --- | --- | --- |
| 运行时 / 框架 | Next.js | 16.1.2 |
| UI 框架 | React | 19.2.3 |
| 语言 | TypeScript | 5.x |
| 样式 | Tailwind CSS | 4.x |
| 组件库 | shadcn/ui + Radix UI | — |
| 状态管理 | Zustand | 5.x |
| 动画 | motion（Framer Motion） | — |
| Monorepo | pnpm Workspace | 10.x |
| 数据库 | PostgreSQL（可选） | 16 |
| ORM/驱动 | `pg`（原生 Postgres 驱动） | — |
| LLM SDK | Vercel AI SDK | `ai` 6.x + `@ai-sdk/*` |
| 多智能体编排 | LangGraph | 1.1.x |
| 测试 | Vitest + Playwright | — |
| 容器 | Docker / Docker Compose | — |

### 3.2 关键依赖及选型原因

| 依赖 | 用途 | 选型原因 |
| --- | --- | --- |
| **Next.js 16 + App Router** | 全栈应用：SSR/SSG、API Routes、服务端组件 | 一套技术栈同时承载页面与 API，Vercel 一键部署生态成熟 |
| **React 19** | 交互式 UI | 新特性（如 Compiler 准备）与并发渲染能力 |
| **Vercel AI SDK** | 统一调用 18+ LLM | `LanguageModel` 抽象 + 流式输出 + 工具调用，避免每家 API 单独封装 |
| **LangGraph** | 多智能体状态机 | 显式状态图控制智能体轮次，支持自定义流式 chunk 输出 |
| **Zustand** | 全局/局部状态 | 轻量、无样板、支持 Immer、 persist 中间件 |
| **ProseMirror** | 幻灯片内富文本编辑 | 结构化文档编辑的行业标准 |
| **KaTeX / temml** | LaTeX 公式渲染 | 浏览器与 PPTX 导出双端一致 |
| **ECharts** | 图表渲染 | 成熟、可导出为图片 |
| **Dexie / IndexedDB** | 浏览器端存储 | 浏览器模式下的文档与资产存储 |
| **pg** | PostgreSQL 驱动 | 直接写 schema/触发器，不引入 ORM 以精细控制存储层 |
| **@hyperframes/producer** | 视频导出时序合成 | 浏览器端构建可渲染帧序列，交给服务端 Chromium+FFmpeg |

---

## 四、可复用的设计模式与架构决策

### 4.1 DSL 优先：数据契约作为架构中心

- 把 `Stage / Scene / Action` 全部沉淀到 `@openmaic/dsl`，所有其他包单向依赖它。
- 好处：生成、渲染、编辑、导入、导出、持久化全部基于同一份契约，避免 N 份格式之间的转换。
- 复刻建议：**先定义课程数据模型**，再写生成、渲染、播放。

### 4.2 两阶段生成：先结构化大纲，再生成内容

- 第 1 阶段输出 `SceneOutline[]`，用户可编辑。
- 第 2 阶段按节点并行/串行生成 `CompleteScene`。
- 好处：人类可干预课程结构，降低模型一次性生成长内容的失败率。
- 复刻建议：不要试图一次 prompt 输出整门课，**拆分为"大纲 → 场景"两步**。

### 4.3 动作驱动的播放引擎

- 课堂不是视频，而是**按顺序执行 Action 列表**（speech、spotlight、wb_draw、discussion 等）。
- 播放引擎 `PlaybackEngine` 与动作执行器 `ActionEngine` 解耦。
- 好处：可暂停、跳转、打断、插入讨论，且导出为视频时只需把同一套 Action 渲染成帧。
- 复刻建议：把"课堂内容"抽象为可执行动作序列，而不是预渲染媒体。

### 4.4 可替换存储抽象

- `@openmaic/storage` 提供统一接口，底层可切换浏览器 IndexedDB、HTTP、PostgreSQL。
- 好处：同一套应用代码支持"零数据库本地运行"和"服务端多用户部署"两种模式。
- 复刻建议： early 就抽象 `DocumentStore`、`RuntimeStore`、`AssetStore`，不要直接依赖 IndexedDB 或 SQL。

### 4.5 Provider 中立与能力发现

- 模型、媒体、搜索、TTS/ASR 全部通过统一接口接入。
- 服务端暴露 `/api/server-providers`，浏览器只获取能力列表，Key 留在服务端。
- 模型 ID 使用 `<provider>:<model>`，启动时校验路由。
- 复刻建议：**不要让浏览器直接拿 Key 调第三方 API**；用服务端 route 中转，并做能力发现。

### 4.6 功能开关门控

- `lib/config/feature-flags.ts` 统一管理 build-time / runtime 开关：Pro 工作台、视频导出、PPTX 导入、职教模式、Pi Chat 等。
- build-time 开关（`NEXT_PUBLIC_*`）会编译进产物；runtime 开关（`OPENMAIC_*`）只在服务端判断。
- 复刻建议：把实验性功能关在 flag 后面，避免未完成能力污染主流程。

### 4.7 资产内容寻址 + 离线回收

- 资产按内容哈希存储，分配 ID 引用；删除引用后由后台 collector 回收。
- 导出时把外部 CDN 资源内联为 `data:` URI，实现离线播放。
- 复刻建议：媒体资源别直接塞 base64 进文档，抽成独立资产层，便于去重、导出、回收。

### 4.8 持久化 Agent 会话：租约 + 心跳 + 崩溃恢复

- `AgentSessionStore` 使用 lease/heartbeat 保证同一时刻只有一个 runner 执行会话。
- 会话状态持久化到 DB，runner 重启后可恢复。
- 复刻建议：如果做对话式智能体建课，必须考虑**并发控制**和**进程重启恢复**，不能只在内存里跑。

### 4.9 按场景单调 revision 同步

- 数据库触发器为每个 scene 维护单调递增 revision。
- 工作台通过 `StageFreshnessManifest` 只拉取变更场景，而非全量刷新。
- 复刻建议：多标签/多客户端编辑同一文档时，用 revision 做增量同步，降低带宽和冲突。

---

## 五、复刻该项目所需的核心步骤

### 阶段 1：最小数据模型（MVP 基础）

1. 定义 `Stage`：课程 = 元数据 + `Scene[]`
2. 定义 `Scene`：通用结构 + 4 种内容：`slide`、`quiz`、`interactive`、`pbl`
3. 定义 `Action`：语音、白板、 Spotlight、讨论触发等最小集合
4. 写 `normalize` 与 `validate`，保证生成端和播放端数据一致

### 阶段 2：生成流水线（先能"造课"）

1. 实现"大纲生成"：输入主题/材料 → `SceneOutline[]`
2. 实现"场景内容生成"：每个 outline → 文本/测验题/交互 HTML
3. 实现"动作生成"：把内容转成 `Action[]`
4. 接入一家 LLM（建议从 OpenAI 或 Gemini 开始）

### 阶段 3：播放与动作引擎（再能"上课"）

1. 用 React 渲染 `slide` 内容（文本、图片、图表、公式）
2. 实现 `PlaybackEngine`：顺序执行 `Action`
3. 实现 `ActionEngine`：TTS 播放、白板绘制、 Spotlight 效果
4. 做一个简单聊天/问答入口

### 阶段 4：编辑与持久化（让它可用）

1. 实现浏览器端 `DocumentStore`（IndexedDB 或 localStorage 起步）
2. 实现课程列表、创建、删除、重命名
3. 实现简单的幻灯片编辑器：增删页、改文字、插入图片
4. 导出 PPTX / HTML（可先只做 HTML）

### 阶段 5：扩展为"多智能体课堂"

1. 引入 LangGraph 或自研状态机管理多智能体轮次
2. 定义 agent registry 与人设（教师、同学、辩论方）
3. 实现讨论触发：播放中某 action 触发讨论，用户可加入
4. 实现白板共享状态

### 阶段 6：服务端化与 Pro 工作台（高级）

1. 引入 PostgreSQL，实现服务端 `DocumentStore` / `RuntimeStore`
2. 实现 `/api/persistence` HTTP 契约
3. 设计持久化 Agent 会话：lease、heartbeat、event log
4. 实现工具系统 + 技能系统
5. 做对话式工作台 UI

---

## 六、注意事项与常见陷阱

| 坑点 | 说明 | 建议 |
| --- | --- | --- |
| **不要把 API Key 下发浏览器** | 项目通过服务端 provider 路由和能力发现避免 | 所有 LLM/媒体调用走服务端 route |
| **不要一次 prompt 生成整门课** | 容易超长/失败/不可控 | 拆"大纲 → 场景"两阶段 |
| **不要把媒体直接内联进文档** | 会导致文档巨大、难以导出 | 独立资产层 + 引用 |
| **不要忽视播放状态机** | 课堂需要 pause/resume/jump/live 多种模式 | early 设计 `PlaybackEngine` |
| **不要直接依赖具体数据库** | 项目通过 `@openmaic/storage` 抽象支持浏览器/HTTP/PG | 先抽象接口，再实现后端 |
| **注意 build-time vs runtime flag 区别** | `NEXT_PUBLIC_*` 编译进产物，服务端 flag 只在 Node 判断 | 别在客户端读服务端 flag，也别在服务端读客户端 flag |
| **Pro 工作台必须配数据库** | Agent runtime 不启动则 `/api/agent/*` 404 | 无 PG 不要试图开启工作台 |
| **MP4 导出资源开销大** | Chromium + FFmpeg + 8 GiB 内存 | 作为独立服务，按需启用 |
| **LaTeX / 图表 / 公式双端一致** | 浏览器和 PPTX 导出需要两套渲染 | 用成熟库（KaTeX/ECharts）并做导出适配 |
| **版本迁移** | DSL 会演进，老课程数据需要 migrate | 从 v1 就设计版本号与迁移函数 |

---

## 七、推荐阅读顺序

如果想直接读代码理解实现，建议按以下顺序：

1. `packages/@openmaic/dsl/src/stage.ts`、`scene.ts`、`slides.ts`、`action.ts` —— 先懂数据模型
2. `packages/@openmaic/generation/src/outline-generator.ts`、`scene-generator.ts` —— 再懂生成
3. `lib/playback/engine.ts`、`lib/action/engine.ts` —— 再懂播放
4. `lib/orchestration/director-graph.ts` —— 再懂多智能体
5. `packages/@openmaic/storage/src/document/types.ts`、`kv/types.ts`、`asset/types.ts` —— 再懂存储抽象
6. `lib/server/agent-runtime/runner.ts`、`course-tools.ts` —— 最后懂 Pro 工作台

---

*文档基于 OpenMAIC v1.0.0（2026-08-27）源码整理，生成于 2026-08-31。*
