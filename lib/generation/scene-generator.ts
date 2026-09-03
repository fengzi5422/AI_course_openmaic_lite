import { Scene, SceneOutline, TextElement } from "@/lib/dsl";
import { DEGRADED_SPEECH_PREFIX } from "@/lib/dsl/degraded";
import { normalizeScene } from "@/lib/dsl/normalize";
import { LLMClient, defaultLLM } from "@/lib/ai/provider";
import { parseLooseJson } from "./json-repair";
import {
  SceneIssue,
  applyDeterministicFixes,
  checkScene,
  describeIssues,
  isRepairWorthy,
} from "./quality-check";
import { ReferenceContext } from "./reference-context";

const SYSTEM = `你是 AI 互动课堂的场景生成器，兼具学科专家与金牌讲师双重身份。
任务：根据大纲把单个场景生成为「幻灯片内容 + 讲课动作」，要求内容深入、案例详实、数据具体、讲解生动。

## 任务目标
产出一个可直接播放的教学场景：幻灯片承载知识结构，动作序列还原真实课堂的讲解节奏。

## 内容要求
### 幻灯片（slide 场景）
1. 1 个大标题（fontSize 44-48，bold）+ 可选 1 行导语（20~40 字的点题句，fontSize 22-24，灰色 #6b7280）。
2. 6~10 个内容元素，组成建议（按需取舍，但力求饱满）：
   - 2~4 条核心要点文本（每条 20~60 字，fontSize 24-28）；
   - 1 个「案例说明」块：具体、真实、含数字或过程细节（fontSize 22-26，可用不同颜色区分）；
   - 1 个「数据/事实」块：具体数字、年份、对比或引文（fontSize 22-24）；
   - 1 个「易错点/误区」块：初学者常犯的错误及原因（fontSize 22-24）；
   - 可选 1 个「延伸思考」块：留一个开放问题；
   - 1~3 个 shape 作为视觉分区、强调底色或图形示意。
3. **可视化优先原则**（关键）：凡是内容涉及「数字对比」「多维对比」「流程步骤」「清单结构」，优先用 table / chart 元素呈现，而不是塞进一段文字：
   - 纯数字对比（2~6 项，如百分比、耗时、产量）→ 用 chart 条形图，配 unit 说明单位；
   - 多维对比（如方案 vs 成本/效果、误区 vs 正解、步骤 vs 判据）→ 用 table，表头 2~4 列、行 2~5 行、单元格 ≤14 字；
   - 两者不要同时塞满一页：一页最多 1 个 table 或 1 个 chart，其余用文本与 shape 承载；
   - table/chart 区域必须与文本区完全分离（推荐：左文右图表，或上文下表），元素间不重叠；
   - table 高度估算：行数（含表头）× fontSize × 2.2，需 ≤ h；chart 高度：数据条数 × fontSize × 2.6 ≤ h。
4. 图片使用克制：仅当确有把握提供可访问的图片 URL 时才用 image 元素（每页最多 1 张，w×h ≥ 360×240，放在右栏或底部）；否则用 shape 色块 + 文本替代，禁止编造 URL。
5. 配色协调：正文 #1f2937 / #374151，强调可用 #1d4ed8 / #b45309 / #047857 等，同一场景不超过 3 种强调色；table/chart 优先不指定颜色（自动跟随主题）。
6. 布局约束（画布 1280x720，硬性要求）：所有元素必须完整落在画布内
   （x>=0, y>=0, x+w<=1280, y+h<=720）；文本框尺寸要预留行高余量
   （估算：行数≈每行字数/宽度容量，高度>=行数*fontSize*1.5）。
   **严禁任何两个文本元素相互重叠**：同一栏内各文本块垂直间距 >= 12px；
   shape 仅可作文本底衬或独立图形，不得压在另一文本上；
   table/chart 区域独立放置，四周不与文本交叠。
   推荐分区：标题区 y<200；左栏要点 x 80~660；右栏案例/图表 x 700~1200；底部结论/易错 y>600。

### 讲稿（speech 动作）
7. 每个场景 5~8 段 speech，每段 80~160 字，按「引入设问 → 概念定义 → 深入机制 → 案例验证 → 数据佐证 → 纠偏/延伸 → 小结」推进（按需取舍，但不少于 5 段）。
8. 台词口语化、有节奏感，可设问、可类比、可举反例；与幻灯片当前内容严格呼应，讲到案例块时引用其中的具体数字；讲到 table/chart 时要「读出对比结论」而非逐格念数据。

### 板书与强调（其余动作）
9. 每个场景至少 1 个 wb_text（板书关键词，如「核心公式」「易错点」）或 wb_draw（画流程框/坐标轴/关系连线）。
10. 讲到重点、案例或易错点时使用 spotlight（半径 180~260）聚焦对应区域。
11. 场景结束前用 wb_clear 清理板书（若本场景有板书）。

### 测验（quiz 场景）
12. 大纲含"测验"字样的场景用 quiz：题干给出具体情境，4 个选项含 2 个强干扰项；explanation 必须逐项解释每个错误选项为何错（80~200 字）。

## 输出格式
只输出 JSON：
{
  "content": {
    "kind": "slide" | "quiz",
    "elements": [
      {"type":"text","content":"...","x":80,"y":80,"w":1000,"h":90,"fontSize":48,"color":"#1f2937","bold":true},
      {"type":"shape","shape":"rect|ellipse|triangle","x":0,"y":0,"w":200,"h":120,"fill":"#93c5fd"},
      {"type":"image","src":"https://...","x":800,"y":200,"w":400,"h":300},
      {"type":"table","headers":["环节","耗时","改进后"],"rows":[["选题","90分钟","25分钟"],["写作","180分钟","150分钟"]],"x":690,"y":220,"w":510,"h":240,"fontSize":20},
      {"type":"chart","chart":"bar","data":[{"label":"跳过概念","value":31},{"label":"先学概念","value":78}],"x":700,"y":420,"w":500,"h":180,"unit":"%"}
    ]
  },
  "actions": [
    {"type":"speech","text":"..."},
    {"type":"spotlight","x":640,"y":300,"radius":220,"text":"提示语(可选)"},
    {"type":"wb_draw","points":[[0.3,0.4],[0.5,0.6]],"color":"#f59e0b","width":4},
    {"type":"wb_text","x":0.5,"y":0.5,"text":"关键词","color":"#f59e0b"},
    {"type":"wb_clear"}
  ]
}
quiz 时 content 为：{"kind":"quiz","question":"...","options":["A","B","C","D"],"answerIndex":0,"explanation":"..."}

## 评估标准
- 知识密度：概念有定义、机制有因果、案例有细节、观点有数据；
- 讲解结构：speech 之间逻辑递进，不重复，总讲稿字数不低于 500 字；
- 视觉层次：标题/导语/要点/案例/数据/易错点分区清晰，元素饱满但不拥挤；
- 全部中文。

## 参考资料（若用户提供）
- 案例、数据、事实与关键表述必须优先取自参考资料；资料未覆盖处可用通用知识补充，但不得与资料矛盾；
- 引用资料中的具体数字时保持原样，不四舍五入编造。`;

/** 单页可见输入裁剪（借鉴 prepare_slide_input：上下文越短，越不会混入别页内容） */
function buildUserPrompt(
  outline: SceneOutline,
  index: number,
  total: number,
  repairNotes?: string,
  refCtx?: ReferenceContext | null
): string {
  const points = outline.points
    .map((p, i) => `${i + 1}. ${p.slice(0, 120)}`)
    .join("\n");
  let user = `课程第 ${index + 1}/${total} 个场景。
场景标题：${outline.title}
要点：
${points}`;
  if (refCtx) {
    user += `\n\n## 参考资料提取（本场景案例与数据优先引用）\n${refCtx.text}`;
  }
  if (repairNotes) {
    user += `\n\n## 上一版产出存在以下问题，本次生成必须全部修复：\n${repairNotes}`;
  }
  return user;
}

interface ParseResult {
  scene: Scene;
  parseErr?: unknown;
}

function parseSceneOutput(text: string, outline: SceneOutline): ParseResult {
  const parsed = parseLooseJson<{ content?: unknown; actions?: unknown }>(text);
  if (!parsed) return { scene: null as unknown as Scene, parseErr: new Error("JSON 解析失败") };
  const scene = normalizeScene({
    title: outline.title,
    content: parsed.content,
    actions: parsed.actions,
  });
  return { scene };
}

/* ---------------- 讲稿兜底：LLM 漏产 speech 时本地合成，保证每页可讲 ---------------- */

/** 从场景内容合成讲稿：slide 用标题+文本块按句切分分组；quiz 用题干+解析（导出供测试与编辑器使用） */
export function synthesizeSpeech(scene: Scene): Array<{ type: "speech"; text: string }> {
  if (scene.content.kind === "quiz") {
    const q = scene.content;
    return [{ type: "speech", text: `${q.question} 请先思考再作答。${q.explanation ?? ""}`.trim() }];
  }
  const texts = scene.content.elements.filter((e): e is TextElement => e.type === "text");
  const raw = [scene.title, ...texts.map((t) => t.content)].join(" ");
  const sentences = raw
    .split(/(?<=[。！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 按每段 ~110 字分组成讲解段落，最多 6 段
  const paras: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length > 110) {
      paras.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) paras.push(buf);
  return paras.slice(0, 6).map((text) => ({ type: "speech" as const, text }));
}

/** 后处理：场景缺少 speech 时补本地合成讲稿，并记录 warning（不静默） */
function ensureSpeech(scene: Scene, issues: SceneIssue[]): { scene: Scene; issues: SceneIssue[] } {
  if (scene.actions.some((a) => a.type === "speech")) {
    return { scene, issues };
  }
  const synthesized = synthesizeSpeech(scene);
  if (synthesized.length === 0) return { scene, issues };
  return {
    scene: { ...scene, actions: [...synthesized, ...scene.actions] },
    issues: [
      ...issues,
      {
        level: "warning",
        scope: "actions",
        message: "LLM 未产出讲稿，已由本地按幻灯片内容合成兜底（可在编辑器中润色）",
      },
    ],
  };
}

/** 自纠环生成单场景（借鉴 LangGraph generate→check→repair 回路）：
 * 1. LLM 生成（json_mode 约束）→ 校验；
 * 2. 溢出类 error 先做确定性修复（本地降字号，省一次 LLM 调用）；
 * 3. 仍有 error 时，把问题清单回喂 LLM 重写一轮（MAX_REPAIR_ROUNDS = 1）；
 * 4. warning 不触发重写，只随结果返回供前端提示；
 * 5. 讲稿缺失时本地合成兜底，保证每页可讲。
 * 全程失败时抛错，由调用方降级占位。 */
export async function generateScene(
  outline: SceneOutline,
  index: number,
  total: number,
  refCtx?: ReferenceContext | null,
  llm: LLMClient = defaultLLM
): Promise<{ scene: Scene; issues: SceneIssue[] }> {
  let lastErr: unknown = null;
  // 外层重试 3 次（覆盖网络抖动/解析失败，带退避），内层自纠 1 轮（覆盖质量问题）
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
    try {
      const text = await llm.complete(SYSTEM, buildUserPrompt(outline, index, total, undefined, refCtx), 0.7, {
        json: true,
      });
      const { scene, parseErr } = parseSceneOutput(text, outline);
      if (!scene) throw parseErr;

      // check 节点：结构 + 丰富度校验
      let issues = checkScene(scene, outline);
      let currentScene = scene;

      // 确定性修复：溢出降字号
      if (issues.some(isRepairWorthy)) {
        const fixed = applyDeterministicFixes(scene);
        const rechecked = checkScene(fixed, outline);
        if (rechecked.filter(isRepairWorthy).length < issues.filter(isRepairWorthy).length) {
          issues = rechecked;
          currentScene = fixed;
        }
      }
      const repairable = issues.filter(isRepairWorthy);

      // repair 节点：问题清单回喂 LLM 重写一轮
      if (repairable.length > 0) {
        const repairedText = await llm.complete(
          SYSTEM,
          buildUserPrompt(outline, index, total, describeIssues(repairable), refCtx),
          0.7,
          { json: true }
        );
        const repaired = parseSceneOutput(repairedText, outline);
        if (repaired.scene) {
          const fixed2 = applyDeterministicFixes(repaired.scene);
          const issues2 = checkScene(fixed2, outline);
          // 采纳修复结果当且仅当 error 没有变多
          if (issues2.filter(isRepairWorthy).length <= repairable.length) {
            return ensureSpeech(fixed2, issues2);
          }
        }
      }
      return ensureSpeech(currentScene, issues);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`场景「${outline.title}」生成失败：${String(lastErr)}`);
}

/** 失败场景的占位降级 */
function placeholderScene(outline: SceneOutline): Scene {
  return normalizeScene({
    title: outline.title,
    content: {
      kind: "slide",
      elements: [
        {
          type: "text",
          content: outline.title,
          x: 80,
          y: 80,
          w: 1100,
          h: 90,
          fontSize: 44,
          color: "#1f2937",
          bold: true,
        },
        {
          type: "text",
          content: outline.points.join("\n") || "本场景生成失败，请到编辑器补充。",
          x: 80,
          y: 220,
          w: 1100,
          h: 300,
          fontSize: 26,
          color: "#374151",
        },
      ],
    },
    actions: [{ type: "speech", text: `${DEGRADED_SPEECH_PREFIX}场景「${outline.title}」生成失败，请点击重新生成。` }],
  });
}

export interface SceneGenResult {
  scenes: Scene[];
  /** 生成失败、走了占位降级的场景标题 */
  failed: string[];
  /** 质量门禁的 warning 汇总（error 已在生成内自纠或降级） */
  warnings: string[];
}

/** SSE 进度事件（借鉴参考项目 Redis pub/sub + SSE 的逐页推送） */
export type SceneGenEvent =
  | { type: "scene_done"; index: number; title: string; warnings: string[] }
  | { type: "scene_failed"; index: number; title: string };

/** 流式版本：每页完成/失败即触发 onEvent（供 SSE 推送），返回完整结果。
 *  llm 为依赖注入点（默认 OpenAI 兼容实现）。 */
export async function generateScenesStream(
  outlines: SceneOutline[],
  onEvent?: (ev: SceneGenEvent) => void,
  refCtx?: ReferenceContext | null,
  llm: LLMClient = defaultLLM
): Promise<SceneGenResult> {
  const scenes: Scene[] = new Array(outlines.length);
  const failed: string[] = [];
  const warnings: string[] = [];
  const CONCURRENCY = 2;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= outlines.length) return;
      try {
        const { scene, issues } = await generateScene(outlines[i], i, outlines.length, refCtx, llm);
        scenes[i] = scene;
        const pageWarnings = issues
          .filter((issue) => issue.level === "warning")
          .map((issue) => `「${outlines[i].title}」${issue.scope}：${issue.message}`);
        warnings.push(...pageWarnings);
        onEvent?.({ type: "scene_done", index: i, title: outlines[i].title, warnings: pageWarnings });
      } catch {
        failed.push(outlines[i].title);
        scenes[i] = placeholderScene(outlines[i]);
        onEvent?.({ type: "scene_failed", index: i, title: outlines[i].title });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, outlines.length) }, () => worker())
  );
  return { scenes, failed, warnings };
}

/** 并发生成全部场景：并发度 2（借鉴 ARQ + asyncio.Semaphore 的页级并发），
 *  结果按大纲顺序排列；单页失败降级占位，不影响其他页。 */
export async function generateScenes(
  outlines: SceneOutline[],
  refCtx?: ReferenceContext | null,
  llm: LLMClient = defaultLLM
): Promise<SceneGenResult> {
  return generateScenesStream(outlines, undefined, refCtx, llm);
}

/** 占位场景标记与降级识别已迁移至 lib/dsl/degraded（纯函数，客户端安全），此处 re-export 保持兼容 */
export { DEGRADED_SPEECH_PREFIX, degradedSceneInfo } from "@/lib/dsl/degraded";
