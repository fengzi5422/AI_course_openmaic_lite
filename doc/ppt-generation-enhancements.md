# PPT 生成组件增强记录

> 参考 [yuyuanweb/ai-ppt-generator](https://github.com/yuyuanweb/ai-ppt-generator)（FastAPI + LangChain + LangGraph + python-pptx 全栈项目）的最佳实践，对本项目「大纲 → 场景 → 动作」生成流水线做的系统性增强。
>
> 日期：2026-08-31 ｜ 涉及代码：`lib/ai/provider.ts`、`lib/generation/*`、`app/api/generate/*`、`app/page.tsx`、`app/classroom/[id]/page.tsx`

---

## 一、参考项目的关键实践（来源分析）

| 实践 | 参考项目实现（源码位置） | 核心思想 |
| --- | --- | --- |
| **结构化输出** | `backend/app/llm/`（LCEL + json_mode） | 用 API 层的 `response_format: json_object` 约束模型输出，保证 JSON 可解析 |
| **自纠环工作流** | `backend/app/workflows/slide.py` 的 `build_slide_workflow` | `prepare → generate → check → (repair) → generate` 状态机；校验放进图里，让修复轮次拿到结构问题清单回喂模型，"形成自纠正回路而不是简单的重试"；`MAX_REPAIR_ROUNDS = 1` |
| **输入裁剪** | `slide.py: prepare_slide_input` | "上下文越短，模型越不容易把别页的内容混进来"，单页只喂本页需要的证据 |
| **质量门禁分级** | `backend/app/domain/quality.py`（`validate_slide` + `check_slide_richness`） | 结构问题（error）阻断/触发修复；丰富度问题（warning）只提醒不回炉（`is_repair_worthy`） |
| **溢出检测与自适应** | `backend/app/domain/flex_fit.py`（`fit_tree_to_content`） | "宽度决定折行，折行决定自然高度"，版面按内容自适应，避免导出溢出 |
| **页级并发生成** | commit「按页并发生成 PPT 正文」：ARQ Worker + `asyncio.Semaphore` | 每页独立任务并发执行、控制调用频率，失败单页重试不整份重来 |

## 二、本项目适配实现

> 我们没有引入 LangGraph/ARQ（避免重依赖，保持轻量架构），用纯 TypeScript 在现有流水线内复刻同样的事件流拓扑。

### 2.1 结构化输出：`lib/ai/provider.ts`

- `callLLM(system, user, temperature, { json: true })`：通过 AI SDK v7 的 `defaultSettingsMiddleware` + `wrapLanguageModel` 给模型注入 `responseFormat: { type: "json" }`（SDK 自动映射为 OpenAI 的 `json_object`）。
- **自动降级**：个别兼容服务不支持该参数时 catch 后退回普通文本模式，由下游 `parseLooseJson` 兜底。
- **关键修复**：`@ai-sdk/openai` v4 的 `provider(model)` 默认走 **Responses API（`/responses`）**，第三方 OpenAI 兼容服务（如 sensenova）没有该端点，会 404。改为 `provider.chat(modelId)` 显式走 Chat Completions。
- **环境值容错**：`cleanEnv()` 去除 `.env` 值的首尾空格与包裹引号（此前 `LLM_BASE_URL= https://... ` 带空格会导致请求打错地址）。

### 2.2 质量门禁与自纠环：`lib/generation/quality-check.ts`（新增）

- `SceneIssue { level: "error" | "warning", scope, message }`：
  - **error**（触发修复）：元素越界（超出 1280×720）、尺寸非法（w/h≤0）、文本溢出、无 speech、动作列表为空、quiz 选项 <2、answerIndex 越界、题干为空、无文本元素；
  - **warning**（只提示不回炉）：元素 <3（过瘦）、全部文本 <10 字（标题式短语）、缺案例/拓展块、讲稿 <3 段、讲稿平均 <40 字/段。
- `estimateTextOverflow`：启发式行宽估算（中文/全角 ≈ 1.0em，ASCII ≈ 0.55em；行数 = ⌈行宽/容器宽⌉；行高 = fontSize × 1.5）。相比参考项目 FontTools 字形级测量轻量很多，但对纯中文课堂内容精度足够。
- `fitTextElement` 两阶段确定性修复（借鉴 `fit_tree_to_content` "高度随内容自适应"）：
  1. 保持字号，把 h 扩展到自然高度（受画布底部约束，只扩不缩）；
  2. 仍放不下则按 0.85 比例降字号（下限 14px）并重新扩高；
  3. 极端超长仍放不下时保留原状，交给 LLM 自纠轮。
- `isRepairWorthy`：仅 error 触发回炉（与参考项目 `is_repair_worthy` 语义一致）。
- `describeIssues`：把问题清单转为 `- [error] scope：message` 格式回喂给 LLM。

### 2.3 自纠环生成：`lib/generation/scene-generator.ts`

复刻 `build_slide_workflow` 的回路（纯 TS 实现，无图框架）：

```text
generate(json_mode) → check（checkScene）
  ├─ 无 error ──────────────→ 返回 {scene, issues}
  ├─ 有 error → 确定性修复（fitText）→ recheck
  │     ├─ error 减少 → 采纳修复版
  │     └─ 仍有 error → repair：问题清单回喂 LLM 重写一轮（MAX_REPAIR_ROUNDS=1）
  │           └─ 采纳条件：新 error 数 ≤ 原 error 数（防止越修越差）
  └─ 全程失败（网络/解析）→ 外层重试 2 次 → 抛错 → 调用方降级占位
```

- Prompt 新增布局硬约束（坐标/尺寸/行高余量），从源头减少溢出。
- 输入裁剪：每条要点截断 120 字，防长材料污染单页上下文。
- `generateScenes`：worker-pool 并发（`CONCURRENCY = 2`，借鉴 ARQ + Semaphore 的限流思想），结果按大纲顺序排列；单页失败自动占位降级不影响其他页。

### 2.4 门禁透出：API 与前端

- `/api/generate/scenes` 响应新增 `warnings: string[]`。
- 首页生成完成后将 warnings 写入 `sessionStorage`；课堂页顶部显示可关闭的 ⚠️ 横幅（最多展示 3 条），warning 不阻断播放。

## 三、修复的存量问题

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 真实 LLM 全部 404 NOT_FOUND | `@ai-sdk/openai` v4 默认 Responses API，sensenova 无 `/responses` | `provider.chat()` 显式 Chat Completions |
| `.env` 的 `LLM_BASE_URL= https://... `（带空格） | 手写空格 | 修正 `.env` + `cleanEnv()` 容错 |
| JSON 模式偶发解析失败 | 纯 prompt 约束 | json_mode + `parseLooseJson` 双保险 |

## 四、验证结果

### 单元/集成测试（vitest，33/33 通过）

- `lib/generation/__tests__/quality-check.test.ts`（9 用例）：溢出估算与两阶段修复、越界/尺寸/quiz/空动作 error 判定、warning 不回炉、describeIssues 格式。
- `lib/generation/__tests__/scene-generator.test.ts`（8 用例，mock LLM）：正常单次通过、溢出本地修复省一次 LLM 调用、结构 error 触发自纠（问题清单确实回喂）、修复版更差时保留原版、JSON 失败重试、持续失败抛错、结果保序+失败占位、并发度 ≤2。
- 原有 `json-repair` / `dsl` 测试无回归。
- `tsc --noEmit` 零错误；`pnpm build` 通过。

### 端到端实测（真实 LLM：sensenova-6.8-flash-lite）

| 指标 | 结果 |
| --- | --- |
| 大纲生成（单次 LLM） | 27.2s，9 个场景，要点含"硬件视角/可靠性考量"等展开式表述 |
| 单场景生成（json_mode + 自纠环） | 39.2s，质量门禁 **0 error / 0 warning**；9 个元素全部落在画布内（左"机制解析"/右"案例+硬件实现"分区），6 段 speech（87~112 字/段）+ 2 spotlight + wb_text + wb_clear，案例含具体数字（7 段数码管、5V 高电平） |
| 场景生成（4 场景，并发 2，含自纠） | 5.1min，200，无失败 |
| 场景生成（8 场景全量） | 服务端完成（200），质量门禁全程工作 |
| 课程保存（DB） | 依赖 Docker Desktop 运行；本次验证时 Docker 已关闭，通路在此前交付已验证 |

> 性能对比：串行 → 并发 2 后，N 个场景的生成时间约从 Σtᵢ 降为 ≈ max(t₂ᵏ₋₁, t₂ₖ) 分组求和，实测 4 场景 5.1min（flash-lite 单次调用约 1.5~2.5min 时，串行预计 8~10min）。

## 五、后续演进（2026-08-31 第二批，已实现）

参考项目同源三项能力已全部落地：

### 5.1 SSE 进度推送

- `generateScenesStream(outlines, onEvent)`（[scene-generator.ts](../lib/generation/scene-generator.ts)）：worker 池每页完成/失败即触发 `scene_done` / `scene_failed` 事件（对应参考项目 Redis pub/sub + SSE 的逐页推送，本项目用进程内回调 + ReadableStream 实现，无外部依赖）。
- `POST /api/generate/scenes` 新增 `stream: true`：返回 `text/event-stream`，逐帧推送进度，结束时 `done` 帧携带完整 stage（与 JSON 响应字段一致）；非流式路径保留兼容。
- 首页生成 UI：骨架屏升级为场景清单逐个点亮（⏳→✅），SSE 逐帧解析（`data: {json}\n\n` 分帧、按 content-type 自动降级 JSON）。
- 实测（真实 LLM）：`content-type: text/event-stream` → `scene_done`（t+117s）→ `done`（含完整 stage），theme 兜底正常。

### 5.2 失败单页重试 API

- `POST /api/generate/scene-retry {title, points?}`：对占位场景单独重新生成（对应参考项目"失败单页重试，不整份重来"），复用 `generateScene` 的自纠环与质量门禁；无 Key 时返回演示场景。
- 占位场景识别：`DEGRADED_SPEECH_PREFIX`（`【占位】`）标记 + `degradedSceneInfo()` 提取标题与要点（要点保存于占位场景正文元素）。
- 前端入口：课堂页播放到占位场景时顶部显示"🔄 重新生成本场景"横幅（重试后自动跳回该场景播放并 PUT 保存）；编辑器场景列表同样提供入口（重试后直接保存）。

### 5.3 主题三分离（内容/布局/主题）

- [lib/dsl/theme.ts](../lib/dsl/theme.ts)：`ThemeTokens`（bg/bgSoft/title/text/dim/accent/accentSoft/quiz/quizText）+ 3 套内置主题（`ivory` 米白学术、`midnight` 深空夜课、`mint` 薄荷清爽）+ `resolveTheme` / `isThemeId`。
- DSL：`Stage.theme: string`（normalize 兜底默认主题，老数据零迁移成本）。
- 渲染消费：`SlideRenderer` 接收 tokens，元素命中"生成端默认深色调色板"（#1f2937 等）时映射为主题文字/标题色（`mapElementColor`，保证深空主题可读性），自定义色保留；舞台背景、测验交互层同源消费 tokens。
- 交互：课堂页 ControlBar 上方 🎨 按钮循环切换主题并 PUT 持久化到 `doc.theme`（保存失败不打断播放）。

### 测试

- 42/42 通过（新增 9 个：theme 5 + SSE 事件流 2 + 占位识别 2）；`tsc --noEmit` 零错误；`pnpm build` 通过。

## 六、更远期方向

1. **编辑器画布化**：元素拖拽/缩放的所见即所得编辑。
2. **导出 PPTX**：基于 theme token 同源渲染导出（theme 分离已为导出铺路）。
3. **图片生成 Provider**：为概念场景配示意图。

