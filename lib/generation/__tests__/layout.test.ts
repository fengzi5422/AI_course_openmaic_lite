import { describe, expect, it } from "vitest";
import { normalizeScene } from "@/lib/dsl/normalize";
import { CANVAS_W, CANVAS_H, TextElement } from "@/lib/dsl";
import { relayoutSlideElements, rectsOverlap } from "../layout";
import { applyDeterministicFixes, checkScene, isRepairWorthy } from "../quality-check";

function makeText(overrides: Partial<TextElement>): TextElement {
  return {
    id: `el_${Math.random().toString(36).slice(2, 8)}`,
    type: "text",
    content: "这是一段足够长的正文文本，用于占位测试排版逻辑。",
    x: 80,
    y: 80,
    w: 500,
    h: 60,
    fontSize: 24,
    color: "#1f2937",
    ...overrides,
  };
}

describe("rectsOverlap", () => {
  it("相交与容差判定", () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 25, w: 100, h: 50 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 54, w: 100, h: 50 }, 4)).toBe(false);
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 52, w: 100, h: 50 }, 4)).toBe(true);
  });
});

describe("relayoutSlideElements", () => {
  it("重叠的正文文本被推下分离", () => {
    const els = [
      makeText({ content: "标题", bold: true, fontSize: 44, y: 60, h: 80 }),
      makeText({ y: 100, h: 120 }), // 与标题重叠
      makeText({ y: 180, h: 120 }), // 与上一块重叠
    ];
    const out = relayoutSlideElements(els) as TextElement[];
    const body = out.slice(1) as TextElement[];
    for (let i = 0; i < body.length; i++) {
      for (let j = i + 1; j < body.length; j++) {
        expect(rectsOverlap(body[i], body[j])).toBe(false);
      }
    }
  });

  it("标题保持原位，正文被推到标题之下", () => {
    const els = [
      makeText({ content: "标题", bold: true, fontSize: 44, x: 80, y: 60, h: 80 }),
      makeText({ x: 80, y: 90, h: 100 }),
    ];
    const out = relayoutSlideElements(els) as TextElement[];
    expect(out[0].y).toBe(60);
    expect(out[1].y).toBeGreaterThanOrEqual(60 + 80);
  });

  it("越界元素被夹取回画布", () => {
    const els = [
      makeText({ x: 2000, y: 2000, w: 900, h: 900 }),
      makeText({ x: -500, y: -500, w: 100, h: 50, content: "负坐标文本" }),
    ];
    const out = relayoutSlideElements(els);
    for (const el of out) {
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.x + el.w).toBeLessThanOrEqual(CANVAS_W);
      expect(el.y + el.h).toBeLessThanOrEqual(CANVAS_H);
    }
  });

  it("同栏正文纵向排列，另一栏不受牵连", () => {
    const els = [
      makeText({ x: 80, y: 60, h: 100 }),
      makeText({ x: 100, y: 100, h: 100 }), // 左栏重叠
      makeText({ x: 700, y: 60, h: 100 }), // 右栏独立
    ];
    const out = relayoutSlideElements(els) as TextElement[];
    // 左栏第一块被推下，右栏位置不动
    expect(out[0].y).toBe(60);
    expect(out[1].y).toBeGreaterThanOrEqual(160);
    expect(out[2].y).toBe(60);
  });
});

describe("checkScene 重叠检测 + applyDeterministicFixes 联动", () => {
  it("重叠文本报 error，确定性修复后消除", () => {
    const scene = normalizeScene({
      title: "t",
      content: {
        kind: "slide",
        elements: [
          { type: "text", content: "标题文本", x: 80, y: 60, w: 1100, h: 80, fontSize: 44, color: "#1f2937", bold: true },
          { type: "text", content: "第一段要点内容较长一些用于测试。", x: 80, y: 90, w: 500, h: 120, fontSize: 24, color: "#374151" },
          { type: "text", content: "第二段要点内容同样较长用于测试。", x: 90, y: 150, w: 500, h: 120, fontSize: 24, color: "#374151" },
        ],
      },
      actions: [
        { type: "speech", text: "这是一段足够长的讲稿内容，用于通过讲稿相关的检查逻辑，字数必须超过六十个字符以上才能满足平均长度的要求。" },
        { type: "speech", text: "第二段讲稿同样需要足够长的内容来满足质量门禁对平均长度的检查要求，这里继续补充一些字数。" },
        { type: "speech", text: "第三段讲稿保持相同的长度水平，确保整体检查不会因为讲稿过短而出现额外的警告信息干扰断言。" },
        { type: "speech", text: "第四段讲稿继续补充内容，保证讲稿数量达到四段以上的要求，同时每段都维持在六十个字符以上。" },
      ],
    });
    expect(checkScene(scene).filter(isRepairWorthy).some((i) => i.message.includes("相互重叠"))).toBe(true);
    const fixed = applyDeterministicFixes(scene);
    expect(checkScene(fixed).filter(isRepairWorthy).some((i) => i.message.includes("相互重叠"))).toBe(false);
  });
});
