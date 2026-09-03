import { NextResponse } from "next/server";
import {
  generateOutlines,
  buildReferenceContext,
  mockOutlines,
} from "@/lib/generation";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api.generate.outline");

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/generate/outline {topic, requirements?, referenceIds?} → {outlines, warnings, mock} */
export async function POST(req: Request) {
  const started = Date.now();
  try {
    const body = (await req.json()) as {
      topic?: string;
      requirements?: string;
      referenceIds?: string[];
    };
    const topic = (body.topic ?? "").trim();
    if (!topic) {
      return NextResponse.json({ error: "topic 不能为空" }, { status: 400 });
    }
    if (!process.env.LLM_API_KEY) {
      return NextResponse.json({
        outlines: mockOutlines(topic),
        warnings: ["未配置 LLM_API_KEY，本次为内置演示大纲；配置后自动使用真实 AI 生成"],
        mock: true,
      });
    }
    const refCtx = await buildReferenceContext(body.referenceIds);
    log.info("开始生成大纲", { topic, references: refCtx?.names ?? [] });
    const result = await generateOutlines(topic, body.requirements, refCtx);
    log.info("大纲生成完成", { topic, scenes: result.outlines.length, ms: Date.now() - started, warnings: result.warnings.length });
    return NextResponse.json({
      ...result,
      referenceNames: refCtx?.names ?? [],
      mock: false,
    });
  } catch (err) {
    log.error("大纲生成失败", { ms: Date.now() - started, err: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
