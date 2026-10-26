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

### 5. 设置页拆分为「极简」与「高级」两层

上游只有一个设置页（1427 行、7 个标签、8 个平台卡全部展开、35 个输入框），对"只用中转站"的用户过重。

- **`/settings`（新增）**：极简设置页 —— 只有「连接中转站（一个 Key 输入框）」「出片质量（画质 / 比例 / 花费上限）」「当前使用的 AI（只报用途，不报模型名）」三块；单页滚动、不分标签、不出现"平台"概念。
- **`/settings/advanced`（原页面迁移至此）**：完整参数页，能力与上游一致，新增「← 返回简单设置」入口。
- 应用内 9 处 `?tab=` 深链已改指：配置 Key 类 → 极简页；模型 / 平台类 → 高级页。
- i18n：新增 `simple*` / `advancedTitle` 等词条（中英成对）。

### 5.1 MAX 场景型号接入（第二批）

Max API 的 `supersolar-*-app` 系列走**另一个端点** `POST /v1/video-generations`（不是 `/v1/videos`），
请求体必填 `request_id`、参数在 `parameters`、素材是 `assets:[{asset_id, slot}]`（需先 `POST /v1/assets`）。
第一批实现时被整体过滤掉了；第二批按各自契约接入其中三个：

| 型号 | 映射方式 |
|---|---|
| `supersolar-literary-drama-app`（文戏） | 首/尾帧 → `first_frame`/`last_frame`；`generation_mode` 按帧位取 0/1/2/3；比例是带括号标签的整串（`9:16 (Portrait Widescreen)`）；无 480P（上抬到 720P） |
| `supersolar-real-person-drama-app`（真人剧） | 参考帧 → `image_1..N`；同上比例/分辨率规则 |
| `supersolar-multi-reference-v2-app`（多参生视频） | 参考图 → `image_1..9`；`motion_type`/`duration_mode` 显式传；支持 480P，最长 60 秒 |

任务 id 形如 `generation_*`：状态查询按前缀直接走 `/video-generations/{id}`（终态看 `overall_status` + `terminal`，
成片在 `video` 字段，取片仍用 `/v1/videos/{video.id}/content`）。实测文戏 5 秒 720P 约 2.5 分钟出片、带 AAC 音轨。

**仍未接入**：`supersolar-infinite-outfit-app`（需 `person_image` + `outfit_1..4`）、
`supersolar-virtual-ip-v2-app`（需人像 + 口播文本/音色）、`supersolar-video-remix-app`（需源视频槽位）——
它们的必填素材槽位在 ClipForge 的通用视频调用里没有对应来源，接之前需要各自做专用入口。

### 5.2 图片与整片链路的三个契约修复

- **文生图尺寸字段**：`supersolar-image/*` 的请求体没有 `resolution`，硬发会被 400
  （`invalid_image_request`）。现在按型号预判 + 服务端点名字段时自动摘掉重放（最多两个字段）。
- **异步出图**：部分图片型号超时后返回 `504 image_task_pending` + `task_id`，任务其实已受理。
  适配器改为轮询 `/v1/images/tasks/{id}` 直到出图，避免"报失败但已扣费"。实测 `supersolar-image` 约 90 秒出图。
- **整片模型映射**：上游把"整片"的兜底模型写死成 Atlas 的 `bytedance/seedance-2.5/reference-to-video`，
  中转站没有这个 id（参考生视频就是 `seedance-2.5` 本身）。改为按 provider 取兜底型号，
  并在适配器里为 `seedance-2.5` 补 `omni_reference_task_type: "reference"` 与音频开关。

### 6. 补齐分发合规材料

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
