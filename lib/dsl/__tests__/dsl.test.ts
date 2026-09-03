import { describe, expect, it } from "vitest";
import { normalizeStage } from "../normalize";
import { validateStage } from "../validate";

describe("normalizeStage", () => {
  it("补全缺失 id 与默认值", () => {
    const stage = normalizeStage({
      title: "测试课程",
      scenes: [
        {
          title: "场景一",
          content: { kind: "slide", elements: [{ type: "text", content: "hello" }] },
          actions: [{ type: "speech", text: "大家好" }, { type: "bad_action" }],
        },
      ],
    });
    expect(stage.id).toBeTruthy();
    expect(stage.version).toBe(1);
    expect(stage.scenes[0].id).toBeTruthy();
    expect(stage.scenes[0].content.kind).toBe("slide");
    const el = stage.scenes[0].content.kind === "slide" ? stage.scenes[0].content.elements[0] : null;
    expect(el?.type).toBe("text");
    if (el?.type === "text") expect(el.fontSize).toBe(28);
    expect(stage.scenes[0].actions.length).toBe(1);
  });

  it("quiz 归一化并剔除非法元素", () => {
    const stage = normalizeStage({
      scenes: [
        {
          content: {
            kind: "quiz",
            question: "1+1=?",
            options: ["2", "3"],
            answerIndex: 5,
          },
          actions: [{ type: "wb_draw", points: [[0.1, 0.1]] }, { type: "wb_draw", points: [] }],
        },
      ],
    });
    const c = stage.scenes[0].content;
    expect(c.kind).toBe("quiz");
    if (c.kind === "quiz") expect(c.answerIndex).toBe(1);
    expect(stage.scenes[0].actions.length).toBe(1);
  });

  it("非法输入不抛异常", () => {
    expect(() => normalizeStage(null)).not.toThrow();
    expect(() => normalizeStage({ scenes: "oops" })).not.toThrow();
    const stage = normalizeStage(undefined);
    expect(stage.scenes).toEqual([]);
  });

  it("重复场景 id 自动去重", () => {
    const stage = normalizeStage({
      title: "t",
      scenes: [
        { id: "dup", title: "A", content: { kind: "slide", elements: [] }, actions: [] },
        { id: "dup", title: "B", content: { kind: "slide", elements: [] }, actions: [] },
        { id: "uniq", title: "C", content: { kind: "slide", elements: [] }, actions: [] },
      ],
    });
    const ids = stage.scenes.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("dup");
    expect(ids[2]).toBe("uniq");
  });

  it("table 元素清洗：裁列、剔空行、空表剔除", () => {
    const stage = normalizeStage({
      scenes: [
        {
          title: "t",
          content: {
            kind: "slide",
            elements: [
              {
                type: "table",
                headers: ["A", "B", "C", "D", "E"], // 超过 4 列应裁剪
                rows: [["1", "2", "3", "4", "5"], ["", "", "", "", ""], ["x"]], // 空行剔除、短行补齐
              },
              { type: "table", headers: [], rows: [] }, // 无表头无行 → 剔除
            ],
          },
          actions: [],
        },
      ],
    });
    const els = (stage.scenes[0].content as { elements: Array<{ type: string }> }).elements;
    expect(els.length).toBe(1);
    const t = els[0] as unknown as { headers: string[]; rows: string[][] };
    expect(t.headers).toEqual(["A", "B", "C", "D"]);
    expect(t.rows[0]).toEqual(["1", "2", "3", "4"]);
    expect(t.rows[1]).toEqual(["x"]);
  });

  it("chart 元素清洗：字符串数值转换、非法项剔除", () => {
    const stage = normalizeStage({
      scenes: [
        {
          title: "t",
          content: {
            kind: "slide",
            elements: [
              {
                type: "chart",
                chart: "bar",
                data: [
                  { label: "甲", value: 78 },
                  { label: "乙", value: "31" }, // 数字字符串应转换
                  { label: "丙", value: "abc" }, // 非数字 → 剔除
                  { label: "", value: 5 }, // 空标签 → 剔除
                  { label: "丁", value: -10 }, // 负值收敛为 0
                ],
                unit: "%",
              },
              { type: "chart", chart: "bar", data: [] }, // 空数据 → 剔除
            ],
          },
          actions: [],
        },
      ],
    });
    const els = (stage.scenes[0].content as { elements: Array<{ type: string }> }).elements;
    expect(els.length).toBe(1);
    const c = els[0] as unknown as { data: Array<{ label: string; value: number }>; unit?: string };
    expect(c.data).toEqual([
      { label: "甲", value: 78 },
      { label: "乙", value: 31 },
      { label: "丁", value: 0 },
    ]);
    expect(c.unit).toBe("%");
  });
});

describe("validateStage", () => {
  it("合法课程通过", () => {
    const stage = normalizeStage({
      title: "课程",
      scenes: [
        {
          title: "s1",
          content: { kind: "quiz", question: "q", options: ["a", "b"], answerIndex: 0 },
          actions: [{ type: "speech", text: "x" }],
        },
      ],
    });
    expect(validateStage(stage).ok).toBe(true);
  });

  it("发现缺标题与越界答案", () => {
    const stage = normalizeStage({
      title: "课程",
      scenes: [
        { title: "", content: { kind: "quiz", question: "", options: ["a"], answerIndex: 3 }, actions: [] },
      ],
    });
    const r = validateStage(stage);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
