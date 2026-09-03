# AI 互动课堂（OpenMAIC 简化复刻）设计文档

> 日期：2026-08-31。基于 doc/architecture-deep-dive.md 的架构总结，从零复刻 OpenMAIC 阶段 1-4 核心闭环。

## 1. 交付范围

- DSL 数据模型（Stage / Scene / Action / PPTElement）+ normalize/validate
- 两阶段课程生成（大纲 → 场景内容+动作），带 JSON 修复与重试
- 播放引擎（顺序执行 Action，可暂停/跳转）+ 动作引擎（语音/聚光灯/白板）
- 幻灯片渲染组件、简单编辑器（增删页/改文字/插图）
- 教师问答聊天（SSE 流式）
- PostgreSQL 持久化（课程 CRUD）

不包含：多智能体编排、Pro 工作台、MP4 导出、PPTX 导入、S3 资产层。

## 2. 技术栈

| 领域 | 选型 |
| --- | --- |
| 框架 | Next.js (App Router) + React + TypeScript |
| 样式 | Tailwind CSS |
| 状态 | Zustand |
| LLM | Vercel AI SDK + OpenAI 兼容 Provider（BASE_URL/API_KEY/MODEL 可配） |
| 数据库 | PostgreSQL + pg 原生驱动（docker-compose） |
| 语音 | 浏览器 Web Speech API（零配置） |
| 测试 | Vitest（dsl / json-repair 单测） |

单仓库，用 lib/ 分层替代 pnpm workspace 子包。

## 3. 目录结构

```text
app/
  page.tsx                  课程列表
  classroom/[id]/page.tsx   课堂播放页
  edit/[id]/page.tsx        编辑器
  api/generate/outline      大纲生成
  api/generate/scenes       场景生成
  api/chat                  问答 SSE
  api/courses, api/courses/[id]  课程 CRUD
lib/
  dsl/          stage.ts scene.ts action.ts slides.ts normalize.ts validate.ts
  generation/   outline-generator.ts scene-generator.ts json-repair.ts
  playback/     engine.ts
  action/       engine.ts
  ai/           provider.ts
  server/       db.ts
  store/        course-store.ts playback-store.ts
components/
  slide-renderer/  PPTElement 渲染
  chat/            聊天面板
  editor/          编辑面板
```

## 4. 数据模型

- `Stage { id, title, description, scenes: Scene[], version }`
- `Scene { id, title, content: SlideContent | QuizContent, actions: Action[] }`
- `PPTElement`: text / image / shape（最小集）
- `Action`: speech / spotlight / wb_draw / wb_text（最小集）
- PG 表 `courses (id uuid pk, title text, doc jsonb, revision int, created_at, updated_at)`

## 5. 核心流程

1. 首页输入主题 → `/api/generate/outline` → 可编辑大纲
2. 确认大纲 → `/api/generate/scenes` 逐场景生成 → 组装 Stage 存库
3. 课堂页：PlaybackEngine 顺序消费 actions，ActionEngine 执行
   speech（Web Speech API）/ spotlight（遮罩）/ wb_draw / wb_text（canvas）
4. 聊天面板带当前场景上下文调用 `/api/chat`（SSE）
5. 编辑页改内容 → 保存写库（revision 自增）

## 6. 错误处理

- 生成端：LLM 输出 JSON 解析失败 → json-repair → 最多重试 2 次 → 仍失败则报错给前端
- validate 在生成写入与播放前双重把关
- DB 不可用时 API 返回明确错误信息

## 7. 验收标准

`docker compose up -d` + `pnpm dev` 后完整走通：
输入主题 → 生成大纲 → 生成课程 → 课堂播放（语音+白板+聚光灯）→ 提问 → 编辑保存。
`pnpm build` 与 `pnpm test` 通过。
