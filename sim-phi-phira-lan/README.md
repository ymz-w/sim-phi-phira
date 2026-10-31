# sim-phi × Phira（局域网 Fork）

在单机 Fork 的全部能力之上，增加 **A 端（安卓平板，只能 `file://`）↔ B 端（Windows，可上网）**
的局域网代理：A 端不直接访问互联网，所有 Phira 数据由 B 端的静默服务器转发。

```
┌──────────────────────────┐        Wi-Fi / 局域网        ┌──────────────────────────┐
│ A 端：安卓平板            │  http://<B-IP>:8765/api/...  │ B 端：Windows 10/11       │
│ a/index.html（file://）   │ ───────────────────────────► │ PhiraHub.pyw（静默代理）   │
│ Phira 浏览 / IDB / 模拟器 │ ◄─────────────────────────── │ 访问 api.phira.cn / 5wyxi │
└──────────────────────────┘                              └──────────────────────────┘
```

- B 端只做代理，不保存曲谱；曲谱下载后存在 **A 端的 IndexedDB**，断网也能玩
- A 端记忆上次的 host/port，下次打开自动重连
- B 端响应头带 `Access-Control-Allow-Origin: *`，解决 `file://`（Origin: null）的跨域问题

---

## 目录

```
sim-phi-phira-lan/
├── a/                    # A 端（平板）应用
│   ├── index.html        # 开发版入口
│   ├── dist/index.html   # 单文件分发版（推荐拷到平板）
│   ├── css/  js/         # 与单机 Fork 相同 + js/app/lan.js
│   └── README.md
├── b/                    # B 端（Windows）代理
│   ├── PhiraHub.pyw      # 静默服务器（仅标准库）
│   ├── setup.bat         # 安装/配置：pip 检查 + 防火墙放行 + 显示本机 IP
│   ├── start.bat         # 后台启动
│   ├── stop.bat          # 停止
│   ├── status.bat        # 状态自检 / 查看日志
│   ├── show_ip.py        # 显示局域网地址
│   ├── config.json       # 端口、上游、超时、IPv4 等配置
│   └── README.md
└── README.md             # 本文件
```

---

## 一、B 端（Windows）一次性配置

前提：已安装 **Python 3.9+**（安装时勾选 `Add python.exe to PATH`），电脑与平板连接同一个 Wi-Fi。

1. 把 `b/` 整个文件夹拷到 Windows 电脑（路径不要含中文更稳妥）。
2. 右键 **以管理员身份运行** `setup.bat`（或直接双击，脚本会请求管理员权限）：
   - 检查 Python / pip
   - 放行防火墙 **TCP 8765**（专用/域网络）
   - 打印本机局域网 IP，例如 `http://192.168.0.103:8765/`
3. 双击 `start.bat` 启动服务（`pythonw` 后台运行，无窗口）。
   - 自检页：在电脑浏览器打开 `http://127.0.0.1:8765/`
   - 日志：`b/hub.log`；停止：`stop.bat`；状态：`status.bat`
4. 让 B 端保持开机、联网、服务运行。

> 端口被占用 / 想换端口：修改 `b/config.json` 的 `port`，重新运行 `setup.bat` 放行新端口，
> 再 `start.bat`。A 端填写相同端口即可。

---

## 二、A 端（平板）使用

1. 把 `a/dist/index.html`（单文件版）拷到平板，用 Chrome / Edge 打开。
   - 也可以拷贝整个 `a/` 目录打开 `index.html`（非单文件版）。
   - 必须是 `file://` 打开（本地文件），不需要装 App、不需要服务器。
2. 进入 **Phira 曲库**，首次会显示连接界面：
   - 填写 B 端 IP（如 `192.168.0.103`）和端口（默认 `8765`），点「连接」。
   - 连接失败会显示原因；改地址后点「重试」。
3. 连接成功后与单机 Fork 完全一致：
   - 浏览列表 → 详情 → 「下载并载入」（经 B 端下载 zip）
   - 自动存入 IndexedDB 并载入模拟器 → 回模拟器点「播放」
4. 地址会存进 `localStorage`（键 `spp.endpoint`），**下次打开自动重连**。
5. 断网 / B 端关闭时：**我的曲库** 中已下载的曲谱仍可载入游玩。
6. 顶栏「断开」可清除连接状态，重新显示连接界面。

---

## 三、A ↔ B 通信约定

| 项目 | 约定 |
| --- | --- |
| 监听 | `0.0.0.0:8765`（局域网内可访问） |
| 协议 | HTTP（明文，仅限可信局域网） |
| CORS | 所有响应 `Access-Control-Allow-Origin: *`，并带 `Access-Control-Allow-Private-Network: true` |
| 预检 | `OPTIONS` 返回 204 + CORS 头 |
| 上游 | 主：`https://phira.5wyxi.com`（列表/详情/文件）；备用：`https://api.phira.cn`，超时自动切换 |
| 白名单 | `/api/file`、`/api/img` 只允许 `api.phira.cn / phira.5wyxi.com / phira-cdn.5wyxi.com / phira.moe`，防止被当成任意代理 |

接口见 `b/README.md`。

---

## 四、故障排查

| 现象 | 排查 |
| --- | --- |
| A 端点「连接」提示超时 | ① B 端是否运行（`status.bat`）；② IP 是否为 B 端当前局域网 IP（`ipconfig`）；③ 两台设备是否同网段；④ 防火墙是否放行 TCP 端口（`setup.bat` 或手动添加规则）；⑤ 路由器是否开启了 AP 隔离 |
| 连接成功但列表一直「加载中」 | 旧版本会卡在上游 `api.phira.cn` 超时上；当前版本默认走 `phira.5wyxi.com` 并自动切换备用域名，首屏 12 首通常 1 秒内。若仍慢，看 `b/hub.log` 的 `API ... on https://...` 行，稍后点「刷新」 |
| 下载卡住 / 失败 | 看 `hub.log` 的 `FILE` 行；上游 CDN 偶发超时，重试即可 |
| 平板 Chrome 首次连局域网弹权限 | 新版 Chrome 的「本地网络访问」提示，选择 **允许** |
| 换 Wi-Fi 后连不上 | IP 变了：在 B 端重新运行 `status.bat` 看新 IP，A 端点「断开」后重填 |
| 端口被占用 | 改 `config.json` 的 `port` → 重跑 `setup.bat` → `start.bat` |
| 想彻底卸载 | `stop.bat`；删除防火墙规则 `PhiraHub 8765`；删除文件夹 |

---

## 五、安全说明

- 服务只监听局域网，**没有鉴权**：同一局域网内知道地址的人都能通过它访问 Phira 公共接口。
  请仅在家庭 / 可信网络使用，不要把端口映射到公网。
- `/api/file`、`/api/img` 有域名白名单，不能被用来代理任意网站。
- B 端不落盘保存曲谱内容（只写访问日志 `hub.log`）。
- 曲谱版权归原作者 / Phira 社区所有，仅用于个人学习与离线游玩。

---

## 六、与单机 Fork 的差异

| 能力 | 单机 Fork | 局域网 Fork |
| --- | --- | --- |
| 入口 | `sim-phi-phira/dist/index.html` | `sim-phi-phira-lan/a/dist/index.html` |
| Phira 浏览 | 直连 `api.phira.cn` | 经 B 端 `/api/chart` |
| 曲谱包下载 | 受 CDN CORS 限制，需手动导入或代理 | B 端服务端取文件，A 端全自动 |
| 封面 | 直连 CDN（`<img>` 不受 CORS 限制） | 经 B 端 `/api/img`（离线也能看已存封面） |
| 连接界面 | 无 | 有（host/port、持久化、自动重连） |
| 断网游玩 | ✅ IndexedDB | ✅ IndexedDB |

A 端应用与单机 Fork 共用同一套代码，仅 `js/app/config.js` 的 `mode: 'lan'` 与
额外的 `js/app/lan.js`（连接层）不同；构建方式见 `a/README.md`。
