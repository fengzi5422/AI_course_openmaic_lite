import { Scene } from "./index";

/** 占位场景标记（speech 文本前缀），用于客户端识别"生成失败的场景"（纯函数，客户端安全） */
export const DEGRADED_SPEECH_PREFIX = "【占位】";

/** 客户端识别降级场景，提取重试所需信息 */
export function degradedSceneInfo(scene: Scene): { title: string; points: string[] } | null {
  if (scene.content.kind !== "slide") return null;
  const alone =
    scene.actions.length === 1 &&
    scene.actions[0].type === "speech" &&
    scene.actions[0].text.startsWith(DEGRADED_SPEECH_PREFIX);
  if (!alone) return null;
  const els = scene.content.elements;
  const body = els[1] && els[1].type === "text" ? els[1].content : "";
  const points = body.split("\n").map((s) => s.trim()).filter(Boolean);
  return { title: scene.title, points };
}
