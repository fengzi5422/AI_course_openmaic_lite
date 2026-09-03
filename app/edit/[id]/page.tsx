"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChartElement, ImageElement, PPTElement, Scene, ShapeElement, Stage, TableElement, TextElement } from "@/lib/dsl";
import { normalizeStage } from "@/lib/dsl/normalize";
import { resolveTheme } from "@/lib/dsl/theme";
import { degradedSceneInfo } from "@/lib/dsl/degraded";
import { relayoutSlideElements } from "@/lib/generation/layout";
import { SlideCanvasEditor } from "@/components/editor/SlideCanvasEditor";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function EditPage() {
  const params = useParams<{ id: string }>();
  const courseId = params.id;

  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<"" | "speech" | "no-speech">("");
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    fetch(`/api/courses/${courseId}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setTitle(data.title);
        setStage(data.doc as Stage);
        setRefIds(Array.isArray(data.referenceIds) ? data.referenceIds : []);
      })
      .catch((e) => setError(String(e)));
  }, [courseId]);

  if (error && !stage) {
    return (
      <main className="p-8" style={{ color: "#ef4444" }}>
        加载失败：{error}{" "}
        <Link href="/" className="underline" style={{ color: "var(--accent)" }}>
          返回首页
        </Link>
      </main>
    );
  }
  if (!stage) return <main className="p-8" style={{ color: "var(--text-dim)" }}>加载中…</main>;

  function patchStage(patch: Partial<Stage>) {
    setSaved("");
    setStage({ ...stage!, ...patch });
  }

  function patchScene(i: number, patch: Partial<Scene>) {
    setSaved("");
    patchStage({ scenes: stage!.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  }

  function patchElements(elements: PPTElement[]) {
    patchScene(selected, { content: { kind: "slide", elements } });
  }

  /** 保存；withSpeech=false 时清空所有场景的动作列表（仅保留幻灯片画面） */
  async function save(withSpeech: boolean) {
    if (!stage || saving) return;
    setSaving(true);
    setError("");
    try {
      const doc = normalizeStage({
        ...stage,
        title,
        scenes: withSpeech
          ? stage.scenes
          : stage.scenes.map((s) => ({ ...s, actions: [] })),
      });
      const r = await fetch(`/api/courses/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, doc }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setStage(doc);
      setSaved(withSpeech ? "speech" : "no-speech");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  /** 失败占位场景单独重新生成并保存 */
  async function retryScene(index: number) {
    if (!stage || retrying) return;
    const info = degradedSceneInfo(stage.scenes[index]);
    if (!info) return;
    setRetrying(true);
    setError("");
    try {
      const r = await fetch("/api/generate/scene-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...info, referenceIds: refIds }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      const normalized = normalizeStage({
        ...stage,
        scenes: stage.scenes.map((s, i) => (i === index ? data.scene : s)),
      });
      setStage(normalized);
      const r2 = await fetch(`/api/courses/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, doc: normalized }),
      });
      if (!r2.ok) {
        const d2 = await r2.json();
        throw new Error(d2.error ?? `HTTP ${r2.status}`);
      }
      setSaved("speech");
    } catch (e) {
      setError(String(e));
    } finally {
      setRetrying(false);
    }
  }

  const scene = stage.scenes[selected];
  if (!scene) {
    return (
      <main className="p-8">
        空课程{" "}
        <Link href="/" className="text-blue-400 underline">
          返回首页
        </Link>
      </main>
    );
  }

  const content = scene.content;
  const tokens = resolveTheme(stage.theme).tokens;
  const selectedEl =
    content.kind === "slide"
      ? content.elements.find((e) => e.id === selectedElId) ?? null
      : null;

  function updateSelectedEl(patch: Record<string, unknown>) {
    if (!selectedEl) return;
    const elements = (content as { kind: "slide"; elements: PPTElement[] }).elements;
    patchElements(
      elements.map((el) => (el.id === selectedEl.id ? ({ ...el, ...patch } as PPTElement) : el))
    );
  }

  const numInput = "input-box px-2 py-1.5 text-xs w-full";

  return (
    <main className="max-w-[1500px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="link-op text-sm">
          ← 首页
        </Link>
        <input
          className="input-line flex-1 px-1 py-2 text-lg font-display"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved("");
          }}
        />
        <Link href={`/classroom/${courseId}`} className="btn-ghost px-4 py-2 text-sm">
          预览课堂
        </Link>
        <button
          className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
          onClick={() => void save(true)}
          disabled={saving}
        >
          {saving ? "保存中…" : saved === "speech" ? "已保存" : "保存（含讲解）"}
        </button>
        <button
          className="btn-ghost px-4 py-2 text-sm disabled:opacity-50"
          onClick={() => void save(false)}
          disabled={saving}
          title="清空所有场景的讲稿与板书动作，仅保留幻灯片画面"
        >
          {saved === "no-speech" ? "已保存" : "保存（不含讲解）"}
        </button>
        <ThemeToggle />
        <details className="relative">
          <summary className="btn-ghost px-4 py-2 text-sm cursor-pointer list-none select-none">下载</summary>
          <div
            className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-md border shadow-lg"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          >
            <a className="block px-3 py-2 text-sm hover:opacity-70" href={`/api/export/pptx?courseId=${courseId}`} download>
              PowerPoint（.pptx）
            </a>
            <a className="block px-3 py-2 text-sm hover:opacity-70" href={`/api/export/html?courseId=${courseId}`} download>
              可编辑网页（.html）
            </a>
            <a className="block px-3 py-2 text-sm hover:opacity-70" href={`/api/export/pdf?courseId=${courseId}`} download>
              PDF（.pdf）
            </a>
          </div>
        </details>
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-2 text-sm anim-fade-in"
          style={{ background: "rgba(185,28,28,0.06)", borderLeft: "2px solid #b91c1c", color: "#b91c1c" }}
        >
          {error}
        </div>
      )}

      <div className="flex gap-5">
        {/* 场景列表 */}
        <aside className="w-52 shrink-0">
          <ul className="space-y-1">
            {stage.scenes.map((s, i) => (
              <li key={`${i}-${s.id}`}>
                <button
                  onClick={() => {
                    setSelected(i);
                    setSelectedElId(null);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm truncate ${
                    i === selected ? "btn-primary" : "btn-ghost"
                  }`}
                >
                  <span className="sec-num mr-1.5" style={i === selected ? { color: "inherit" } : undefined}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.title}
                  <span className="ml-1 text-xs opacity-60">{s.content.kind === "quiz" ? "[测验]" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn-ghost mt-3 w-full px-3 py-2 text-sm"
            onClick={() => {
              const id = `sc_${Date.now()}`;
              patchStage({
                scenes: [
                  ...stage.scenes,
                  {
                    id,
                    title: "新场景",
                    content: { kind: "slide", elements: [] },
                    actions: [{ type: "speech", text: "" }],
                  } as Scene,
                ],
              });
              setSelected(stage.scenes.length);
              setSelectedElId(null);
            }}
          >
            + 添加场景
          </button>
          <button
            className="btn-ghost mt-3 px-3 py-1.5 text-xs"
            style={{ color: "#b91c1c", borderColor: "rgba(185,28,28,0.4)" }}
            onClick={() => {
              if (stage.scenes.length <= 1) {
                setError("至少保留一个场景");
                return;
              }
              patchStage({ scenes: stage.scenes.filter((_, j) => j !== selected) });
              setSelected(Math.max(0, selected - 1));
              setSelectedElId(null);
            }}
          >
            删除本场景
          </button>
        </aside>

        {/* 画布 + 讲稿 */}
        <section className="flex-1 min-w-0 space-y-5">
          <div>
            <input
              className="input-box w-full px-3 py-2 text-sm mb-3"
              value={scene.title}
              onChange={(e) => patchScene(selected, { title: e.target.value })}
            />
            {content.kind === "slide" ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {(["text", "shape", "image"] as const).map((t) => (
                    <button
                      key={t}
                      className="px-2.5 py-1 rounded-md btn-ghost text-xs"
                      onClick={() => {
                        const base = { id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, x: 80, y: 300 };
                        const el: PPTElement =
                          t === "text"
                            ? { ...base, type: "text", content: "新文本", w: 400, h: 60, fontSize: 28, color: "#1f2937" }
                            : t === "shape"
                              ? { ...base, type: "shape", shape: "rect", w: 240, h: 140, fill: "#dbeafe" }
                              : { ...base, type: "image", src: "", w: 400, h: 280 };
                        patchElements([...content.elements, el]);
                        setSelectedElId(el.id);
                      }}
                    >
                      + {t === "text" ? "文本" : t === "shape" ? "形状" : "图片"}
                    </button>
                  ))}
                  <button
                    className="px-2.5 py-1 rounded-md btn-ghost text-xs"
                    onClick={() => patchElements(relayoutSlideElements(content.elements))}
                    title="自动消重叠、夹取越界、文本高度自适应"
                  >
                    整理布局
                  </button>
                  {selectedEl && (
                    <button
                      className="link-op ml-auto text-xs"
                      onClick={() => {
                        patchElements(content.elements.filter((e) => e.id !== selectedEl.id));
                        setSelectedElId(null);
                      }}
                    >
                      删除选中元素
                    </button>
                  )}
                </div>
                <SlideCanvasEditor
                  elements={content.elements}
                  tokens={tokens}
                  selectedId={selectedElId}
                  onSelect={setSelectedElId}
                  onChange={patchElements}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-sm font-display">测验</h3>
                <input
                  className="input-box w-full px-3 py-2 text-sm"
                  placeholder="题干"
                  value={content.question}
                  onChange={(e) => patchScene(selected, { content: { ...content, question: e.target.value } })}
                />
                {content.options.map((o, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`answer-${scene.id}`}
                      checked={content.answerIndex === oi}
                      onChange={() => patchScene(selected, { content: { ...content, answerIndex: oi } })}
                    />
                    <input
                      className="input-box flex-1 px-3 py-2 text-sm"
                      value={o}
                      onChange={(e) =>
                        patchScene(selected, {
                          content: { ...content, options: content.options.map((x, j) => (j === oi ? e.target.value : x)) },
                        })
                      }
                    />
                  </div>
                ))}
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>勾选单项表示正确答案</p>
              </div>
            )}
          </div>

          {/* 讲稿 */}
          {scene.actions.filter((a) => a.type === "speech").length > 0 && (
            <div>
              <h3 className="text-sm font-display mb-2">讲稿（speech 动作）</h3>
              {scene.actions.map((a, ai) =>
                a.type === "speech" ? (
                  <div key={ai} className="flex gap-2 mb-2">
                    <textarea
                      className="input-box flex-1 px-3 py-2 text-sm"
                      rows={2}
                      value={a.text}
                      onChange={(e) =>
                        patchScene(selected, {
                          actions: scene.actions.map((x, j) => (j === ai && x.type === "speech" ? { ...x, text: e.target.value } : x)),
                        })
                      }
                    />
                    <button
                      className="link-op text-xs"
                      onClick={() =>
                        patchScene(selected, { actions: scene.actions.filter((_, j) => j !== ai) })
                      }
                    >
                      删除
                    </button>
                  </div>
                ) : null
              )}
            </div>
          )}
          {scene.actions.length === 0 && (
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              本场景无讲解动作（以「不含讲解」模式保存或已手动清空）。播放时将直接显示整页幻灯片。
            </p>
          )}

          {degradedSceneInfo(scene) && (
            <div
              className="px-3 py-2 text-xs anim-fade-in flex items-center gap-2"
              style={{ background: "rgba(185, 28, 28, 0.06)", borderLeft: "2px solid #b91c1c", color: "#b91c1c" }}
            >
              <span>这是生成失败时的占位场景。</span>
              <button
                className="btn-ghost px-2 py-0.5 text-xs font-medium disabled:opacity-50"
                style={{ borderColor: "#b91c1c", color: "#b91c1c" }}
                disabled={retrying}
                onClick={() => void retryScene(selected)}
              >
                {retrying ? "重新生成中…" : "重新生成"}
              </button>
            </div>
          )}
        </section>

        {/* 属性面板 */}
        <aside className="w-72 shrink-0">
          <h3 className="text-sm font-display mb-2">元素属性</h3>
          {!selectedEl ? (
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              在画布中点击元素以编辑属性。
            </p>
          ) : (
            <div className="space-y-3 p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-dim)" }}>
                类型：{selectedEl.type}
              </div>

              {selectedEl.type === "text" && (
                <>
                  <textarea
                    className="input-box w-full px-3 py-2 text-sm"
                    rows={3}
                    value={selectedEl.content}
                    onChange={(e) => updateSelectedEl({ content: e.target.value })}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-xs" style={{ color: "var(--text-dim)" }}>
                      字号
                      <input type="number" className={numInput} value={selectedEl.fontSize} onChange={(e) => updateSelectedEl({ fontSize: Number(e.target.value) || 28 })} />
                    </label>
                    <label className="text-xs" style={{ color: "var(--text-dim)" }}>
                      颜色
                      <input type="color" className={numInput} value={selectedEl.color} onChange={(e) => updateSelectedEl({ color: e.target.value })} />
                    </label>
                    <label className="text-xs flex items-end gap-1 pb-1.5" style={{ color: "var(--text-dim)" }}>
                      <input type="checkbox" checked={selectedEl.bold ?? false} onChange={(e) => updateSelectedEl({ bold: e.target.checked })} />
                      加粗
                    </label>
                  </div>
                </>
              )}

              {selectedEl.type === "image" && (
                <input
                  className="input-box w-full px-3 py-2 text-sm"
                  placeholder="图片 URL"
                  value={selectedEl.src}
                  onChange={(e) => updateSelectedEl({ src: e.target.value })}
                />
              )}

              {selectedEl.type === "shape" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs" style={{ color: "var(--text-dim)" }}>
                    形状
                    <select
                      className={numInput}
                      value={selectedEl.shape}
                      onChange={(e) => updateSelectedEl({ shape: e.target.value as ShapeElement["shape"] })}
                    >
                      <option value="rect">矩形</option>
                      <option value="ellipse">椭圆</option>
                      <option value="triangle">三角</option>
                    </select>
                  </label>
                  <label className="text-xs" style={{ color: "var(--text-dim)" }}>
                    填充色
                    <input type="color" className={numInput} value={selectedEl.fill} onChange={(e) => updateSelectedEl({ fill: e.target.value })} />
                  </label>
                </div>
              )}

              {selectedEl.type === "table" && (
                <>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    表格数据（JSON：headers + rows）
                    <textarea
                      className="input-box w-full px-3 py-2 text-xs font-mono"
                      rows={6}
                      defaultValue={JSON.stringify({ headers: selectedEl.headers, rows: selectedEl.rows }, null, 1)}
                      onBlur={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value) as { headers?: string[]; rows?: string[][] };
                          if (Array.isArray(parsed.headers) && Array.isArray(parsed.rows)) {
                            updateSelectedEl({ headers: parsed.headers.map(String), rows: parsed.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])) });
                          }
                        } catch {
                          /* JSON 非法时忽略本次修改 */
                        }
                      }}
                    />
                  </label>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    表格字号
                    <input type="number" className={numInput} value={selectedEl.fontSize ?? 20} onChange={(e) => updateSelectedEl({ fontSize: Number(e.target.value) || 20 })} />
                  </label>
                </>
              )}

              {selectedEl.type === "chart" && (
                <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                  图表数据（JSON：[{`{label, value}`}]）
                  <textarea
                    className="input-box w-full px-3 py-2 text-xs font-mono"
                    rows={6}
                    defaultValue={JSON.stringify(selectedEl.data, null, 1)}
                    onBlur={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value) as Array<{ label?: unknown; value?: unknown }>;
                        if (Array.isArray(parsed)) {
                          updateSelectedEl({
                            data: parsed
                              .map((d) => ({ label: String(d.label ?? ""), value: Number(d.value) }))
                              .filter((d) => d.label && Number.isFinite(d.value)),
                          });
                        }
                      } catch {
                        /* JSON 非法时忽略本次修改 */
                      }
                    }}
                  />
                </label>
              )}

              {/* 位置与尺寸（所有类型通用） */}
              <div className="grid grid-cols-4 gap-2 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <label key={k} className="text-xs" style={{ color: "var(--text-dim)" }}>
                    {k}
                    <input
                      type="number"
                      className={numInput}
                      value={Math.round(selectedEl[k])}
                      onChange={(e) => updateSelectedEl({ [k]: Number(e.target.value) || 0 })}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
