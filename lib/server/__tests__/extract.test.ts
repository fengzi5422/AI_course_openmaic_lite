import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXTS,
  cleanText,
  isSparseText,
  toPages,
  validateUpload,
} from "../extract";

describe("validateUpload", () => {
  it("白名单内的扩展名通过", () => {
    for (const ext of ALLOWED_EXTS) {
      expect(validateUpload(`file.${ext}`, 100)).toEqual({ ok: true, ext });
    }
    // 大小写不敏感
    expect(validateUpload("A.PDF", 100)).toEqual({ ok: true, ext: "pdf" });
  });

  it("拒绝不支持的格式", () => {
    expect(validateUpload("a.exe", 100).ok).toBe(false);
    expect(validateUpload("noext", 100).ok).toBe(false);
    const r = validateUpload("a.doc", 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("doc");
  });

  it("拒绝空文件与超限文件", () => {
    expect(validateUpload("a.txt", 0).ok).toBe(false);
    const big = validateUpload("a.pdf", 21 * 1024 * 1024);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toContain("大小限制");
  });
});

describe("isSparseText", () => {
  it("空页数组视为稀疏", () => {
    expect(isSparseText([])).toBe(true);
  });

  it("文字层充足不稀疏", () => {
    const pages = toPages(["一".repeat(500), "二".repeat(500)]);
    expect(isSparseText(pages)).toBe(false);
  });

  it("扫描件（每页近无文字）判为稀疏", () => {
    const pages = toPages(["", "A", " "]);
    expect(isSparseText(pages)).toBe(true);
  });
});

describe("cleanText", () => {
  it("统一换行并压缩空行", () => {
    expect(cleanText("a\r\n\r\n\r\nb")).toBe("a\n\nb");
    expect(cleanText("  行尾空格   \n")).toBe("行尾空格");
  });
});
