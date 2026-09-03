import { createOpenAI } from "@ai-sdk/openai";
import {
  defaultSettingsMiddleware,
  generateText,
  wrapLanguageModel,
} from "ai";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("llm");

/** 清理环境变量值：去首尾空白与包裹引号（防 .env 手误） */
function cleanEnv(value: string | undefined): string | undefined {
  const v = value?.trim().replace(/^["']|["']$/g, "").trim();
  return v || undefined;
}

/** OpenAI 兼容 Provider：BASE_URL / API_KEY / MODEL 全部可配 */
export function resolveModel() {
  const apiKey = cleanEnv(process.env.LLM_API_KEY);
  if (!apiKey) {
    throw new Error(
      "未配置 LLM_API_KEY。请在 .env 中设置 LLM_API_KEY（以及可选 LLM_BASE_URL、LLM_MODEL）。"
    );
  }
  const baseURL = cleanEnv(process.env.LLM_BASE_URL) || "https://api.openai.com/v1";
  const modelId = cleanEnv(process.env.LLM_MODEL) || "gpt-4o-mini";
  const provider = createOpenAI({ apiKey, baseURL });
  // 显式走 Chat Completions API：第三方 OpenAI 兼容服务大多没有 /responses 端点
  return provider.chat(modelId);
}

/** LLM 客户端接口抽象：生成模块只依赖此接口而非具体 Provider（依赖注入，便于测试与替换） */
export interface LLMClient {
  complete(
    system: string,
    user: string,
    temperature?: number,
    opts?: { json?: boolean }
  ): Promise<string>;
}

/** 统一 LLM 调用入口，供生成流水线复用 */
export async function callLLM(
  system: string,
  user: string,
  temperature = 0.7,
  opts?: { json?: boolean }
): Promise<string> {
  const base = {
    model: resolveModel(),
    system,
    prompt: user,
    temperature,
    maxOutputTokens: 8192,
  };
  // 结构化输出（借鉴 ai-ppt-generator 的 json_mode）：通过模型中间件注入
  // responseFormat=json 约束；个别兼容服务不支持该参数时自动降级为普通文本 + 下游 JSON 修复。
  if (opts?.json) {
    try {
      const jsonModel = wrapLanguageModel({
        model: resolveModel(),
        middleware: defaultSettingsMiddleware({
          settings: { responseFormat: { type: "json" } },
        }),
      });
      const { text } = await generateText({ ...base, model: jsonModel });
      return text;
    } catch (err) {
      log.warn("json_mode 调用失败，降级为普通文本 + JSON 修复", String(err));
    }
  }
  const { text } = await generateText(base);
  return text;
}

/** 默认客户端（OpenAI 兼容实现）；测试或替代实现可注入自定义 LLMClient */
export const defaultLLM: LLMClient = { complete: callLLM };
