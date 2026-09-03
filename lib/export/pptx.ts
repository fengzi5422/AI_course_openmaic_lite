/**
 * PPTX 导出：Stage → pptxgenjs（原生可编辑 PowerPoint）。
 * 坐标换算：画布 1280x720 px（96dpi）→ 幻灯片 13.333x7.5 英寸；字号 px→pt 乘 0.75。
 * 讲稿（speech 动作）写入演讲者备注。
 */
import PptxGenJS from "pptxgenjs";
import { CANVAS_H, CANVAS_W, Scene, Stage } from "@/lib/dsl";
import { resolveTheme } from "@/lib/dsl/theme";

const PAGE_W = CANVAS_W / 96; // 13.333
const PAGE_H = CANVAS_H / 96; // 7.5

function inch(v: number): number {
  return Math.round((v / 96) * 10000) / 10000;
}

function pt(px: number): number {
  return Math.round(px * 0.75 * 10) / 10;
}

async function fetchImageBase64(src: string): Promise<string | null> {
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") ?? "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function renderScene(pptx: PptxGenJS, scene: Scene, tokens: ReturnType<typeof resolveTheme>["tokens"]) {
  const slide = pptx.addSlide();
  slide.background = { color: tokens.bg.replace("#", "") };

  if (scene.content.kind === "quiz") {
    const q = scene.content;
    slide.addText(q.question, {
      x: inch(80), y: inch(90), w: inch(1120), h: inch(80),
      fontSize: pt(36), bold: true, color: tokens.text.replace("#", ""), valign: "top",
    });
    q.options.forEach((opt, i) => {
      const mark = i === q.answerIndex ? "  ✓" : "";
      slide.addText(`${String.fromCharCode(65 + i)}. ${opt}${mark}`, {
        x: inch(80), y: inch(200 + i * 90), w: inch(1120), h: inch(70),
        fontSize: pt(24), color: tokens.text.replace("#", ""),
        fill: { color: tokens.quiz?.replace("#", "") ?? tokens.accentSoft.replace("#", "") },
        valign: "middle", lineSpacingMultiple: 1.1,
      });
    });
    if (q.explanation) {
      slide.addText(`解析：${q.explanation}`, {
        x: inch(80), y: inch(200 + q.options.length * 90 + 10), w: inch(1120), h: inch(60),
        fontSize: pt(18), color: tokens.dim.replace("#", ""), valign: "top",
      });
    }
  } else {
    for (const el of scene.content.elements) {
      switch (el.type) {
        case "text":
          slide.addText(el.content, {
            x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h),
            fontSize: pt(el.fontSize), bold: el.bold ?? false,
            color: el.color.replace("#", ""), valign: "top", align: "left",
            lineSpacingMultiple: 1.15,
          });
          break;
        case "shape": {
          const shapeMap = { rect: "rect", ellipse: "ellipse", triangle: "triangle" } as const;
          slide.addShape(shapeMap[el.shape], {
            x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h),
            fill: { color: el.fill.replace("#", "") }, line: { type: "none" },
          });
          break;
        }
        case "image": {
          const data = await fetchImageBase64(el.src);
          if (data) {
            slide.addImage({ data, x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h) });
          } else {
            slide.addText("[图片加载失败]", {
              x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h),
              fontSize: pt(14), color: "999999", fill: { color: "EEEEEE" }, valign: "middle", align: "center",
            });
          }
          break;
        }
        case "table": {
          const header = el.headers.map((h) => ({
            text: h,
            options: {
              bold: true,
              fill: { color: (el.headerFill ?? tokens.accentSoft).replace("#", "") },
              color: "FFFFFF",
            },
          }));
          const rows = el.rows.map((row, ri) =>
            row.map((cell) => ({
              text: cell,
              options: {
                fill: { color: ri % 2 === 0 ? tokens.bgSoft.replace("#", "") : "FFFFFF" },
                color: tokens.text.replace("#", ""),
              },
            }))
          );
          slide.addTable([header, ...rows] as PptxGenJS.TableRow[], {
            x: inch(el.x), y: inch(el.y), w: inch(el.w),
            fontSize: pt(el.fontSize ?? 18),
            border: { type: "solid", pt: 0.5, color: "BBBBBB" },
            colW: Array.from({ length: el.headers.length }, () => inch(el.w) / el.headers.length),
            valign: "middle",
          });
          break;
        }
        case "chart": {
          // 原生条形图（可编辑数据）
          const max = Math.max(...el.data.map((d) => d.value), 1);
          slide.addChart(
            "bar",
            [
              { name: el.unit ? `${el.unit}` : "数值", labels: el.data.map((d) => d.label), values: el.data.map((d) => d.value) },
            ],
            {
              x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h),
              barDir: "bar",
              chartColors: [el.color?.replace("#", "") ?? tokens.accent.replace("#", "")],
              valAxisMaxVal: Math.ceil(max * 1.1),
              catAxisLabelColor: tokens.text.replace("#", ""),
              valAxisLabelColor: tokens.dim.replace("#", ""),
              dataLabelColor: tokens.text.replace("#", ""),
              showValue: true,
              catAxisLabelFontSize: pt(16), valAxisLabelFontSize: pt(14),
              dataLabelFontSize: pt(14),
            }
          );
          break;
        }
      }
    }
  }

  // 讲稿 → 演讲者备注
  const speech = scene.actions
    .filter((a) => a.type === "speech")
    .map((a) => (a as { type: "speech"; text: string }).text)
    .join("\n");
  if (speech) slide.addNotes(speech);
  return slide;
}

export async function stageToPptxBuffer(stage: Stage): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: PAGE_W, height: PAGE_H });
  pptx.layout = "WIDE";
  pptx.title = stage.title;

  const tokens = resolveTheme(stage.theme).tokens;
  for (const scene of stage.scenes) {
    await renderScene(pptx, scene, tokens);
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as unknown as Buffer;
  return Buffer.from(out);
}
