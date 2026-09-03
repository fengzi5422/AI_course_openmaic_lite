# openmaic-lite — AI 互动课堂

从零复刻 [OpenMAIC](https://github.com/openmaic/openmaic)（阶段 1-4）并持续增强的 AI 互动课堂应用：输入一个主题，AI 自动生成**带讲稿、板书、聚光灯与测验的互动课件**，在浏览器课堂中逐页"讲课"，并支持可视化编辑与三格式导出。

## 功能总览

| 模块 | 说明 |
|---|---|
| AI 课件生成 | 两阶段生成（大纲 → 逐场景），后台任务化，导航离开不中断；质量门禁 + LLM 自纠重写；讲稿本地合成兜底 |
| 互动课堂 | 播放引擎逐讲点推进：语音朗读（Web Speech）、字幕、白板绘制、聚光灯、选择题互动 |
| 可视化编辑 | 画布拖拽/缩放/属性面板，与课堂渲染同源；支持「整理布局」一键消重叠；可保存"含讲解"或"不含讲解"版本 |
| 参考资料库 | 上传 txt/md/docx/pdf/图片，文字层提取优先，扫描件自动降级 PaddleOCR；结构化入库，生成时勾选引用 |
| 日志中心 | 分级日志（DEBUG/INFO/WARN/ERROR）批量异步落库，按日期归档，管理页实时查询过滤 |
| 课件导出 | **PPTX**（原生可编辑 + 讲稿备注）、**可编辑 HTML**（单文件、contenteditable、自保存）、**PDF**（Chrome 无头精确分页） |

## 技术栈

- **框架**：Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS 4
- **AI**：Vercel AI SDK（OpenAI 兼容接口，DeepSeek / Kimi / GLM / SenseNova 均可）
- **数据**：PostgreSQL 16（Docker）+ `pg`
- **文档解析**：mammoth（docx）· unpdf（pdf.js）· PaddleOCR（可选，扫描件）
- **导出**：pptxgenjs · puppeteer-core（复用本机 Chrome）

## 架构一览

```
app/                     页面与 API 路由（App Router）
  page.tsx               首页：课程列表 + 生成入口（后台任务轮询）
  classroom/[id]         课堂播放页
  edit/[id]              可视化编辑器
  references/  logs/     参考资料库 / 日志中心
  api/generate/jobs      生成任务（与请求生命周期解耦）
  api/export/[format]    HTML / PPTX / PDF 导出
  api/references         参考资料上传与提取
  api/logs               日志查询
components/
  slide-renderer/        幻灯片渲染器（内容/布局/主题三分离）
  classroom/             舞台区、控制条、字幕条
  editor/                画布可视化编辑器
lib/
  dsl/                   数据契约：类型 + 校验 + 归一化 + 主题 token（纯函数，客户端可用）
  generation/            大纲/场景生成器、质量门禁、确定性排版引擎、讲稿兜底
  playback/  action/     播放引擎、动作引擎
  ai/                    LLM 客户端（接口抽象，可注入）
  server/                db、日志、参考资料、生成任务表
  export/                HTML / PPTX / PDF 导出器
scripts/paddleocr_server.py   可选本地 OCR 服务（FastAPI）
```

分层原则：`dsl`（纯契约）→ `generation`（AI 管道）→ `server`（IO）→ `app`（路由）；客户端只允许导入 `lib/dsl` 与 `lib/generation/layout.ts`。

## 快速开始

依赖：Node.js 20+、pnpm（或 npm）、Docker。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 PostgreSQL（端口 5434）
docker compose up -d

# 3. 配置环境变量
cp .env.example .env    # 至少填写 LLM_API_KEY

# 4. 启动
pnpm dev                # http://localhost:3000
```

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | `postgres://openmaic:openmaic@localhost:5434/openmaic` |
| `LLM_API_KEY` | 否* | OpenAI 兼容 Key；未配置时生成走内置演示数据 |
| `LLM_BASE_URL` | 否 | 默认 DeepSeek；可换 Kimi/GLM/SenseNova 等 |
| `LLM_MODEL` | 否 | 模型名，如 `deepseek-chat` |
| `OCR_SERVICE_URL` | 否 | 本地 PaddleOCR 服务地址（扫描件识别） |
| `OCR_TIMEOUT_MS` | 否 | OCR 请求超时，默认 300000 |
| `CHROME_PATH` | 否 | PDF 导出浏览器路径（默认自动探测 Chrome/Edge） |
| `LOG_LEVEL` | 否 | 日志落库最低级别，默认 INFO |

\* 未配置 Key 时所有功能仍可体验（演示数据），配置后自动切换真实生成。

### 可选：扫描件 OCR

图片/扫描版 PDF 的文字识别依赖本地 PaddleOCR 服务（首次运行自动下载模型）：

```bash
pip install "paddlepaddle>=3.0" "paddleocr>=3.0" fastapi python-multipart "pymupdf>=1.24" uvicorn
python scripts/paddleocr_server.py --port 8901
# .env 配置：OCR_SERVICE_URL=http://127.0.0.1:8901/ocr 后重启应用
```

> Windows + PaddleOCR 3.x 的兼容处理（MKLDNN 禁用、langchain 垫片等）已内置在脚本中，详见开发文档「踩坑实录」。

## 测试

```bash
pnpm test    # vitest，覆盖 DSL 校验/归一化、生成器、排版引擎、质量门禁、讲稿兜底、导出等
```

## 部署

生产构建：`pnpm build && pnpm start`。云服务器（阿里云 2C2G Ubuntu）一键部署、Nginx + HTTPS 配置见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

## 开发文档

完整的模块设计、开发历程、踩坑实录与复刻指南见 **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**。

## License

MIT
