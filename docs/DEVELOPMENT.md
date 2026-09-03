# openmaic-lite 开发文档

> 目标：读完整篇即可从零复刻本项目。包含架构设计、数据模型、模块详解、开发历程与踩坑实录。
> 配套阅读：[README.md](../README.md)（快速开始）、[doc/architecture-deep-dive.md](../doc/architecture-deep-dive.md)（原版 OpenMAIC 架构总结）。

## 目录

1. [项目定位与总体架构](#1-项目定位与总体架构)
2. [数据模型](#2-数据模型)
3. [DSL：内容/布局/主题三分离](#3-dsl内容布局主题三分离)
4. [生成管道：两阶段 + 质量门禁 + 后台任务](#4-生成管道)
5. [课堂：播放引擎与动作引擎](#5-课堂)
6. [可视化编辑器](#6-可视化编辑器)
7. [参考资料管道](#7-参考资料管道)
8. [日志模块](#8-日志模块)
9. [导出模块（HTML/PPTX/PDF）](#9-导出模块)
10. [开发历程时间线](#10-开发历程时间线)
11. [踩坑实录（最有价值）](#11-踩坑实录)
12. [复刻指南：分阶段里程碑](#12-复刻指南)
13. [测试策略](#13-测试策略)
14. [部署](#14-部署)

---

## 1. 项目定位与总体架构

openmaic-lite 是原版 OpenMAIC（AI 互动课堂）的阶段 1-4 复刻 + 持续增强版。核心体验：

```
输入主题 → AI 生成大纲（8-12 场景） → 确认后逐场景生成课件
        → 课堂播放（讲稿朗读 + 字幕 + 白板 + 聚光灯 + 测验）
        → 可视化编辑 → 导出 PPTX / HTML / PDF
```

**技术选型**（单仓库，非 monorepo）：

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js 16 App Router + React 19 + TS | 全栈一体，API Routes 承载 SSE/长任务 |
| 样式 | Tailwind CSS 4 | 零配置，CSS 变量做主题 |
| 状态 | Zustand（轻量使用）+ React 状态 | 复杂度不高，不上 Redux |
| AI | Vercel AI SDK + OpenAI 兼容接口 | 一套代码换任何国产模型 |
| DB | PostgreSQL 16（docker-compose，端口 **5434**） | jsonb 存课程文档 |
| 解析/导出 | mammoth · unpdf · pptxgenjs · puppeteer-core | 全部纯 JS / 复用本机浏览器 |

**目录分层与依赖方向**（单向，禁止反向）：

```
dsl（纯契约，客户端可用）
 ↑           ↑
generation（AI 管道）  playback/action（引擎）
 ↑                      ↑
server（DB/日志/任务/参考资料）
 ↑
app（页面 + API 路由）
```

> 关键约束：客户端组件只允许导入 `lib/dsl/*`（含 `degraded.ts`）与 `lib/generation/layout.ts`。`lib/generation/index.ts` barrel 会把 `pg` 传递引入 client bundle 导致页面 500（见踩坑 #10）。

## 2. 数据模型

三张表（建表 SQL 幂等，进程启动时自动执行，见 `lib/server/db.ts`）：

```sql
-- 课程（doc 存完整 Stage DSL）
CREATE TABLE IF NOT EXISTS courses (
  id text PRIMARY KEY, title text NOT NULL,
  doc jsonb NOT NULL,
  reference_ids jsonb,               -- 关联的参考资料 id（后续迁移补列）
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 参考资料库
CREATE TABLE IF NOT EXISTS reference_files (
  id text PRIMARY KEY,
  course_id text,                    -- 可选关联
  filename text, ext text, mime text,
  size_bytes integer,
  status text,                       -- extracted | failed | needs_ocr
  method text,                       -- direct | paddleocr | ocr
  char_count integer, page_count integer,
  content text,                      -- 提取全文
  pages jsonb,                       -- 分页文本 [{index, text}]
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 日志 + 归档表（logs_archive 结构相同）
CREATE TABLE IF NOT EXISTS logs (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  level text, module text, message text, detail jsonb
);
```

id 生成：`crc_/ref_/job_` 前缀 + `Date.now().toString(36)` + 随机段。

## 3. DSL：内容/布局/主题三分离

核心契约在 `lib/dsl/index.ts`（纯类型，无 IO，客户端可用）：

- **画布**：1280×720 逻辑坐标，渲染时按容器等比缩放（`use-stage-scale.ts`）
- **场景**：`Scene { id, title, content, actions }`
  - `content` 二选一：`slide`（元素列表）或 `quiz`（选择题）
  - `actions`：`speech`（讲稿）/ `spotlight`（聚光灯）/ `wb_draw` `wb_text` `wb_clear`（白板）
- **元素**：`text` / `image` / `shape`(rect|ellipse|triangle) / `table` / `chart`(横向条形图)
- **主题三分离**（借鉴 ai-ppt-generator）：
  - 内容 = 元素数据；布局 = x/y/w/h 坐标；主题 = `stage.theme` token id
  - `lib/dsl/theme.ts` 定义 `ivory / midnight / mint` 三套 token（bg/text/dim/accent/accentSoft/bgSoft/quiz/quizText）
  - 渲染时 `resolveTheme(stage.theme).tokens` 注入颜色，课堂与导出同源

**normalize + validate**（`normalize.ts` / `validate.ts`）：所有 LLM 输出必须经过归一化（缺字段兜底、非法坐标夹取、scene id 去重）与校验（结构错误→error，可疑→warning）才能入库/播放。

## 4. 生成管道

### 4.1 两阶段

```
阶段一（outline-generator）：主题+要求+参考资料摘要 → N 个 SceneOutline {title, points[4-6]}
阶段二（scene-generator）：逐场景 → 幻灯片元素 + 讲稿 + 白板/聚光灯动作 + 测验场景穿插
```

- JSON 模式输出 + `json-repair.ts` 兜底修复 LLM 的非法 JSON
- 并发控制：worker pool 上限 2，避免打爆供应商
- 演示模式：无 `LLM_API_KEY` 时走 `mock.ts`，全功能可体验

### 4.2 质量门禁（quality-check.ts）

每个场景生成后本地校验：元素重叠 = **error**（触发一次 LLM 自纠重写）、文字缺失/讲稿缺失 = warning。确定性修复优先于 LLM 重试，省调用。

### 4.3 确定性排版引擎（layout.ts）

生成与编辑器共用，三步纯函数：

1. 夹取：所有元素落回 1280×720
2. 自适应：文本高度按内容估算扩展，放不下自动降字号
3. 消重叠：正文按左右栏分组，栏内顺序向下推，标题原位占位

### 4.4 讲稿兜底（ensureSpeech）

LLM 漏产 speech 时按幻灯片文本本地合成讲稿（按句切分、~110 字分组；quiz 用题干+解析），记 warning 提示用户去编辑器润色。外层重试 3 次 + 退避（800ms 起倍增）。

### 4.5 后台任务化（gen-jobs.ts + /api/generate/jobs）★关键设计

**问题**：生成绑定在页面请求上，用户导航离开 → fetch 被 cancel → 前端保存逻辑丢失，任务中断。

**方案**：生成与 HTTP 生命周期解耦——

- `POST /api/generate/jobs` 创建任务（内存表：状态 + 事件 + 结果，30min TTL）立即返回 jobId，生成在服务端独立 async 运行
- **课程保存在服务端任务完成时自动执行**（不再依赖前端）
- 前端 `GET ?id=` 每 1.5s 轮询，全量重放进度事件（幂等）；sessionStorage 记录进行中任务，导航回来自动恢复
- 页面卸载只停轮询，绝不取消服务端任务

## 5. 课堂

`app/classroom/[id]/page.tsx` + `lib/playback/engine.ts` + `lib/action/engine.ts`：

- **播放引擎**：状态机 `idle → playing → paused → scene-done → finished`；按 actions 逐"讲点"推进，每讲点 = 一段讲稿 + 可选特效
- **动作引擎**：speech 用 Web Speech API 朗读（浏览器 TTS，零配置）；spotlight 高亮区域；白板支持画笔（归一化坐标）/文字/清除
- **组件**：`StageArea`（幻灯片+白板+聚光灯+测验层，memo 隔离高频更新）、`ControlBar`（进度/跳转/下载菜单）、`CaptionBar`（字幕）
- **聊天问答**：`ChatPanel` + `/api/chat`，把当前课程上下文发给 LLM 答疑

## 6. 可视化编辑器

`app/edit/[id]/page.tsx` 三栏：场景列表 | 画布 | 属性面板。

- `SlideCanvasEditor.tsx`：与课堂渲染**同源**（同一 SlideRenderer + token），点击选中、拖拽移动、右下角手柄缩放，逻辑坐标精确输入
- 属性面板：文本内容/字号/颜色/加粗、形状、图片 URL、表格与图表数据（JSON 编辑）
- 「整理布局」一键应用确定性排版引擎
- 双保存模式：**保存（含讲解）**原样；**保存（不含讲解）**清空 actions，播放时整页直接显示
- 失败单页重试：占位场景（【占位】前缀）可单独重生成（`/api/generate/scene-retry`），自动携带课程关联的参考资料

## 7. 参考资料管道

`app/api/references` + `lib/server/extract.ts`，提取策略**简单高效优先**：

```
txt/md  → 直接读取（UTF-8 失败自动尝试 GBK）
docx    → mammoth（Word 转 HTML 再抽文本）
pdf     → unpdf（pdf.js）提取文字层
          └─ 文字层稀疏（每页 <20 字符判定为扫描件）→ 降级 PaddleOCR
图片     → 直接 PaddleOCR
```

- 校验：扩展名白名单（txt/md/docx/pdf/png/jpg/webp）+ 20MB 大小限制（413 拦截）
- 结构化入库：全文 `content` + 分页 `pages`（每页字符数），提供按 id 取全文、批量查询
- 生成引用：勾选的参考资料构建摘要（`reference-context.ts`，总预算 12k 字均分截取），注入大纲与场景生成的 system 约束（"数字保持原样、不得编造"）
- OCR 服务：`scripts/paddleocr_server.py`（FastAPI 包装 PaddleOCR，PDF 逐页渲染 150DPI、图片长边 >2000px 降采样、启动即预热、默认 PP-OCRv5 **mobile** 模型）

## 8. 日志模块

`lib/server/logger.ts`：`createLogger(module)` 返回 debug/info/warn/error 四级接口。

- **性能零影响**：调用只入内存有界队列（1000 条，溢出丢 DEBUG）立即返回；2s 定时批量 INSERT（100 条/批）；落库失败仅回退 console，绝不阻塞请求
- 字段：时间戳、级别、模块、描述、detail(JSON)
- 归档：启动 30s 后 + 每 24h 把 30 天前日志迁移到 `logs_archive`
- 查询：`GET /api/logs?level=&module=&q=&from=&to=`；管理页 `app/logs/page.tsx` 支持过滤与 5s 自动刷新
- 埋点：课程创建、资料上传/删除、生成任务启停、LLM 降级、导出

## 9. 导出模块

`lib/export/` + `GET /api/export/[format]?courseId=`，三格式共享 `renderSceneToHtml`（视觉同源）：

| 格式 | 实现 | 要点 |
|---|---|---|
| PPTX | pptxgenjs | 坐标 px→in（÷96，画布恰为 13.333×7.5in）、字号 ×0.75 转 pt；chart 用**原生可编辑图表**；讲稿写 `addNotes`；远程图片抓取转 base64 |
| HTML | 单文件字符串模板 | contenteditable 编辑；「保存编辑」= 从 DOM 读回 → 更新内嵌 JSON script → `outerHTML` 下载自身（闭环：打开→编辑→保存→再打开） |
| PDF | puppeteer-core + **本机 Chrome**（免下载 Chromium，`CHROME_PATH` 可覆盖） | 打印版 HTML（`@page 13.333in 7.5in`）→ `page.pdf`；**必须 `pageRanges:"1-场景数"`** 否则 Chrome 附加尾部空白页（踩坑 #14） |

## 10. 开发历程时间线

1. **脚手架**：create-next-app 拒绝含 doc/ 的目录 → 手动搭建；docker-compose PG 落 5434（5433 被占用）
2. **阶段 1-4 复刻**：DSL + 两阶段生成（mock 兜底）→ 播放/动作引擎 → 编辑器 → PG 持久化 → 聊天问答
3. **借鉴 ai-ppt-generator**：SSE 进度推送（逐场景上屏）、失败单页重试端点、主题三分离（theme token）
4. **视觉去"AI 感"**：去掉紫粉渐变/emoji/回弹动画，serif 标题、发丝分割线、克制配色
5. **内容扩充**：场景 8-12 页、要点 4-6 条、讲稿 ≥500 字；新增历史背景/误区辨析场景类型
6. **可视化增强**：新增表格与横向条形图元素（normalize 消毒 + 主题配色 + visual-first 生成规则）
7. **Bug 修复**：React 重复 key（normalize 去重 + index 复合 key）
8. **参考资料模块**：多格式提取 + PaddleOCR + 结构化存储 + 预览管理页
9. **生成接入参考资料**：摘要注入两阶段 prompt，课程持久化 referenceIds
10. **排版质量**：确定性排版引擎 + 重叠升级为 error 级门禁
11. **可视化编辑器**：画布拖拽/属性面板/整理布局/双保存模式
12. **讲稿兜底**：本地合成 + 重试加固
13. **日志模块** + **模块解耦**（LLMClient 接口注入、barrel 边界）
14. **OCR 深度适配**（见踩坑 #6-9）+ 性能调优（mobile 模型 + 预热，60s→29s）
15. **生成任务后台化**：解决导航中断，服务端自动保存课程
16. **导出模块**：三格式 + Chrome 空白页修复

## 11. 踩坑实录

> 每一条都真实发生过，复刻时值得先读。

1. **create-next-app 拒绝非空目录** — 项目目录含 doc/ 时直接退出。手动脚手架（package.json + next.config + tsconfig + app/）。
2. **沙箱/缓存限制 pnpm** — 设 `npm_config_cache_dir` 指向项目内目录绕开；极端情况外部终端手动装。
3. **LLM 404（@ai-sdk/openai v4）** — 新版默认走 Responses API，部分兼容端点不支持 → 改用 `provider.chat(modelId)` 走 Chat Completions。
4. **PaddleOCR 3.x API 大改** — `show_log`/`use_angle_cls` 参数被移除（报 Unknown argument），改用 `predict()` + `use_textline_orientation`；按版本号双路径兼容 2.x/3.x。
5. **paddlex × langchain 1.x 不兼容** — paddlex 3.3 仍 `from langchain.docstore.document import Document`，langchain 1.x 已删除该路径；首次导入失败 + 二次重试还会撞上"PDX has already been initialized"半初始化状态。解法：脚本内用 `sys.modules` 注入桩模块（`langchain.docstore` / `langchain.text_splitter`），不动用户环境。
6. **Paddle 3.x Windows CPU 崩溃** — `ConvertPirAttribute2RuntimeAttribute not support`（onednn/PIR 执行器 bug），`FLAGS_enable_pir_api=0` 无效（PIR 无法绕过）→ `PaddleOCR(enable_mkldnn=False)` 妥协纯 CPU。
7. **OCR 慢 + 大图超时** — server 大模型纯 CPU 极慢 → 默认换 PP-OCRv5 **mobile** 模型（快 5-10 倍）+ 启动预热 + 长边 2000px 降采样 + PDF 150DPI + 超时提到 300s。
8. **关闭方向分类省时间 → 全是乱码** — `use_textline_orientation=False` 实测对正向文本也输出乱码，必须开启（用每个文本块一次分类的代价换准确率）。
9. **paddlex 模型源连通性检查拖慢启动** — `DISABLE_MODEL_SOURCE_CHECK=True` 跳过。
10. **barrel 把 pg 打进 client bundle** — `lib/generation/index.ts` 被 client 组件导入 → edit/classroom 页 500。约束：客户端只导入 `lib/dsl/*` 与 `layout.ts`。
11. **dev 长驻进程的陈旧模块缓存** — 新增导出函数/路由后报 `X is not a function` 或 404，重启 dev 解决；**服务端模块改动后若未生效，优先怀疑 dev 缓存**。
12. **React 重复 key** — 数据中存在重复 scene id → 双保险：normalize 去重 + 列表渲染 `${i}-${s.id}` 复合 key。
13. **生成任务随页面导航中断** — 见 §4.5，核心是把"保存课程"从前端搬到服务端任务里。
14. **Chrome page.pdf 尾部空白页** — 逐项量测布局完全精确（11×720px 分毫不差）仍多一页空白，是 Chrome 打印管线行为；`pageRanges: "1-场景数"` 硬性限定解决。
15. **pptxgenjs 坐标换算** — 画布 1280×720px 在 96dpi 下恰为 13.333×7.5in；字号 px→pt 乘 0.75。
16. **unpdf/mammoth 打包** — 含动态加载与 worker，必须列入 `serverExternalPackages`。
17. **讲稿缺失导致哑页** — LLM 偶发漏产 speech 且质量门禁重写未采纳 → 本地合成兜底（保证每页必然可讲）。

## 12. 复刻指南

按以下顺序推进，每个里程碑独立可用：

1. **契约先行**：`lib/dsl`（类型 + normalize + validate + theme）+ 单测。这是全项目地基。
2. **mock 生成**：`mock.ts` 产出合法 Stage → 不接 LLM 也能跑通全链路（生成→入库→播放）。
3. **持久化 + 页面骨架**：courses 表、`/api/courses`、首页、课堂页静态渲染。
4. **播放引擎**：先纯状态机（无 TTS），逐讲点推进；再接 Web Speech 与动作特效。
5. **接 LLM**：Vercel AI SDK + json_mode + json-repair；两阶段生成 + 并发控制。
6. **质量与排版**：quality-check 门禁 → layout 确定性排版 → 讲稿兜底。
7. **编辑器**：先只读属性面板，再画布交互（同源渲染是关键，不要另写一套预览）。
8. **参考资料 / 日志 / 导出**：相互独立，任意顺序。
9. **后台任务化**：最后做，把生成从请求生命周期解耦。

贯穿原则：

- **所有 LLM 输出必须过 normalize + validate**，error 触发自纠，永不直接入库
- **演示模式优先**：无 Key 时 mock 兜底，降低体验门槛
- **每步都有单测**，纯函数（DSL/排版/质检）与 IO 严格分离

## 13. 测试策略

`pnpm test`（vitest，67 用例）：

- `dsl.test.ts`：校验/归一化/去重回归
- `layout.test.ts`：重叠分离、标题占位、越界夹取、分栏独立
- `quality-check.test.ts` / `scene-generator.test.ts`：门禁分级、降级路径
- `speech-fallback.test.ts`：本地讲稿合成
- `export.test.ts`：HTML 转义防注入、打印分页、PPTX zip 魔数与部件
- `extract.test.ts`：上传校验、稀疏判定、文本清洗

E2E 手工验证清单：三格式导出页数/部件数、生成中导航离开再回来、OCR 大图识别（29s/1082 字符基准）。

## 14. 部署

### 生产构建

```bash
pnpm build && pnpm start   # 默认 3000，PORT 环境变量可改
```

### 云服务器（Linux + Docker）

1. 安装 Docker + Node 20（或全部容器化）
2. `docker compose up -d` 起数据库（生产务必改密码）
3. 导出 PDF 需要服务器上有 Chrome/Chromium：`apt install chromium` 并设 `CHROME_PATH=/usr/bin/chromium`
4. 应用进程管理：pm2 / systemd / `docker compose` 追加 app 服务均可；反向代理 Nginx + HTTPS
5. OCR 服务（可选）：服务器性能有限时建议不开，或仅在需要时启动
6. 数据备份：`pgdata` 卷定期 `pg_dump`

> 注意：本机 dev 环境的 `.env` 不要提交；生产 `.env` 中 `DATABASE_URL` 指向服务器数据库，`LLM_API_KEY` 用生产 Key。
