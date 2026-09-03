import {
  Action,
  PPTElement,
  Scene,
  SceneContent,
  Stage,
} from "./index";
import { DEFAULT_THEME_ID, isThemeId } from "./theme";

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

function normalizeElement(raw: unknown): PPTElement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (type === "text") {
    return {
      id: str(r.id) || genId("el"),
      type: "text",
      content: str(r.content),
      x: num(r.x, 80),
      y: num(r.y, 80),
      w: num(r.w, CANVAS_DEFAULT_W),
      h: num(r.h, 80),
      fontSize: num(r.fontSize, 28),
      color: str(r.color, "#1f2937"),
      bold: r.bold === true,
    };
  }
  if (type === "image") {
    return {
      id: str(r.id) || genId("el"),
      type: "image",
      src: str(r.src),
      x: num(r.x, 0),
      y: num(r.y, 0),
      w: num(r.w, 480),
      h: num(r.h, 320),
    };
  }
  if (type === "shape") {
    const shape = ["rect", "ellipse", "triangle"].includes(str(r.shape))
      ? (str(r.shape) as "rect" | "ellipse" | "triangle")
      : "rect";
    return {
      id: str(r.id) || genId("el"),
      type: "shape",
      shape,
      x: num(r.x, 0),
      y: num(r.y, 0),
      w: num(r.w, 200),
      h: num(r.h, 120),
      fill: str(r.fill, "#93c5fd"),
    };
  }
  if (type === "table") {
    // 表头：字符串数组，最多 4 列
    const headers = (Array.isArray(r.headers) ? r.headers : [])
      .slice(0, 4)
      .map((h) => str(h))
      .filter(Boolean);
    // 行：每行裁剪到表头列数，剔除全空行
    const rows = (Array.isArray(r.rows) ? r.rows : [])
      .map((row) =>
        (Array.isArray(row) ? row : [])
          .slice(0, Math.max(headers.length, 1))
          .map((c) => str(c))
      )
      .filter((row) => row.some((c) => c.trim()));
    if (headers.length === 0 || rows.length === 0) return null;
    return {
      id: str(r.id) || genId("el"),
      type: "table",
      headers,
      rows,
      x: num(r.x, 0),
      y: num(r.y, 0),
      w: num(r.w, 520),
      h: num(r.h, 200),
      fontSize: num(r.fontSize, 20),
      headerFill: str(r.headerFill) || undefined,
      zebra: r.zebra !== false,
    };
  }
  if (type === "chart") {
    // 数据点：value 接受 number 或纯数字字符串，剔除非法项
    const data = (Array.isArray(r.data) ? r.data : [])
      .map((d) => {
        const p = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
        const raw = p.value;
        const v = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
        return { label: str(p.label), value: v };
      })
      .filter((d) => d.label.trim() && Number.isFinite(d.value))
      .map((d) => ({ label: d.label, value: Math.max(0, d.value) }))
      .slice(0, 6);
    if (data.length === 0) return null;
    return {
      id: str(r.id) || genId("el"),
      type: "chart",
      chart: "bar",
      data,
      x: num(r.x, 0),
      y: num(r.y, 0),
      w: num(r.w, 480),
      h: num(r.h, 220),
      color: str(r.color) || undefined,
      unit: str(r.unit) || undefined,
    };
  }
  return null;
}

const CANVAS_DEFAULT_W = 720;

function normalizeContent(raw: unknown): SceneContent {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (r.kind === "quiz") {
      const options = Array.isArray(r.options)
        ? r.options.map((o) => str(o)).filter(Boolean)
        : [];
      return {
        kind: "quiz",
        question: str(r.question),
        options,
        answerIndex: Math.max(0, Math.min(num(r.answerIndex, 0), Math.max(0, options.length - 1))),
        explanation: str(r.explanation) || undefined,
      };
    }
  }
  const elementsRaw =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).elements)
      ? ((raw as Record<string, unknown>).elements as unknown[])
      : [];
  const elements = elementsRaw
    .map(normalizeElement)
    .filter((e): e is PPTElement => e !== null);
  return { kind: "slide", elements };
}

function normalizeAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "speech":
      return { type: "speech", text: str(r.text) };
    case "spotlight":
      return {
        type: "spotlight",
        x: num(r.x, 640),
        y: num(r.y, 360),
        radius: num(r.radius, 200),
        text: str(r.text) || undefined,
      };
    case "wb_draw": {
      const pts = Array.isArray(r.points) ? r.points : [];
      const points: Array<[number, number]> = [];
      for (const p of pts) {
        if (Array.isArray(p) && p.length >= 2) {
          points.push([num(p[0], 0), num(p[1], 0)]);
        }
      }
      if (points.length === 0) return null;
      return {
        type: "wb_draw",
        points,
        color: str(r.color, "#f59e0b"),
        width: num(r.width, 4),
      };
    }
    case "wb_text":
      return {
        type: "wb_text",
        x: num(r.x, 0.5),
        y: num(r.y, 0.5),
        text: str(r.text),
        color: str(r.color, "#f59e0b"),
      };
    case "wb_clear":
      return { type: "wb_clear" };
    default:
      return null;
  }
}

export function normalizeScene(raw: unknown): Scene {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const actionsRaw = Array.isArray(r.actions) ? r.actions : [];
  return {
    id: str(r.id) || genId("sc"),
    title: str(r.title, "未命名场景"),
    content: normalizeContent(r.content),
    actions: actionsRaw
      .map(normalizeAction)
      .filter((a): a is Action => a !== null),
  };
}

/** 场景 id 去重：同一份 doc 内 id 必须唯一，重复时重新生成（防御脏数据） */
function dedupeSceneIds(scenes: Scene[]): Scene[] {
  const seen = new Set<string>();
  return scenes.map((s) => {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      return s;
    }
    const id = genId("sc");
    seen.add(id);
    return { ...s, id };
  });
}

/** 写入/播放前归一化：补默认值、剔除非法字段、保证 id 存在 */
export function normalizeStage(raw: unknown): Stage {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const scenesRaw = Array.isArray(r.scenes) ? r.scenes : [];
  return {
    id: str(r.id) || genId("stage"),
    title: str(r.title, "未命名课程"),
    description: str(r.description),
    scenes: dedupeSceneIds(scenesRaw.map(normalizeScene)),
    version: 1,
    // 老数据无 theme 或非法值 → 兜底默认主题
    theme: isThemeId(r.theme) ? r.theme : DEFAULT_THEME_ID,
  };
}
