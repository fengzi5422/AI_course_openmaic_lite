"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

interface RefItem {
  id: string;
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

interface UploadTask {
  filename: string;
  state: "uploading" | "done" | "error";
  detail: string;
}

const STATUS_LABEL: Record<string, string> = {
  extracted: "已提取",
  needs_ocr: "需 OCR",
  failed: "失败",
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReferencesPage() {
  const [items, setItems] = useState<RefItem[] | null>(null);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [selected, setSelected] = useState<RefItem | null>(null);
  const [fullText, setFullText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const r = await fetch("/api/references");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setItems(data.items);
    } catch (e) {
      setError(String(e));
      setItems([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openDetail(item: RefItem) {
    setSelected(item);
    setFullText(null);
    setExpanded(false);
    try {
      const r = await fetch(`/api/references/${item.id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setFullText(data.content ?? "");
    } catch (e) {
      setFullText(`加载失败：${String(e)}`);
    }
  }

  async function handleFiles(files: FileList) {
    const list = Array.from(files);
    for (const f of list) {
      setTasks((prev) => [...prev, { filename: f.name, state: "uploading", detail: "上传并提取中…" }]);
      try {
        const form = new FormData();
        form.append("file", f);
        const r = await fetch("/api/references", { method: "POST", body: form });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        const detail =
          data.status === "extracted"
            ? `${data.charCount} 字${data.pageCount ? ` · ${data.pageCount} 页` : ""}${data.method === "paddleocr" ? " · PaddleOCR" : ""}`
            : data.status === "needs_ocr"
              ? "疑似扫描件，需要 PaddleOCR 服务"
              : data.message ?? "提取失败";
        setTasks((prev) =>
          prev.map((t) =>
            t.filename === f.name && t.state === "uploading"
              ? { filename: f.name, state: data.status === "failed" ? "error" : "done", detail }
              : t
          )
        );
      } catch (e) {
        setTasks((prev) =>
          prev.map((t) =>
            t.filename === f.name && t.state === "uploading"
              ? { filename: f.name, state: "error", detail: String(e) }
              : t
          )
        );
      }
    }
    if (inputRef.current) inputRef.current.value = "";
    void load();
  }

  async function remove(id: string) {
    try {
      const r = await fetch(`/api/references/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      if (selected?.id === id) {
        setSelected(null);
        setFullText(null);
      }
      void load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-3" style={{ color: "var(--accent)" }}>
            References
          </p>
          <h1 className="text-3xl font-display mb-3">参考资料</h1>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            上传 txt / docx / pdf / 图片，系统自动提取文字并结构化存储，供课程生成与课堂问答引用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="btn-ghost px-3 py-1.5 text-sm">
            ← 首页
          </Link>
          <ThemeToggle />
        </div>
      </div>
      <hr className="hairline mb-8" />

      {error && (
        <div className="mb-6 px-4 py-3 text-sm" style={{ background: "rgba(185,28,28,0.06)", borderLeft: "2px solid #b91c1c", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {/* 上传区 */}
      <section className="panel p-6 mb-8">
        <label
          className="block border border-dashed px-6 py-10 text-center cursor-pointer transition-colors"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".txt,.md,.docx,.pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => e.target.files?.length && void handleFiles(e.target.files)}
          />
          <span className="font-display text-lg">点击或拖拽文件到此处上传</span>
          <span className="block mt-2 text-xs" style={{ color: "var(--text-dim)" }}>
            支持 txt / md / docx / pdf / png / jpg / webp，单个文件 ≤ 20MB；扫描件与图片需本地 PaddleOCR 服务
          </span>
        </label>

        {tasks.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {tasks.map((t, i) => (
              <div key={i} className="flex items-baseline gap-3 text-sm py-1.5 border-b anim-fade-in" style={{ borderColor: "var(--border)" }}>
                <span className="truncate flex-1">{t.filename}</span>
                <span
                  className="text-xs shrink-0"
                  style={{
                    color: t.state === "error" ? "#b91c1c" : t.state === "done" ? "var(--accent)" : "var(--text-dim)",
                  }}
                >
                  {t.detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 列表 + 详情 */}
      <div className="flex gap-6 items-start">
        <section className="flex-1 min-w-0">
          <h2 className="text-lg font-display mb-4">已上传</h2>
          {items === null ? (
            <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="skeleton h-14" />)}</div>
          ) : items.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>还没有参考资料。</p>
          ) : (
            <ul>
              {items.map((it) => (
                <li key={it.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <button onClick={() => void openDetail(it)} className="w-full text-left py-3 group">
                    <div className="flex items-center gap-3">
                      <span
                        className="text-xs px-1.5 py-0.5 shrink-0"
                        style={{ border: "1px solid var(--border-strong)", color: "var(--text-dim)" }}
                      >
                        {it.ext.toUpperCase()}
                      </span>
                      <span className="font-medium truncate group-hover:underline">{it.filename}</span>
                      <span
                        className="ml-auto text-xs shrink-0"
                        style={{
                          color:
                            it.status === "extracted" ? "var(--accent)" : it.status === "needs_ocr" ? "#b45309" : "#b91c1c",
                        }}
                      >
                        {STATUS_LABEL[it.status] ?? it.status}
                      </span>
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                      {fmtSize(it.sizeBytes)}
                      {it.status === "extracted" && ` · ${it.charCount} 字`}
                      {it.pageCount && it.pageCount > 1 ? ` · ${it.pageCount} 页` : ""}
                      {it.method === "paddleocr" ? " · PaddleOCR" : it.method === "direct" ? " · 直接提取" : ""}
                      {` · ${new Date(it.createdAt).toLocaleString()}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 详情 / 预览 */}
        {selected && (
          <aside className="w-[46%] shrink-0 panel p-5 anim-fade-in sticky top-6">
            <div className="flex items-baseline gap-3 mb-3">
              <h3 className="font-display truncate">{selected.filename}</h3>
              <button className="link-op ml-auto text-sm shrink-0" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            {selected.message && (
              <p className="text-xs mb-3 px-3 py-2" style={{ background: "rgba(180,83,9,0.07)", borderLeft: "2px solid #b45309", color: "#b45309" }}>
                {selected.message}
              </p>
            )}
            <p className="text-xs mb-3" style={{ color: "var(--text-dim)" }}>
              {selected.status === "extracted"
                ? `${selected.charCount} 字 · ${selected.method === "paddleocr" ? "PaddleOCR 识别" : "直接提取"}`
                : STATUS_LABEL[selected.status] ?? selected.status}
            </p>
            <div
              className="text-sm leading-6 overflow-y-auto whitespace-pre-wrap p-3"
              style={{
                background: "var(--bg-soft)",
                border: "1px solid var(--border)",
                maxHeight: expanded ? 480 : 220,
              }}
            >
              {fullText === null ? "加载中…" : fullText === "" ? "（无文本内容）" : expanded ? fullText : fullText.slice(0, 600) + (fullText.length > 600 ? "…" : "")}
            </div>
            {fullText && fullText.length > 600 && (
              <button className="link-op text-xs mt-2" onClick={() => setExpanded(!expanded)}>
                {expanded ? "收起" : `展开全文（共 ${fullText.length} 字）`}
              </button>
            )}
            <button
              className="btn-ghost mt-4 px-3 py-1.5 text-xs"
              style={{ color: "#b91c1c", borderColor: "rgba(185,28,28,0.4)" }}
              onClick={() => void remove(selected.id)}
            >
              删除该资料
            </button>
          </aside>
        )}
      </div>
    </main>
  );
}
