import { NextResponse } from "next/server";
import { generateScene, buildReferenceContext, mockStage } from "@/lib/generation";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api.generate.scene-retry");

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * POST /api/generate/scene-retry {title, points?, referenceIds?} → {scene, warnings, mock?}
 * 对生成失败（占位降级）的单独场景重新生成；points 为可选的大纲要点，
 * referenceIds 为课程关联的参考资料（重试时同样注入，保证内容一致）。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { title?: string; points?: string[]; referenceIds?: string[] };
    const title = (body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "title 不能为空" }, { status: 400 });
    }
    const outline = {
      title,
      points: Array.isArray(body.points) ? body.points.filter((p) => typeof p === "string") : [],
    };

    if (!process.env.LLM_API_KEY) {
      const mock = mockStage(title);
      return NextResponse.json({ scene: mock.scenes[0], warnings: [], mock: true });
    }

    const refCtx = await buildReferenceContext(body.referenceIds);
    log.info("开始重试单场景", { title, references: refCtx?.names ?? [] });
    const { scene, issues } = await generateScene(outline, 0, 1, refCtx);
    const warnings = issues
      .filter((i) => i.level === "warning")
      .map((i) => `「${title}」${i.scope}：${i.message}`);
    log.info("单场景重试完成", { title, warnings: warnings.length });
    return NextResponse.json({ scene, warnings, mock: false });
  } catch (err) {
    log.error("单场景重试失败", String(err));
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
