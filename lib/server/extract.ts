import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * 参考资料文本提取管线：
 * - txt/md：直接读取（含 GBK 兜底解码）
 * - docx：mammoth 提取正文
 * - pdf：unpdf（pdf.js）提取文字层 —— 最简单高效的首选路径；
 *   文字层稀疏（扫描件）时降级 PaddleOCR
 * - 图片（png/jpg/webp）：PaddleOCR
 * OCR 通过环境变量 OCR_SERVICE_URL 指向本地 PaddleOCR 服务
 * （参见 scripts/paddleocr_server.py），未配置时返回 needs_ocr 并给出指引。
 */

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
export const ALLOWED_EXTS = ["txt", "md", "docx", "pdf", "png", "jpg", "jpeg", "webp"] as const;
export type AllowedExt = (typeof ALLOWED_EXTS)[number];

export const IMAGE_EXTS: readonly string[] = ["png", "jpg", "jpeg", "webp"];
/** OCR 服务请求超时（长文档逐页识别较慢），可用 OCR_TIMEOUT_MS 环境变量调整 */
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS ?? 300_000);

export type ExtractStatus = "extracted" | "needs_ocr" | "failed";
export type ExtractMethod = "direct" | "paddleocr" | null;

export interface ExtractedPage {
  index: number;
  chars: number;
  text: string;
}

export interface ExtractResult {
  status: ExtractStatus;
  method: ExtractMethod;
  /** 全文（needs_ocr/failed 时为空串或部分内容） */
  text: string;
  /** 分页结构化数据（无页概念的类型为单页） */
  pages: ExtractedPage[];
  pageCount: number | null;
  charCount: number;
  /** 面向用户的附加说明（如缺少 OCR 服务的指引） */
  message?: string;
}

/** 上传校验：扩展名白名单 + 大小限制（纯函数，便于测试） */
export function validateUpload(
  filename: string,
  size: number
): { ok: true; ext: AllowedExt } | { ok: false; error: string } {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  if (!(ALLOWED_EXTS as readonly string[]).includes(ext)) {
    return { ok: false, error: `不支持的文件格式 .${ext || "(无扩展名)"}，仅支持：${ALLOWED_EXTS.join(" / ")}` };
  }
  if (size <= 0) return { ok: false, error: "文件为空" };
  if (size > MAX_FILE_SIZE) {
    return { ok: false, error: `文件超过大小限制（${Math.round(size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB）` };
  }
  return { ok: true, ext: ext as AllowedExt };
}

/** 稀疏文本判定：平均每页可见字符过少 → 视为扫描件需要 OCR（纯函数） */
export function isSparseText(pages: ExtractedPage[]): boolean {
  if (pages.length === 0) return true;
  const total = pages.reduce((acc, p) => acc + p.chars, 0);
  const perPage = total / pages.length;
  return total < 50 || perPage < 20;
}

/** 清洗文本：统一换行、去句尾空格、压缩连续空行 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 文本数组 → 分页结构（导出供测试与外部复用） */
export function toPages(texts: string[]): ExtractedPage[] {
  return texts.map((t, i) => ({ index: i, chars: t.length, text: t }));
}

function mergePages(pages: ExtractedPage[]): string {
  return cleanText(pages.map((p) => p.text).join("\n\n"));
}

export function ocrConfigured(): boolean {
  return Boolean(process.env.OCR_SERVICE_URL);
}

/** 文本解码：UTF-8 优先，出现替换符时尝试 GBK（Node 全量 ICU 支持） */
function decodeTextBytes(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  if (bad === 0) return utf8.replace(/^\uFEFF/, "");
  try {
    const gbk = new TextDecoder("gbk").decode(buffer);
    if (!(gbk.includes("\uFFFD") && !utf8.includes("\uFFFD"))) return gbk;
  } catch {
    /* 当前运行时不支持 GBK，保留 UTF-8 结果 */
  }
  return utf8;
}

/** txt / md：直接读取 */
function extractPlainText(buffer: Buffer): ExtractResult {
  const text = cleanText(decodeTextBytes(buffer));
  const pages = toPages([text]);
  return {
    status: "extracted",
    method: "direct",
    text,
    pages,
    pageCount: 1,
    charCount: text.length,
  };
}

/** docx：mammoth 提取正文（保留段落结构） */
async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const { value } = await mammoth.extractRawText({ buffer });
  const text = cleanText(value);
  return {
    status: "extracted",
    method: "direct",
    text,
    pages: toPages([text]),
    pageCount: 1,
    charCount: text.length,
  };
}

/**
 * PDF：优先提取文字层（最快最准）；
 * 扫描件（文字层稀疏）降级 PaddleOCR；OCR 未配置时标记 needs_ocr。
 */
async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  let pages: ExtractedPage[] = [];
  let pdfError: unknown = null;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    const arr = Array.isArray(text) ? text : [String(text)];
    pages = toPages(arr.map((t) => cleanText(t)));
  } catch (err) {
    pdfError = err;
  }

  if (!isSparseText(pages)) {
    const text = mergePages(pages);
    return {
      status: "extracted",
      method: "direct",
      text,
      pages,
      pageCount: pages.length,
      charCount: text.length,
    };
  }

  // 文字层稀疏或解析失败 → PaddleOCR
  if (ocrConfigured()) {
    try {
      const ocr = await ocrExtract(buffer, "document.pdf");
      if (ocr.pages.length > 0) {
        const text = mergePages(ocr.pages);
        return {
          status: "extracted",
          method: "paddleocr",
          text,
          pages: ocr.pages,
          pageCount: ocr.pages.length,
          charCount: text.length,
          message: pdfError ? "文字层提取失败，已通过 PaddleOCR 识别全文。" : "检测到扫描版 PDF，已通过 PaddleOCR 识别全文。",
        };
      }
    } catch (err) {
      return {
        status: "failed",
        method: null,
        text: "",
        pages: [],
        pageCount: null,
        charCount: 0,
        message: `PaddleOCR 识别失败：${String(err)}`,
      };
    }
  }

  return {
    status: "needs_ocr",
    method: null,
    text: "",
    pages,
    pageCount: pages.length || null,
    charCount: pages.reduce((acc, p) => acc + p.chars, 0),
    message: ocrConfigured()
      ? "未能从该 PDF 提取到有效文字。"
      : "该 PDF 疑似扫描件（无文字层）。请启动本地 PaddleOCR 服务并在 .env 配置 OCR_SERVICE_URL 后重试（参见 scripts/paddleocr_server.py）。",
  };
}

/** 图片：仅 PaddleOCR 路径 */
async function extractImage(buffer: Buffer, filename: string): Promise<ExtractResult> {
  if (ocrConfigured()) {
    try {
      const ocr = await ocrExtract(buffer, filename);
      const text = mergePages(ocr.pages);
      return {
        status: "extracted",
        method: "paddleocr",
        text,
        pages: ocr.pages,
        pageCount: 1,
        charCount: text.length,
      };
    } catch (err) {
      return {
        status: "failed",
        method: null,
        text: "",
        pages: [],
        pageCount: null,
        charCount: 0,
        message: `PaddleOCR 识别失败：${String(err)}`,
      };
    }
  }
  return {
    status: "needs_ocr",
    method: null,
    text: "",
    pages: [],
    pageCount: null,
    charCount: 0,
    message: "图片文字识别需要 PaddleOCR 服务：请启动 scripts/paddleocr_server.py 并在 .env 配置 OCR_SERVICE_URL。",
  };
}

interface OcrResponse {
  text?: string;
  pages?: Array<{ index?: number; text?: string }>;
}

/**
 * PaddleOCR HTTP 适配器：
 * POST OCR_SERVICE_URL（multipart，字段名 file）→ JSON {text, pages:[{index,text}]}
 * 服务端实现见 scripts/paddleocr_server.py（paddleocr + PyMuPDF 渲染 PDF 页面）。
 */
export async function ocrExtract(buffer: Buffer, filename: string): Promise<{ pages: ExtractedPage[] }> {
  const base = process.env.OCR_SERVICE_URL;
  if (!base) throw new Error("OCR_SERVICE_URL 未配置");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), filename);
  const res = await fetch(base, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OCR 服务返回 HTTP ${res.status}`);
  }
  const data = (await res.json()) as OcrResponse;
  let pages: ExtractedPage[] = [];
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    pages = data.pages.map((p, i) => {
      const t = cleanText(String(p.text ?? ""));
      return { index: typeof p.index === "number" ? p.index : i, chars: t.length, text: t };
    });
  } else if (data.text) {
    const t = cleanText(data.text);
    pages = [{ index: 0, chars: t.length, text: t }];
  }
  return { pages };
}

/** 统一入口：按扩展名分发提取 */
export async function extractFile(buffer: Buffer, filename: string): Promise<ExtractResult> {
  const v = validateUpload(filename, buffer.length);
  if (!v.ok) {
    return {
      status: "failed",
      method: null,
      text: "",
      pages: [],
      pageCount: null,
      charCount: 0,
      message: v.error,
    };
  }
  switch (v.ext) {
    case "txt":
    case "md":
      return extractPlainText(buffer);
    case "docx":
      try {
        return await extractDocx(buffer);
      } catch (err) {
        return {
          status: "failed",
          method: null,
          text: "",
          pages: [],
          pageCount: null,
          charCount: 0,
          message: `docx 解析失败（文件可能已损坏或为旧版 .doc 格式）：${String(err)}`,
        };
      }
    case "pdf":
      return extractPdf(buffer);
    default:
      return extractImage(buffer, filename);
  }
}
