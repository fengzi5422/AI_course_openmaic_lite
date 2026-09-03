"use client";

import { CANVAS_W, CANVAS_H } from "@/lib/dsl";

export interface SpotlightState {
  x: number;
  y: number;
  radius: number;
  text?: string;
}

/** 聚光灯遮罩：在逻辑坐标 (x,y) 处开一个半径 radius 的孔 */
export function Spotlight({ s }: { s: SpotlightState }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        className="absolute rounded-full"
        style={{
          left: s.x - s.radius,
          top: s.y - s.radius,
          width: s.radius * 2,
          height: s.radius * 2,
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.78)",
        }}
      />
      {s.text ? (
        <div
          className="absolute text-white text-3xl font-semibold"
          style={{ left: s.x, top: s.y + s.radius + 24, transform: "translateX(-50%)" }}
        >
          {s.text}
        </div>
      ) : null}
    </div>
  );
}

export const spotlightCanvasSize = { CANVAS_W, CANVAS_H };
