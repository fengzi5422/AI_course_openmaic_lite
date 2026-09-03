"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SceneOutline, Stage } from "@/lib/dsl";
import { ThemeToggle } from "@/components/ThemeToggle";

interface CourseMeta {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
}

type Phase = "list" | "outline" | "generating";

interface RefMeta {
  id: string;
  filename: string;
  charCount: number;
}

const SAMPLE_TOPICS = [
  "二进制与计算机底层原理",
  "光的波粒二象性",
  "复利与个人理财",
  "图神经网络入门",
];

// 生成任务与页面生命周期解耦：任务在服务端自治运行（导航离开不中断），
// 前端轮询进度；active-* 键用于导航回来后恢复进行中的任务
const ACTIVE_OUTLINE_KEY = "active-outline-job";
const ACTIVE_SCENES_KEY = "active-scenes-job";

interface SavedScenesJob {
  id: string;
  topic: string;
  outlines: SceneOutline[];
  referenceIds: string[];
}

interface SavedOutlineJob {
  id: string;
  topic: string;
}

export default function HomePage() {
  const router = useRouter();
  const [courses, setCourses] = useState<CourseMeta[] | null>(null);
  const [refs, setRefs] = useState<RefMeta[]>([]);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("list");
  const [topic, setTopic] = useState("");
  const [requirements, setRequirements] = useState("");
  const [outlines, setOutlines] = useState<SceneOutline[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [genTip, setGenTip] = useState("");
  const [sceneStatus, setSceneStatus] = useState<Array<{ title: string; ok: boolean }>>([]);

  const outlinePollRef = useRef<number | null>(null);
  const scenesPollRef = useRef<number | null>(null);
  const tipsTimerRef = useRef<number | null>(null);

  async function loadCourses() {
    try {
      const r = await fetch("/api/courses");
      const data = await r.json();
      if (r.ok) setCourses(data.courses ?? []);
      else setError(data.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadRefs() {
    try {
      const r = await fetch("/api/references");
      const data = await r.json();
      if (r.ok) {
        setRefs(
          (data.items ?? [])
            .filter((it: { status: string }) => it.status === "extracted")
            .map((it: { id: string; filename: string; charCount: number }) => ({
              id: it.id,
              filename: it.filename,
              charCount: it.charCount,
            }))
        );
      }
    } catch {
      /* 参考资料加载失败不阻断首页 */
    }
  }

  useEffect(() => {
    void loadCourses();
    void loadRefs();
  }, []);

  // 卸载时只清理轮询，不取消服务端任务（任务自治，回来可恢复）
  useEffect(() => {
    return () => {
      if (outlinePollRef.current) clearInterval(outlinePollRef.current);
      if (scenesPollRef.current) clearInterval(scenesPollRef.current);
      if (tipsTimerRef.current) clearInterval(tipsTimerRef.current);
    };
  }, []);

  function toggleRef(id: string) {
    setRefIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  /* ---------------- 后台任务轮询 ---------------- */

  function startOutlineJob(jobId: string) {
    setBusy(true);
    if (outlinePollRef.current) clearInterval(outlinePollRef.current);
    outlinePollRef.current = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/generate/jobs?id=${jobId}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (d.status === "done") {
          if (outlinePollRef.current) clearInterval(outlinePollRef.current);
          outlinePollRef.current = null;
          sessionStorage.removeItem(ACTIVE_OUTLINE_KEY);
          const res = d.result ?? {};
          if (res.mock) {
            setError("提示：未配置 LLM_API_KEY，当前为内置演示大纲；在 .env 配置 Key 后即为真实 AI 生成。");
          }
          setOutlines(res.outlines ?? []);
          setPhase("outline");
          setBusy(false);
        } else if (d.status === "error") {
          if (outlinePollRef.current) clearInterval(outlinePollRef.current);
          outlinePollRef.current = null;
          sessionStorage.removeItem(ACTIVE_OUTLINE_KEY);
          setError(d.error ?? "大纲生成失败");
          setBusy(false);
        }
      } catch {
        /* 网络抖动：下一轮继续 */
      }
    }, 1500);
  }

  function startScenesJob(jobId: string, titles: string[], saved: boolean) {
    setBusy(true);
    setPhase("generating");
    setSceneStatus(titles.map((t) => ({ title: t, ok: false })));
    const tips = [
      "正在逐场景生成幻灯片内容…",
      "正在撰写讲稿与板书动作…",
      "正在组装课堂与测验…",
      "仍在努力，内容越深耗时越长…",
    ];
    let ti = 0;
    setGenTip(tips[0]);
    if (tipsTimerRef.current) clearInterval(tipsTimerRef.current);
    tipsTimerRef.current = window.setInterval(() => {
      ti = Math.min(ti + 1, tips.length - 1);
      setGenTip(tips[ti]);
    }, 12000);

    if (scenesPollRef.current) clearInterval(scenesPollRef.current);
    scenesPollRef.current = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/generate/jobs?id=${jobId}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        // 全量重放进度事件（幂等更新）
        for (const ev of d.events ?? []) {
          if (ev.type === "scene_done") {
            setSceneStatus((prev) => prev.map((s, i) => (i === ev.index ? { ...s, ok: true } : s)));
          }
        }
        if (d.status === "done") {
          if (scenesPollRef.current) clearInterval(scenesPollRef.current);
          scenesPollRef.current = null;
          if (tipsTimerRef.current) clearInterval(tipsTimerRef.current);
          sessionStorage.removeItem(ACTIVE_SCENES_KEY);
          const res = d.result ?? {};
          const warnings: string[] = res.warnings ?? [];
          if (warnings.length > 0) {
            try {
              sessionStorage.setItem(`gen-warnings-${res.courseId}`, JSON.stringify(warnings));
            } catch {
              /* 忽略隐私模式 */
            }
          }
          router.push(`/classroom/${res.courseId}`);
        } else if (d.status === "error") {
          if (scenesPollRef.current) clearInterval(scenesPollRef.current);
          scenesPollRef.current = null;
          if (tipsTimerRef.current) clearInterval(tipsTimerRef.current);
          sessionStorage.removeItem(ACTIVE_SCENES_KEY);
          setError(d.error ?? "课程生成失败");
          setPhase("outline");
          setBusy(false);
        }
      } catch {
        /* 网络抖动或页面切换中：下一轮继续；服务端任务不受影响 */
      }
    }, 1500);
    if (saved) setBusy(false); // 恢复场景：busy 状态由轮询驱动，避免按钮永久禁用歧义
  }

  // 挂载时恢复未完成的后台任务（用户生成中导航离开再回来的场景）
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(ACTIVE_SCENES_KEY);
    } catch {
      /* 忽略 */
    }
    if (raw) {
      try {
        const saved = JSON.parse(raw) as SavedScenesJob;
        if (saved.id && Array.isArray(saved.outlines) && saved.outlines.length > 0) {
          setTopic(saved.topic ?? "");
          setOutlines(saved.outlines);
          setRefIds(saved.referenceIds ?? []);
          startScenesJob(saved.id, saved.outlines.map((o) => o.title), true);
          return;
        }
      } catch {
        /* 数据损坏则清除 */
      }
      sessionStorage.removeItem(ACTIVE_SCENES_KEY);
    }
    let raw2: string | null = null;
    try {
      raw2 = sessionStorage.getItem(ACTIVE_OUTLINE_KEY);
    } catch {
      /* 忽略 */
    }
    if (raw2) {
      try {
        const saved = JSON.parse(raw2) as SavedOutlineJob;
        if (saved.id) {
          setTopic(saved.topic ?? "");
          startOutlineJob(saved.id);
          return;
        }
      } catch {
        /* 忽略 */
      }
      sessionStorage.removeItem(ACTIVE_OUTLINE_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function genOutline() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/generate/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "outline", topic, requirements, referenceIds: refIds }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      try {
        sessionStorage.setItem(ACTIVE_OUTLINE_KEY, JSON.stringify({ id: d.jobId, topic }));
      } catch {
        /* 忽略 */
      }
      startOutlineJob(d.jobId);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  async function genCourse() {
    if (busy || outlines.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/generate/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "scenes", topic, outlines, referenceIds: refIds }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      try {
        sessionStorage.setItem(
          ACTIVE_SCENES_KEY,
          JSON.stringify({ id: d.jobId, topic, outlines, referenceIds: refIds } satisfies SavedScenesJob)
        );
      } catch {
        /* 忽略 */
      }
      startScenesJob(d.jobId, outlines.map((o) => o.title), false);
    } catch (e) {
      setError(String(e));
      setPhase("outline");
      setBusy(false);
    }
  }

  async function removeCourse(id: string) {
    if (!confirm("确定删除该课程？")) return;
    await fetch(`/api/courses/${id}`, { method: "DELETE" });
    void loadCourses();
  }

  function updateOutline(i: number, patch: Partial<SceneOutline>) {
    setOutlines(outlines.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-3" style={{ color: "var(--accent)" }}>
            OpenMAIC Lite
          </p>
          <h1 className="text-4xl font-display mb-3 anim-fade-up">AI 互动课堂</h1>
          <p className="anim-fade-up text-sm" style={{ color: "var(--text-dim)", animationDelay: "80ms" }}>
            输入一个主题，AI 生成一门可播放、可提问的深度互动课程。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/references" className="btn-ghost px-3 py-1.5 text-sm">
            参考资料
          </Link>
          <Link href="/logs" className="btn-ghost px-3 py-1.5 text-sm">
            日志
          </Link>
          <ThemeToggle />
        </div>
      </div>
      <hr className="hairline mb-8" />

      {error && (
        <div className="mb-6 px-4 py-3 text-sm anim-fade-up" style={{
          background: "var(--accent-soft)",
          color: "var(--text)",
          borderLeft: "2px solid var(--accent)",
        }}>
          {error}
        </div>
      )}

      {/* 创建课程 */}
      <section className="panel p-6 mb-10 anim-fade-up" style={{ animationDelay: "120ms" }}>
        {phase === "generating" ? (
          <div className="py-6 space-y-4">
            <div className="flex items-center gap-3" style={{ color: "var(--accent)" }}>
              <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              <span className="font-medium">{genTip}</span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              实时进度：每个场景完成即点亮（深度内容每页约 1-2 分钟），请勿关闭页面。
            </p>
            <div>
              {sceneStatus.map((s, i) => (
                <div
                  key={i}
                  className={`flex items-baseline gap-3 py-2 text-sm border-b anim-fade-in ${
                    i === sceneStatus.length - 1 ? "border-b-0" : ""
                  }`}
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="sec-num text-sm w-7 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className={s.ok ? "" : "opacity-50"} style={{ color: "var(--text)" }}>
                    {s.title}
                  </span>
                  <span
                    className="ml-auto text-xs shrink-0 tracking-wider"
                    style={{ color: s.ok ? "var(--accent)" : "var(--text-dim)" }}
                  >
                    {s.ok ? "已完成" : "生成中"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : phase === "outline" ? (
          <>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-display">编辑大纲 <span className="text-xs font-sans font-normal" style={{ color: "var(--text-dim)" }}>（可增删改）</span></h2>
              <span className="text-xs tracking-wider" style={{ color: "var(--text-dim)" }}>
                共 {outlines.length} 个场景
              </span>
            </div>
            <div className="space-y-3 mb-4 max-h-[420px] overflow-y-auto pr-1">
              {outlines.map((o, i) => (
                <div key={i} className="p-4 anim-fade-up" style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  animationDelay: `${i * 60}ms`,
                }}>
                  <div className="flex gap-3 mb-2 items-baseline">
                    <span className="sec-num text-lg w-8 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <input
                      className="input-line flex-1 px-1 py-1.5 text-sm"
                      value={o.title}
                      onChange={(e) => updateOutline(i, { title: e.target.value })}
                    />
                    <button
                      className="link-op px-2 text-sm"
                      title="删除该场景"
                      onClick={() => setOutlines(outlines.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    className="input-box w-full px-3 py-2 text-sm ml-11"
                    style={{ width: "calc(100% - 2.75rem)" }}
                    rows={2}
                    value={o.points.join("\n")}
                    onChange={(e) =>
                      updateOutline(i, { points: e.target.value.split("\n").filter(Boolean) })
                    }
                  />
                </div>
              ))}
              <button
                className="link-op text-sm"
                onClick={() => setOutlines([...outlines, { title: "新场景", points: ["要点1"] }])}
              >
                + 添加场景
              </button>
            </div>
            <div className="flex gap-3">
              <button
                className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
                onClick={() => void genCourse()}
                disabled={busy || outlines.length === 0}
              >
                生成课程
              </button>
              <button
                className="btn-ghost px-5 py-2.5 text-sm"
                onClick={() => setPhase("list")}
              >
                返回
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-display mb-4">创建新课程</h2>
            <input
              className="input-line w-full mb-5 px-1 py-2.5 text-base"
              placeholder="课程主题，例如：二进制与计算机底层原理"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void genOutline();
              }}
            />
            <textarea
              className="input-box w-full mb-4 px-3 py-2.5 text-sm"
              placeholder="补充要求（可选）：目标人群、时长、深度、风格等"
              rows={2}
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>试试：</span>
              {SAMPLE_TOPICS.map((t) => (
                <button
                  key={t}
                  className="link-op text-xs"
                  onClick={() => setTopic(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {refs.length > 0 && (
              <div className="mb-5">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                    参考用资料（可选，生成内容将优先依据所选材料）
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                    已选 {refIds.length}/{refs.length}
                  </span>
                </div>
                <ul className="max-h-36 overflow-y-auto pr-1">
                  {refs.map((r) => {
                    const checked = refIds.includes(r.id);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm transition-colors border-b"
                          style={{
                            borderColor: "var(--border)",
                            background: checked ? "var(--accent-soft)" : "transparent",
                          }}
                          onClick={() => toggleRef(r.id)}
                        >
                          <span
                            className="shrink-0 inline-block w-3.5 h-3.5 translate-y-[2px] border"
                            style={{
                              borderColor: "var(--border)",
                              background: checked ? "var(--accent)" : "transparent",
                            }}
                          />
                          <span className="truncate">{r.filename}</span>
                          <span className="ml-auto text-xs shrink-0" style={{ color: "var(--text-dim)" }}>
                            {r.charCount > 1000 ? `${(r.charCount / 1000).toFixed(1)}k 字` : `${r.charCount} 字`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <button
              className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
              onClick={() => void genOutline()}
              disabled={busy || !topic.trim()}
            >
              {busy ? "生成大纲中…" : "生成大纲"}
            </button>
          </>
        )}
      </section>

      {/* 课程列表 */}
      <section className="anim-fade-up" style={{ animationDelay: "200ms" }}>
        <h2 className="text-lg font-display mb-4">我的课程</h2>
        {courses === null ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="skeleton h-16" />)}
          </div>
        ) : courses.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>还没有课程，先创建一门吧。</p>
        ) : (
          <ul>
            {courses.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-4 px-5 py-3.5 anim-fade-up border-b transition-colors"
                style={{
                  borderColor: "var(--border)",
                  animationDelay: `${i * 50}ms`,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{c.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                    更新于 {new Date(c.updatedAt).toLocaleString()} · v{c.revision}
                  </div>
                </div>
                <Link
                  href={`/classroom/${c.id}`}
                  className="btn-primary px-3.5 py-1.5 text-sm"
                >
                  进入课堂
                </Link>
                <Link
                  href={`/edit/${c.id}`}
                  className="btn-ghost px-3 py-1.5 text-sm"
                >
                  编辑
                </Link>
                <button
                  className="btn-ghost px-3 py-1.5 text-sm"
                  onClick={() => void removeCourse(c.id)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
