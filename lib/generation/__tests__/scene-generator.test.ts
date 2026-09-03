import { beforeEach, describe, expect, it, vi } from "vitest";
import { SceneOutline } from "@/lib/dsl";

vi.mock("@/lib/ai/provider", () => {
  const callLLM = vi.fn();
  return {
    resolveModel: vi.fn(),
    callLLM,
    // DI 默认客户端与 callLLM 共享同一 mock，生成器走 llm.complete
    defaultLLM: { complete: callLLM },
  };
});

import { callLLM } from "@/lib/ai/provider";
import {
  DEGRADED_SPEECH_PREFIX,
  degradedSceneInfo,
  generateScene,
  generateScenes,
  generateScenesStream,
} from "../scene-generator";
import { normalizeScene } from "@/lib/dsl/normalize";

const mockedCall = vi.mocked(callLLM);

const outline: SceneOutline = {
  title: "二进制的按位权展开",
  points: ["按位权展开机制：为什么 1011 = 11", "与十进制的对应关系"],
};

/** 构造能通过质量门禁的合法场景 JSON */
function goodPayload(): string {
  return JSON.stringify({
    content: {
      kind: "slide",
      elements: [
        { type: "text", content: "二进制的按位权展开", x: 80, y: 80, w: 1100, h: 90, fontSize: 44, color: "#1f2937", bold: true },
        { type: "text", content: "案例说明：例如 1011 从右往左按 2 的幂展开求和得到 11，这是所有位运算与浮点表示的背景基础。", x: 80, y: 220, w: 1000, h: 120, fontSize: 26, color: "#374151" },
      ],
    },
    actions: [
      { type: "speech", text: "我们先从一个具体的例子说起：把 1011 从右往左逐位乘以 2 的幂再求和，就能得到十进制的 11。" },
      { type: "speech", text: "深入一层看，按位权展开的本质是多项式求值，每一位的权重由它距离最低位的距离决定。" },
      { type: "speech", text: "用刚才的例子验证：1x8 + 0x4 + 1x2 + 1x1 = 11，与直接换算的结果完全一致，说明机制成立。" },
      { type: "wb_text", x: 0.5, y: 0.5, text: "按位权展开" },
      { type: "wb_clear" },
    ],
  });
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("generateScene", () => {
  it("正常输出：一次调用通过门禁", async () => {
    mockedCall.mockResolvedValue(goodPayload());
    const { scene, issues } = await generateScene(outline, 0, 6);
    expect(scene.title).toBe(outline.title);
    expect(scene.content.kind).toBe("slide");
    expect(scene.actions.length).toBeGreaterThan(0);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it("溢出文本被确定性修复，不触发第二次 LLM 调用", async () => {
    const payload = JSON.stringify({
      content: {
        kind: "slide",
        elements: [
          { type: "text", content: "标题", x: 80, y: 80, w: 1100, h: 90, fontSize: 44, color: "#1f2937", bold: true },
          { type: "text", content: "案例：很长的中文内容".repeat(40), x: 80, y: 220, w: 300, h: 60, fontSize: 28, color: "#374151" },
        ],
      },
      actions: [
        { type: "speech", text: "这是一段足够长的讲稿内容，用来满足讲稿校验的最低长度要求，避免触发警告或错误。" },
        { type: "speech", text: "这是第二段足够长的讲稿内容，用来满足讲稿校验的最低长度要求，避免触发警告或错误。" },
        { type: "speech", text: "这是第三段足够长的讲稿内容，用来满足讲稿校验的最低长度要求，避免触发警告或错误。" },
      ],
    });
    mockedCall.mockResolvedValue(payload);
    const { scene, issues } = await generateScene(outline, 0, 6);
    expect(issues.filter((i) => i.level === "error").some((i) => i.message.includes("溢出"))).toBe(false);
    expect(scene.content.kind === "slide" && scene.content.elements.some((e) => e.type === "text" && e.fontSize < 28)).toBe(true);
    expect(mockedCall).toHaveBeenCalledTimes(1); // 本地修复，省一次 LLM
  });

  it("结构 error 触发自纠：问题清单回喂重写一轮", async () => {
    // 第一版：无 speech（error，确定性修复无法解决）
    const bad = JSON.stringify({
      content: { kind: "slide", elements: [{ type: "text", content: "只有标题的场景", x: 80, y: 80, w: 1100, h: 90, fontSize: 44, color: "#000", bold: true }] },
      actions: [{ type: "wb_clear" }],
    });
    mockedCall
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(goodPayload()); // 修复版
    const { scene, issues } = await generateScene(outline, 0, 6);
    expect(mockedCall).toHaveBeenCalledTimes(2);
    // 修复指令确实回喂给了 LLM
    const repairPrompt = mockedCall.mock.calls[1][1] as string;
    expect(repairPrompt).toContain("必须全部修复");
    expect(repairPrompt).toContain("speech");
    expect(scene.actions.some((a) => a.type === "speech")).toBe(true);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("修复版更差时保留原版（采纳条件：error 不变多）", async () => {
    const bad = JSON.stringify({
      content: { kind: "slide", elements: [{ type: "text", content: "只有标题的场景", x: 80, y: 80, w: 1100, h: 90, fontSize: 44, color: "#000", bold: true }] },
      actions: [{ type: "wb_clear" }],
    });
    const worse = JSON.stringify({ content: { kind: "quiz", question: "", options: [], answerIndex: 9 } });
    mockedCall.mockResolvedValueOnce(bad).mockResolvedValueOnce(worse);
    const { scene } = await generateScene(outline, 0, 6);
    expect(scene.content.kind).toBe("slide"); // 未被更差的版本替换
    expect(mockedCall).toHaveBeenCalledTimes(2);
  });

  it("JSON 解析失败自动重试", async () => {
    mockedCall
      .mockResolvedValueOnce("这不是 JSON")
      .mockResolvedValueOnce(goodPayload());
    const { scene } = await generateScene(outline, 0, 6);
    expect(scene.content.kind).toBe("slide");
    expect(mockedCall).toHaveBeenCalledTimes(2);
  });

  it("持续失败则抛错", async () => {
    mockedCall.mockRejectedValue(new Error("网络超时"));
    await expect(generateScene(outline, 0, 6)).rejects.toThrow("生成失败");
  });
});

describe("generateScenes（页级并发）", () => {
  it("结果按大纲顺序排列，单页失败降级占位", async () => {
    mockedCall.mockImplementation(async (_sys, user) => {
      if (String(user).includes("场景二")) throw new Error("第 2 页挂了");
      return goodPayload();
    });
    const outlines: SceneOutline[] = [
      { title: "场景一", points: ["p1"] },
      { title: "场景二", points: ["p2"] },
      { title: "场景三", points: ["p3"] },
    ];
    const { scenes, failed, warnings } = await generateScenes(outlines);
    expect(scenes.map((s) => s.title)).toEqual(["场景一", "场景二", "场景三"]);
    expect(failed).toEqual(["场景二"]);
    expect(scenes[1].content.kind === "slide" && scenes[1].content.elements.length).toBeGreaterThan(0); // 占位场景
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("并发度不超过 2", async () => {
    let inflight = 0;
    let maxInflight = 0;
    mockedCall.mockImplementation(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight--;
      return goodPayload();
    });
    const outlines: SceneOutline[] = Array.from({ length: 5 }, (_, i) => ({
      title: `场景${i}`,
      points: ["p"],
    }));
    const { scenes } = await generateScenes(outlines);
    expect(scenes).toHaveLength(5);
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxInflight).toBeGreaterThan(1); // 确实并发了
  });
});

describe("generateScenesStream（SSE 事件流）", () => {
  it("每页完成即触发 scene_done，携带 warning；顺序正确", async () => {
    const events: Array<{ type: string; index: number; warnings?: string[] }> = [];
    mockedCall.mockResolvedValue(goodPayload());
    const result = await generateScenesStream(
      [
        { title: "A", points: ["p"] },
        { title: "B", points: ["p"] },
        { title: "C", points: ["p"] },
      ],
      (ev) => events.push(ev as { type: string; index: number })
    );
    expect(events.map((e) => e.type)).toEqual(["scene_done", "scene_done", "scene_done"]);
    expect(events.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(result.scenes.map((s) => s.title)).toEqual(["A", "B", "C"]);
  });

  it("失败页触发 scene_failed", async () => {
    const events: Array<{ type: string; index: number }> = [];
    mockedCall.mockImplementation(async (_sys, user) => {
      if (String(user).includes("会挂")) throw new Error("挂");
      return goodPayload();
    });
    const result = await generateScenesStream(
      [
        { title: "会挂", points: ["p"] },
        { title: "正常", points: ["p"] },
      ],
      (ev) => events.push(ev as { type: string; index: number })
    );
    expect(events.filter((e) => e.type === "scene_failed").map((e) => e.index)).toEqual([0]);
    expect(events.filter((e) => e.type === "scene_done").map((e) => e.index)).toEqual([1]);
    expect(result.failed).toEqual(["会挂"]);
  });
});

describe("degradedSceneInfo（占位场景识别）", () => {
  it("识别占位场景并提取标题与要点", () => {
    const scene = normalizeScene({
      title: "挂掉的场景",
      content: {
        kind: "slide",
        elements: [
          { type: "text", content: "挂掉的场景", x: 80, y: 80, w: 1100, h: 90, fontSize: 44, color: "#000", bold: true },
          { type: "text", content: "要点一\n要点二", x: 80, y: 220, w: 1100, h: 300, fontSize: 26, color: "#333" },
        ],
      },
      actions: [{ type: "speech", text: `${DEGRADED_SPEECH_PREFIX}场景「挂掉的场景」生成失败，请点击重新生成。` }],
    });
    expect(degradedSceneInfo(scene)).toEqual({ title: "挂掉的场景", points: ["要点一", "要点二"] });
  });

  it("正常场景不误判", () => {
    mockedCall.mockResolvedValue(goodPayload());
    return generateScene(outline, 0, 6).then(({ scene }) => {
      expect(degradedSceneInfo(scene)).toBeNull();
    });
  });
});
