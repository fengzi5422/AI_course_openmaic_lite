import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 互动课堂",
  description: "输入主题，AI 生成可播放的互动课堂",
};

/** 首帧前应用 localStorage 主题，防止闪烁 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="light")document.documentElement.classList.add("light");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
