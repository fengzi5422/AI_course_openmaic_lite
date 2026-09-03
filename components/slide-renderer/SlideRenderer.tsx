"use client";

import {
  CANVAS_W,
  CANVAS_H,
  ChartElement,
  ImageElement,
  SceneContent,
  ShapeElement,
  TableElement,
  TextElement,
} from "@/lib/dsl";
import { ThemeTokens, mapElementColor } from "@/lib/dsl/theme";

function TextEl({ el, tokens }: { el: TextElement; tokens: ThemeTokens }) {
  const lines = el.content.split("\n");
  return (
    <div
      className="absolute overflow-hidden whitespace-pre-wrap"
      style={{
        left: el.x,
        top: el.y,
        width: el.w,
        minHeight: el.h,
        fontSize: el.fontSize,
        color: mapElementColor(el.color, tokens, el.bold),
        fontWeight: el.bold ? 700 : 400,
        lineHeight: 1.4,
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function ShapeEl({ el }: { el: ShapeElement }) {
  const style = {
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    background: el.fill,
  } as const;
  return (
    <div
      className="absolute"
      style={{
        ...style,
        borderRadius: el.shape === "ellipse" ? "50%" : el.shape === "rect" ? 8 : 0,
        clipPath: el.shape === "triangle" ? "polygon(50% 0, 100% 100%, 0 100%)" : undefined,
      }}
    />
  );
}

function ImageEl({ el }: { el: ImageElement }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={el.src}
      alt=""
      className="absolute object-cover"
      style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
    />
  );
}

/** 结构化表格：表头走 accentSoft，正文斑马纹，整体 hairline 描边 */
function TableEl({ el, tokens }: { el: TableElement; tokens: ThemeTokens }) {
  const fontSize = el.fontSize ?? 20;
  const cols = Math.max(el.headers.length, 1);
  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.h,
        fontSize,
        border: `1px solid ${tokens.dim}`,
        borderRadius: 6,
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: "1fr",
        background: tokens.bg,
      }}
    >
      {el.headers.map((h, i) => (
        <div
          key={`h${i}`}
          className="flex items-center px-3 font-semibold truncate"
          style={{
            background: el.headerFill ?? tokens.accentSoft,
            color: tokens.title,
            borderRight: i < cols - 1 ? `1px solid ${tokens.dim}` : undefined,
            borderBottom: `1px solid ${tokens.dim}`,
          }}
        >
          {h}
        </div>
      ))}
      {el.rows.map((row, ri) =>
        row.map((cell, ci) => (
          <div
            key={`r${ri}c${ci}`}
            className="flex items-center px-3 truncate"
            style={{
              background: el.zebra !== false && ri % 2 === 1 ? tokens.bgSoft : tokens.bg,
              color: tokens.text,
              borderRight: ci < cols - 1 ? `1px solid ${tokens.dim}` : undefined,
              borderBottom: ri < el.rows.length - 1 ? `1px solid ${tokens.dim}` : undefined,
            }}
          >
            {cell}
          </div>
        ))
      )}
    </div>
  );
}

/** 水平条形图：label 左侧、条形按值占比、数值右侧；缺省色为主题 accent */
function ChartEl({ el, tokens }: { el: ChartElement; tokens: ThemeTokens }) {
  const max = Math.max(...el.data.map((d) => d.value), 1);
  const labelW = Math.min(Math.max(el.w * 0.3, 90), 220);
  const fontSize = Math.max(14, Math.min(22, el.h / (el.data.length * 2.6)));
  const barColor = el.color ? mapElementColor(el.color, tokens) : tokens.accent;
  return (
    <div
      className="absolute flex flex-col justify-between"
      style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
    >
      {el.data.map((d, i) => (
        <div key={i} className="flex items-center" style={{ gap: 10, height: `${100 / el.data.length}%` }}>
          <div
            className="shrink-0 truncate text-right"
            style={{ width: labelW, fontSize, color: tokens.text }}
            title={d.label}
          >
            {d.label}
          </div>
          <div className="flex-1 flex items-center" style={{ gap: 8 }}>
            <div
              style={{
                width: `${(d.value / max) * 100}%`,
                height: fontSize * 1.4,
                background: barColor,
                borderRadius: 3,
                minWidth: 4,
              }}
            />
            <span className="shrink-0 tabular-nums font-medium" style={{ fontSize, color: tokens.title }}>
              {d.value}
              {el.unit ?? ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 幻灯片渲染：把 SlideContent 渲染为 1280x720 绝对定位布局（tokens 为主题 token，内容/主题分离） */
export function SlideRenderer({ content, tokens }: { content: SceneContent; tokens: ThemeTokens }) {
  if (content.kind === "quiz") {
    return (
      <div
        className="absolute inset-0 flex flex-col items-start p-16 gap-6"
        style={{ background: tokens.bg }}
      >
        <div className="text-4xl font-bold" style={{ color: tokens.title }}>
          {content.question}
        </div>
        <div className="grid grid-cols-1 gap-4 w-full max-w-[900px]">
          {content.options.map((o, i) => (
            <div
              key={i}
              className="px-6 py-3 rounded-lg border text-2xl"
              style={{ borderColor: tokens.dim, color: tokens.quizText, background: tokens.quiz }}
            >
              {String.fromCharCode(65 + i)}. {o}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0" style={{ background: tokens.bg }}>
      {content.elements.map((el) => {
        if (el.type === "text") return <TextEl key={el.id} el={el} tokens={tokens} />;
        if (el.type === "shape") return <ShapeEl key={el.id} el={el} />;
        if (el.type === "table") return <TableEl key={el.id} el={el} tokens={tokens} />;
        if (el.type === "chart") return <ChartEl key={el.id} el={el} tokens={tokens} />;
        return <ImageEl key={el.id} el={el} />;
      })}
    </div>
  );
}
