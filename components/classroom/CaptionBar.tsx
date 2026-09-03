"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 讲稿字幕条：打字机逐字显示，播放状态下自动跟随。
 * 自管理动画状态，不触发父组件重渲染。
 */
export function CaptionBar({ text, active }: { text: string; active: boolean }) {
  const [shown, setShown] = useState("");
  const [typing, setTyping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!active || !text) {
      setShown("");
      setTyping(false);
      return;
    }
    setTyping(true);
    let i = 0;
    setShown("");
    timerRef.current = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        setTyping(false);
      }
    }, 45);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, active]);

  if (!active || !text) return null;

  return (
    <div className="panel px-5 py-3 anim-fade-up">
      <div className="flex items-start gap-3">
        <span
          className="shrink-0 mt-0.5 text-xs tracking-widest px-1.5 py-0.5 font-display"
          style={{ border: "1px solid var(--border-strong)", color: "var(--accent)" }}
        >
          讲师
        </span>
        <p className="text-sm leading-6 m-0" style={{ color: "var(--text)" }}>
          {shown}
          {typing && <span className="caption-cursor" />}
        </p>
      </div>
    </div>
  );
}
