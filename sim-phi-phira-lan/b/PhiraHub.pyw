#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PhiraHub - 局域网 Phira 代理服务器（B 端）
==========================================

A 端（安卓平板，只能以 file:// 打开页面）无法访问外网。本服务器运行在
可以上网的 Windows 电脑上，把 Phira 的列表 / 详情 / 封面 / 曲谱包代理给
A 端，并附带 `Access-Control-Allow-Origin: *`，避免 file:// 的跨域限制。

只使用 Python 标准库，无需 pip 安装任何第三方包。
以 `.pyw` 运行时不显示控制台窗口；日志写入 hub.log。

用法:
    pythonw PhiraHub.pyw           # 静默运行（推荐）
    python PhiraHub.pyw            # 控制台运行，方便排错

接口:
    GET /                      状态页（浏览器打开可自检）
    GET /api/health            健康检查
    GET /api/chart?page=..     代理 api.phira.cn/chart 列表
    GET /api/chart/{id}        代理 api.phira.cn/chart/{id} 详情
    GET /api/file?url=..       代理曲谱包（二进制）
    GET /api/img?url=..        代理封面图（带缓存）
"""

import json
import os
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent
CONFIG_FILE = Path(os.environ.get("PHIRAHUB_CONFIG") or (BASE / "config.json"))
DEFAULTS = {
    "host": "0.0.0.0",
    "port": 8765,
    # phira.moe 前端实际使用的接口域名，实测比 api.phira.cn 快很多
    "upstream_api": "https://phira.5wyxi.com",
    "upstream_api_fallback": "https://api.phira.cn",
    "upstream_file": "https://phira.5wyxi.com",
    "log": "hub.log",
    "allowed_hosts": [
        "api.phira.cn",
        "phira.5wyxi.com",
        "phira-cdn.5wyxi.com",
        "phira.moe",
        "www.phira.moe",
    ],
    "api_timeout": 12,
    "file_timeout": 60,
    "force_ipv4": True,
    "upstream_retries": 1,
    "api_cache_seconds": 120,
    "cache_stale_seconds": 86400,
    "file_host_fallback": True,
}
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 PhiraHub/1.0"
)
VERSION = "1.0.0"

CONFIG = dict(DEFAULTS)
LOCK = threading.Lock()

# Some home networks advertise IPv6 but cannot route it; urllib then burns the
# whole timeout on a dead AAAA address. Chrome hides this with Happy Eyeballs,
# plain urllib does not - so force IPv4 unless the user opts out.
_ORIG_GETADDRINFO = socket.getaddrinfo


def install_ipv4_only():
    def ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return _ORIG_GETADDRINFO(host, port, socket.AF_INET, type, proto, flags)
    socket.getaddrinfo = ipv4_getaddrinfo


# small in-memory response cache, makes browsing resilient to flaky upstream
CACHE = {}
CACHE_LOCK = threading.Lock()


def cache_get(url):
    with CACHE_LOCK:
        item = CACHE.get(url)
    if not item:
        return None
    return item


def cache_put(url, status, ctype, body):
    with CACHE_LOCK:
        if len(CACHE) > 200:
            CACHE.clear()
        CACHE[url] = (time.time(), status, ctype, body)



def log(message):
    line = time.strftime("%Y-%m-%d %H:%M:%S") + "  " + str(message)
    with LOCK:
        try:
            with open(BASE / CONFIG["log"], "a", encoding="utf-8") as fp:
                fp.write(line + "\n")
        except Exception:
            pass
    try:
        if sys.stderr is not None and sys.stderr.isatty():
            print(line, file=sys.stderr, flush=True)
    except Exception:
        pass


def load_config():
    global CONFIG
    CONFIG = dict(DEFAULTS)
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                CONFIG.update(data)
        except Exception as exc:
            log("config.json 解析失败，使用默认值: %r" % (exc,))
    try:
        CONFIG["port"] = int(CONFIG["port"])
    except Exception:
        CONFIG["port"] = 8765


def local_ips():
    found = set()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))
            found.add(sock.getsockname()[0])
        finally:
            sock.close()
    except Exception:
        pass
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = item[4][0]
            if not ip.startswith("127.") and not ip.startswith("169.254."):
                found.add(ip)
    except Exception:
        pass
    return sorted(found)


def message_box(title, text):
    """Use a native dialog only when running windowless and startup fails."""
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, str(text), str(title), 0x10)
    except Exception:
        pass


class PhiraHubHandler(BaseHTTPRequestHandler):
    server_version = "PhiraHub/" + VERSION
    protocol_version = "HTTP/1.1"

    # keep the console quiet; we have our own log
    def log_message(self, fmt, *args):
        pass

    # A phone that switches Wi-Fi / closes the page will reset sockets all the
    # time. Those are normal, not server errors - never print a traceback for
    # them (this is what spammed the old hub.log).
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError):
            self.close_connection = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError)):
            return
        log("REQUEST ERROR from %s: %r" % (client_address, exc))

    # ---------------------------------------------------------------- helpers
    def cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, ETag")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")

    def send_bytes(self, status, body, content_type="application/json; charset=utf-8", cache=None, head=False):
        try:
            self.send_response(status)
            self.cors_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            if cache:
                self.send_header("Cache-Control", cache)
            self.end_headers()
            if not head:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            self.close_connection = True

    def send_json(self, payload, status=200, head=False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_bytes(status, body, cache="no-store", head=head)

    def log_request_line(self, status, extra=""):
        log("%s %s -> %s %s" % (self.command, self.path, status, extra))

    # ---------------------------------------------------------------- routing
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.handle_get(head=True)

    def do_GET(self):
        self.handle_get(head=False)

    def handle_get(self, head=False):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        try:
            if path in ("/", "/index.html"):
                return self.serve_landing(head)
            if path in ("/api/health", "/api/ping"):
                return self.serve_health(head)
            if path == "/api/chart":
                return self.proxy_api("/chart", parsed.query, head)
            if path.startswith("/api/chart/"):
                chart_id = path[len("/api/chart/"):].strip("/")
                if not chart_id.isdigit():
                    return self.send_json({"ok": False, "error": "invalid chart id"}, 400, head)
                return self.proxy_api("/chart/" + chart_id, "", head)
            if path in ("/api/file", "/api/img"):
                target = (query.get("url") or [""])[0]
                return self.proxy_file(target, cache=(path == "/api/img"), head=head)
            return self.send_json({"ok": False, "error": "not found", "path": path}, 404, head)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            log("UNHANDLED %r\n%s" % (exc, traceback.format_exc()))
            try:
                return self.send_json({"ok": False, "error": "internal error"}, 500, head)
            except Exception:
                return

    # ---------------------------------------------------------------- pages
    def serve_health(self, head=False):
        ips = local_ips()
        return self.send_json({
            "ok": True,
            "name": "PhiraHub",
            "version": VERSION,
            "port": CONFIG["port"],
            "ips": ips,
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        }, 200, head)

    def serve_landing(self, head=False):
        ips = local_ips()
        rows = "".join(
            '<li><a href="http://%s:%s/">http://%s:%s/</a></li>' % (ip, CONFIG["port"], ip, CONFIG["port"])
            for ip in ips
        ) or "<li>未检测到局域网 IP，请检查网络连接。</li>"
        html = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PhiraHub 已运行</title>
<style>
 body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#0b0d12;color:#e9eef8;
      display:flex;min-height:100vh;align-items:center;justify-content:center}
 .card{width:min(680px,92vw);background:#151a26;border:1px solid #232c3e;border-radius:16px;padding:26px 28px}
 h1{margin:0 0 4px;font-size:22px}
 p{color:#8b97ae;font-size:13px;line-height:1.7}
 code{background:#0d121b;border:1px solid #232c3e;padding:2px 6px;border-radius:6px;font-size:12px}
 ul{line-height:2;font-size:13px}
 a{color:#a78bfa}
 .ok{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:20px;background:rgba(52,211,153,.15);
     color:#34d399;font-size:11px;vertical-align:middle}
 .endpoints{margin-top:16px;padding-top:14px;border-top:1px dashed #232c3e}
</style></head><body><div class="card">
<h1>PhiraHub <span class="ok">运行中</span></h1>
<p>局域网 Phira 代理服务，供平板 A 端使用。请保持这台电脑开机并联网。</p>
<p>在 A 端「Phira 曲库」页填写下面任一地址：</p>
<ul>%s</ul>
<p>端口：<code>%s</code> · 版本：%s · 时间：%s</p>
<div class="endpoints"><p>自检接口：<a href="/api/health">/api/health</a> ·
<a href="/api/chart?page=1&amp;pageNum=2">/api/chart?page=1</a></p>
<p>日志文件：<code>%s</code></p></div>
</div></body></html>""" % (rows, CONFIG["port"], VERSION, time.strftime("%Y-%m-%d %H:%M:%S"), CONFIG["log"])
        return self.send_bytes(200, html.encode("utf-8"), "text/html; charset=utf-8", "no-store", head)

    # ---------------------------------------------------------------- proxies
    def api_urls(self, api_path, query):
        suffix = api_path + (("?" + query) if query else "")
        urls = []
        for base in (CONFIG.get("upstream_api"), CONFIG.get("upstream_api_fallback")):
            base = (base or "").strip()
            if not base:
                continue
            url = base.rstrip("/") + suffix
            if url not in urls:
                urls.append(url)
        return urls

    def fetch_json(self, url):
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Accept": "application/json",
            "Referer": "https://phira.moe/",
        })
        with urllib.request.urlopen(req, timeout=float(CONFIG.get("api_timeout", 12))) as resp:
            return resp.status, resp.headers.get("Content-Type", "application/json"), resp.read()

    def proxy_api(self, api_path, query, head=False):
        urls = self.api_urls(api_path, query)
        if not urls:
            return self.send_json({"ok": False, "error": "upstream not configured"}, 500, head)
        cache_key = urls[0]

        cached = cache_get(cache_key)
        ttl = float(CONFIG.get("api_cache_seconds", 120))
        if cached and (time.time() - cached[0]) < ttl:
            _, status, ctype, body = cached
            log("API CACHE %s (%d bytes)" % (cache_key, len(body)))
            return self.send_bytes(status, body, ctype, "public, max-age=30", head)

        retries = max(1, int(CONFIG.get("upstream_retries", 1)))
        last_error = None
        for url in urls:
            for attempt in range(retries):
                try:
                    status, ctype, body = self.fetch_json(url)
                    cache_put(cache_key, status, ctype, body)
                    self.log_request_line(status, "%s (%d bytes)" % (url, len(body)))
                    return self.send_bytes(status, body, ctype, "public, max-age=30", head)
                except urllib.error.HTTPError as exc:
                    body = exc.read() if exc.fp else b""
                    if exc.code < 500 and exc.code != 429:
                        self.log_request_line(exc.code, url)
                        return self.send_bytes(exc.code, body or b'{"error":"upstream"}',
                                                "application/json", "no-store", head)
                    last_error = exc
                    log("API HTTP %s on %s" % (exc.code, url))
                except Exception as exc:
                    last_error = exc
                    log("API retry %d/%d failed on %s: %r" % (attempt + 1, retries, url, exc))
                    if attempt + 1 < retries:
                        time.sleep(0.3)

        stale_limit = float(CONFIG.get("cache_stale_seconds", 86400))
        if cached and (time.time() - cached[0]) < stale_limit:
            _, status, ctype, body = cached
            log("API STALE %s (%r)" % (cache_key, last_error))
            return self.send_bytes(status, body, ctype, "public, max-age=10", head)
        log("API FAIL %s : %r" % (cache_key, last_error))
        return self.send_json({
            "ok": False,
            "error": "upstream unreachable",
            "detail": str(last_error),
        }, 502, head)

    def file_urls(self, target):
        urls = [target]
        if not CONFIG.get("file_host_fallback", True):
            return urls
        parsed = urllib.parse.urlparse(target)
        host = parsed.hostname
        alt = None
        if host == "phira.5wyxi.com":
            alt = "api.phira.cn"
        elif host == "api.phira.cn":
            alt = "phira.5wyxi.com"
        if alt:
            netloc = alt + ((":" + str(parsed.port)) if parsed.port else "")
            alt_url = urllib.parse.urlunparse(parsed._replace(netloc=netloc))
            if alt_url not in urls:
                urls.append(alt_url)
        return urls

    def proxy_file(self, target, cache=False, head=False):
        if not target:
            return self.send_json({"ok": False, "error": "missing url"}, 400, head)
        parsed = urllib.parse.urlparse(target)
        if parsed.scheme not in ("http", "https"):
            return self.send_json({"ok": False, "error": "invalid scheme"}, 400, head)
        if parsed.hostname not in CONFIG["allowed_hosts"]:
            return self.send_json({"ok": False, "error": "host not allowed"}, 403, head)

        resp = None
        used = None
        last_error = None
        for url in self.file_urls(target):
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "*/*",
                "Referer": "https://phira.moe/",
            })
            try:
                resp = urllib.request.urlopen(req, timeout=float(CONFIG.get("file_timeout", 60)))
                used = url
                break
            except urllib.error.HTTPError as exc:
                body = exc.read() if exc.fp else b""
                if exc.code < 500:
                    log("FILE HTTP %s %s" % (exc.code, url))
                    return self.send_bytes(exc.code, body or b"", "application/octet-stream", "no-store", head)
                last_error = exc
                log("FILE HTTP %s %s" % (exc.code, url))
            except Exception as exc:
                last_error = exc
                log("FILE failed on %s: %r" % (url, exc))
        if resp is None:
            log("FILE FAIL %s : %r" % (target, last_error))
            return self.send_json({"ok": False, "error": "file fetch failed", "detail": str(last_error)}, 502, head)

        try:
            length = resp.headers.get("Content-Length")
            ctype = resp.headers.get("Content-Type", "application/octet-stream")
            self.send_response(200)
            self.cors_headers()
            self.send_header("Content-Type", ctype)
            if length:
                self.send_header("Content-Length", length)
            else:
                self.send_header("Connection", "close")
            self.send_header("Cache-Control", "public, max-age=86400" if cache else "no-cache")
            self.end_headers()

            total = 0
            if not head:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    total += len(chunk)
            log("FILE 200 %s via %s (%s bytes)" % (target, used, total if not head else length or "?"))
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            log("FILE CLIENT ABORT %s" % target)
            self.close_connection = True
        finally:
            try:
                resp.close()
            except Exception:
                pass


def run():
    load_config()
    if CONFIG.get("force_ipv4", True):
        install_ipv4_only()
    host = CONFIG["host"]
    port = CONFIG["port"]
    try:
        httpd = ThreadingHTTPServer((host, port), PhiraHubHandler)
        httpd.daemon_threads = True
    except OSError as exc:
        log("启动失败: %r" % (exc,))
        message_box(
            "PhiraHub 启动失败",
            "端口 %s 可能已被占用，或没有权限。\n\n错误：%s\n\n"
            "请修改 config.json 中的 port 后重试。" % (port, exc),
        )
        sys.exit(1)

    pid_file = BASE / "hub.pid"
    try:
        pid_file.write_text(str(os.getpid()), encoding="utf-8")
    except Exception:
        pass

    ips = local_ips()
    log("=" * 60)
    log("PhiraHub %s 已启动，监听 %s:%s" % (VERSION, host, port))
    for ip in ips:
        log("  A 端可填写: %s:%s   (http://%s:%s/)" % (ip, port, ip, port))
    log("  本机自检: http://127.0.0.1:%s/api/health" % port)
    log("=" * 60)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("收到中断，正在退出")
    finally:
        try:
            httpd.server_close()
        except Exception:
            pass
        try:
            pid_file.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    run()
