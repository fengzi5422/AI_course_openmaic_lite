import { SceneOutline } from "@/lib/dsl";
import { LLMClient, defaultLLM } from "@/lib/ai/provider";
import { parseLooseJson } from "./json-repair";
import { ReferenceContext } from "./reference-context";

const SYSTEM = `你是资深课程设计师与学科专家，任务是为学习者设计一份「结构完整、深度递进、信息密度高」的课程大纲。

## 任务目标
将给定主题拆解为由浅入深的场景序列，为第二阶段的内容生成提供骨架。

## 内容要求
1. 场景数量 8~12 个，遵循认知曲线，典型结构：
   引入(动机与问题) → 核心概念剖析 → 机制/原理深入 → 历史脉络或关键人物 → 真实案例拆解 → 常见误区与辨析 → 进阶应用或跨学科连接 → 随堂测验 → 总结与延伸学习路径。
   （不必全部覆盖，但至少包含：引入、2~3 个概念/原理场景、1 个案例拆解、1 个误区辨析、测验、总结。）
2. 每个场景 4~6 个要点，每个要点必须具体、可展开讲解，禁止空泛表述。
   - 差：「介绍二进制」
   - 好：「二进制的按位权展开机制：为什么 1011 = 11」
3. 每个场景至少包含一个「深入解析」「案例说明」「数据事实」或「背景拓展」类型的要点，为详细讲解预留空间。
4. 案例场景要求要点中给出具体案例名称与可讲解的细节（数字、过程、对比）。
5. 在总结前安排 1 个测验场景（标题含"测验"字样），题目考查核心概念的理解而非记忆。
6. 总结场景的要点应包含「回顾框架」与「延伸学习路径」（推荐进阶主题或阅读方向）。
7. 所有内容使用中文。

## 输出格式
只输出 JSON，不要任何解释或围栏：
{"scenes":[{"title":"场景标题","points":["要点1","要点2"]}]}

## 评估标准
- 核心概念全覆盖且逻辑递进，无断层；
- 要点具体到可以直接展开成 2~3 分钟讲解；
- 深度与广度平衡：既有原理剖析，也有真实案例、数据事实与误区辨析。

## 参考资料（若提供）
- 大纲中的知识点、案例与数据必须优先取自参考资料，忠于其中的表述与数字；
- 资料未覆盖的部分可用通用知识补充，但不得与资料矛盾；
- 资料与主题无关的内容忽略，不强行引用。`;

export interface OutlineResult {
  outlines: SceneOutline[];
  warnings: string[];
}

/** 阶段一：主题 → 可编辑大纲。LLM 输出经 JSON 修复，最多重试 2 次。
 *  llm 参数为依赖注入点（默认 OpenAI 兼容实现，测试可注入假客户端）。 */
export async function generateOutlines(
  topic: string,
  requirements?: string,
  refCtx?: ReferenceContext | null,
  llm: LLMClient = defaultLLM
): Promise<OutlineResult> {
  const warnings: string[] = [];
  let user = `课程主题：${topic}${requirements ? `\n补充要求：${requirements}` : ""}`;
  if (refCtx) {
    user += `\n\n## 参考资料提取（大纲需优先依据以下材料）\n${refCtx.text}`;
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await llm.complete(SYSTEM, user, 0.7, { json: true });
      const parsed = parseLooseJson<{
        scenes?: Array<{ title?: unknown; points?: unknown }>;
      }>(text);
      if (!parsed?.scenes || !Array.isArray(parsed.scenes)) {
        throw new Error("输出中缺少 scenes 数组");
      }
      const outlines: SceneOutline[] = [];
      for (const s of parsed.scenes) {
        const title = typeof s.title === "string" ? s.title : "";
        const points = Array.isArray(s.points)
          ? s.points.map((p) => String(p)).filter(Boolean)
          : [];
        if (title) outlines.push({ title, points });
      }
      if (outlines.length === 0) throw new Error("大纲为空");
      if (outlines.length !== parsed.scenes.length) {
        warnings.push("部分大纲项格式非法，已剔除");
      }
      return { outlines, warnings };
    } catch (err) {
      lastErr = err;
      warnings.push(`大纲生成第 ${attempt + 1} 次尝试失败：${String(err)}`);
    }
  }
  throw new Error(`大纲生成失败（已重试 3 次）：${String(lastErr)}`);
}
