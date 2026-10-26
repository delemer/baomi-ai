# 修改声明 / Modification Notice

本仓库是 **爆米AI**，是开源项目 **ClipForge** 的修改版（非官方版本）。

- 上游项目：ClipForge v0.9.12
- 上游作者与版权：Copyright (C) 2026 **xixihhhh**
- 上游地址：<https://github.com/xixihhhh/clipforge>
- 上游许可：**AGPL-3.0-only**（见本仓库 `LICENSE`、`NOTICE`）
- 本版本修改者：**爆米AI 团队**
- 修改日期：**2026-10-26**
- 本版本许可：**AGPL-3.0-only**（与上游一致；完整对应源码见本仓库）
- 本版本源码地址：`https://github.com/delemer/baomi-ai`

> 依据 AGPL-3.0 §5(a)，修改版必须显著标注"已修改"及修改日期；§5(b) 要求显著标注其依本许可发布；
> §4/§5 要求保留原作者的版权声明与许可全文。上游的 `LICENSE` / `NOTICE` 已原样保留，未作删改。

---

## 本版本相对上游的修改内容

### 1. 新增：Max API 中转站接入（核心改动）

| 文件 | 说明 |
|---|---|
| `src/lib/providers/max-relay.ts` | 新增 `max-relay` Provider。上游的 OpenAI 兼容视频走 `multipart` + 扁平请求体；Max API 的 `POST /v1/videos` 只收 JSON、`metadata` 必填、且生成参数按模型族分裂（wan 用大写 `720P`、seedance/vidu 用小写、seedance-2.5 无 `generation_mode`）。参考图必须先 `POST /v1/assets` 上传换 id（seedance-2.5 例外，只吃 url）。任务状态多一个 `unknown`，上游白名单不认会抛 `UNKNOWN_STATUS`，此处按"未完成"处理。 |
| `src/lib/max-onekey.ts` | 一键接入常量与默认模型 |
| `src/lib/__tests__/providers-max-relay.test.ts` | 16 个契约测试，固化上述映射关系 |
| `src/lib/providers/index.ts`、`src/lib/stores/settings-store.ts`、`src/app/settings/page.tsx`、`src/components/generation-settings.tsx`、`src/lib/i18n/messages/settings.ts`、`src/app/api/ai/test-provider/route.ts` | 注册 Provider、一键接入 action、设置页平台卡、自定义模型下拉、中英文案、连接测试地址 |

### 2. 修复：上游 LLM 兼容逻辑对本中转站的三个"隐形坑"

| 文件 | 修改 |
|---|---|
| `src/lib/llm-error.ts` | ① `jsonModeParams()` 的域名白名单加入中转站域名——否则拿不到 `response_format: json_object` 供应商级约束；② `optionalParamRetryFetch()` 增加"空 body 400 时摘掉 `temperature` 重放一次"的分支——Max 的 `gpt-6-*` 会用空 body 拒绝 `temperature`，而本项目写脚本固定发 `0.8`。 |
| `src/lib/gen-params.ts` | `toEditVariant()` 增加中转站"文生图 → 图生图"的 model id 映射；中转站的文生图与图生图是两个不同 id，不映射会把参考图硬发给只做文生的模型。 |
| `src/lib/llm-presets.ts` | 新增中转站快捷预设（默认 `deepseek/deepseek-v4.1-flash`，实测接受 `temperature` 且支持识图）。 |

### 3. 品牌更名为「爆米AI」

修改点（仅用户可见文案与标识，**未改动内部标识符**，避免破坏已存用户数据与导出文件互操作性）：

- `package.json`：`name` / `productName` / `appId`
- `electron/main.js`：窗口标题、启动日志与错误对话框；并显式把 `userData` 固定为 ASCII 目录 `BaoMiAI`（避免中文路径进入 ffmpeg 参数，同时与官方版数据目录隔离）
- `src/app/layout.tsx`：页面 title / description
- `src/components/app-shell.tsx`：侧边栏与移动端顶栏品牌名
- `public/logo.svg`、`src/app/icon.svg`、`electron/icon.png`：新 Logo（黑色圆角矩形 + 「米」）
- `src/lib/compliance-metadata.ts`：AIGC 隐式标识的"服务提供者"默认值（GB 45438 必填项）
- 各 i18n 文案、内置风格配方作者字段、导出文件名、EDL 注释、抓取用 User-Agent

**保留未改**（有意为之）：`clipforgeStorage` 存储桥、`clipforge:settings` IPC 通道、各类 `localStorage` 键、`clipforge-style-pack@1` 等文件格式串、OTIO/EDL 元数据键、`CLIPFORGE_*` 环境变量。这些是数据与格式契约，改名会导致老用户配置丢失或导出文件不兼容。

### 4. 移除上游的第三方推广返利链接

`src/lib/atlas-onekey.ts` 中上游默认指向 `atlascloud.ai?ref=JPM683`（原作者返利码）。
本项目发布的分发版不应把用户导向他人的返利账号，已改为不带参数的普通地址。

### 5. 补齐分发合规材料

- `package.json` 的 `build.extraResources` 现在会把 `LICENSE`、`NOTICE`、`THIRD-PARTY-NOTICES.md` 打进安装包（上游的 `build.files` 未包含，属分发缺口）
- 新增 `THIRD-PARTY-NOTICES.md`：FFmpeg/FFprobe 的 GPL-3.0 义务与源码获取路径、字体 OFL、Electron/Chromium、LGPL 组件等

---

## 上游未修改部分

除上述改动外，其余代码、文档、模板与素材均来自上游 ClipForge v0.9.12，版权归原作者 xixihhhh 所有，依 AGPL-3.0 使用。

## 如何自行核对

```bash
git diff --stat          # 相对上游的改动规模
git log --oneline        # 本仓库提交历史
```

如需逐文件核对，请对比上游 tag `v0.9.12`。
