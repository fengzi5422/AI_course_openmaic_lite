import { NextResponse } from "next/server";
import { Stage } from "@/lib/dsl";
import { getPool, ensureSchema } from "@/lib/server/db";
import { createLogger } from "@/lib/server/logger";
import { buildEditableHtml } from "@/lib/export/html";
import { stageToPptxBuffer } from "@/lib/export/pptx";
import { stageToPdfBuffer } from "@/lib/export/pdf";

const log = createLogger("api.export");

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** RFC 5987：中文文件名 */
function contentDisposition(name: string, ext: string): string {
  const ascii = `slides-${Date.now().toString(36)}.${ext}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}.${ext}`;
}

async function loadStage(courseId: string): Promise<Stage | null> {
  await ensureSchema();
  const { rows } = await getPool().query(`SELECT title, doc FROM courses WHERE id = $1`, [courseId]);
  return rows.length === 0 ? null : (rows[0].doc as Stage);
}

/** GET /api/export/[format]?courseId=xxx → html | pptx | pdf */
export async function GET(req: Request, ctx: { params: Promise<{ format: string }> }) {
  const { format } = await ctx.params;
  const courseId = new URL(req.url).searchParams.get("courseId");
  if (!courseId) return NextResponse.json({ error: "缺少 courseId" }, { status: 400 });

  try {
    const stage = await loadStage(courseId);
    if (!stage) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    const safeName = (stage.title || "slides").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

    if (format === "html") {
      const html = buildEditableHtml(stage);
      log.info("导出 HTML", { courseId, title: stage.title });
      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": contentDisposition(safeName, "html"),
        },
      });
    }

    if (format === "pptx") {
      const buf = await stageToPptxBuffer(stage);
      log.info("导出 PPTX", { courseId, title: stage.title, scenes: stage.scenes.length });
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": contentDisposition(safeName, "pptx"),
        },
      });
    }

    if (format === "pdf") {
      const buf = await stageToPdfBuffer(stage);
      log.info("导出 PDF", { courseId, title: stage.title, scenes: stage.scenes.length });
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition(safeName, "pdf"),
        },
      });
    }

    return NextResponse.json({ error: "format 必须是 html / pptx / pdf" }, { status: 400 });
  } catch (err) {
    log.error("导出失败", { format, courseId, err: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
