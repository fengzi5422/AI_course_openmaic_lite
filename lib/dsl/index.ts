/**
 * 课程数据契约（DSL）：纯类型 + 校验 + 归一化。
 * 所有生成、渲染、播放、持久化代码只依赖本模块，形成单向依赖。
 */

/** 画布逻辑尺寸，渲染时按容器等比缩放 */
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

/* ---------------- 幻灯片元素 ---------------- */

export interface TextElement {
  id: string;
  type: "text";
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  color: string;
  bold?: boolean;
}

export interface ImageElement {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeElement {
  id: string;
  type: "shape";
  shape: "rect" | "ellipse" | "triangle";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/** 结构化表格：表头 + 行数据。配色缺省走主题 token（accentSoft 表头 / bgSoft 斑马纹） */
export interface TableElement {
  id: string;
  type: "table";
  headers: string[];
  rows: string[][];
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  /** 表头底色（缺省用主题 accentSoft） */
  headerFill?: string;
  /** 隔行斑马纹，默认开启 */
  zebra?: boolean;
}

export interface ChartDataPoint {
  label: string;
  value: number;
}

/** 数据图形（水平条形图）：强调数字对比，缺省色为主题 accent */
export interface ChartElement {
  id: string;
  type: "chart";
  chart: "bar";
  data: ChartDataPoint[];
  x: number;
  y: number;
  w: number;
  h: number;
  /** 条形颜色（缺省用主题 accent） */
  color?: string;
  /** 数值单位，如 "%"、"分钟" */
  unit?: string;
}

export type PPTElement = TextElement | ImageElement | ShapeElement | TableElement | ChartElement;

/* ---------------- 场景内容 ---------------- */

export interface SlideContent {
  kind: "slide";
  elements: PPTElement[];
}

export interface QuizContent {
  kind: "quiz";
  question: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
}

export type SceneContent = SlideContent | QuizContent;

/* ---------------- 动作 ---------------- */

export interface SpeechAction {
  type: "speech";
  text: string;
}

/** 聚光灯：高亮 (x,y) 为圆心 radius 的区域，坐标为画布逻辑坐标 */
export interface SpotlightAction {
  type: "spotlight";
  x: number;
  y: number;
  radius: number;
  text?: string;
}

/** 白板绘制，points 为 0..1 归一化坐标 */
export interface WbDrawAction {
  type: "wb_draw";
  points: Array<[number, number]>;
  color?: string;
  width?: number;
}

export interface WbTextAction {
  type: "wb_text";
  x: number; // 0..1
  y: number; // 0..1
  text: string;
  color?: string;
}

export interface WbClearAction {
  type: "wb_clear";
}

export type Action =
  | SpeechAction
  | SpotlightAction
  | WbDrawAction
  | WbTextAction
  | WbClearAction;

/* ---------------- 场景与课程 ---------------- */

export interface Scene {
  id: string;
  title: string;
  content: SceneContent;
  actions: Action[];
}

export interface Stage {
  id: string;
  title: string;
  description: string;
  scenes: Scene[];
  version: 1;
  /** 主题 token id（内容/布局/主题分离；normalize 时兜底为默认主题） */
  theme: string;
}

/** 生成阶段一：可编辑大纲 */
export interface SceneOutline {
  title: string;
  points: string[];
}

/** 持久化记录（不含 doc 本体） */
export interface CourseMeta {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
