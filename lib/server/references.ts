import { genId } from "@/lib/dsl/normalize";
import { ExtractedPage } from "./extract";
import { getPool } from "./db";

/**
 * 参考资料结构化存储：
 * - 全文 content + 分页 pages（含每页字符数），供生成/问答后续按需引用
 * - 提供按 id 取全文、按课程维度列出等便捷读取接口
 */

let refSchemaReady: Promise<void> | null = null;

export function ensureReferenceSchema(): Promise<void> {
  if (!refSchemaReady) {
    refSchemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS reference_files (
          id text PRIMARY KEY,
          course_id text,
          filename text NOT NULL,
          ext text NOT NULL,
          mime text,
          size_bytes bigint NOT NULL,
          status text NOT NULL,
          method text,
          char_count integer NOT NULL DEFAULT 0,
          page_count integer,
          content text NOT NULL DEFAULT '',
          pages jsonb,
          message text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch((err) => {
      refSchemaReady = null;
      throw err;
    });
  }
  return refSchemaReady;
}

export interface ReferenceRecord {
  id: string;
  courseId: string | null;
  filename: string;
  ext: string;
  mime: string | null;
  sizeBytes: number;
  status: string;
  method: string | null;
  charCount: number;
  pageCount: number | null;
  content: string;
  pages: ExtractedPage[] | null;
  message: string | null;
  createdAt: string;
}

/** 列表视图：不带全文，只带 300 字预览 */
export interface ReferenceListItem {
  id: string;
  courseId: string | null;
  filename: string;
  ext: string;
  sizeBytes: number;
  status: string;
  method: string | null;
  charCount: number;
  pageCount: number | null;
  message: string | null;
  preview: string;
  createdAt: string;
}

function rowToRecord(r: Record<string, unknown>): ReferenceRecord {
  return {
    id: String(r.id),
    courseId: (r.course_id as string | null) ?? null,
    filename: String(r.filename),
    ext: String(r.ext),
    mime: (r.mime as string | null) ?? null,
    sizeBytes: Number(r.size_bytes),
    status: String(r.status),
    method: (r.method as string | null) ?? null,
    charCount: Number(r.char_count),
    pageCount: r.page_count == null ? null : Number(r.page_count),
    content: String(r.content ?? ""),
    pages: (r.pages as ExtractedPage[] | null) ?? null,
    message: (r.message as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export async function insertReference(input: {
  courseId?: string | null;
  filename: string;
  ext: string;
  mime: string | null;
  sizeBytes: number;
  status: string;
  method: string | null;
  charCount: number;
  pageCount: number | null;
  content: string;
  pages: ExtractedPage[] | null;
  message: string | null;
}): Promise<ReferenceRecord> {
  await ensureReferenceSchema();
  const id = genId("ref");
  const { rows } = await getPool().query(
    `INSERT INTO reference_files
       (id, course_id, filename, ext, mime, size_bytes, status, method, char_count, page_count, content, pages, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      id,
      input.courseId ?? null,
      input.filename,
      input.ext,
      input.mime,
      input.sizeBytes,
      input.status,
      input.method,
      input.charCount,
      input.pageCount,
      input.content,
      input.pages ? JSON.stringify(input.pages) : null,
      input.message,
    ]
  );
  return rowToRecord(rows[0]);
}

export async function listReferences(courseId?: string): Promise<ReferenceListItem[]> {
  await ensureReferenceSchema();
  const { rows } = courseId
    ? await getPool().query(
        `SELECT id, course_id, filename, ext, size_bytes, status, method, char_count, page_count, message,
                left(content, 300) AS preview, created_at
         FROM reference_files WHERE course_id = $1 ORDER BY created_at DESC`,
        [courseId]
      )
    : await getPool().query(
        `SELECT id, course_id, filename, ext, size_bytes, status, method, char_count, page_count, message,
                left(content, 300) AS preview, created_at
         FROM reference_files ORDER BY created_at DESC`
      );
  return rows.map((r) => ({
    id: String(r.id),
    courseId: (r.course_id as string | null) ?? null,
    filename: String(r.filename),
    ext: String(r.ext),
    sizeBytes: Number(r.size_bytes),
    status: String(r.status),
    method: (r.method as string | null) ?? null,
    charCount: Number(r.char_count),
    pageCount: r.page_count == null ? null : Number(r.page_count),
    message: (r.message as string | null) ?? null,
    preview: String(r.preview ?? ""),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export async function getReference(id: string): Promise<ReferenceRecord | null> {
  await ensureReferenceSchema();
  const { rows } = await getPool().query(`SELECT * FROM reference_files WHERE id = $1`, [id]);
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

/** 按 id 批量取已提取全文的参考资料（供生成流程构建摘要上下文） */
export async function getReferencesByIds(ids: string[]): Promise<ReferenceRecord[]> {
  if (ids.length === 0) return [];
  await ensureReferenceSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM reference_files
     WHERE id = ANY($1) AND status = 'extracted' AND char_count > 0
     ORDER BY created_at ASC`,
    [ids]
  );
  return rows.map(rowToRecord);
}

export async function deleteReference(id: string): Promise<boolean> {
  await ensureReferenceSchema();
  const { rowCount } = await getPool().query(`DELETE FROM reference_files WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
