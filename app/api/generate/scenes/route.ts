import { NextResponse } from "next/server";
import { SceneOutline } from "@/lib/dsl";
import {
  generateScenesStream,
  buildReferenceContext,
  mockStage,
} from "@/lib/generation";
import { normalizeStage } from "@/lib/dsl/normalize";
import { validateStage } from "@/lib/dsl/validate";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api.generate.scenes");

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * POST /api/generate/scenes {topic, outlines, referenceIds?, stream?}
 * - stream=false（默认）→ JSON {stage, failed, warnings, mock}
 * - stream=true → SSE：逐场景推送 scene_done / scene_failed，
 *   结束时推送 done（携带完整 stage，与 JSON 响应字段一致）
 */
export async function POST(req: Request) {
  let body: { topic?: string; outlines?: SceneOutline[]; referenceIds?: string[]; stream?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const topic = (body.topic ?? "").trim();
  const outlines = body.outlines;
  if (!topic) {
    return NextResponse.json({ error: "topic 不能为空" }, { status: 400 });
  }
  if (!Array.isArray(outlines) || outlines.length === 0) {
    return NextResponse.json({ error: "outlines 不能为空" }, { status: 400 });
  }

  // 无 Key：演示模式（与 stream 无关，直接 JSON 返回）
  if (!process.env.LLM_API_KEY) {
    return NextResponse.json({ stage: mockStage(topic), failed: [], warnings: [], mock: true });
  }

  const refCtx = await buildReferenceContext(body.referenceIds);
  const started = Date.now();
  log.info("开始生成场景", { topic, scenes: outlines.length, stream: body.stream === true, references: refCtx?.names ?? [] });

  if (!body.stream) {
    try {
      const result = await generateScenesStream(outlines, undefined, refCtx);
      const stage = normalizeStage({
        title: topic,
        description: `AI 生成的课程：${topic}`,
        scenes: result.scenes,
      });
      const validation = validateStage(stage);
      if (!validation.ok) {
        return NextResponse.json(
          { error: `生成的课程数据未通过校验：${validation.errors.join("；")}` },
          { status: 500 }
        );
      }
      return NextResponse.json({ stage, failed: result.failed, warnings: result.warnings, mock: false });
    } catch (err) {
      log.error("场景生成失败（非流式）", { topic, ms: Date.now() - started, err: String(err) });
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // SSE 流式：借鉴参考项目 pub/sub + SSE 的逐页推送，每页完成即推送
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        const result = await generateScenesStream(outlines, (ev) => {
          if (ev.type === "scene_done" || ev.type === "scene_failed") {
            log.info(ev.type === "scene_done" ? "单场景完成" : "单场景失败（降级占位）", {
              topic,
              index: (ev as { index?: number }).index,
              title: (ev as { title?: string }).title,
            });
          }
          send(ev);
        });
        const stage = normalizeStage({
          title: topic,
          description: `AI 生成的课程：${topic}`,
          scenes: result.scenes,
        });
        const validation = validateStage(stage);
        if (!validation.ok) {
          log.error("生成的课程数据未通过校验", { topic, errors: validation.errors });
          send({ type: "error", error: `生成的课程数据未通过校验：${validation.errors.join("；")}` });
        } else {
          log.info("场景生成完成", { topic, scenes: result.scenes.length, failed: result.failed.length, ms: Date.now() - started });
          send({
            type: "done",
            stage,
            failed: result.failed,
            warnings: result.warnings,
            mock: false,
          });
        }
      } catch (err) {
        log.error("场景生成失败（流式）", { topic, ms: Date.now() - started, err: String(err) });
        send({ type: "error", error: String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
