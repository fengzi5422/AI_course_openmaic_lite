import { NextResponse } from "next/server";
import { deleteReference, getReference } from "@/lib/server/references";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/references/[id] — 完整记录（含全文与分页数据） */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const record = await getReference(id);
    if (!record) {
      return NextResponse.json({ error: "参考资料不存在" }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE /api/references/[id] */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const ok = await deleteReference(id);
    if (!ok) {
      return NextResponse.json({ error: "参考资料不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
