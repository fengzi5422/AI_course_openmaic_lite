import { describe, expect, it } from "vitest";
import { Scene, TextElement } from "@/lib/dsl";
import { normalizeScene } from "@/lib/dsl/normalize";
import {
  applyDeterministicFixes,
  checkScene,
  describeIssues,
  estimateTextOverflow,
  fitTextElement,
  isRepairWorthy,
} from "../quality-check";

function slideScene(overrides?: {
  elements?: unknown[];
  actions?: unknown[];
  content?: unknown;
}) {
  return normalizeScene({
    title: "测试场景",
    content: overrides?.content ?? {
      kind: "slide",
      elements:
        overrides?.elements ?? [
          { type: "text", content: "核心概念解析", x: 80, y: 80, w: 1100, h: 90, fontSize: 44, color: "#1f2937", bold: true },
          { type: "text", content: "案例说明：例如某电商平台通过二分查找将检索耗时从 200ms 降到 20ms，这就是算法复杂度的实际应用背景。", x: 80, y: 220, w: 1000, h: 120, fontSize: 26, color: "#374151" },
        ],
    },
    actions:
      overrides?.actions ?? [
        { type: "speech", text: "我们先从一个具体的案例说起，看看这个概念在真实业务里是怎么落地的，为什么它如此重要。" },
        { type: "speech", text: "深入到机制层面，它的内部原理可以分为三个步骤，每一步都有明确的输入与输出关系。" },
        { type: "speech", text: "通过刚才的例子可以验证，这个机制在极端情况下的表现也符合理论推导的预期结果。" },
        { type: "wb_text", x: 0.5, y: 0.5, text: "核心公式" },
        { type: "wb_clear" },
      ],
  });
}

/** 从归一化后的场景中取第一个 text 元素（测试辅助） */
function firstText(scene: Scene): TextElement {
  if (scene.content.kind !== "slide") throw new Error("not a slide");
  const el = scene.content.elements[0];
  if (el.type !== "text") throw new Error("not a text element");
  return el;
}

describe("estimateTextOverflow / fitTextElement", () => {
  it("短文本不溢出", () => {
    const el = firstText(
      normalizeScene({
        title: "t",
        content: { kind: "slide", elements: [{ type: "text", content: "短文本", x: 0, y: 0, w: 500, h: 60, fontSize: 24, color: "#000" }] },
        actions: [],
      })
    );
    expect(estimateTextOverflow(el)).toBe(false);
  });

  it("长文本溢出，fitTextElement 两阶段修复", () => {
    const content = "很长的中文内容".repeat(60); // 420 字
    const raw = firstText(
      normalizeScene({
        title: "t",
        content: { kind: "slide", elements: [{ type: "text", content, x: 0, y: 0, w: 300, h: 80, fontSize: 32, color: "#000" }] },
        actions: [],
      })
    );
    expect(estimateTextOverflow(raw)).toBe(true);
    const fitted = fitTextElement(raw);
    expect(fitted.fontSize).toBeLessThan(raw.fontSize);
    expect(estimateTextOverflow(fitted)).toBe(false);
  });

  it("极端情况下保底 14px", () => {
    const fitted = fitTextElement(
      firstText(
        normalizeScene({
          title: "t",
          content: { kind: "slide", elements: [{ type: "text", content: "字".repeat(500), x: 0, y: 0, w: 50, h: 20, fontSize: 32, color: "#000" }] },
          actions: [],
        })
      )
    );
    expect(fitted.fontSize).toBe(14);
  });
});

describe("checkScene", () => {
  it("合法场景无 error", () => {
    const issues = checkScene(slideScene());
    expect(issues.filter(isRepairWorthy)).toHaveLength(0);
  });

  it("空动作 → error", () => {
    const issues = checkScene(slideScene({ actions: [] }));
    const errs = issues.filter(isRepairWorthy);
    expect(errs.some((i) => i.scope === "actions")).toBe(true);
  });

  it("缺少 speech → error", () => {
    const issues = checkScene(slideScene({ actions: [{ type: "wb_clear" }] }));
    expect(issues.filter(isRepairWorthy).some((i) => i.message.includes("speech"))).toBe(true);
  });

  it("元素越界 → error", () => {
    const issues = checkScene(
      slideScene({
        elements: [
          { type: "text", content: "出界文本", x: 1200, y: 700, w: 400, h: 100, fontSize: 24, color: "#000" },
        ],
      })
    );
    expect(issues.filter(isRepairWorthy).some((i) => i.message.includes("越界"))).toBe(true);
  });

  it("尺寸非法 → error", () => {
    const issues = checkScene(
      slideScene({
        elements: [{ type: "text", content: "零尺寸文本内容", x: 0, y: 0, w: 0, h: 0, fontSize: 24, color: "#000" }],
      })
    );
    expect(issues.filter(isRepairWorthy).some((i) => i.message.includes("尺寸非法"))).toBe(true);
  });

  it("文本溢出 → error，且 applyDeterministicFixes 能消除", () => {
    const content = "很长的中文内容".repeat(60);
    const scene = slideScene({
      elements: [{ type: "text", content, x: 0, y: 0, w: 300, h: 80, fontSize: 32, color: "#000" }],
    });
    expect(checkScene(scene).filter(isRepairWorthy).some((i) => i.message.includes("溢出"))).toBe(true);
    const fixed = applyDeterministicFixes(scene);
    expect(checkScene(fixed).filter(isRepairWorthy).some((i) => i.message.includes("溢出"))).toBe(false);
  });

  it("quiz 非法 answerIndex → error", () => {
    // 直接构造（绕过 normalizeScene 的 answerIndex 钳制），模拟上游漏网数据
    const scene = {
      id: "s1",
      title: "t",
      content: { kind: "quiz", question: "题干", options: ["A", "B"], answerIndex: 5, explanation: "" },
      actions: [{ type: "speech", text: "讲稿" }],
    } as unknown as Scene;
    const issues = checkScene(scene);
    expect(issues.filter(isRepairWorthy).some((i) => i.message.includes("answerIndex"))).toBe(true);
  });

  it("内容过瘦 → warning 不回炉", () => {
    const issues = checkScene(
      slideScene({
        elements: [{ type: "text", content: "要点", x: 0, y: 0, w: 500, h: 60, fontSize: 24, color: "#000", bold: true }],
      })
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.level === "warning" && i.message.includes("过瘦"))).toBe(true);
  });

  it("describeIssues 输出可读清单", () => {
    const text = describeIssues([{ level: "error", scope: "text #0", message: "文本溢出" }]);
    expect(text).toBe("- [error] text #0：文本溢出");
  });
});
