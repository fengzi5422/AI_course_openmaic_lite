import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署：输出自包含产物（.next/standalone）
  output: "standalone",
  // PDF/DOCX 解析库与 PPTX/PDF 导出库包含动态加载逻辑，保持为服务端外部依赖
  serverExternalPackages: ["unpdf", "mammoth", "pptxgenjs", "puppeteer-core"],
};

export default nextConfig;
