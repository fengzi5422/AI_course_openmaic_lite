import { NextResponse } from "next/server";
import { extractFile, validateUpload, MAX_FILE_SIZE } from "@/lib/server/extract";
import { insertReference, listReferences } from "@/lib/server/references";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("references");

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/references — 参考资料列表（含 300 字预览，不含全文） */
export async function GET(req: Request) {
  try {
    const courseId = new URL(req.url).searchParams.get("courseId") ?? undefined;
    const items = await listReferences(courseId || undefined);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** POST /api/references — 上传并提取（multipart，字段名 file；可选 courseId） */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求必须是 multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `文件超过大小限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）` },
      { status: 413 }
    );
  }
  const v = validateUpload(file.name, file.size);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await extractFile(buffer, file.name);
    const record = await insertReference({
      courseId: (form.get("courseId") as string) || null,
      filename: file.name,
      ext: v.ext,
      mime: file.type || null,
      sizeBytes: file.size,
      status: result.status,
      method: result.method,
      charCount: result.charCount,
      pageCount: result.pageCount,
      content: result.text,
      pages: result.pages.length > 0 ? result.pages : null,
      message: result.message ?? null,
    });
    log.info("用户上传参考资料", { id: record.id, filename: file.name, ext: v.ext, size: file.size, status: result.status, method: result.method, chars: result.charCount });
    return NextResponse.json({
      id: record.id,
      filename: record.filename,
      ext: record.ext,
      status: record.status,
      method: record.method,
      charCount: record.charCount,
      pageCount: record.pageCount,
      message: record.message,
      preview: record.content.slice(0, 300),
      createdAt: record.createdAt,
    });
  } catch (err) {
    log.error("参考资料处理失败", String(err));
    return NextResponse.json({ error: `处理失败：${String(err)}` }, { status: 500 });
  }
}
