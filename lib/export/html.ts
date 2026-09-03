/**
 * HTML 导出：与 DSL 同源的单文件导出。
 *  - buildEditableHtml：可编辑单文件 HTML（contenteditable + 导航 + 自保存下载）
 *  - buildPrintableHtml：静态分页打印版（供 puppeteer 生成 PDF，也可人工打印）
 * 共享 renderSceneToHtml 保证两种格式视觉一致（配色来自主题 token）。
 */
import {
  CANVAS_H,
  CANVAS_W,
  ChartElement,
  Scene,
  Stage,
  TableElement,
} from "@/lib/dsl";
import { resolveTheme } from "@/lib/dsl/theme";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function px(n: number): string {
  return `${Math.round(n)}px`;
}

/** 单个场景 → HTML 片段（1280x720 逻辑坐标，绝对定位） */
export function renderSceneToHtml(scene: Scene, editable: boolean, tokens: {
  bg: string; text: string; dim: string; accent: string; accentSoft: string; bgSoft: string;
}): string {
  const ce = editable ? ' contenteditable="true"' : "";
  const parts: string[] = [];

  if (scene.content.kind === "quiz") {
    const q = scene.content;
    parts.push(
      `<div class="el" data-eid="${esc(scene.id)}-q" data-kind="text" style="left:80px;top:100px;width:1120px;font-size:40px;font-weight:700;color:${esc(tokens.text)}"${ce}>${esc(q.question)}</div>`
    );
    q.options.forEach((opt, i) => {
      const marker = i === q.answerIndex ? " ✓" : "";
      parts.push(
        `<div class="el" data-eid="${esc(scene.id)}-opt${i}" data-kind="text" style="left:80px;top:${200 + i * 90}px;width:1120px;font-size:28px;color:${esc(tokens.text)};border:1px solid ${esc(tokens.dim)};border-radius:10px;padding:14px 20px;box-sizing:border-box"${ce}>${esc(String.fromCharCode(65 + i))}. ${esc(opt)}${esc(marker)}</div>`
      );
    });
    if (q.explanation) {
      parts.push(
        `<div class="el" data-eid="${esc(scene.id)}-exp" data-kind="text" style="left:80px;top:${200 + q.options.length * 90 + 20}px;width:1120px;font-size:22px;color:${esc(tokens.dim)}"${ce}>${esc(q.explanation)}</div>`
      );
    }
    return parts.join("\n");
  }

  for (const el of scene.content.elements) {
    const pos = `left:${px(el.x)};top:${px(el.y)};width:${px(el.w)};height:${px(el.h)};`;
    switch (el.type) {
      case "text":
        parts.push(
          `<div class="el" data-eid="${esc(el.id)}" data-kind="text" style="${pos}font-size:${px(el.fontSize)};color:${esc(el.color)};${el.bold ? "font-weight:700;" : ""}"${ce}>${esc(el.content).replace(/\n/g, "<br>")}</div>`
        );
        break;
      case "image":
        parts.push(
          `<img class="el" data-eid="${esc(el.id)}" data-kind="image" src="${esc(el.src)}" style="${pos}object-fit:contain;"${editable ? ' title="双击可替换图片地址"' : ""}${editable ? " ondblclick=\"const u=prompt('图片地址',this.src);if(u!==null)this.src=u;\"" : ""} />`
        );
        break;
      case "shape": {
        const extra =
          el.shape === "ellipse"
            ? "border-radius:50%;"
            : el.shape === "triangle"
              ? `clip-path:polygon(50% 0,100% 100%,0 100%);`
              : "";
        parts.push(
          `<div class="el" data-eid="${esc(el.id)}" data-kind="shape" style="${pos}background:${esc(el.fill)};${extra}"></div>`
        );
        break;
      }
      case "table":
        parts.push(renderTable(el, editable, tokens, pos));
        break;
      case "chart":
        parts.push(renderChart(el, editable, tokens, pos));
        break;
    }
  }
  return parts.join("\n");
}

function renderTable(el: TableElement, editable: boolean, tokens: { accentSoft: string; bgSoft: string; text: string }, pos: string): string {
  const fs = el.fontSize ?? 18;
  const rows = [el.headers, ...el.rows]
    .map(
      (row, ri) =>
        `<tr>${row
          .map(
            (cell) =>
              `<${ri === 0 ? "th" : "td"}${ri > 0 && editable ? ceAttr() : ""} style="${ri === 0 ? `background:${esc(el.headerFill ?? tokens.accentSoft)};font-weight:700;` : ri % 2 === 0 ? `background:${esc(tokens.bgSoft)};` : ""}">${esc(cell)}</${ri === 0 ? "th" : "td"}>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<table class="el" data-eid="${esc(el.id)}" data-kind="table" data-rows="${el.rows.length}" style="${pos}font-size:${px(fs)};color:${esc(tokens.text)};border-collapse:collapse;width:${px(el.w)};table-layout:fixed;"><tbody>${rows}</tbody></table>`;

  function ceAttr() {
    return editable ? ' contenteditable="true"' : "";
  }
}

function renderChart(el: ChartElement, editable: boolean, tokens: { accent: string; text: string; dim: string }, pos: string): string {
  const max = Math.max(...el.data.map((d) => d.value), 1);
  const rowH = el.h / Math.max(el.data.length, 1);
  const labelW = Math.min(200, el.w * 0.3);
  const valueW = 90;
  const barArea = el.w - labelW - valueW;
  const color = el.color ?? tokens.accent;
  const rows = el.data
    .map((d, i) => {
      const y = i * rowH;
      const barW = Math.max(4, (d.value / max) * barArea);
      return `<div class="crow" style="position:absolute;left:0;top:${px(y)};width:100%;height:${px(rowH - 8)};">
  <div style="position:absolute;left:0;top:0;width:${px(labelW)};height:100%;font-size:18px;color:${esc(tokens.text)};overflow:hidden;"${editable ? ' contenteditable="true" data-crow="' + i + '" data-cfield="label"' : ""}>${esc(d.label)}</div>
  <div style="position:absolute;left:${px(labelW)};top:15%;height:70%;width:${px(barW)};background:${esc(color)};border-radius:4px;"></div>
  <div style="position:absolute;left:${px(labelW + barArea + 8)};top:0;font-size:18px;color:${esc(tokens.dim)};"${editable ? ' contenteditable="true" data-crow="' + i + '" data-cfield="value"' : ""}>${esc(String(d.value))}${esc(el.unit ?? "")}</div>
</div>`;
    })
    .join("");
  return `<div class="el" data-eid="${esc(el.id)}" data-kind="chart" style="${pos}">${rows}</div>`;
}

/* ---------------- 可编辑单文件 HTML ---------------- */

export function buildEditableHtml(stage: Stage): string {
  const tokens = resolveTheme(stage.theme).tokens;
  const pages = stage.scenes
    .map(
      (s, i) =>
        `<div class="scene-page" data-index="${i}" style="display:${i === 0 ? "block" : "none"};">
  <div class="scene-inner" style="background:${esc(tokens.bg)};">${renderSceneToHtml(s, true, tokens)}</div>
</div>`
    )
    .join("\n");

  const dataJson = esc(JSON.stringify({ title: stage.title, theme: stage.theme }));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(stage.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #1c1c1e; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
  .stage-wrap { position: relative; width: min(96vw, calc(92vh * 1.7778)); aspect-ratio: 1280/720; margin: 24px auto 8px; box-shadow: 0 4px 32px rgba(0,0,0,.4); overflow: hidden; }
  .scene-page { position: absolute; inset: 0; }
  .scene-inner { position: absolute; left:0; top:0; width:1280px; height:720px; transform-origin: 0 0; }
  .el { position: absolute; overflow: visible; }
  img.el { object-fit: contain; }
  table.el th, table.el td { border: 1px solid rgba(0,0,0,.15); padding: 6px 10px; text-align: left; word-break: break-all; }
  .el[contenteditable]:focus { outline: 2px dashed rgba(59,130,246,.7); outline-offset: 2px; }
  .bar { position: sticky; top: 0; z-index: 10; display: flex; gap: 10px; align-items: center; justify-content: center; padding: 10px; background: rgba(20,20,22,.92); color: #eee; flex-wrap: wrap; }
  .bar button { padding: 6px 14px; border: 1px solid #555; background: #2c2c2e; color: #eee; border-radius: 6px; cursor: pointer; font-size: 14px; }
  .bar button:hover { background: #3a3a3c; }
  .bar .idx { min-width: 72px; text-align: center; font-size: 14px; color: #aaa; }
  @media print {
    body { background: #fff; }
    .bar { display: none !important; }
    .stage-wrap { width: 13.333in; margin: 0; box-shadow: none; }
    .scene-page { display: block !important; position: relative; width: 13.333in; height: 7.5in; page-break-after: always; overflow: hidden; }
    .scene-inner { transform: none !important; }
  }
</style>
</head>
<body>
<div class="bar">
  <button id="prev">‹ 上一页</button>
  <span class="idx" id="idx"></span>
  <button id="next">下一页 ›</button>
  <button id="save" title="把当前所有编辑保存进本 HTML 文件">💾 下载（保存编辑）</button>
  <button onclick="window.print()">🖨 打印 / 存为 PDF</button>
  <span style="font-size:12px;color:#888;">文字可直接点击编辑；图片双击替换地址</span>
</div>
<div class="stage-wrap" id="wrap">${pages}</div>
<script id="stage-data" type="application/json">${dataJson}</script>
<script>
(function () {
  var pages = Array.prototype.slice.call(document.querySelectorAll(".scene-page"));
  var cur = 0;
  function fit() {
    var wrap = document.getElementById("wrap");
    var scale = wrap.clientWidth / 1280;
    document.querySelectorAll(".scene-inner").forEach(function (n) {
      n.style.transform = "scale(" + scale + ")";
    });
  }
  function show(i) {
    cur = Math.max(0, Math.min(pages.length - 1, i));
    pages.forEach(function (p, pi) { p.style.display = pi === cur ? "block" : "none"; });
    document.getElementById("idx").textContent = (cur + 1) + " / " + pages.length;
  }
  document.getElementById("prev").onclick = function () { show(cur - 1); };
  document.getElementById("next").onclick = function () { show(cur + 1); };
  document.addEventListener("keydown", function (e) {
    if (e.target.isContentEditable) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") show(cur + 1);
    if (e.key === "ArrowLeft" || e.key === "PageUp") show(cur - 1);
  });
  window.addEventListener("resize", fit);
  fit(); show(0);

  /* 保存：从 DOM 读回内容，更新 JSON 数据块，下载整个 HTML */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function collect() {
    var base = {};
    try { base = JSON.parse(document.getElementById("stage-data").textContent); } catch (e) {}
    var title = base.title || document.title;
    document.querySelectorAll("[data-kind]").forEach(function (n) {
      var kind = n.getAttribute("data-kind");
      if (kind === "text" && n.isContentEditable) n.setAttribute("data-out", n.innerText);
      if (kind === "image") n.setAttribute("data-out", n.getAttribute("src") || "");
      if (kind === "table") {
        var rows = [];
        n.querySelectorAll("tr").forEach(function (tr) {
          rows.push(Array.prototype.map.call(tr.children, function (td) { return td.innerText; }));
        });
        n.setAttribute("data-out", JSON.stringify(rows));
      }
      if (kind === "chart") {
        var data = [];
        n.querySelectorAll("[data-crow]").forEach(function (c) {
          var i = +c.getAttribute("data-crow");
          data[i] = data[i] || { label: "", value: 0 };
          if (c.getAttribute("data-cfield") === "label") data[i].label = c.innerText;
          else data[i].value = parseFloat(c.innerText.replace(/[^0-9.\\-]/g, "")) || 0;
        });
        n.setAttribute("data-out", JSON.stringify(data));
      }
    });
    return { base: base, title: title };
  }
  document.getElementById("save").onclick = function () {
    collect();
    var html = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (document.title || "slides") + ".html";
    a.click();
    URL.revokeObjectURL(a.href);
  };
})();
</script>
</body>
</html>`;
}

/* ---------------- 打印版（PDF 渲染输入） ---------------- */

export function buildPrintableHtml(stage: Stage): string {
  const tokens = resolveTheme(stage.theme).tokens;
  const pages = stage.scenes
    .map((s, i) => {
      const label = `<div style="position:absolute;left:0;bottom:-26px;width:100%;text-align:center;font-size:11px;color:#999;">${i + 1} / ${stage.scenes.length}</div>`;
      return `<div class="sheet"><div class="canvas" style="background:${esc(tokens.bg)};">${renderSceneToHtml(s, false, tokens)}</div>${label}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${esc(stage.title)}</title>
<style>
  @page { size: 13.333in 7.5in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 0; }
  .sheet { position: relative; width: 13.333in; height: 7.5in; overflow: hidden; page-break-after: always; background: #fff; }
  .sheet:last-child { page-break-after: auto; }
  .canvas { position: absolute; left: 0; top: 0; width: ${CANVAS_W}px; height: ${CANVAS_H}px; }
  .el { position: absolute; }
  img.el { object-fit: contain; }
  table.el th, table.el td { border: 1px solid rgba(0,0,0,.15); padding: 6px 10px; text-align: left; word-break: break-all; }
</style>
</head>
<body>
${pages}
</body>
</html>`;
}
