# -*- coding: utf-8 -*-
"""
本地 PaddleOCR 文字识别服务（可选组件，配合 openmaic-lite 参考资料模块使用）。

功能：
  - 接收图片（png/jpg/webp）或 PDF 文件，返回识别出的文本
  - PDF 由 PyMuPDF(fitz) 逐页渲染为图片后交给 PaddleOCR 识别
  - 兼容 PaddleOCR 2.x 与 3.x（3.x 移除了 show_log/use_angle_cls，改为 predict API）
  - 返回 JSON：{"text": "全文", "pages": [{"index": 0, "text": "第 1 页文本"}, ...]}

启动（首次会自动下载 PP-OCRv4/v5 模型，约几百 MB）：
  pip install "paddlepaddle>=2.6.0" "paddleocr>=2.7.0" fastapi python-multipart "pymupdf>=1.24" uvicorn
  python scripts/paddleocr_server.py            # 默认 0.0.0.0:8900
  python scripts/paddleocr_server.py --port 8901

然后在项目 .env 中配置（端口须一致）：
  OCR_SERVICE_URL=http://127.0.0.1:8901/ocr

重启 Next.js 应用后，上传扫描版 PDF / 图片即自动走 PaddleOCR 识别。
"""
from __future__ import annotations

import argparse
import io
import os

# 跳过 paddlex 启动时的模型源连通性检查（加速冷启动，离线环境必需）
os.environ.setdefault("DISABLE_MODEL_SOURCE_CHECK", "True")


def _patch_langchain_docstore() -> None:
    """兼容垫片：paddlex 3.3 仍从 langchain.docstore / langchain.text_splitter 导入旧符号，
    而 langchain 1.x 已移除这些路径。paddlex 仅在未使用的检索功能中用到它们，
    这里注入最小桩模块，避免升级/降级用户的 langchain。"""
    import sys
    import types

    try:
        import langchain  # noqa: F401
        import langchain.docstore.document  # noqa: F401
        import langchain.text_splitter  # noqa: F401

        return  # 旧版 langchain，无需处理
    except ModuleNotFoundError:
        pass

    class Document:  # 最小桩：仅保留 paddlex 用到的属性
        def __init__(self, page_content: str = "", metadata: dict | None = None):
            self.page_content = page_content
            self.metadata = metadata or {}

    class RecursiveCharacterTextSplitter:  # 未使用的检索功能，空桩即可
        pass

    def _register(name: str, **attrs) -> None:
        if name in sys.modules:
            return
        mod = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod

    _register("langchain.docstore")
    _register("langchain.docstore.document", Document=Document)
    _register("langchain.text_splitter", RecursiveCharacterTextSplitter=RecursiveCharacterTextSplitter)

    # 同步挂到真实 langchain 包对象上，确保 from-import 的属性查找路径也能命中
    import langchain as _lc

    if not hasattr(_lc, "docstore"):
        _lc.docstore = sys.modules["langchain.docstore"]
    if not hasattr(_lc, "text_splitter"):
        _lc.text_splitter = sys.modules["langchain.text_splitter"]


_patch_langchain_docstore()

from fastapi import FastAPI, File, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

app = FastAPI(title="PaddleOCR Service")
_ocr = None  # 懒加载，避免启动即拉模型
_ocr_major = 2  # 检测到的 PaddleOCR 主版本

# 默认用 mobile 轻量模型：纯 CPU（MKLDNN 被 Paddle 3.x PIR bug 禁用）下比 server 模型快 5-10 倍，
# 精度略低但足够。可用环境变量覆盖：OCR_MODEL_DET / OCR_MODEL_REC
_DET_MODEL = os.environ.get("OCR_MODEL_DET", "PP-OCRv5_mobile_det")
_REC_MODEL = os.environ.get("OCR_MODEL_REC", "PP-OCRv5_mobile_rec")


def get_ocr():
    global _ocr, _ocr_major
    if _ocr is None:
        import paddleocr
        from paddleocr import PaddleOCR

        major = int((paddleocr.__version__ or "2").split(".")[0])
        if major >= 3:
            # 3.x：无 show_log/use_angle_cls 参数，方向分类改名为 use_textline_orientation；
            # 关闭 MKLDNN：Paddle 3.x Windows CPU 下 onednn/PIR 执行器存在
            # "ConvertPirAttribute2RuntimeAttribute not support" 崩溃 bug
            # use_textline_orientation 会对每个文本块额外跑一次方向分类模型：
            # 实测关闭后 PP-OCRv5 mobile 对正向文本也会大量误判为乱码，必须保持开启
            kwargs = dict(
                lang="ch",
                use_textline_orientation=True,
                enable_mkldnn=False,
                text_detection_model_name=_DET_MODEL,
                text_recognition_model_name=_REC_MODEL,
            )
            _ocr = PaddleOCR(**kwargs)
        else:
            _ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
        _ocr_major = major
    return _ocr


def _render_pdf_pages(data: bytes, dpi: int = 150):
    """PDF → 每页一张 PIL Image（RGB）。150 DPI 对 OCR 精度足够，比 200 DPI 少 ~44% 像素"""
    import fitz  # pymupdf
    from PIL import Image

    doc = fitz.open(stream=data, filetype="pdf")
    images = []
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        images.append(img)
    doc.close()
    return images


def _downscale(img, max_side: int = 2000):
    """长边超过 max_side 的图片等比缩小：推理耗时与像素数近似成正比"""
    from PIL import Image

    w, h = img.size
    longest = max(w, h)
    if longest <= max_side:
        return img
    scale = max_side / longest
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def _ocr_image_v3(img) -> str:
    """PaddleOCR 3.x：predict API，结果为 dict-like OCRResult（rec_texts 键）"""
    import numpy as np

    ocr = get_ocr()
    lines: list[str] = []
    for res in ocr.predict(np.asarray(img)):
        texts = None
        try:
            texts = res["rec_texts"]
        except Exception:  # noqa: BLE001
            j = getattr(res, "json", None) or {}
            texts = (j.get("res") or j).get("rec_texts") or []
        lines.extend(t for t in (texts or []) if t)
    return "\n".join(lines)


def _ocr_image_v2(img) -> str:
    """PaddleOCR 2.x：ocr API，结果为 [[box, (text, score)], ...]"""
    import numpy as np

    ocr = get_ocr()
    result = ocr.ocr(np.asarray(img), cls=True)
    lines = []
    for page in result or []:
        for item in page or []:
            # 兼容不同版本的返回结构：[box, (text, score)]
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                text = item[1][0] if isinstance(item[1], (list, tuple)) else str(item[1])
                if text:
                    lines.append(text)
    return "\n".join(lines)


def _ocr_image(img) -> str:
    get_ocr()  # 先确保实例与版本号初始化，再选分支
    return _ocr_image_v3(img) if _ocr_major >= 3 else _ocr_image_v2(img)


@app.get("/")
async def root():
    return {
        "service": "PaddleOCR",
        "status": "ok",
        "usage": "POST /ocr (multipart, 字段名 file) 上传图片或 PDF",
        "health": "GET /health",
    }


def _warmup() -> None:
    """后台线程预热：启动即加载模型并空跑一次，避免首个请求承担 30s+ 冷启动"""
    try:
        from PIL import Image

        img = Image.new("RGB", (96, 32), "white")
        _ocr_image(img)
        print("[paddleocr] 模型预热完成（%s / %s）" % (_DET_MODEL, _REC_MODEL))
    except Exception as exc:  # noqa: BLE001
        print("[paddleocr] 预热失败（将在首次请求时重试）:", exc)


@app.on_event("startup")
async def _startup_warmup() -> None:
    import threading

    threading.Thread(target=_warmup, daemon=True).start()


@app.post("/ocr")
async def ocr(file: UploadFile = File(...)):
    data = await file.read()
    name = (file.filename or "").lower()
    try:
        pages_text: list[str] = []
        if name.endswith(".pdf"):
            images = _render_pdf_pages(data)
        else:
            from PIL import Image

            images = [Image.open(io.BytesIO(data)).convert("RGB")]
        for img in images:
            pages_text.append(_ocr_image(_downscale(img)))
        pages = [{"index": i, "text": t} for i, t in enumerate(pages_text)]
        full = "\n\n".join(t for t in pages_text if t)
        return JSONResponse({"text": full, "pages": pages})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8900)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)
