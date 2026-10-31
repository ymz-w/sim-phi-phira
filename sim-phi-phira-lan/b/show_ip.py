#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print the LAN addresses A-end should use (called by setup.bat / status.bat)."""
import json
import socket
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(__file__).resolve().parent
port = 8765
try:
    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
    port = int(cfg.get("port", port))
except Exception:
    pass

ips = set()
try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ips.add(sock.getsockname()[0])
    finally:
        sock.close()
except Exception:
    pass
try:
    for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
        ip = item[4][0]
        if not ip.startswith("127.") and not ip.startswith("169.254."):
            ips.add(ip)
except Exception:
    pass

if not ips:
    print("    未检测到局域网 IP，请确认电脑已连接 Wi-Fi / 网线，或运行 ipconfig 查看。")
else:
    for ip in sorted(ips):
        print("    http://%s:%s/        (IP: %s  端口: %s)" % (ip, port, ip, port))
print("")
print("    提示：平板与电脑必须在同一个 Wi-Fi / 局域网内。")
