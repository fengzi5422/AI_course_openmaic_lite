/**
 * 轻量 JSON 修复：从 LLM 输出中提取并修复常见 JSON 格式问题。
 */

/** 去掉 markdown 代码围栏与前后噪声，截取第一个平衡的 JSON 值 */
export function extractJson(raw: string): string | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // 找到第一个 { 或 [ 开始做括号平衡扫描（忽略字符串字面量内）
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // 未闭合：截到末尾，交给 repair 补齐
  return text.slice(start);
}

function stripTrailingCommas(s: string): string {
  // 移除 } 或 ] 前的逗号（忽略字符串内）
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === "}" || s[j] === "]") continue; // 跳过该逗号
    }
    out += ch;
  }
  return out;
}

/** 修复未闭合的括号与引号，尽量返回可解析的 JSON 文本 */
function closeUnclosed(s: string): string {
  let inStr = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  // 若末尾是悬空逗号，先去掉
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

/** 解析失败则修复后重试；最终失败返回 null */
export function parseLooseJson<T = unknown>(raw: string): T | null {
  const candidate = extractJson(raw);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* fallthrough */
  }
  try {
    const repaired = closeUnclosed(stripTrailingCommas(candidate));
    // 残缺输入补全后若只是空容器（如 "{" → "{}"），视为不可挽救
    if ((repaired === "{}" || repaired === "[]") && candidate.trim() !== repaired) {
      return null;
    }
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}
