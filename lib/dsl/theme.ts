/**
 * 主题 token（内容/布局/主题三分离，借鉴 ai-ppt-generator 的 Theme 模型）：
 * 主题只定义"环境与强调色"，元素内容色仍由数据自身携带，
 * 使同一份课程文档可在不同主题下渲染（Web 与未来 PPTX 导出同源）。
 */

export interface ThemeTokens {
  /** 舞台背景 */
  bg: string;
  /** 舞台次级背景（渐变端点/分区） */
  bgSoft: string;
  /** 默认标题色（渲染缺省时使用） */
  title: string;
  /** 正文色 */
  text: string;
  /** 弱化文字 */
  dim: string;
  /** 强调色（板书/高亮/选中） */
  accent: string;
  /** 强调色弱背景 */
  accentSoft: string;
  /** 测验选项底色 */
  quiz: string;
  /** 测验选项文字色 */
  quizText: string;
}

export interface Theme {
  id: string;
  name: string;
  tokens: ThemeTokens;
}

export const THEMES: Theme[] = [
  {
    id: "ivory",
    name: "米白学术",
    tokens: {
      bg: "#ffffff",
      bgSoft: "#f8fafc",
      title: "#1f2937",
      text: "#374151",
      dim: "#9ca3af",
      accent: "#f59e0b",
      accentSoft: "#fef3c7",
      quiz: "#dbeafe",
      quizText: "#1e3a8a",
    },
  },
  {
    id: "midnight",
    name: "深空夜课",
    tokens: {
      bg: "#0f172a",
      bgSoft: "#1e293b",
      title: "#f1f5f9",
      text: "#cbd5e1",
      dim: "#64748b",
      accent: "#38bdf8",
      accentSoft: "#0c4a6e",
      quiz: "#164e63",
      quizText: "#e0f2fe",
    },
  },
  {
    id: "mint",
    name: "薄荷清爽",
    tokens: {
      bg: "#f0fdfa",
      bgSoft: "#e6fffa",
      title: "#134e4a",
      text: "#33544f",
      dim: "#94a3b8",
      accent: "#0d9488",
      accentSoft: "#ccfbf1",
      quiz: "#d1fae5",
      quizText: "#065f46",
    },
  },
];

export const DEFAULT_THEME_ID = THEMES[0].id;

export function resolveTheme(id?: string | null): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isThemeId(id: unknown): id is string {
  return typeof id === "string" && THEMES.some((t) => t.id === id);
}

/** 生成端默认深色调色板：渲染时映射为主题文字色，保证深色主题可读性 */
const DEFAULT_DARKS = new Set([
  "#1f2937",
  "#374151",
  "#111827",
  "#1e293b",
  "#0f172a",
  "#000000",
  "#000",
  "#334155",
]);

/** 元素色 → 主题映射：命中默认调色板则替换，自定义色保留 */
export function mapElementColor(color: string, tokens: ThemeTokens, bold = false): string {
  const c = (color ?? "").trim().toLowerCase();
  if (!DEFAULT_DARKS.has(c)) return color;
  return bold ? tokens.title : tokens.text;
}
