import { NextResponse } from "next/server";
import { SceneOutline, Stage } from "@/lib/dsl";
import { normalizeStage } from "@/lib/dsl/normalize";
import { validateStage } from "@/lib/dsl/validate";
import {
  buildReferenceContext,
  generateOutlines,
  generateScenesStream,
  mockOutlines,
} from "@/lib/generation";
import { createJob, failJob, finishJob, getJob, pushEvent } from "@/lib/server/gen-jobs";
import { getPool, ensureSchema } from "@/lib/server/db";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api.generate.jobs");

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * POST /api/generate/jobs
 * 创建后台生成任务，立即返回 jobId；任务与服务端请求生命周期解耦，
 * 客户端断开（用户导航离开）不影响生成与自动保存。
 * body:
 *   kind=outline: { topic, requirements?, referenceIds? }
 *   kind=scenes:  { topic, outlines, referenceIds? }   ← outlines 为大纲阶段产物
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      kind?: "outline" | "scenes";
      topic?: string;
      requirements?: string;
      referenceIds?: string[];
      outlines?: SceneOutline[];
    };
    const topic = (body.topic ?? "").trim();
    if (!topic) return NextResponse.json({ error: "topic 不能为空" }, { status: 400 });

    if (body.kind === "outline") {
      const job = createJob("outline", topic);
      void (async () => {
        try {
          if (!process.env.LLM_API_KEY) {
            finishJob(job, {
              outlines: mockOutlines(topic),
              warnings: ["未配置 LLM_API_KEY，本次为内置演示大纲；配置后自动使用真实 AI 生成"],
              mock: true,
              referenceNames: [],
            });
            return;
          }
          const refCtx = await buildReferenceContext(body.referenceIds);
          const result = await generateOutlines(topic, body.requirements, refCtx);
          finishJob(job, {
            outlines: result.outlines,
            warnings: result.warnings,
            mock: false,
            referenceNames: refCtx?.names ?? [],
          });
        } catch (err) {
          failJob(job, err);
        }
      })();
      return NextResponse.json({ jobId: job.id }, { status: 202 });
    }

    if (body.kind === "scenes") {
      const outlines = Array.isArray(body.outlines) ? body.outlines : [];
      if (outlines.length === 0) {
        return NextResponse.json({ error: "outlines 不能为空" }, { status: 400 });
      }
      const job = createJob("scenes", topic);
      void (async () => {
        try {
          const refCtx = await buildReferenceContext(body.referenceIds);
          const result = await generateScenesStream(outlines, (ev) => {
            if (ev.type === "scene_done" || ev.type === "scene_failed") {
              pushEvent(job, ev);
            }
          });
          const stage = normalizeStage({
            title: topic,
            description: `AI 生成的课程：${topic}`,
            scenes: result.scenes,
          }) as Stage;
          const validation = validateStage(stage);
          if (!validation.ok) {
            failJob(job, `生成的课程数据未通过校验：${validation.errors.join("；")}`);
            return;
          }
          // 关键：课程保存移到服务端——客户端断开也不丢结果
          await ensureSchema();
          const id = `crc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const refIds = body.referenceIds ?? [];
          await getPool().query(
            `INSERT INTO courses (id, title, doc, reference_ids) VALUES ($1, $2, $3, $4)`,
            [id, stage.title, JSON.stringify(stage), refIds.length > 0 ? JSON.stringify(refIds) : null]
          );
          log.info("用户创建课程（后台任务）", { id, title: stage.title, scenes: result.scenes.length });
          finishJob(job, { courseId: id, warnings: result.warnings, failed: result.failed, mock: false });
        } catch (err) {
          failJob(job, err);
        }
      })();
      return NextResponse.json({ jobId: job.id }, { status: 202 });
    }

    return NextResponse.json({ error: "kind 必须是 outline 或 scenes" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /api/generate/jobs?id=xxx → 轮询任务状态/进度/结果 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    events: job.events,
    result: job.result ?? null,
    error: job.error ?? null,
    warnings: job.warnings,
    createdAt: job.createdAt,
  });
}
