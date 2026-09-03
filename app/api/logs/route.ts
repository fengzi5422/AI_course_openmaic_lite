import { NextResponse } from "next/server";
import { LogLevel, queryLogs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const VALID_LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR"]);

/** GET /api/logs?level=WARN&module=api.&q=超时&from=...&to=...&limit=200&offset=0 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const levelParam = url.searchParams.getAll("level").filter((l) => VALID_LEVELS.has(l));
    const level = levelParam.length > 0 ? (levelParam as LogLevel[]) : undefined;
    const result = await queryLogs({
      level,
      module: url.searchParams.get("module") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
