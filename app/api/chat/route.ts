import { streamText } from "ai";
import { resolveModel } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** POST /api/chat {context, messages} → SSE 流式回答 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      context?: string;
      messages?: ChatMessage[];
    };
    const messages = (body.messages ?? []).filter(
      (m) => (m.role === "user" || m.role === "assistant") && m.content?.trim()
    );
    if (messages.length === 0) {
      return new Response("messages 不能为空", { status: 400 });
    }
    if (!process.env.LLM_API_KEY) {
      return new Response("未配置 LLM_API_KEY", { status: 500 });
    }

    const result = streamText({
      model: resolveModel(),
      system: `你是一位耐心的课堂老师，正在给学生答疑。请基于下方课程内容用中文回答学生的问题；若课程内容未覆盖，可给出通用知识并说明。
<课程内容>
${(body.context ?? "").slice(0, 8000)}
</课程内容>`,
      messages,
      temperature: 0.5,
      maxOutputTokens: 2048,
    });
    return result.toTextStreamResponse();
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}
