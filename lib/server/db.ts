import { Pool } from "pg";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) {
      throw new Error(
        "未配置 DATABASE_URL。请先 docker compose up -d 启动 PostgreSQL，并在 .env 中设置 DATABASE_URL。"
      );
    }
    pool = new Pool({ connectionString: cs, max: 10 });
  }
  return pool;
}

/** 建表（幂等），进程内只执行一次 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS courses (
          id text PRIMARY KEY,
          title text NOT NULL,
          doc jsonb NOT NULL,
          revision integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        -- 参考资料关联（生成课程时所选的 reference_files id）
        ALTER TABLE courses ADD COLUMN IF NOT EXISTS reference_ids jsonb;
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export { getPool };
