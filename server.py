#!/usr/bin/env python3
"""
公式识图 EqLens —— 本地服务（静态文件 + SimpleTex API 同源代理）

用法：
    python server.py [端口]        # 默认 8020，仅绑定本机 127.0.0.1

为什么需要代理：
    浏览器跨域安全策略（CORS）不允许网页向 SimpleTex 携带其要求的
    `token` 自定义请求头，因此真实识别需要经由同源代理转发：
        浏览器 --(x-eq-token)--> 本代理 --(token)--> server.simpletex.cn
    页面中填写的令牌仅保存在用户本地浏览器，经由代理转发时不出本机。

线上部署：
    将 /api/* 以同样方式反向代理到 https://server.simpletex.cn 即可
    （Nginx / Cloudflare Worker / Vercel Function 均可，逻辑与本文件一致）。
"""
import http.server
import json
import socketserver
import sys
import traceback
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG_FILE = ROOT / ".server.log"  # 服务器日志（排障用，可删除）


def _log(msg):
    line = "[EqLens] %s\n" % msg
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass
    try:
        sys.stderr.write(line)
    except Exception:
        pass
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8020
UPSTREAM = "https://server.simpletex.cn"
# 代理白名单：仅开放公式识别相关端点，防止代理被滥用
PROXY_PATHS = {"/api/latex_ocr", "/api/latex_ocr_turbo"}
MAX_BODY = 12 * 1024 * 1024  # 12MB（页面侧限制 10MB）
UPSTREAM_TIMEOUT = 90  # OCR 推理可能较慢


def upstream_error(err_type, err_msg):
    return {"status": False, "err_info": {"err_type": err_type, "err_msg": err_msg}}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ---------- 静态文件 ----------
    def end_headers(self):
        # 本地开发禁用缓存，避免更新后浏览器使用旧版 JS/CSS
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- API 代理 ----------
    def do_POST(self):
        try:
            self._do_proxy()
        except Exception as e:  # noqa: BLE001
            _log("POST %s 处理异常:\n%s" % (self.path, traceback.format_exc()))
            try:
                self._json(500, upstream_error("proxy_error", "代理内部错误：" + str(e)))
            except Exception:  # noqa: BLE001
                pass

    def _do_proxy(self):
        path = self.path.split("?")[0]

        # 无论是否命中白名单，都先消耗请求体，避免残留数据破坏连接
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length < 0 or length > MAX_BODY:
            self._json(413, upstream_error("image_oversize", "请求体过大（上限 12MB）"))
            return

        if path not in PROXY_PATHS:
            if length:
                self.rfile.read(length)
            self._json(404, upstream_error("api_not_find", "代理仅开放公式识别端点 /api/latex_ocr"))
            return
        if length <= 0:
            self._json(413, upstream_error("image_missing", "请求体为空"))
            return
        body = self.rfile.read(length)

        token = (self.headers.get("x-eq-token") or "").strip()
        req = urllib.request.Request(UPSTREAM + path, data=body, method="POST")
        req.add_header("Content-Type", self.headers.get("Content-Type") or "application/octet-stream")
        if token:
            req.add_header("token", token)  # x-eq-token -> token，符合 SimpleTex 鉴权协议

        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "application/json")
                self._raw(resp.status, data, ctype)
        except urllib.error.HTTPError as e:
            data = e.read()
            ctype = (e.headers.get("Content-Type") if e.headers else None) or "application/json"
            self._raw(e.code, data, ctype)  # 上游 401/402/429 等原样透传给页面
        except Exception as e:  # noqa: BLE001
            self._json(502, upstream_error("proxy_upstream_error", "无法连接 SimpleTex 服务：" + str(e)))

    def _raw(self, code, data, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code, obj):
        self._raw(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def log_message(self, fmt, *args):
        _log("%s %s" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    srv = Server(("127.0.0.1", PORT), Handler)
    _log("服务已启动: http://127.0.0.1:%d" % PORT)
    print("EqLens 本地服务已启动: http://127.0.0.1:%d" % PORT)
    print("真实识别代理端点: " + ", ".join(sorted(PROXY_PATHS)))
    print("按 Ctrl+C 停止")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[EqLens] 已停止")
