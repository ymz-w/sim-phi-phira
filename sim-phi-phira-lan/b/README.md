# B 端（Windows 局域网代理）

`PhiraHub` 是一个只依赖 **Python 标准库** 的静默 HTTP 服务，为平板 A 端代理 Phira 数据：

- 解决 `file://`（Origin: `null`）的跨域问题：所有响应带 `Access-Control-Allow-Origin: *`
- 服务端去取曲谱包，A 端不再受 Phira CDN 的 CORS 限制
- 不保存曲谱，只做转发；支持 IPv4 强制、失败重试、短时缓存

## 文件

| 文件 | 作用 |
| --- | --- |
| `PhiraHub.pyw` | 服务器本体；`.pyw` 运行时无控制台窗口，日志写 `hub.log` |
| `setup.bat` | 请求管理员权限 → 检查 Python/pip → 放行防火墙 TCP 端口 → 显示本机 IP |
| `start.bat` | 用 `pythonw` 后台启动（无窗口），并打印 A 端可填写的地址 |
| `stop.bat` | 读取 `hub.pid` 结束进程 |
| `status.bat` | 健康检查 + 显示 IP + 最近日志 |
| `show_ip.py` | 打印本机局域网地址（setup/start/status 调用） |
| `config.json` | 端口、上游地址、超时、IPv4、重试、缓存时间 |
| `requirements.txt` | 无第三方依赖（保留给 setup.bat 的 pip 步骤） |
| `hub.log` / `hub.pid` | 运行时生成 |

## 安装与启动

1. 安装 Python 3.9+，勾选 **Add python.exe to PATH**。
2. 右键 **以管理员身份运行** `setup.bat`（双击亦可，脚本会请求 UAC）：
   - `python -m pip install --upgrade pip` + `pip install -r requirements.txt`（本服务不需要三方包）
   - `netsh advfirewall firewall add rule name="PhiraHub 8765" dir=in action=allow protocol=TCP localport=8765 profile=private,domain`
   - 打印 `http://<本机IP>:8765/`
3. 双击 `start.bat`。服务在后台运行，可关闭窗口。
4. 浏览器打开 `http://127.0.0.1:8765/` 可看到状态页；`status.bat` 可自检。
5. 停止：`stop.bat`（或任务管理器结束 `pythonw.exe`）。

> 若不想改防火墙，也可手动在「Windows Defender 防火墙 → 高级设置 → 入站规则」
> 放行 TCP 8765。局域网模式（专用网络）即可，不需要公网。

## 配置 `config.json`

```json
{
  "host": "0.0.0.0",
  "port": 8765,
  "upstream_api": "https://phira.5wyxi.com",
  "upstream_api_fallback": "https://api.phira.cn",
  "upstream_file": "https://phira.5wyxi.com",
  "log": "hub.log",
  "allowed_hosts": ["api.phira.cn", "phira.5wyxi.com", "phira-cdn.5wyxi.com", "phira.moe", "www.phira.moe"],
  "api_timeout": 12,
  "file_timeout": 60,
  "force_ipv4": true,
  "upstream_retries": 1,
  "api_cache_seconds": 120,
  "cache_stale_seconds": 86400,
  "file_host_fallback": true
}
```

| 字段 | 说明 |
| --- | --- |
| `host` | 监听地址，默认 `0.0.0.0`（局域网可访问）；只想本机测试可改 `127.0.0.1` |
| `port` | 监听端口，改完要重新放行防火墙 |
| `upstream_api` | **列表/详情主接口**，默认 `phira.5wyxi.com`（与 phira.moe 前端一致，实测比 api.phira.cn 快很多） |
| `upstream_api_fallback` | 主接口超时/5xx 时自动切换的备用域名（`api.phira.cn`） |
| `upstream_file` | 文件域名，默认 `phira.5wyxi.com` |
| `allowed_hosts` | `/api/file`、`/api/img` 允许的域名白名单（防开放代理） |
| `api_timeout` / `file_timeout` | 单次上游超时（秒）。A 端等待时间 = 域名数 × 超时 |
| `force_ipv4` | 强制 IPv4。部分家庭网络 IPv6 不通，urllib 会卡满超时；默认开启 |
| `upstream_retries` | 每个域名的重试次数（默认 1，失败后换域名） |
| `api_cache_seconds` | 列表/详情内存缓存秒数；重复浏览直接用缓存 |
| `cache_stale_seconds` | 上游全挂时，最多允许多旧的缓存兜底（默认 1 天） |
| `file_host_fallback` | 文件下载失败时在 `phira.5wyxi.com` / `api.phira.cn` 之间自动切换 |

修改端口后：

```bat
:: 1. 改 config.json 的 port
:: 2. 重新放行新端口（管理员）
netsh advfirewall firewall add rule name="PhiraHub 9000" dir=in action=allow protocol=TCP localport=9000 profile=private,domain
:: 3. 重启服务
stop.bat
start.bat
```

## HTTP 接口

所有响应都带 CORS 头（`*`），`OPTIONS` 返回 204。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 状态页（含本机 IP、端口、自检链接） |
| GET | `/api/health` | `{ok:true, name, version, port, ips, time}` |
| GET | `/api/chart?page=1&pageNum=24&order=-updated&search=...` | 代理列表（原样转发查询串） |
| GET | `/api/chart/{id}` | 代理详情 |
| GET | `/api/file?url=<encodeURIComponent>` | 代理曲谱包（二进制，流式） |
| GET | `/api/img?url=<encodeURIComponent>` | 代理封面（带 1 天缓存） |

示例：

```bash
curl "http://127.0.0.1:8765/api/health"
curl "http://127.0.0.1:8765/api/chart?page=1&pageNum=2&order=-updated"
curl "http://127.0.0.1:8765/api/chart/63591"
curl -o chart.zip "http://127.0.0.1:8765/api/file?url=https%3A%2F%2Fphira.5wyxi.com%2Ffiles%2F<uuid>"
```

## 日志与排错

`hub.log` 记录每个请求、上游重试、缓存命中、文件转发字节数与错误堆栈。

| 现象 | 处理 |
| --- | --- |
| 启动失败弹窗 / 日志 `WinError 10048` | 端口被占用：`stop.bat` 或改端口 |
| A 端连接超时但本机 `127.0.0.1` 正常 | 防火墙未放行 / IP 填错 / 不在同一网段 / 路由器 AP 隔离 |
| 列表很慢或超时 | 先看日志里的 `API ... on https://...`：B 端会自动在主接口（5wyxi）和备用接口间切换；`API CACHE` 表示命中缓存；反复 `API retry` 说明本机网络到 Phira 很差，可稍后重试 |
| 日志里出现 `ConnectionAbortedError` | 已修复：手机切换 Wi-Fi / 关页面属于正常断开，不再打印 traceback |
| 文件下载失败 | 日志 `FILE failed on ...`，B 端会自动换文件域名重试；仍失败就重试 |
| 想确认监听 | `netstat -ano | findstr :8765`；`status.bat` |
| 想临时前台调试 | `python PhiraHub.pyw`（有控制台输出） |

## 安全

- 仅监听局域网、无鉴权，请勿把端口映射到公网
- `/api/file`、`/api/img` 有域名白名单，不是开放代理
- 不缓存/保存曲谱内容；日志只记录 URL 与状态
- 曲谱版权归原作者所有，仅用于个人学习与离线游玩

## 与其他项目的关系

A 端应用（`../a`）把 `phira.js` 的所有请求指向本服务；单机 Fork
（`../../sim-phi-phira`）也可以在「Phira 曲库 → 下载被浏览器跨域拦截？」里
填写本服务地址作为代理，从而恢复自动下载。
