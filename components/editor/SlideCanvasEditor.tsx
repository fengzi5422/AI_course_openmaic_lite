"use client";

import { useCallback, useEffect, useRef } from "react";
import { CANVAS_W, CANVAS_H, PPTElement } from "@/lib/dsl";
import { ThemeTokens } from "@/lib/dsl/theme";
import { SlideRenderer } from "@/components/slide-renderer/SlideRenderer";
import { useStageScale, stageAspectStyle } from "@/components/slide-renderer/use-stage-scale";

/**
 * 幻灯片可视化编辑画布：
 * - 底层用 SlideRenderer 实时预览（与课堂渲染同源）；
 * - 顶层透明交互层：点击选中、拖拽移动、右下角手柄缩放，逻辑坐标 1280x720 随容器缩放。
 */

type DragState =
  | { kind: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; id: string; startX: number; startY: number; origW: number; origH: number }
  | null;

export function SlideCanvasEditor({
  elements,
  tokens,
  selectedId,
  onSelect,
  onChange,
}: {
  elements: PPTElement[];
  tokens: ThemeTokens;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (elements: PPTElement[]) => void;
}) {
  const { ref: wrapRef, scale, innerStyle } = useStageScale<HTMLDivElement>();
  const dragRef = useRef<DragState>(null);

  const patchElement = useCallback(
    (id: string, patch: Record<string, number>) => {
      onChange(
        elements.map((el) => (el.id === id ? ({ ...el, ...patch } as PPTElement) : el))
      );
    },
    [elements, onChange]
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;
      if (d.kind === "move") {
        patchElement(d.id, {
          x: Math.round(Math.max(0, Math.min(CANVAS_W - 40, d.origX + dx))),
          y: Math.round(Math.max(0, Math.min(CANVAS_H - 20, d.origY + dy))),
        });
      } else {
        patchElement(d.id, {
          w: Math.round(Math.max(60, Math.min(CANVAS_W, d.origW + dx))),
          h: Math.round(Math.max(30, Math.min(CANVAS_H, d.origH + dy))),
        });
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [scale, patchElement]);

  function startDrag(e: React.PointerEvent, el: PPTElement, kind: "move" | "resize") {
    e.stopPropagation();
    onSelect(el.id);
    dragRef.current =
      kind === "move"
        ? { kind, id: el.id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y }
        : { kind, id: el.id, startX: e.clientX, startY: e.clientY, origW: el.w, origH: el.h };
  }

  return (
    <div ref={wrapRef} className="w-full select-none" style={stageAspectStyle}>
      <div
        className="relative w-full overflow-hidden"
        style={{ ...stageAspectStyle, background: tokens.bg }}
        onPointerDown={() => onSelect(null)}
      >
        <div style={innerStyle} className="absolute left-0 top-0">
          {/* 底层：与课堂同源渲染 */}
          <SlideRenderer content={{ kind: "slide", elements }} tokens={tokens} />

          {/* 顶层：交互矩形 */}
          {elements.map((el) => {
            const sel = el.id === selectedId;
            return (
              <div
                key={el.id}
                className="absolute"
                style={{
                  left: el.x,
                  top: el.y,
                  width: el.w,
                  height: el.h,
                  cursor: "move",
                  border: sel ? "1.5px dashed var(--accent)" : "1px dashed transparent",
                  background: sel ? "rgba(29,78,216,0.03)" : "transparent",
                }}
                onPointerDown={(e) => startDrag(e, el, "move")}
              >
                {sel && (
                  <>
                    <span
                      className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm"
                      style={{ background: "var(--accent)", cursor: "nwse-resize" }}
                      onPointerDown={(e) => startDrag(e, el, "resize")}
                    />
                    <span
                      className="absolute -top-5 left-0 px-1 text-[10px] leading-4 whitespace-nowrap"
                      style={{ background: "var(--accent)", color: "#fff" }}
                    >
                      {el.type} · {Math.round(el.w)}×{Math.round(el.h)}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-1.5 text-xs" style={{ color: "var(--text-dim)" }}>
        点击元素选中，拖拽移动，右下角手柄缩放；详细属性在右侧面板编辑。
      </p>
    </div>
  );
}
