import { Scene, Stage } from "./index";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 结构校验：normalize 之后调用，保证生成端与播放端数据一致 */
export function validateStage(stage: Stage): ValidationResult {
  const errors: string[] = [];
  if (!stage.id) errors.push("stage.id 缺失");
  if (!stage.title?.trim()) errors.push("stage.title 不能为空");
  if (!Array.isArray(stage.scenes)) errors.push("stage.scenes 必须为数组");

  const sceneIds = new Set<string>();
  (stage.scenes ?? []).forEach((scene: Scene, i: number) => {
    const tag = `scenes[${i}]`;
    if (!scene.id) errors.push(`${tag}.id 缺失`);
    else if (sceneIds.has(scene.id)) errors.push(`${tag}.id 重复: ${scene.id}`);
    else sceneIds.add(scene.id);

    if (!scene.title?.trim()) errors.push(`${tag}.title 不能为空`);

    const c = scene.content;
    if (!c || (c.kind !== "slide" && c.kind !== "quiz")) {
      errors.push(`${tag}.content 类型非法`);
    } else if (c.kind === "slide") {
      if (!Array.isArray(c.elements)) errors.push(`${tag}.content.elements 必须为数组`);
    } else {
      if (!c.question?.trim()) errors.push(`${tag}.quiz.question 不能为空`);
      if (!Array.isArray(c.options) || c.options.length < 2)
        errors.push(`${tag}.quiz.options 至少 2 项`);
      else if (c.answerIndex < 0 || c.answerIndex >= c.options.length)
        errors.push(`${tag}.quiz.answerIndex 越界`);
    }

    if (!Array.isArray(scene.actions)) errors.push(`${tag}.actions 必须为数组`);
    (scene.actions ?? []).forEach((a, j) => {
      if (a.type === "speech" && !a.text?.trim())
        errors.push(`${tag}.actions[${j}] speech.text 不能为空`);
    });
  });

  return { ok: errors.length === 0, errors };
}
