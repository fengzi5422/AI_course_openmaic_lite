import { getReferencesByIds } from "@/lib/server/references";

/**
 * 参考资料上下文构建器：
 * 将选中的参考资料全文按预算均匀截取，格式化为可注入 LLM prompt 的摘要块。
 * 注入两阶段生成（大纲 + 场景），使课程内容忠于资料中的事实、数据与案例。
 */

/** 参考资料总字符预算（中文约 1 字 ≈ 0.6~1 token，12k 字对 64k 上下文安全） */
const TOTAL_BUDGET = 12_000;

export interface ReferenceContext {
  /** 格式化后的摘要块（直接拼入 user prompt） */
  text: string;
  /** 实际使用的资料文件名 */
  names: string[];
  /** 所有资料的原始总字符数 */
  totalChars: number;
  /** 是否因预算发生了截取 */
  truncated: boolean;
}

export async function buildReferenceContext(
  referenceIds?: string[] | null,
  budget: number = TOTAL_BUDGET
): Promise<ReferenceContext | null> {
  const ids = (referenceIds ?? []).filter((id) => typeof id === "string" && id.trim());
  if (ids.length === 0) return null;
  const records = await getReferencesByIds(ids);
  if (records.length === 0) return null;

  const totalChars = records.reduce((acc, r) => acc + r.charCount, 0);
  const perRef = Math.max(500, Math.floor(budget / records.length));
  const truncated = totalChars > budget;

  const blocks = records.map((r, i) => {
    let content = r.content;
    let note = `${r.charCount} 字`;
    if (content.length > perRef) {
      content = content.slice(0, perRef);
      note += `，此处节选前 ${perRef} 字`;
    }
    return `【参考资料 ${i + 1}：${r.filename}】（全文 ${note}）\n${content}`;
  });

  const text = blocks.join("\n\n");
  return {
    text,
    names: records.map((r) => r.filename),
    totalChars,
    truncated,
  };
}
