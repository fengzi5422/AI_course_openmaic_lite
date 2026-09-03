import { describe, expect, it } from "vitest";
import { Scene } from "@/lib/dsl";
import { normalizeScene } from "@/lib/dsl/normalize";
import { synthesizeSpeech } from "../scene-generator";

function slideScene(elements: unknown[]): Scene {
  return normalizeScene({ title: "光的波粒二象性", content: { kind: "slide", elements }, actions: [] });
}

describe("synthesizeSpeech 讲稿兜底合成", () => {
  it("slide：从标题与文本块合成多段讲稿", () => {
    const scene = slideScene([
      { type: "text", content: "光的波粒二象性。光既表现出波动性，又表现出粒子性。", x: 80, y: 80, w: 1100, h: 90, fontSize: 44, color: "#1f2937", bold: true },
      { type: "text", content: "案例说明：光电效应证明了光的粒子性。频率低于阈值的光无论多强都无法打出电子。", x: 80, y: 220, w: 1000, h: 120, fontSize: 26, color: "#374151" },
    ]);
    const paras = synthesizeSpeech(scene);
    expect(paras.length).toBeGreaterThanOrEqual(1);
    expect(paras.every((p) => p.type === "speech" && p.text.trim().length > 0)).toBe(true);
    expect(paras[0].text).toContain("波粒二象性");
    expect(paras.map((p) => p.text).join(" ")).toContain("光电效应");
  });

  it("quiz：用题干与解析合成讲稿", () => {
    const scene = normalizeScene({
      title: "随堂测验",
      content: { kind: "quiz", question: "光电效应说明光具有什么性？", options: ["波动性", "粒子性"], answerIndex: 1, explanation: "光电效应证明了光的粒子性。" },
      actions: [],
    });
    const paras = synthesizeSpeech(scene);
    expect(paras).toHaveLength(1);
    expect(paras[0].text).toContain("光电效应");
  });

  it("无文本元素的 slide 仍可用场景标题合成一段讲稿", () => {
    const scene = slideScene([{ type: "shape", shape: "rect", x: 0, y: 0, w: 100, h: 80, fill: "#fff" }]);
    const paras = synthesizeSpeech(scene);
    expect(paras).toHaveLength(1);
    expect(paras[0].text).toContain("光的波粒二象性");
  });

  it("长文本按句分组为多个 ~110 字段落", () => {
    const long = "这是一个测试句子。".repeat(40); // 180 字
    const scene = slideScene([
      { type: "text", content: long, x: 80, y: 220, w: 1000, h: 300, fontSize: 24, color: "#374151" },
    ]);
    const paras = synthesizeSpeech(scene);
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(paras.slice(0, -1).every((p) => p.text.length <= 200)).toBe(true);
  });
});
