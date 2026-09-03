import { CANVAS_H, CANVAS_W, Scene, SceneOutline, TextElement } from "@/lib/dsl";
import {
  estimateTextOverflow,
  fitTextElement,
  rectsOverlap,
  relayoutSlideElements,
} from "./layout";

/**
 * 场景质量门禁（借鉴 yuyuanweb/ai-ppt-generator 的 validate_slide + check_slide_richness 思路）：
 * - 结构问题（越界/塌缩/文本重叠/quiz 非法）记为 error，可修复的先做确定性修复，否则回炉 LLM 自纠；
 * - 丰富度问题（文本过短/无案例块/讲稿不足）记为 warning，不阻断、不触发重写。
 *
 * 文本溢出估算与 fitTextElement 已迁移至 layout.ts，此处 re-export 保持兼容。
 */

export { estimateTextOverflow, fitTextElement };

export interface SceneIssue {
  level: "error" | "warning";
  /** 问题描述的定位，如 "文本元素 #3"、"actions" */
  scope: string;
  message: string;
}

/* ---------------- 场景校验 ---------------- */

export function checkScene(scene: Scene, outline?: SceneOutline): SceneIssue[] {
  const issues: SceneIssue[] = [];

  if (scene.actions.length === 0) {
    issues.push({ level: "error", scope: "actions", message: "动作列表为空，场景无法播放" });
  }
  const speeches = scene.actions.filter((a) => a.type === "speech");
  if (speeches.length === 0) {
    issues.push({ level: "error", scope: "actions", message: "缺少 speech 讲稿，场景没有声音内容" });
  }

  if (scene.content.kind === "quiz") {
    const { options, answerIndex, question } = scene.content;
    if (options.length < 2) {
      issues.push({ level: "error", scope: "quiz", message: `测验选项不足（${options.length} 个）` });
    }
    if (answerIndex < 0 || answerIndex >= options.length) {
      issues.push({ level: "error", scope: "quiz", message: `answerIndex=${answerIndex} 越界` });
    }
    if (!question.trim()) {
      issues.push({ level: "error", scope: "quiz", message: "测验题干为空" });
    }
    return issues;
  }

  // slide 内容：结构 + 丰富度
  const { elements } = scene.content;
  if (elements.length < 5) {
    issues.push({ level: "warning", scope: "slide", message: `幻灯片元素过少（${elements.length} 个），内容可能过瘦` });
  }

  const textEls = elements.filter((e): e is TextElement => e.type === "text");
  if (textEls.length === 0) {
    issues.push({ level: "error", scope: "slide", message: "幻灯片没有任何文本元素" });
  }

  elements.forEach((el, i) => {
    const label = `${el.type} #${i}`;
    const out =
      el.x < -4 || el.y < -4 || el.x + el.w > CANVAS_W + 4 || el.y + el.h > CANVAS_H + 4;
    if (out) {
      issues.push({
        level: "error",
        scope: label,
        message: `元素越界（x=${el.x}, y=${el.y}, w=${el.w}, h=${el.h} 超出 ${CANVAS_W}x${CANVAS_H} 画布）`,
      });
    }
    if (el.w <= 0 || el.h <= 0) {
      issues.push({ level: "error", scope: label, message: `元素尺寸非法（w=${el.w}, h=${el.h}）` });
    }
  });

  textEls.forEach((el, i) => {
    if (estimateTextOverflow(el)) {
      issues.push({
        level: "error",
        scope: `text #${i}`,
        message: `文本溢出（fontSize=${el.fontSize} 的内容在 ${el.w}x${el.h} 区域内放不下）`,
      });
    }
  });

  // 文本相互重叠 → error（文字覆盖是排版乱象的主要来源）
  for (let i = 0; i < textEls.length; i++) {
    for (let j = i + 1; j < textEls.length; j++) {
      if (rectsOverlap(textEls[i], textEls[j])) {
        issues.push({
          level: "error",
          scope: `text #${i} × text #${j}`,
          message: `文本元素相互重叠（${textEls[i].content.slice(0, 8)}… 与 ${textEls[j].content.slice(0, 8)}…）`,
        });
      }
    }
  }

  const shortTexts = textEls.filter((e) => !e.bold && e.content.trim().length < 10);
  if (shortTexts.length === textEls.length && textEls.length > 0) {
    issues.push({
      level: "warning",
      scope: "slide",
      message: "全部文本都过短（<10 字），内容可能是标题式短语而非展开讲解",
    });
  }
  const hasCaseOrExt = textEls.some(
    (e) => /案例|例如|比如|拓展|背景|应用|实例/.test(e.content)
  );
  if (!hasCaseOrExt) {
    issues.push({ level: "warning", scope: "slide", message: "缺少案例说明或背景拓展类内容块" });
  }
  if (speeches.length < 4) {
    issues.push({ level: "warning", scope: "actions", message: `讲稿仅 ${speeches.length} 段，讲解深度可能不足` });
  }
  const avgLen = speeches.length
    ? speeches.reduce((acc, s) => acc + (s.type === "speech" ? s.text.length : 0), 0) / speeches.length
    : 0;
  if (speeches.length > 0 && avgLen < 60) {
    issues.push({ level: "warning", scope: "actions", message: `讲稿平均仅 ${Math.round(avgLen)} 字/段，内容偏空` });
  }

  void outline; // 保留参数：未来可按大纲核对要点覆盖率
  return issues;
}

/** 只有 error 级别才回炉重写（warning 只提醒，与参考项目 is_repair_worthy 一致） */
export function isRepairWorthy(issue: SceneIssue): boolean {
  return issue.level === "error";
}

/** 把问题清单转为可回喂给 LLM 的修复指令 */
export function describeIssues(issues: SceneIssue[]): string {
  return issues.map((i) => `- [${i.level}] ${i.scope}：${i.message}`).join("\n");
}

/** 确定性修复：夹取越界 + 文本高度自适应 + 分栏推下消重叠（省一次 LLM 调用） */
export function applyDeterministicFixes(scene: Scene): Scene {
  if (scene.content.kind !== "slide") return scene;
  return {
    ...scene,
    content: {
      ...scene.content,
      elements: relayoutSlideElements(scene.content.elements),
    },
  };
}
