import { describe, expect, it } from "vitest";
import { Stage } from "@/lib/dsl";
import { buildEditableHtml, buildPrintableHtml, renderSceneToHtml } from "../html";
import { stageToPptxBuffer } from "../pptx";

const stage: Stage = {
  id: "stg_test",
  title: "导出测试课程",
  description: "d",
  version: 1,
  theme: "ivory",
  scenes: [
    {
      id: "sc_1",
      title: "标题页",
      content: {
        kind: "slide",
        elements: [
          { id: "e1", type: "text", content: "你好\n世界", x: 100, y: 80, w: 600, h: 120, fontSize: 32, color: "#1f2937", bold: true },
          { id: "e2", type: "shape", shape: "rect", x: 0, y: 0, w: 1280, h: 60, fill: "#123456" },
          { id: "e3", type: "table", headers: ["名称", "值"], rows: [["A", "1"], ["B", "2"]], x: 80, y: 300, w: 500, h: 160 },
          { id: "e4", type: "chart", chart: "bar", data: [{ label: "甲", value: 30 }, { label: "乙", value: 70 }], x: 640, y: 300, w: 500, h: 240, unit: "%" },
        ],
      },
      actions: [{ type: "speech", text: "这是讲稿内容。" }],
    },
    {
      id: "sc_2",
      title: "测验页",
      content: { kind: "quiz", question: "1+1=?", options: ["2", "3"], answerIndex: 0, explanation: "基础加法" },
      actions: [],
    },
  ],
};

describe("export/html", () => {
  it("可编辑版包含 contenteditable 与自保存运行时", () => {
    const html = buildEditableHtml(stage);
    expect(html).toContain('contenteditable="true"');
    expect(html).toContain('id="stage-data"');
    expect(html).toContain("下载（保存编辑）");
    expect(html).toContain("导出测试课程");
    expect(html.match(/class="scene-page"/g)?.length).toBe(2);
    expect(html).toContain("你好<br>世界");
  });

  it("打印版每场景一页且无编辑属性", () => {
    const html = buildPrintableHtml(stage);
    expect(html.match(/class="sheet"/g)?.length).toBe(2);
    expect(html).not.toContain("contenteditable");
    expect(html).toContain("@page { size: 13.333in 7.5in; margin: 0; }");
  });

  it("表格与图表按数据渲染", () => {
    const tokens = { bg: "#fff", text: "#111", dim: "#666", accent: "#333", accentSoft: "#eee", bgSoft: "#f5f5f5" };
    const sceneHtml = renderSceneToHtml(stage.scenes[0], false, tokens);
    expect(sceneHtml).toContain('data-kind="table"');
    expect(sceneHtml).toContain(">甲<");
    expect(sceneHtml).toContain('data-kind="chart"');
    expect(sceneHtml).toContain("70");
  });

  it("HTML 转义防注入", () => {
    const s: Stage = {
      ...stage,
      scenes: [
        {
          ...stage.scenes[0],
          content: {
            kind: "slide",
            elements: [{ id: "x", type: "text", content: '<script>alert(1)</script>', x: 0, y: 0, w: 100, h: 40, fontSize: 16, color: "#000" }],
          },
        },
      ],
    };
    const html = buildEditableHtml(s);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("export/pptx", () => {
  it("生成合法的 pptx（zip 魔数 + 非空）且包含备注", async () => {
    const buf = await stageToPptxBuffer(stage);
    expect(buf.length).toBeGreaterThan(10000);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    // zip 内应包含幻灯片与备注部件
    const raw = buf.toString("latin1");
    expect(raw).toContain("ppt/slides/slide1.xml");
    expect(raw).toContain("notesSlide");
  }, 30000);
});
