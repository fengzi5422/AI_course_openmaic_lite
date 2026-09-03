/**
 * 生成任务注册表（内存态）：把大纲/场景生成与 HTTP 请求生命周期解耦。
 * 客户端提前断开（如用户导航到其他页面）不影响服务端继续生成并自动保存课程；
 * 前端通过 job id 轮询进度与结果，天然支持断线恢复。
 */
import type { SceneGenEvent } from "@/lib/generation";
import { createLogger } from "./logger";

const log = createLogger("genjob");

export type JobStatus = "running" | "done" | "error";
export type JobKind = "outline" | "scenes";

export interface GenJob {
  id: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  /** 进度事件（scene_done / scene_failed），供轮询全量重放 */
  events: Array<Extract<SceneGenEvent, { type: "scene_done" | "scene_failed" }>>;
  warnings: string[];
  /** 完成结果：outline → { outlines, warnings, mock }；scenes → { courseId, warnings, failed, mock } */
  result?: unknown;
  error?: string;
  createdAt: number;
}

const MAX_JOBS = 50;
const TTL_MS = 30 * 60 * 1000; // 完成任务保留 30 分钟供前端恢复
const jobs = new Map<string, GenJob>();

function prune() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (j.status !== "running" && now - j.createdAt > TTL_MS) jobs.delete(id);
  }
  // 超限时优先丢弃最早完成的任务
  while (jobs.size > MAX_JOBS) {
    const oldestDone = [...jobs.values()]
      .filter((j) => j.status !== "running")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldestDone) break;
    jobs.delete(oldestDone.id);
  }
}

function newId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createJob(kind: JobKind, title: string): GenJob {
  const job: GenJob = { id: newId(), kind, title, status: "running", events: [], warnings: [], createdAt: Date.now() };
  jobs.set(job.id, job);
  prune();
  log.info("生成任务启动", { kind, title, jobId: job.id });
  return job;
}

export function getJob(id: string): GenJob | null {
  return jobs.get(id) ?? null;
}

export function pushEvent(job: GenJob, ev: Extract<SceneGenEvent, { type: "scene_done" | "scene_failed" }>) {
  job.events.push(ev);
}

export function finishJob(job: GenJob, result: unknown, warnings: string[] = []) {
  job.status = "done";
  job.result = result;
  job.warnings = warnings;
  log.info("生成任务完成", { kind: job.kind, title: job.title, jobId: job.id });
}

export function failJob(job: GenJob, error: unknown) {
  job.status = "error";
  job.error = String(error);
  log.error("生成任务失败", { kind: job.kind, title: job.title, jobId: job.id, err: job.error });
}
