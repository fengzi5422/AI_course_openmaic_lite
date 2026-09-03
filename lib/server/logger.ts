import { getPool } from "./db";

/**
 * 统一日志模块（异步缓冲批量落库，不阻塞请求路径）：
 * - 分级：DEBUG/INFO/WARN/ERROR（LOG_LEVEL 环境变量控制最低落库级别，默认 INFO）
 * - 结构：时间戳、级别、模块名、描述、可选 detail(JSON)
 * - 性能：内存队列 + 定时批量 INSERT；队列有界（溢出丢弃 DEBUG 优先）；
 *   写库失败仅回退 console，绝不向调用方抛错
 * - 归档：每天自动将 30 天前的日志迁移到 logs_archive 表（按日期可查）
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_WEIGHT: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const QUEUE_LIMIT = 1000;
const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 2000;
const RETENTION_DAYS = 30;
const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  message: string;
  detail?: unknown;
}

export interface LogQuery {
  level?: LogLevel | LogLevel[];
  module?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface LogQueryResult {
  items: LogEntry[];
  total: number;
}

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

/* ---------------- 队列与落库 ---------------- */

interface QueueRow {
  ts: Date;
  level: LogLevel;
  module: string;
  message: string;
  detail: unknown;
}

const queue: QueueRow[] = [];
let dropped = 0;
let flushing = false;
let timerStarted = false;
let logsSchemaReady: Promise<void> | null = null;

function minLevel(): number {
  const raw = process.env.LOG_LEVEL?.trim().toUpperCase();
  return raw && raw in LEVEL_WEIGHT ? LEVEL_WEIGHT[raw as LogLevel] : LEVEL_WEIGHT.INFO;
}

function startTimer() {
  if (timerStarted) return;
  timerStarted = true;
  setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  // 每天触发一次归档（进程存活期内惰性执行）
  setInterval(() => void archiveOldLogs(), ARCHIVE_INTERVAL_MS);
  setTimeout(() => void archiveOldLogs(), 30_000); // 启动 30s 后先试一次
}

function ensureLogsSchema(): Promise<void> {
  if (!logsSchemaReady) {
    logsSchemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS logs (
          id bigserial PRIMARY KEY,
          ts timestamptz NOT NULL DEFAULT now(),
          level text NOT NULL,
          module text NOT NULL,
          message text NOT NULL,
          detail jsonb
        );
        CREATE INDEX IF NOT EXISTS logs_ts_idx ON logs (ts DESC);
        CREATE INDEX IF NOT EXISTS logs_module_idx ON logs (module);
        CREATE TABLE IF NOT EXISTS logs_archive (LIKE logs INCLUDING DEFAULTS);
        CREATE INDEX IF NOT EXISTS logs_archive_ts_idx ON logs_archive (ts DESC);
      `);
    })().catch((err) => {
      logsSchemaReady = null;
      throw err;
    });
  }
  return logsSchemaReady;
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    await ensureLogsSchema();
    const values: unknown[] = [];
    const placeholders = batch
      .map((r, i) => {
        values.push(r.ts, r.level, r.module, r.message, r.detail ? JSON.stringify(r.detail) : null);
        return `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`;
      })
      .join(", ");
    await getPool().query(
      `INSERT INTO logs (ts, level, module, message, detail) VALUES ${placeholders}`,
      values
    );
    if (dropped > 0) {
      console.warn(`[logger] 此前因队列溢出丢弃 ${dropped} 条日志`);
      dropped = 0;
    }
  } catch (err) {
    // 落库失败：回退 console（截断 batch 防刷屏），其余行放回队首等待重试
    queue.unshift(...batch);
    console.error("[logger] 日志落库失败：", err instanceof Error ? err.message : err);
    if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT);
  } finally {
    flushing = false;
    if (queue.length >= BATCH_SIZE) {
      // 余量充足，立即接续下一批（脱离定时器节奏）
      setImmediate(() => void flush());
    }
  }
}

function enqueue(row: QueueRow) {
  if (queue.length >= QUEUE_LIMIT) {
    // 队列满：优先丢弃低级别日志
    const lowIdx = queue.findIndex((r) => LEVEL_WEIGHT[r.level] <= LEVEL_WEIGHT.DEBUG);
    if (lowIdx >= 0) {
      queue.splice(lowIdx, 1);
    } else {
      dropped += 1;
      return;
    }
  }
  queue.push(row);
  startTimer();
}

/* ---------------- 归档与查询 ---------------- */

/** 将超过保留期的日志迁移到 logs_archive（按日期归档可查），失败静默 */
async function archiveOldLogs(): Promise<number> {
  try {
    await ensureLogsSchema();
    const { rowCount } = await getPool().query(
      `WITH moved AS (
         DELETE FROM logs
         WHERE ts < now() - interval '${RETENTION_DAYS} days'
         RETURNING id, ts, level, module, message, detail
       )
       INSERT INTO logs_archive (id, ts, level, module, message, detail)
       SELECT id, ts, level, module, message, detail FROM moved`
    );
    if ((rowCount ?? 0) > 0) {
      console.log(`[logger] 已归档 ${rowCount} 条过期日志（>${RETENTION_DAYS} 天）`);
    }
    return rowCount ?? 0;
  } catch (err) {
    console.error("[logger] 日志归档失败：", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** 按条件查询日志（管理页使用） */
export async function queryLogs(filter: LogQuery): Promise<LogQueryResult> {
  await ensureLogsSchema();
  const conds: string[] = [];
  const values: unknown[] = [];
  if (filter.level) {
    const levels = (Array.isArray(filter.level) ? filter.level : [filter.level]).map(String);
    values.push(levels);
    conds.push(`level = ANY($${values.length})`);
  }
  if (filter.module?.trim()) {
    values.push(`%${filter.module.trim()}%`);
    conds.push(`module ILIKE $${values.length}`);
  }
  if (filter.q?.trim()) {
    values.push(`%${filter.q.trim()}%`);
    conds.push(`message ILIKE $${values.length}`);
  }
  if (filter.from) {
    values.push(new Date(filter.from));
    conds.push(`ts >= $${values.length}`);
  }
  if (filter.to) {
    values.push(new Date(filter.to));
    conds.push(`ts <= $${values.length}`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  const offset = Math.max(filter.offset ?? 0, 0);
  values.push(limit, offset);

  const [items, count] = await Promise.all([
    getPool().query(
      `SELECT id, ts, level, module, message, detail
       FROM logs ${where}
       ORDER BY ts DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    ),
    getPool().query(`SELECT COUNT(*)::int AS total FROM logs ${where}`, values.slice(0, -2)),
  ]);
  return {
    items: items.rows.map((r) => ({
      ts: (r.ts as Date).toISOString(),
      level: r.level as LogLevel,
      module: r.module as string,
      message: r.message as string,
      detail: r.detail ?? undefined,
    })),
    total: count.rows[0]?.total ?? 0,
  };
}

/* ---------------- 对外接口 ---------------- */

function write(level: LogLevel, module: string, message: string, detail?: unknown) {
  if (LEVEL_WEIGHT[level] < minLevel()) return;
  const row: QueueRow = { ts: new Date(), level, module, message, detail };
  // console 始终同步输出（本地开发可见；ERROR/WARN 带完整 detail）
  const tag = `${new Date().toISOString()} [${level}] [${module}]`;
  if (level === "ERROR") console.error(tag, message, detail ?? "");
  else if (level === "WARN") console.warn(tag, message, detail ?? "");
  else console.log(tag, message);
  // 落库走异步队列，绝不阻塞、绝不抛错
  try {
    enqueue(row);
  } catch {
    /* 忽略：日志永远不影响主流程 */
  }
}

/** 创建模块级 logger：const log = createLogger("api.courses") */
export function createLogger(module: string): Logger {
  return {
    debug: (m, d) => write("DEBUG", module, m, d),
    info: (m, d) => write("INFO", module, m, d),
    warn: (m, d) => write("WARN", module, m, d),
    error: (m, d) => write("ERROR", module, m, d),
  };
}
