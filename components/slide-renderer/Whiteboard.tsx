"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { CANVAS_W, CANVAS_H } from "@/lib/dsl";

export interface WhiteboardHandle {
  drawPath(
    points: Array<[number, number]>,
    color: string,
    width: number,
    instant: boolean
  ): Promise<void>;
  drawText(x: number, y: number, text: string, color: string): void;
  clear(): void;
}

/** 白板覆盖层：canvas 与幻灯片同尺寸（1280x720），points 使用 0..1 归一化坐标 */
export const Whiteboard = forwardRef<WhiteboardHandle>(function Whiteboard(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useImperativeHandle(ref, () => ({
    async drawPath(points, color, width, instant) {
      const canvas = canvasRef.current;
      if (!canvas || points.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const px = (p: [number, number]) => [p[0] * CANVAS_W, p[1] * CANVAS_H] as const;

      if (instant) {
        ctx.beginPath();
        const [x0, y0] = px(points[0]);
        ctx.moveTo(x0, y0);
        for (const p of points.slice(1)) {
          const [x, y] = px(p);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        return;
      }
      // 动画绘制
      const [x0, y0] = px(points[0]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      const seg = Math.max(16, Math.min(1200, points.length * 40));
      const perFrame = Math.max(1, Math.ceil(points.length / seg));
      for (let i = 1; i < points.length; i += perFrame) {
        for (let j = i; j < Math.min(i + perFrame, points.length); j++) {
          const [x, y] = px(points[j]);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        await new Promise((r) => setTimeout(r, 16));
      }
      const [xl, yl] = px(points[points.length - 1]);
      ctx.lineTo(xl, yl);
      ctx.stroke();
    },
    drawText(x, y, text, color) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = color;
      ctx.font = "bold 32px sans-serif";
      ctx.textBaseline = "top";
      const lines = text.split("\n");
      lines.forEach((l, i) => ctx.fillText(l, x * CANVAS_W, y * CANVAS_H + i * 40));
    },
    clear() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.getContext("2d")?.clearRect(0, 0, CANVAS_W, CANVAS_H);
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className="absolute inset-0 pointer-events-none"
    />
  );
});
