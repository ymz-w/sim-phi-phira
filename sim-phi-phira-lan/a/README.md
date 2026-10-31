# A 端（安卓平板 / file://）

本目录是局域网 Fork 的平板端应用。除新增的「连接 B 端」界面外，其余功能与
`../../sim-phi-phira` 完全相同（模拟器、Phira 浏览、IndexedDB 曲库、两个 bug 修复）。

## 快速开始

1. 把 `dist/index.html` 拷到平板（推荐；单文件，无外部依赖）。
2. 用 Chrome / Edge 以本地文件方式打开。
3. 切到「Phira 曲库」，填写 B 端 IP 和端口，点「连接」。
4. 连接成功后：浏览 → 详情 → 下载并载入 → 模拟器播放。
5. 下次打开会自动重连；B 端不在线时仍可从「我的曲库」离线游玩。

> 平板不能直接上网也没关系：A 端只请求 B 端的 `http://<B-IP>:<port>/api/...`。

## 连接层说明

- `js/app/config.js`：`mode: 'lan'`，`apiBase` / `fileBase` 留空（不使用直连）。
- `js/app/lan.js`：
  - `APP.lan.init()`：填充上次地址、绑定连接/断开、有记录时自动连接；
  - `APP.lan.ready()`：是否已连接；
  - `APP.lan.showGate()` / `hideGate()` / `setDetailMode()`：连接界面与浏览界面的切换；
  - 连接探测 `GET /api/health`（7 秒超时），成功后写入 `localStorage['spp.endpoint']`。
- `js/app/phira.js` 在 `mode === 'lan'` 时把所有请求指向：
  - 列表：`/api/chart?page=..&pageNum=..&order=..&search=..`
  - 详情：`/api/chart/{id}`
  - 封面：`/api/img?url=<encoded>`
  - 曲谱包：`/api/file?url=<encoded>`
- 连接失败时保留输入框并显示具体原因，点「重试」即可。

## 持久化

| 数据 | 位置 |
| --- | --- |
| B 端地址 | `localStorage['spp.endpoint']` = `{"host":"192.168.0.103","port":8765}` |
| 曲谱 | IndexedDB `sim-phi-phira` → `charts` |
| 上次曲谱 | `localStorage['spp.lastRecord']`（仅用于显示，不自动载入） |
| 会话标记 | `sessionStorage['spp.session']`（区分「本次载入 / 历史」） |

## 性能

平板端默认开启「性能模式」（触屏设备自动启用），并在模拟器页「曲谱与设置 → 性能」里可调：

- **帧率上限**：默认 60 FPS（高刷平板不会跑 120 帧），可调 30/45/60/不限
- **性能模式**：把渲染分辨率限制在约 1.25 设备像素/CSS 像素（DPR 2 时像素量减少约 60%）

同时做了：`ResizeObserver` 包装 `resizeCanvas` 消除每帧强制布局、移动端关闭顶栏
`backdrop-filter`、切页停止渲染循环。实测在 4× CPU 降频下帧率约提升 3 倍。
详见 `../../sim-phi-phira/README.md` 的「性能优化」一节。

## 构建（可选）

`dist/index.html` 已生成；修改源码后：

```bash
cd sim-phi-phira-lan/a
python build.py
```

构建读取 `../../sim-phi/phi-h5`（只读上游），生成：

- `css/sim-phi.css`：上游样式（移除 Material Icons）
- `js/vendor/sim-phi.bundle.js`：引擎 + Worker + 皮肤 + 音频修复
- `dist/index.html`：单文件版

## 已知环境要求

- Chrome / Edge 90+；需要 IndexedDB、Blob Worker、`createImageBitmap`
- 新版 Chrome 首次访问局域网地址可能弹出「本地网络访问」权限，请选择允许
- 必须保持 B 端在线才能浏览/下载；已下载曲谱不受影响

## 与单机 Fork 的差异

1. `config.js`：`mode: 'lan'`
2. `js/app/lan.js`（本目录独有）：连接界面与自动重连
3. `index.html`：Phira 页增加 `#lan-gate` 连接面板、顶栏连接状态、断开按钮
4. `css/app.css`：连接面板样式

其余文件与单机 Fork 一致（可直接对比 `../../sim-phi-phira`）。
