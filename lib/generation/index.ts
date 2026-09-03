/**
 * 生成模块（lib/generation）公共 API —— 模块边界声明。
 * ⚠️ 本 barrel 传递依赖服务端设施（logger→pg），仅限服务端（app/api 路由、脚本）导入；
 * 客户端组件请导入 client-safe 的具体模块：
 *   - 纯函数：lib/dsl/*（含 degraded.ts）、lib/generation/layout.ts
 *   - 渲染：components/slide-renderer/*
 *
 * 模块分层：
 *   lib/dsl        — 领域模型与校验/规整（纯数据，无 IO，客户端安全）
 *   lib/ai         — LLM 客户端接口抽象（LLMClient）与 OpenAI 兼容实现（server-only）
 *   lib/generation — 生成流水线（大纲/场景/参考资料注入/质量门禁/排版修复）
 *   lib/server     — 基础设施（db / logger / 参考资料存取 / 文件提取）（server-only）
 */
export { generateOutlines } from "./outline-generator";
export type { OutlineResult } from "./outline-generator";
export {
  generateScenes,
  generateScenesStream,
  generateScene,
  synthesizeSpeech,
  degradedSceneInfo,
  DEGRADED_SPEECH_PREFIX,
} from "./scene-generator";
export type { SceneGenResult, SceneGenEvent } from "./scene-generator";
export { buildReferenceContext } from "./reference-context";
export type { ReferenceContext } from "./reference-context";
export { mockOutlines, mockStage } from "./mock";
export { applyDeterministicFixes, checkScene, isRepairWorthy } from "./quality-check";
export type { SceneIssue } from "./quality-check";
export { relayoutSlideElements, fitTextElement, rectsOverlap } from "./layout";
