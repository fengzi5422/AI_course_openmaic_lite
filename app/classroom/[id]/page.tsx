"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Stage } from "@/lib/dsl";
import { PlaybackEngine, PlaybackState } from "@/lib/playback/engine";
import { ActionEffects } from "@/lib/action/engine";
import { StageArea } from "@/components/classroom/StageArea";
import { ControlBar } from "@/components/classroom/ControlBar";
import { CaptionBar } from "@/components/classroom/CaptionBar";
import { WhiteboardHandle } from "@/components/slide-renderer/Whiteboard";
import { SpotlightState } from "@/components/slide-renderer/Spotlight";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { degradedSceneInfo } from "@/lib/dsl/degraded";
import { resolveTheme, THEMES } from "@/lib/dsl/theme";

function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    const finish = (() => {
      let done = false;
      return () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
    })();
    const fallback = setTimeout(finish, Math.max(4000, text.length * 260));
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1;
    u.onend = () => {
      clearTimeout(fallback);
      finish();
    };
    u.onerror = () => {
      clearTimeout(fallback);
      finish();
    };
    window.speechSynthesis.speak(u);
  });
}

export default function ClassroomPage() {
  const params = useParams<{ id: string }>();
  const courseId = params.id;

  const [course, setCourse] = useState<{ title: string; doc: Stage; referenceIds: string[] } | null>(null);
  const [error, setError] = useState("");
  const [pbState, setPbState] = useState<PlaybackState>({
    status: "idle",
    sceneIndex: 0,
    actionIndex: 0,
  });
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);
  const [caption, setCaption] = useState("");
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [pendingJump, setPendingJump] = useState<number | null>(null);
  const [savingTheme, setSavingTheme] = useState(false);

  const wbRef = useRef<WhiteboardHandle | null>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);

  useEffect(() => {
    // 生成阶段的质量提示（warning 级，不阻断播放）
    try {
      const raw = sessionStorage.getItem(`gen-warnings-${courseId}`);
      if (raw) {
        setGenWarnings(JSON.parse(raw));
        sessionStorage.removeItem(`gen-warnings-${courseId}`);
      }
    } catch {
      /* 忽略 */
    }
    let alive = true;
    fetch(`/api/courses/${courseId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (alive)
          setCourse({
            title: data.title,
            doc: data.doc as Stage,
            referenceIds: Array.isArray(data.referenceIds) ? data.referenceIds : [],
          });
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [courseId]);

  const effects = useMemo<ActionEffects>(
    () => ({
      speak: async (text: string) => {
        setCaption(text);
        await speakText(text);
        setCaption("");
      },
      cancelSpeech: () => {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
      },
      pauseSpeech: () => {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.pause();
        }
      },
      resumeSpeech: () => {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.resume();
        }
      },
      setSpotlight: (s: SpotlightState | null) => setSpotlight(s),
      drawPath: (points, color, width, instant) =>
        wbRef.current?.drawPath(points, color, width, instant) ?? Promise.resolve(),
      drawText: (x, y, text, color) => wbRef.current?.drawText(x, y, text, color),
      clearWhiteboard: () => wbRef.current?.clear(),
    }),
    []
  );

  useEffect(() => {
    if (!course) return;
    const engine = new PlaybackEngine(course.doc, effects, (s) => setPbState(s));
    engineRef.current = engine;
    // 场景重试成功后跳回该场景继续
    if (pendingJump != null) {
      engine.playScene(pendingJump);
      setPendingJump(null);
    }
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [course, effects, pendingJump]);

  // 键盘快捷键：空格播放/暂停，←/→ 翻页（输入框聚焦时忽略）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (engineRef.current?.getState().status === "playing") engineRef.current.pause();
        else engineRef.current?.play();
      } else if (e.key === "ArrowRight") {
        engineRef.current?.next();
      } else if (e.key === "ArrowLeft") {
        engineRef.current?.prev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const getContext = useCallback(() => {
    if (!course) return "";
    const s = course.doc.scenes[pbState.sceneIndex];
    if (!s) return course.doc.title;
    const parts = [`课程：${course.doc.title}`, `场景：${s.title}`];
    if (s.content.kind === "slide") {
      parts.push(
        "幻灯片内容：" +
          s.content.elements
            .map((el) => (el.type === "text" ? el.content : `[${el.type}]`))
            .join("\n")
      );
    } else {
      parts.push(`测验：${s.content.question} 选项：${s.content.options.join(" / ")}`);
    }
    parts.push("讲稿：" + s.actions.map((a) => (a.type === "speech" ? a.text : "")).filter(Boolean).join(" "));
    return parts.join("\n");
  }, [course, pbState.sceneIndex]);

  /** 失败占位场景单独重新生成（借鉴参考项目"失败单页重试，不整份重来"） */
  async function retryScene(index: number) {
    if (!course || retrying) return;
    const info = degradedSceneInfo(course.doc.scenes[index]);
    if (!info) return;
    setRetrying(true);
    setError("");
    try {
      const r = await fetch("/api/generate/scene-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...info, referenceIds: course.referenceIds }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      const doc = {
        ...course.doc,
        scenes: course.doc.scenes.map((s, i) => (i === index ? (data.scene as typeof s) : s)),
      };
      setCourse({ ...course, doc });
      setPendingJump(index);
      await fetch(`/api/courses/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc }),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setRetrying(false);
    }
  }

  /** 循环切换课程主题并持久化到 doc.theme */
  async function cycleTheme() {
    if (!course || savingTheme) return;
    const cur = resolveTheme(course.doc.theme);
    const next = THEMES[(THEMES.findIndex((t) => t.id === cur.id) + 1) % THEMES.length];
    const doc = { ...course.doc, theme: next.id };
    setCourse({ ...course, doc });
    setSavingTheme(true);
    try {
      await fetch(`/api/courses/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc }),
      });
    } catch {
      /* 切换已在本地生效，保存失败不打断播放 */
    } finally {
      setSavingTheme(false);
    }
  }

  if (error) {
    return (
      <main className="p-8" style={{ color: "#ef4444" }}>
        加载失败：{error}{" "}
        <Link href="/" style={{ color: "var(--accent)" }}>
          返回首页
        </Link>
      </main>
    );
  }
  if (!course) {
    return (
      <main className="h-screen flex items-center justify-center">
        <div className="flex items-center gap-3" style={{ color: "var(--text-dim)" }}>
          <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
          加载课程中…
        </div>
      </main>
    );
  }

  const playing = pbState.status === "playing";

  return (
    <main className="h-screen flex flex-col">
      <header className="flex items-center gap-4 px-6 py-3">
        <Link
          href="/"
          className="link-op text-sm"
        >
          ← 首页
        </Link>
        <h1 className="text-lg font-display truncate">{course.title}</h1>
        <span className="text-xs px-2 py-0.5" style={{ border: "1px solid var(--border-strong)", color: "var(--text-dim)" }}>
          {playing ? "正在上课" : pbState.status === "paused" ? "已暂停" : "AI 课堂"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn-ghost px-3 py-1.5 text-sm"
            title="切换课程主题（自动保存）"
            disabled={savingTheme}
            onClick={() => void cycleTheme()}
          >
            主题 · {resolveTheme(course.doc.theme).name}
          </button>
          <Link href={`/edit/${courseId}`} className="btn-ghost px-3 py-1.5 text-sm">
            编辑课程
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {genWarnings.length > 0 && (
        <div
          className="mx-6 mb-2 px-4 py-2 text-xs anim-fade-in flex items-start gap-3"
          style={{ background: "rgba(180, 83, 9, 0.07)", borderLeft: "2px solid #b45309", color: "#b45309" }}
        >
          <span className="shrink-0">质量提示（{genWarnings.length} 条，不影响播放）：</span>
          <span className="flex-1 space-y-0.5">
            {genWarnings.slice(0, 3).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
            {genWarnings.length > 3 && <div>… 共 {genWarnings.length} 条</div>}
          </span>
          <button className="link-op shrink-0" onClick={() => setGenWarnings([])}>
            ×
          </button>
        </div>
      )}

      {(() => {
        const cur = course.doc.scenes[pbState.sceneIndex];
        const degraded = cur ? degradedSceneInfo(cur) : null;
        if (!degraded) return null;
        return (
          <div
            className="mx-6 mb-2 px-4 py-2 text-xs anim-fade-in flex items-center gap-3"
            style={{ background: "rgba(185, 28, 28, 0.06)", borderLeft: "2px solid #b91c1c", color: "#b91c1c" }}
          >
            <span className="flex-1">本场景此前生成失败（当前为占位内容）</span>
            <button
              className="btn-ghost px-3 py-1 text-xs font-medium disabled:opacity-50"
              style={{ borderColor: "#b91c1c", color: "#b91c1c" }}
              disabled={retrying}
              onClick={() => void retryScene(pbState.sceneIndex)}
            >
              {retrying ? "重新生成中…（约 1 分钟）" : "重新生成本场景"}
            </button>
          </div>
        );
      })()}

      <div className="flex-1 min-h-0 flex gap-4 px-6 pb-4">
        {/* 舞台区 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <StageArea
            stage={course.doc}
            pbState={pbState}
            spotlight={spotlight}
            wbRef={wbRef}
          />
          <CaptionBar text={caption} active={playing} />
          <ControlBar
            stage={course.doc}
            pbState={pbState}
            courseId={courseId}
            onPlay={() => engineRef.current?.play()}
            onPause={() => engineRef.current?.pause()}
            onSkip={() => engineRef.current?.skip()}
            onPrev={() => engineRef.current?.prev()}
            onNext={() => engineRef.current?.next()}
            onJump={(i) => engineRef.current?.playScene(i)}
          />
        </div>

        {/* 问答区 */}
        <div className="w-80 shrink-0 min-h-0">
          <ChatPanel getContext={getContext} />
        </div>
      </div>
    </main>
  );
}
