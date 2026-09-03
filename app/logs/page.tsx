"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface LogItem {
  ts: string;
  level: string;
  module: string;
  message: string;
  detail?: unknown;
}

const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "#6b7280",
  INFO: "#1d4ed8",
  WARN: "#b45309",
  ERROR: "#b91c1c",
};

function fmtTs(ts: string): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export default function LogsPage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [levels, setLevels] = useState<string[]>(["INFO", "WARN", "ERROR"]);
  const [module, setModule] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(200);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams();
      levels.forEach((l) => p.append("level", l));
      if (module.trim()) p.set("module", module);
      if (q.trim()) p.set("q", q);
      if (from) p.set("from", new Date(from).toISOString());
      if (to) p.set("to", new Date(to).toISOString());
      p.set("limit", String(limit));
      const r = await fetch(`/api/logs?${p.toString()}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setItems(d.items);
      setTotal(d.total);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [levels, module, q, from, to, limit]);

  useEffect(() => {
    void load();
  }, []); // 初始加载一次

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [auto, load]);

  function toggleLevel(l: string) {
    setLevels((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));
  }

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/" className="link-op text-sm">
          ← 首页
        </Link>
        <h1 className="text-xl font-display">系统日志</h1>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          共 {total} 条（最多显示 {limit}）
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            自动刷新（5s）
          </label>
          <button className="btn-ghost px-4 py-2 text-sm" onClick={() => void load()} disabled={loading}>
            {loading ? "查询中…" : "刷新"}
          </button>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          {LEVELS.map((l) => (
            <label key={l} className="text-xs flex items-center gap-1 cursor-pointer" style={{ color: LEVEL_COLOR[l] }}>
              <input type="checkbox" checked={levels.includes(l)} onChange={() => toggleLevel(l)} />
              {l}
            </label>
          ))}
        </div>
        <input
          className="input-box px-2.5 py-1.5 text-xs w-44"
          placeholder="模块名（模糊，如 api.generate）"
          value={module}
          onChange={(e) => setModule(e.target.value)}
        />
        <input
          className="input-box px-2.5 py-1.5 text-xs w-56"
          placeholder="描述关键字"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
        />
        <label className="text-xs" style={{ color: "var(--text-dim)" }}>
          从
          <input type="datetime-local" className="input-box px-2 py-1.5 text-xs block mt-0.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--text-dim)" }}>
          至
          <input type="datetime-local" className="input-box px-2 py-1.5 text-xs block mt-0.5" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select className="input-box px-2 py-1.5 text-xs" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[100, 200, 500, 1000].map((n) => (
            <option key={n} value={n}>
              显示 {n} 条
            </option>
          ))}
        </select>
        <button className="btn-primary px-4 py-1.5 text-xs" onClick={() => void load()}>
          查询
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 text-sm" style={{ background: "rgba(185,28,28,0.06)", borderLeft: "2px solid #b91c1c", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {/* 日志表 */}
      <div className="overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-dim)" }}>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">时间</th>
              <th className="px-3 py-2 text-left font-medium w-16">级别</th>
              <th className="px-3 py-2 text-left font-medium w-44">模块</th>
              <th className="px-3 py-2 text-left font-medium">描述</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center" style={{ color: "var(--text-dim)" }}>
                  暂无匹配日志
                </td>
              </tr>
            )}
            {items.map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-3 py-1.5 whitespace-nowrap font-mono" style={{ color: "var(--text-dim)" }}>
                  {fmtTs(it.ts)}
                </td>
                <td className="px-3 py-1.5 font-medium" style={{ color: LEVEL_COLOR[it.level] ?? "inherit" }}>
                  {it.level}
                </td>
                <td className="px-3 py-1.5 font-mono truncate max-w-[180px]">{it.module}</td>
                <td className="px-3 py-1.5">
                  {it.message}
                  {it.detail != null && (
                    <span className="ml-2 font-mono" style={{ color: "var(--text-dim)" }}>
                      {typeof it.detail === "string" ? it.detail : JSON.stringify(it.detail)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--text-dim)" }}>
        日志异步批量落库（2s 刷新间隔），超过 30 天自动归档至 logs_archive 表；LOG_LEVEL 环境变量可调最低落库级别。
      </p>
    </main>
  );
}
