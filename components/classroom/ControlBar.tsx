"use client";

import { memo } from "react";
import { Stage } from "@/lib/dsl";
import { PlaybackState } from "@/lib/playback/engine";

interface ControlBarProps {
  stage: Stage;
  pbState: PlaybackState;
  courseId?: string;
  onPlay: () => void;
  onPause: () => void;
  onSkip: () => void;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
}

function ControlBarInner({
  stage,
  pbState,
  courseId,
  onPlay,
  onPause,
  onSkip,
  onPrev,
  onNext,
  onJump,
}: ControlBarProps) {
  const playing = pbState.status === "playing";
  const finished = pbState.status === "finished";
  const scene = stage.scenes[pbState.sceneIndex];
  const actionTotal = scene?.actions.length ?? 0;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={onPrev}
          disabled={pbState.sceneIndex === 0}
          title="上一页 (←)"
        >
          ← 上一页
        </button>
        {!playing ? (
          <button
            className="btn-primary px-5 py-1.5 text-sm disabled:opacity-40"
            disabled={finished}
            onClick={onPlay}
            title="播放/继续 (空格)"
          >
            {pbState.status === "paused" ? "继续" : finished ? "已结束" : "播放"}
          </button>
        ) : (
          <button
            className="btn-primary px-5 py-1.5 text-sm"
            onClick={onPause}
            title="暂停 (空格)"
          >
            暂停
          </button>
        )}
        <button
          className="btn-ghost px-3 py-1.5 text-sm"
          onClick={onSkip}
          title="跳过当前讲解"
        >
          跳过讲解
        </button>
        <button
          className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={onNext}
          disabled={pbState.sceneIndex >= stage.scenes.length - 1}
          title="下一页 (→)"
        >
          下一页 →
        </button>
        <div className="ml-3 text-xs" style={{ color: "var(--text-dim)" }}>
          <span className="sec-num">{String(pbState.sceneIndex + 1).padStart(2, "0")}</span>
          <span> / {stage.scenes.length} · {scene?.title}</span>
        </div>
        <div className="ml-auto text-xs tabular-nums" style={{ color: "var(--text-dim)" }}>
          {playing || pbState.status === "scene-done"
            ? `讲点 ${Math.min(pbState.actionIndex + (playing ? 1 : 0), actionTotal)}/${actionTotal}`
            : ""}
        </div>
        {courseId && (
          <details className="relative ml-2">
            <summary
              className="btn-ghost px-3 py-1.5 text-sm cursor-pointer list-none select-none"
              title="导出课件"
            >
              下载
            </summary>
            <div
              className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-md border shadow-lg"
              style={{ background: "var(--bg)", borderColor: "var(--border)" }}
            >
              <a
                className="block px-3 py-2 text-sm hover:opacity-70"
                href={`/api/export/pptx?courseId=${courseId}`}
                download
              >
                PowerPoint（.pptx）
              </a>
              <a
                className="block px-3 py-2 text-sm hover:opacity-70"
                href={`/api/export/html?courseId=${courseId}`}
                download
              >
                可编辑网页（.html）
              </a>
              <a
                className="block px-3 py-2 text-sm hover:opacity-70"
                href={`/api/export/pdf?courseId=${courseId}`}
                download
              >
                PDF（.pdf）
              </a>
            </div>
          </details>
        )}
      </div>

      {/* 讲解进度条 */}
      {actionTotal > 0 && (
        <div
          className="h-px overflow-hidden"
          style={{ background: "var(--border)" }}
        >
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${(pbState.actionIndex / actionTotal) * 100}%`,
              background: "var(--accent)",
              height: "2px",
            }}
          />
        </div>
      )}

      {/* 场景快速跳转 */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {stage.scenes.map((s, i) => (
          <button
            key={`${i}-${s.id}`}
            onClick={() => onJump(i)}
            className={`px-2.5 py-1 text-xs transition-colors ${
              i === pbState.sceneIndex ? "btn-primary" : "btn-ghost"
            }`}
          >
            {String(i + 1).padStart(2, "0")} {s.title}
            {s.content.kind === "quiz" ? " ·测" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

export const ControlBar = memo(ControlBarInner);
