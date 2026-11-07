#!/usr/bin/env python3
"""IOL 核對小幫手：網頁伺服器（只用 Python 標準函式庫，Mac／Linux 皆可）。

預設 OCR 在瀏覽器內執行（Tesseract.js），照片不上傳伺服器。
若要改用伺服器端 OCR（例如 Linux 上的 PaddleOCR），設定環境變數 IOL_OCR_CMD：
    IOL_OCR_CMD="python3 /opt/iol/paddle_ocr.py"
該指令接收影像檔路徑為最後一個參數，輸出 JSON：
    {"width": W, "height": H, "boxes": [{"text", "conf", "x", "y", "w", "h"}]}  # 0–1 正規化、左上原點

環境變數：IOL_HOST（預設 127.0.0.1）、IOL_PORT（預設 8766）、IOL_MAX_UPLOAD_MB（預設 25）。
"""
import json
import mimetypes
import os
import shlex
import subprocess
import sys
import tempfile
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from calculations import calculate, InputError

ROOT = Path(__file__).resolve().parent.parent
MOUNTS = {"/formulas/": ROOT / "formulas", "/": ROOT / "app"}
HOST = os.environ.get("IOL_HOST", "127.0.0.1")
PORT = int(os.environ.get("IOL_PORT", "8766"))
MAX_UPLOAD = int(os.environ.get("IOL_MAX_UPLOAD_MB", "25")) * 1024 * 1024
OCR_CMD = os.environ.get("IOL_OCR_CMD", "").strip()
CALC_SLOTS = threading.BoundedSemaphore(4)

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")


class Handler(SimpleHTTPRequestHandler):
    server_version = "IOLHelper"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "app"), **kwargs)

    def log_message(self, fmt, *args):
        # 不記錄查詢字串或內容，避免日誌留存病患資訊
        sys.stderr.write("%s %s\n" % (self.command, urlparse(self.path).path))

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        clean = unquote(urlparse(path).path)
        for prefix, base in MOUNTS.items():
            if clean.startswith(prefix):
                rel = clean[len(prefix):] or "index.html"
                target = (base / rel).resolve()
                if base.resolve() in target.parents or target == base.resolve():
                    return str(target)
        return str(ROOT / "app" / "__not_found__")

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_GET(self):
        if urlparse(self.path).path == "/api/config":
            return self._json({"serverOcr": bool(OCR_CMD), "remoteCalculations": True})
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path == "/api/calculations":
            return self._calculate()
        if urlparse(self.path).path != "/api/ocr":
            return self.send_error(HTTPStatus.NOT_FOUND)
        if not OCR_CMD:
            return self._json({"error": "伺服器未設定 OCR，請使用瀏覽器內辨識"}, HTTPStatus.NOT_IMPLEMENTED)
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if origin and urlparse(origin).netloc != host:
            return self._json({"error": "來源不符"}, HTTPStatus.FORBIDDEN)
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_UPLOAD:
            return self._json({"error": "檔案大小不符"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        data = self.rfile.read(length)
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "upload.bin"
            img.write_bytes(data)
            try:
                proc = subprocess.run(shlex.split(OCR_CMD) + [str(img)], capture_output=True, timeout=120)
            except subprocess.TimeoutExpired:
                return self._json({"error": "OCR 逾時"}, HTTPStatus.GATEWAY_TIMEOUT)
        if proc.returncode != 0:
            return self._json({"error": "OCR 失敗"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        try:
            result = json.loads(proc.stdout.decode("utf-8"))
        except ValueError:
            return self._json({"error": "OCR 輸出格式錯誤"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return self._json(result)

    def _calculate(self):
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host", ""):
            return self._json({"error": "來源不符"}, HTTPStatus.FORBIDDEN)
        if self.headers.get_content_type() != "application/json":
            return self._json({"error": "只接受 JSON"}, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._json({"error": "請求長度格式不符"}, HTTPStatus.BAD_REQUEST)
        if not 0 < length <= 16384:
            return self._json({"error": "請求大小不符"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            return self._json({"error": "JSON 格式不符"}, HTTPStatus.BAD_REQUEST)
        if not CALC_SLOTS.acquire(blocking=False):
            return self._json({"error": "查詢忙碌中，請稍後重試"}, HTTPStatus.TOO_MANY_REQUESTS)
        try:
            return self._json(calculate(body))
        except InputError as error:
            return self._json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        finally:
            CALC_SLOTS.release()

    def _json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"IOL 核對小幫手：http://{HOST}:{PORT}/  （Ctrl+C 結束）", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
