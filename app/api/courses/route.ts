import { NextResponse } from "next/server";
import { getPool, ensureSchema } from "@/lib/server/db";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api.courses");

export const dynamic = "force-dynamic";

/** GET /api/courses — 课程列表（不含 doc 本体） */
export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await getPool().query(
      `SELECT id, title, revision, created_at, updated_at
       FROM courses ORDER BY updated_at DESC`
    );
    return NextResponse.json({
      courses: rows.map((r) => ({
        id: r.id,
        title: r.title,
        revision: r.revision,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** POST /api/courses — 创建课程 {title, doc, referenceIds?} */
export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = (await req.json()) as { title?: string; doc?: unknown; referenceIds?: string[] };
    const title = (body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "title 不能为空" }, { status: 400 });
    }
    if (!body.doc) {
      return NextResponse.json({ error: "doc 不能为空" }, { status: 400 });
    }
    const id = crypto.randomUUID();
    const refIds = Array.isArray(body.referenceIds)
      ? body.referenceIds.filter((v) => typeof v === "string")
      : [];
    await getPool().query(
      `INSERT INTO courses (id, title, doc, reference_ids) VALUES ($1, $2, $3, $4)`,
      [id, title, JSON.stringify(body.doc), refIds.length > 0 ? JSON.stringify(refIds) : null]
    );
    log.info("用户创建课程", { id, title, scenes: Array.isArray((body.doc as { scenes?: unknown[] })?.scenes) ? (body.doc as { scenes: unknown[] }).scenes.length : 0, references: refIds.length });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    log.error("课程创建失败", String(err));
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
