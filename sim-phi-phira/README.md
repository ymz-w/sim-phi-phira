# sim-phi × Phira（单机 Fork）

把 **sim-phi**（lchzh3473 的 Phigros 网页模拟器）重新包装成一个现代化的单页应用，
并加入 **Phira 曲谱浏览 / 下载 / IndexedDB 管理 / 一键载入游玩**。

- 纯静态、纯本地：双击 `index.html`（`file://`）即可运行
- 内置 Phira 官方音符皮肤（`sim-phi/phi-h5/skin`，Phigros Origin 风格）
- 修复了旧单文件版的两个已知 bug：**结算页电子噪音**、**小窗角落图标破图**
- 不修改 `sim-phi/origin` 里的模拟器核心代码；所有改动都在外层 UI 与构建产物中

> 分发用单文件版本：`dist/index.html`（约 1.1 MB，全部 JS/CSS/皮肤内联）。

---

## 1. 快速开始

```
sim-phi-phira/
├── index.html          # 开发版入口（引用 css/ 与 js/，file:// 可直接打开）
├── dist/index.html     # 单文件分发版（推荐）
├── build.py            # 构建脚本
├── css/
│   ├── sim-phi.css     # 由上游样式生成（已剔除 Material Icons 远程字体）
│   └── app.css         # 现代化外壳 + 模拟器 UI 重绘
├── js/
│   ├── vendor/sim-phi.bundle.js   # 引擎 bundle + Worker + 皮肤 + 音频修复
│   └── app/                       # 应用层（Tab/Phira/IndexedDB/载入器）
└── README.md
```

1. 双击 `dist/index.html`（或 `index.html`）。
2. 等待 1–2 秒，状态栏出现「等待上传文件…」，页面即可用。
3. 切到 **Phira 曲库** 浏览曲谱；进入详情后点「下载并载入」。
4. 下载成功的曲谱会自动保存进 IndexedDB 并载入模拟器；回到 **模拟器** 点「播放」。
5. 下次打开：已保存的曲谱在 **我的曲库**，点「载入」即可（不会自动载入旧曲谱）。

---

## 2. 功能

### 模拟器页
- 完整保留原版模拟器小窗（`#stage` 画布、尺寸、双击角落交互全部由引擎控制）
- 外围 UI 全部重做：深色玻璃拟态、卡片式设置、封面信息卡、状态栏
- 保留原版全部能力：谱面解析（官方 / RPE / PEC）、判定、镜像、变速、自动演示、
  视频录制、皮肤、滤镜、收集条、动态分数、资源管理、日志、更多设置

### Phira 曲库页
- 列表：封面、曲名、等级、谱师、评分
- **懒加载**：每页只取 12 首，点「加载更多」再追加 12 首；封面用 `IntersectionObserver`
  进入视口才请求，首屏不再一次性拉 24 张图
- 搜索（曲名 / 曲师 / 谱师）、排序（更新 / 评分 / 曲名 / 难度）
- 详情：大封面、曲师、谱师、曲绘、评分、标签、简介、更新时间
- 下载：`file` 字段（zip）→ 解压 → 解析 → 存入 IndexedDB → **自动载入模拟器**
- 本地 zip 导入（离线兜底 / 任意 Phira 曲谱包）

### 我的曲库页
- 列出 IndexedDB 中全部曲谱（本次会话 / 历史标记、体积、下载时间）
- 载入、删除、清空；显示存储占用；断网也能载入游玩

### 数据
- IndexedDB：`sim-phi-phira` → store `charts`
- 记录结构：`id / source / phiraId / name / level / charter / composer / illustrator /
  description / tags / rating / chartFile / audioFile / imageFile / files[] / cover / bytes /
  createdAt / sessionId`
- 封面以 400px JPEG dataURL 另存，列表离线也能显示

---

## 3. 调研结论：Phira API、CORS 与曲谱包结构

### 3.1 列表 API

通过分析 `phira.moe` 的前端 bundle（`/assets/main-*.js`）确认，列表接口是：

```
GET https://phira.5wyxi.com/chart?page=1&pageNum=12&order=-updated
```

`api.phira.cn/chart?...` 是同一后端的备用域名。**实测 `phira.5wyxi.com` 快很多**
（本机 0.1–0.2 s vs `api.phira.cn` 经常 12 s+ 超时），所以本项目默认走
`phira.5wyxi.com`，失败时自动切到 `api.phira.cn`（`APP.config.apiBase` /
`apiFallback`）。

| 参数 | 说明 |
| --- | --- |
| `page` | 页码，从 1 开始 |
| `pageNum` | 每页数量（前端固定 28；本项目用 12，配合「加载更多」降低首屏压力） |
| `order` | `updated` / `-updated` / `rating` / `-rating` / `name` / `-name` / `difficulty` / `-difficulty` |
| `search` | 关键词（曲名 / 曲师 / 谱师） |
| `tags` | 标签过滤，逗号分隔，`-tag` 表示排除 |
| `division` | 分区过滤（regular 等） |
| `rating` | 评分区间，如 `3.0,10.0` |
| `uploader` / `reviewed` / `stable` / `ranked` / `stableRequest` | 上传者 / 审核 / 稳定 / Ranked 过滤 |

响应：`{ "count": 9751, "results": [ ... ] }`。

### 3.2 详情 API

```
GET https://phira.5wyxi.com/chart/{id}      # 首选
GET https://api.phira.cn/chart/{id}         # 备用（自动 fallback）
```

返回字段与任务书一致；`file` 是曲谱压缩包地址，`illustration` 支持追加 `.thumbnail`
得到 200×200 缩略图，`preview` 是试听音频。

### 3.3 曲谱包结构（实测 id=63591）

下载 `file` 地址得到的是**无扩展名 zip**（magic `PK\x03\x04`），条目是扁平的：

```
1215939033294024.json   1.9 MB   # RPE 谱面（META.RPEVersion + judgeLineList）
1215939033294024.mp3    2.1 MB   # 音乐
1215939033294024.jpg    133 KB   # 曲绘
info.txt                 305 B   # 传统 info 格式
info.yml                 642 B   # Phira 信息（name/level/charter/aspectRatio/...）
```

结论：**无需格式转换**。sim-phi 的 reader 原生支持 RPE 格式（`META.RPEVersion`），
把文件逐个交给 `hook.uploader.fireLoad({name}, buffer)` 即可完成注册。
`info.yml` 引擎不认识，会产生一条 Unsupported file 警告（不影响游玩）；
曲名/曲师/谱师/等级优先使用 API 详情，其次 `info.yml`，最后谱面 META。

### 3.4 CORS 探测结论（关键）

用 `file://` 页面（Origin: `null`）在 Edge / Chrome 实测：

| 请求 | 结果 |
| --- | --- |
| `phira.5wyxi.com/chart?...`（列表） | ✅ 200，`Access-Control-Allow-Origin: *`，实测 0.1–0.2 s |
| `phira.5wyxi.com/chart/{id}`（详情） | ✅ 200，`ACAO: *` |
| `api.phira.cn/chart?...` / `/chart/{id}`（备用） | ✅ 200，`ACAO: *`（同一后端，但部分网络下很慢） |
| `phira.5wyxi.com/files/<uuid>` | ⚠️ 303 到 `phira-cdn.5wyxi.com/<uuid>?sign=...`，**303 本身有 `ACAO: *`** |
| `phira-cdn.5wyxi.com/<uuid>?sign=...`（最终文件） | ❌ 对 `Origin: null` **不返回** `Access-Control-Allow-Origin`（只对 `https://phira.moe` 等白名单来源返回） |
| 封面 `<img src=...>` | ✅ 可以显示（图片标签不要求 CORS） |

因此：**单机 Fork 直接用 `fetch` 下载曲谱 zip 会被浏览器拦截**（`TypeError: Failed to fetch`，
控制台提示缺少 `Access-Control-Allow-Origin`）。这是 Phira CDN 的服务端策略，不是应用 bug。

本项目的处理（按优先级）：

1. **自动尝试**：点击「下载并载入」时先直接 `fetch`；若 CDN 放开限制（或你通过代理打开页面），全自动完成。
2. **手动导入兜底**：捕获 CORS 失败后弹窗，提供「① 下载 zip」按钮（浏览器正常下载），
   下载完成后点「选择 zip 文件」导入，后续保存/载入全自动。
3. **可选代理**：在「Phira 曲库 → 下载被浏览器跨域拦截？」里填写代理地址
   （例如局域网 Fork 的 B 端 `http://192.168.x.x:8765`），即可恢复全自动下载。
4. 局域网 Fork 由 B 端在服务端取文件再转发，A 端不存在 CORS 问题（见另一个项目）。

---

## 4. 两个 bug 的定位与修复

### 4.1 结算页电子噪音

**根因**：原版引擎在资源初始化时，如果 `pack.json` 拉取失败，会给 4 首结算音乐赋
`V.noise(27.83)` —— **27.83 秒白噪声**：

```js
// 上游 bundle（src/index-CfqrayXh.js）
null == t9.LevelOver0_v1 && (t9.LevelOver0_v1 = V.noise(27.83)), ... ×4
```

结算时 `bs.play(ls.LevelOver*_v1, { loop: true })` 循环播放这段噪声 → 结算页持续电子噪音。

**修复**（`build.py`，两重保险）：

1. 构建时把 bundle 里的 `V.noise(27.83)` 替换为 `V.mute(0.5)`（0.5 秒静音，
   同时省掉约 20 MB 的噪声缓冲分配）；
2. 运行时守卫：hook 就绪后把 `hook.res.LevelOver{0..3}_v1` 再替换为静音缓冲，
   即使上游 bundle 变化也不会复发。

**验证**：自动化测试断言 `hook.res.LevelOver0_v1` 存在、时长 0.5s、前 44100 个采样全为 0。
代价是结算页没有 BGM（原资源包是联网资源，离线本就拿不到），界面与判定不受影响。

### 4.2 小窗角落按键图标破图

**根因**：旧版为了在 `file://` 下可用，移除了远程 `Material Icons` 字体，但
`#stage` 四角的 `<i class="tl">&#xe034;</i>` 等仍是字体私有区（PUA）码位，
字体缺失后就显示为方块/破图；复选框的 `content:'\e835'` 同理。

**修复**：

- 四个角标改为内联 SVG（暂停 / 重试 / 设置 / 全屏），保留原 `#stage i.tl/.tr/.bl/.br`
  的定位与 `pointer-events:none`，尺寸、位置、交互完全不变；
- 复选框/单选框图标改为 CSS 绘制（勾选态用 SVG dataURI）；
- 构建时继续剔除 Material Icons 的 `@font-face` 与 PUA `content`，不再依赖任何远程字体。

**验证**：`#stage i svg` 数量为 4，样式表中不存在 `Material Icons` 字体声明。

---

## 5. 构建

依赖：Python 3.9+（只用标准库）。构建会读取只读的 `../sim-phi/phi-h5`。

```bash
cd sim-phi-phira
python build.py
```

产物：

- `css/sim-phi.css`：`style0.css + style1.css`，剔除 Material Icons、PUA 图标
- `js/vendor/sim-phi.bundle.js`：引擎 bundle + 内联 zip Worker + 内联皮肤 + 音频修复
- `dist/index.html`：把上面的 CSS/JS 全部内联后的单文件版

构建脚本不会修改 `sim-phi/origin` 或 `sim-phi/phi-h5` 中的任何文件。

---

## 6. 性能优化（游玩卡顿）

模拟器页「曲谱与设置 → 性能」提供两个开关，默认值会自动适配设备：

| 选项 | 说明 |
| --- | --- |
| 帧率上限 | 默认 **60 FPS**（引擎原生不限制，120 Hz 平板会跑 120 帧）；可调 30/45/60/不限 |
| 性能模式 | 把渲染分辨率限制在约 **1.25 设备像素 / CSS 像素**（DPR 2 的平板会从 2× 降到 1.25×，像素量减少约 60%）；触屏设备默认开启 |

另外做了三处不改核心逻辑的优化：

1. **消除每帧强制布局**：引擎原本每帧调用 `resizeCanvas()` → `getBoundingClientRect()`。
   现在用 `ResizeObserver` 包装 `hook.app.resizeCanvas`，只有画布尺寸真正变化时才重新同步。
2. **移动端去掉高开销 CSS**：触屏/窄屏下关闭顶栏 `backdrop-filter`、取消 `background-attachment: fixed`，
   状态点的脉冲动画从 `box-shadow` 改为 `transform/opacity`（走合成层）。
3. **切页停止渲染**：离开模拟器页时自动暂停并停掉渲染循环，回来再恢复。

实测（Edge headless、DPR 2、1024 视口、CPU 降频 4×）：

| 配置 | FPS | 画布 |
| --- | --- | --- |
| 性能模式关 | 4.3 | 1638×922 |
| 性能模式开（1.25×） | 13.2 | 1023×576 |

约 **3 倍**提升；不降频时同样有约 2 倍提升（6.6 → 13.2）。真机有 GPU 时帧率会更接近上限，
但弱 GPU 平板/高 DPR 设备受益最大。卡顿明显时可再把帧率上限调到 45。

---

## 7. 兼容性与限制

- 目标环境：Chrome / Edge 90+、Android Chrome（WebView 90+）；需要 IndexedDB、
  Blob Worker、`createImageBitmap`、`decodeAudioData`
- 不使用 ES Module（`file://` 下会被 CORS 拦截），全部为普通 `<script>`
- 不依赖任何外部字体、CDN、统计脚本；除 Phira 接口外不发起网络请求
- **已知限制**：单机 Fork 无法自动下载曲谱包（见 3.4），需手动导入或配置代理；
  列表 / 详情 / 封面不受影响
- 首次载入曲谱时需要解码音频（约 2 MB mp3），低端设备可能等待数秒，属正常现象

---

## 8. 版权与致谢

- 模拟器核心：[lchzh3473/sim-phi](https://github.com/lchzh3473/sim-phi)（原作者）
- Phira 曲谱与接口：Phira 社区 / `phira.moe`
- 内置皮肤：Phigros Origin（Pigeon Games / 皮肤作者）
- 本项目仅用于个人学习与离线游玩，请勿用于商业分发；分享请保留原作者信息
