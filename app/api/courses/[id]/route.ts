import { NextResponse } from "next/server";
import { getPool, ensureSchema } from "@/lib/server/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/courses/[id] — 课程完整文档 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const { rows } = await getPool().query(
      `SELECT id, title, doc, reference_ids, revision, created_at, updated_at
       FROM courses WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    }
    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      title: r.title,
      doc: r.doc,
      referenceIds: (r.reference_ids as string[] | null) ?? [],
      revision: r.revision,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** PUT /api/courses/[id] — 更新课程 {title?, doc?}，revision 自增 */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const body = (await req.json()) as { title?: string; doc?: unknown };
    const { rows } = await getPool().query(
      `UPDATE courses SET
         title = COALESCE($2, title),
         doc = COALESCE($3, doc),
         revision = revision + 1,
         updated_at = now()
       WHERE id = $1
       RETURNING revision`,
      [id, body.title ?? null, body.doc ? JSON.stringify(body.doc) : null]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    }
    return NextResponse.json({ revision: rows[0].revision });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE /api/courses/[id] */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const { rowCount } = await getPool().query(`DELETE FROM courses WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
