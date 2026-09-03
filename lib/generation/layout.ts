import { CANVAS_W, CANVAS_H, PPTElement, TextElement } from "@/lib/dsl";

/**
 * 确定性排版引擎：对 LLM 生成的元素做「夹取画布 → 文本高度自适应 → 分栏推下消重叠」
 * 三步修复，消除文字覆盖与越界。全部为纯函数，供生成质量门禁与编辑器「整理布局」共用。
 */

/* ---------------- 文本溢出估算（启发式，替代 FontTools 字形级测量） ---------------- */

/** 估算一行文本的像素宽度：中文/全角 ≈ 1.0em，ASCII ≈ 0.55em */
function estimateLineWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    units += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
  }
  return units * fontSize;
}

/** 估算文本渲染总高度；超出元素高度即认为溢出（显式换行按多行计） */
export function estimateTextOverflow(el: TextElement): boolean {
  const lineHeight = el.fontSize * 1.5;
  const lines = el.content
    .split("\n")
    .reduce((acc, seg) => acc + Math.max(1, Math.ceil(estimateLineWidth(seg, el.fontSize) / Math.max(el.w, 1))), 0);
  return lines * lineHeight > el.h + 4; // 4px 容差
}

/** 计算文本在指定字号下的自然行数（显式换行按多行计） */
function countLines(content: string, fontSize: number, w: number): number {
  return content
    .split("\n")
    .reduce((acc, seg) => acc + Math.max(1, Math.ceil(estimateLineWidth(seg, fontSize) / Math.max(w, 1))), 0);
}

/** 两阶段确定性修复（借鉴 fit_tree_to_content「高度随内容自适应」思想）：
 * 1. 保持字号，把 h 扩展到自然高度（受画布底部约束，只扩不缩）；
 * 2. 仍放不下则按比例降字号（下限 14px）并重新扩高。
 * 极端超长文本仍无法容纳时保留原状，交给 LLM 自纠轮处理。 */
export function fitTextElement(el: TextElement): TextElement {
  if (!estimateTextOverflow(el)) return el;
  const maxH = CANVAS_H - el.y - 8;

  let candidate: TextElement = {
    ...el,
    h: Math.min(maxH, Math.max(el.h, countLines(el.content, el.fontSize, el.w) * el.fontSize * 1.5)),
  };
  if (!estimateTextOverflow(candidate)) return candidate;

  let size = el.fontSize;
  while (size > 14) {
    size = Math.max(14, Math.floor(size * 0.85));
    candidate = {
      ...candidate,
      fontSize: size,
      h: Math.min(maxH, Math.max(candidate.h, countLines(el.content, size, el.w) * size * 1.5)),
    };
    if (!estimateTextOverflow(candidate)) return candidate;
    if (size <= 14) break;
  }
  return candidate;
}

/* ---------------- 布局修复 ---------------- */

const EDGE = 8; // 画布安全边距
const GAP = 12; // 文本块之间的推荐间隙

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 4): boolean {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

/** 元素夹取到画布内（越界/塌缩修正） */
function clampElement<T extends PPTElement>(el: T): T {
  const w = Math.max(el.type === "text" ? 60 : 40, Math.min(el.w, CANVAS_W - EDGE * 2));
  const h = Math.max(20, Math.min(el.h, CANVAS_H - EDGE * 2));
  return {
    ...el,
    x: Math.min(Math.max(el.x, EDGE), CANVAS_W - EDGE - w),
    y: Math.min(Math.max(el.y, EDGE), CANVAS_H - EDGE - h),
    w,
    h,
  };
}

function isTitle(el: TextElement): boolean {
  return el.bold === true && el.fontSize >= 32;
}

/**
 * 文本消重叠：按左右栏分组（中点 x < 640 为左栏），栏内按 y 排序后顺序推下。
 * 标题保持原位（先参与占位），正文遇到已放置矩形时下沉到其底部 + GAP。
 * shape/image/table/chart 仅夹取不移动（shape 常为文本底衬，移动反而破坏设计）。
 */
export function relayoutSlideElements(elements: PPTElement[]): PPTElement[] {
  const clamped = elements.map((el) =>
    el.type === "text" ? fitTextElement(clampElement(el)) : clampElement(el)
  );

  // 已放置矩形（标题优先占位）
  const placed: Rect[] = [];
  const out: PPTElement[] = clamped.map((el) => ({ ...el }));

  out.forEach((el) => {
    if (el.type === "text" && isTitle(el)) placed.push(el);
  });

  const body = out
    .filter((el): el is TextElement => el.type === "text" && !isTitle(el))
    .sort((a, b) => {
      const colA = a.x + a.w / 2 < CANVAS_W / 2 ? 0 : 1;
      const colB = b.x + b.w / 2 < CANVAS_W / 2 ? 0 : 1;
      return colA !== colB ? colA - colB : a.y - b.y;
    });

  for (const el of body) {
    let { x, y } = el;
    // 与任何已放置矩形重叠则下沉（最多尝试 12 次，防止死循环）
    for (let i = 0; i < 12; i++) {
      const hit = placed.find((r) => rectsOverlap({ x, y, w: el.w, h: el.h }, r));
      if (!hit) break;
      y = hit.y + hit.h + GAP;
    }
    // 底部兜底：放不下时上收（罕见极端情况）
    const maxBottom = CANVAS_H - EDGE;
    if (y + el.h > maxBottom) y = Math.max(EDGE, maxBottom - el.h);
    el.x = x;
    el.y = y;
    placed.push(el);
  }

  return out;
}
