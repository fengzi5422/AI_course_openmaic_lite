/**
 * PDF 导出：puppeteer-core 驱动本机 Chrome/Edge，将打印版 HTML 渲染为 PDF。
 * 无需下载 Chromium（复用系统浏览器）；可用 CHROME_PATH 指定浏览器路径。
 */
import puppeteer from "puppeteer-core";
import { Stage } from "@/lib/dsl";
import { buildPrintableHtml } from "./html";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : "",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((p): p is string => Boolean(p));

function findBrowser(): string | null {
  // 同步探测：文件存在性检查足够快
  for (const p of CANDIDATES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { existsSync } = require("fs") as typeof import("fs");
      if (existsSync(p)) return p;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

export function hasBrowser(): boolean {
  return findBrowser() !== null;
}

export async function stageToPdfBuffer(stage: Stage): Promise<Buffer> {
  const executablePath = findBrowser();
  if (!executablePath) {
    throw new Error("未找到本机 Chrome/Edge，无法导出 PDF；可设置 CHROME_PATH 指向浏览器可执行文件");
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(buildPrintableHtml(stage), {
      waitUntil: ["load", "domcontentloaded"],
      timeout: 60000,
    });
    // 等待所有图片加载完成（失败也放行，渲染占位）
    await page.evaluate(
      () =>
        Promise.all(
          Array.from(document.images)
            .filter((img) => !img.complete)
            .map((img) => new Promise<void>((r) => {
              img.onload = () => r();
              img.onerror = () => r();
            }))
        )
    );
    const buf = await page.pdf({
      width: "13.333in",
      height: "7.5in",
      printBackground: true,
      preferCSSPageSize: false,
      // Chrome 打印管线可能附加一页尾部空白页；按场景数硬性限定页数
      pageRanges: `1-${Math.max(stage.scenes.length, 1)}`,
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
