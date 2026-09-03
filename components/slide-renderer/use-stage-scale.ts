"use client";

import { useEffect, useRef, useState } from "react";
import { CANVAS_W, CANVAS_H } from "@/lib/dsl";

/** 1280x720 逻辑画布，按容器宽度等比缩放 */
export function useStageScale<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(el.clientWidth / CANVAS_W);
    });
    ro.observe(el);
    setScale(el.clientWidth / CANVAS_W);
    return () => ro.disconnect();
  }, []);

  return { ref, scale, innerStyle: { width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, transformOrigin: "top left" } as const };
}

export const stageAspectStyle = { aspectRatio: `${CANVAS_W} / ${CANVAS_H}` };
