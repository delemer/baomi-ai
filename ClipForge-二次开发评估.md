# ClipForge 二次开发评估报告

> 评估对象：`D:\Deepseek\带货视频`（GitHub `xixihhhh/clipforge`，v0.9.12，AGPL-3.0-only）
> 评估目标：在它基础上做二次开发 —— 接入你自己的大模型中转站，并把成品分享给别人使用
> 评估方式：全量源码审读 + 文档通读 + 关键结论逐条回源码复核（本文中 `文件:行号` 均为实测）
> 声明：许可部分是**基于许可证文本与代码事实的工程判断**，不是法律意见；涉及商标、API 转售、国内备案请咨询律师。

---

## 零、第二轮修订（基于你的两个中转站 + 只发 Windows + 不收费）

> 本节是针对你的补充信息做的**修订结论**，优先级高于后文。后文（一~八）是通用评估，仍然有效。

### 0.1 两个中转站实测能力对比

数据来源（实测拉取）：
- `https://mziapi.com/api/pricing`
- `https://max.xiafeng.co/api/pricing`
- `https://max.xiafeng.co/docs/openapi/consumer-v1.json`（OpenAPI 3.0.3，693 KB，完整 spec）

| 能力 | mziapi.com | max.xiafeng.co（Supersolar / Max API） | ClipForge 是否需要 |
|---|---|---|---|
| Chat `/v1/chat/completions` | ✅ | ✅ | ✅ 写脚本，**必需** |
| 视觉识图 | 定价页未标"识图"，需实测 | ✅ gpt-6.1-sol / gemini-3.8-flash / doubao-seed-2-1-pro 等都明确标"识图" | ✅ 商品图分析，**必需** |
| 图片 `/v1/images/generations` | ✅ gpt-image-2 / gpt-image-2.5 | ✅ 10 个模型，**JSON + multipart 双协议** | ✅ |
| 图片 `size` 兼容 | 需实测 | ✅ 接受 `1024x1536`（ClipForge 竖屏默认值正好是这个） | ✅ 竖屏出图 |
| 模型发现 `GET /v1/models` | new-api 系一般支持（需实测） | ✅ 标准 OpenAI 格式 | 可选 |
| **视频 `/v1/videos`** | ❌ **完全没有** | ✅ 有（seedance 2.0/2.5、wan-3.0、vidu-q4） | ✅ **AI 成片的核心** |
| TTS `/v1/audio/speech` | ❌ | ❌ | 可用内置免费 Edge TTS 替代 |
| Anthropic `/v1/messages` | ✅ | ❌ | 不需要 |
| `/v1/responses` | ✅ | ❌ | 不需要 |

**结论：**
1. **`max.xiafeng.co` 是唯一能覆盖"脚本 + 图片 + 视频"的，必须作为主站。**
2. **mziapi 只能覆盖"脚本 + 图片"，没有视频接口**，适合做备用/降级通道，不能当主力。
3. 两个站都没有 TTS → 配音继续用 ClipForge 内置的**免费微软 Edge TTS**（5 个中文音色，零成本，够用）。

### 0.2 坏消息：视频**不能**零代码接，必须写适配器

这是本轮最重要的修正。我用 OpenAPI spec 逐条核对了 ClipForge 的期望和 max 的实际契约：

| 环节 | ClipForge 的期望 | max.xiafeng.co 的实际 | 结果 |
|---|---|---|---|
| 提交方式 | `multipart/form-data`（`providers/openai.ts:99-108`） | **只接受 `application/json`**（spec 里 requestBody 无 multipart） | ❌ 400 |
| 请求体 | `{model, prompt, seconds, size, input_reference}` | **`required: model, metadata`**，`metadata.parameters` / `metadata.assets` 分包 | ❌ 400 |
| 请求形状 | 一套通用体 | **按模型分 6 种**（Seedance2 / Seedance25 / Wan / ViduQ4 / Seedance2Fast / Seedance2Mini） | ❌ 需分派 |
| 时长 | `"5"` 字符串 | 枚举（wan: -1,2~30；seedance2: -1,4~15）—— 5 在范围内 ✅ | ✅ |
| 状态名 | `queued/pending/in_progress/processing/completed/failed/cancelled/canceled` | `queued/in_progress/completed/failed/`**`unknown`** | ⚠️ `unknown` 会抛 `UNKNOWN_STATUS`，**1 行修复** |
| 取片 | `GET /v1/videos/{id}/content` 带 Bearer，**禁重定向** | ✅ 同样路径，返回二进制 | ✅ |
| legacy 路径 | baseUrl 以 `/video/generations` 结尾时 POST JSON | 实际路径是 `/v1/video-generations`（**连字符**），不是 `/video/generations` | ❌ 对不上 |

**含义**：报告第 3.4 节的"方案 D（协议级适配）"是**必选项，不是可选项**。要写一个 `maxrelay` provider（继承 `OpenAIProvider`，覆写 `submitVideoTask` / `getTaskStatus` / `listModels`）。

### 0.3 好消息：图片和脚本基本能开箱即用

- **mziapi 的图片模型 id 就叫 `gpt-image-2` / `gpt-image-2.5`** —— 和 ClipForge 内置硬编码列表（`providers/openai.ts:146-170`）**完全一致**，理论上选 OpenAI 平台填好 baseUrl 就能直接在下拉框里看到。
- **max 的模型 id 是 `gpt-image-2.0/text-to-image/economy` 这种**（spec 里是 10 个固定枚举值）→ 必须走"自定义模型"手填，但正好 `gpt-image*` 前缀会命中 ClipForge 的 gpt-image 分支（不发 `response_format`、尺寸走任意分辨率），行为是对的。
- 图片接口同时支持 `size: 1024x1536`，而 ClipForge 竖屏默认就发这个值 → **能出竖图**，不需要额外适配。

### 0.4 修订后的工作量

| 阶段 | 内容 | 修订后工时 |
|---|---|---|
| 阶段 0 | 填 baseUrl 验证 chat + 图片（两个站都测） | **0.5 天** |
| 阶段 1 | 一键接入 + 预设 + 默认模型（方案 B） | **1 天** |
| 阶段 2 | **视频适配器**（方案 D，新增，必须做） | **1–2 天** |
| 阶段 3 | 换牌 + 合规材料 + 打包（只发 Windows，见 0.5） | **1 天** |
| **合计** | | **4–5 个工作日** |

### 0.5 "只发 Windows + 不收费"带来的简化（好消息）

这两条把你的义务范围**收窄了不少**：

- ✅ **不用做在线服务** → AGPL §13（网络交互必须提供源码）**完全不适用**；
- ✅ **不用做 Docker 镜像** → 少一套 ffmpeg GPL 合规和鉴权工作；
- ✅ **不收费** → 不涉及"卖服务还是卖许可"的边界问题，也不需要用户协议/退款/发票；
- ⚠️ 但仍然适用：「分发安装包 = convey」→ **§5/§6 的源码提供义务照旧**，且**免费不免除**。
- ⚠️ 仍然要做：安装包里补 LICENSE/NOTICE、写明修改声明、提供源码地址、履行 ffmpeg/ffprobe 的 GPL 义务。

### 0.6 你最关心的问题：不开源会怎么样？软件包发给别人，别人用不了吗？

**分两层回答，因为这两层是脱钩的。**

#### 技术上：完全能用，一点都不影响

我实测核验过（不是推测）：
- ❌ 没有激活码 / 没有 license key 校验（全仓 grep `activation|licenseKey|machineId|verifyLicense` 无有效命中）
- ❌ 没有联网校验 / 没有 telephone home（`electron/main.js` 里唯一的外部地址是 `http://127.0.0.1:${port}`）
- ❌ 没有自动更新（无 `electron-updater` / `autoUpdater`）
- ❌ 没有遥测（依赖里无 posthog/sentry/mixpanel/analytics）

→ **你打出来的 `ClipForge.Setup.*.exe` 发给任何人，双击就能正常运行，功能一点不少。**
原因很简单：这是一个本地单机软件，AGPL 是**法律约束**，不是技术约束，作者也没有加 DRM。

#### 法律上：属于违约，后果是"你失去了分发它的权利"

- AGPL §5/§6：分发**修改版**（哪怕只是改了配置和品牌）必须随附完整对应源码（Corresponding Source），或有效的书面要约。
- §8：**一旦违约，你获得的授权自动终止** —— 严格讲，从那一刻起你**没有权利**再分发它，哪怕你不再修改。
- 现实中的后果阶梯（从轻到重）：
  1. 作者要求你停止分发 + 公开源码（最常见，一封信的事）；
  2. 平台投诉下架（GitHub / Gitee / 网盘 / QQ群 / 公众号 / 视频号）—— 你的分发渠道会断；
  3. 主张著作权侵权赔偿（国内可按违法所得或法定赔偿主张）；
  4. **声誉成本**：开源圈对 AGPL 违约极其敏感，一旦被公开点名，你中转站的客户群（恰好就是开发者）会直接受影响 —— 这条对你的实际伤害可能比法律更大。
- 还有个容易被忽略的点：**用户拿到的是"侵权副本"**。用户本身一般不承担责任，但一旦作者维权、你停止分发，你的用户就断更了。你承诺的"分享给别人用"会变成"发出去就收不回来、但也不能再更新"。

#### 风险不对称

你省下的是**约 1 天**（补 LICENSE/NOTICE + 写声明 + 挂源码链接）；赔上的是**产品的合法性和你的个人/品牌信誉**。这笔账非常不划算。

#### 三条路，按推荐顺序

| 路径 | 做什么 | 法律义务 | 成本 | 评价 |
|---|---|---|---|---|
| **A. 只发"接入教程"，不分发软件** | 写一份《ClipForge + 我的中转站 配置指南》，让用户自己去 GitHub 下官方原版，然后照教程填你的 baseUrl + Key | **零** —— 你根本没有分发软件的行为（配置/教程不是衍生作品） | 2 小时 | ✅ **最省事、零风险**，但没有你的品牌和一键体验 |
| **B. fork + 开源 + 发安装包**（推荐） | 做成一键接入版，源码放你自己的 GitHub/Gitee，安装包和源码同页免费提供 | 合规，成本 1 天 | 1 天 | ✅ **最优解**：有品牌、有一键体验、完全合规 |
| **C. 闭源 + 发安装包** | 只发 exe，不给源码 | **违约** | 0 | ❌ 技术上能跑，但你在裸奔 |

**我的建议：走 B。** 你反正要做"一键接入"这件工程（1 天），把源码一起公开只多 1 天（补 LICENSE/NOTICE + 修改声明 + 源码链接），却把整个项目的合法性买回来了。而且开源对你其实是**加分项**：你的目标用户是会用 AI 工具的人，一个"开源、无套路、自带中转接入"的版本比一个闭源黑盒更容易被信任——这直接利好你的中转站充值。

> 补充一个细节：即使你**一个字都不改**、原样转发官方安装包，也仍然需要附带 LICENSE 和源码获取方式。"免费"不构成豁免理由，AGPL 只认"你有没有把副本交到别人手里"。

---

## 一、结论先行

### 1. 技术上：比你想的便宜，但"便宜"和"开箱即用"是两件事

这个项目的 LLM 接入**本来就是"用户自填 baseUrl + Key + 模型名"的形态**，没有任何平台白名单会挡住你的域名。
- **验收/自用**：你的中转站大概率**一行代码都不用改**，在设置页填三处地址就能跑通（`src/app/settings/page.tsx:643-731`）。
- **分享给别人用**：需要把地址、模型、品牌"预置"进去，约 **8–10 个文件 / 200 行 / 0.5–1 天**。
- **图片/视频/TTS 也走中转站**：TTS 零代码；图片基本零代码；**视频是最脆弱的一环**，取决于你的中转站是否严格实现 OpenAI 的 `/videos` 契约，不匹配就要写适配（+150–250 行 / 1–2 天）。

### 2. 法律上：这是本次评估里最大的一笔成本，而且是硬性的

- 项目是 **AGPL-3.0-only**（`package.json:5`），作者在 `NOTICE:7` 额外写明"修改或再发布（含以网络服务形式提供）须公开源码、继续以 AGPL-3.0 发布、并保留本版权署名"。
- **"分享给别人用" = 分发（convey），义务全套激活**：你必须把**你自己的修改版完整源码**（含构建脚本）免费公开，并保留原作者署名。收费可以，但不能"付费才给源码"，也不能加激活码/禁止转售。
- **两个现存缺口，你分发前必须自己补**：
  1. 打出来的安装包**根本不含 LICENSE / NOTICE**（`package.json:72-78` 的 `build.files` 没列）；
  2. 安装包里随附的 `ffmpeg.exe`(105MB) / `ffprobe.exe`(81MB) 是 **GPL-3.0** 二进制（`node_modules/ffmpeg-static/package.json:37`、`node_modules/@ffprobe-installer/win32-x64/package.json:24`），需要单独履行 GPL 的源码提供义务。

### 3. 真正的风险排序

| 排名 | 风险 | 性质 | 能否规避 |
|---|---|---|---|
| 1 | AGPL 要求你开源自己的改动 | 法律硬约束 | 不能规避，只能合规 |
| 2 | 上游是**单人维护 + 高频更新 + 靠域名正则做适配** | 长期维护成本 | 部分（少改上游核心） |
| 3 | 视频接口契约不匹配 → 永远转圈 | 技术 | 可（先验证再用） |
| 4 | 你的中转站 Key 被打进安装包 | 安全/资损 | 可（设计上避开） |
| 5 | 品牌换牌不彻底（appId/元数据/AIGC 服务商） | 合规+体验 | 可（清单化） |

---

## 二、这个项目到底是什么

### 2.1 产品定位

开源、本地部署、BYOK（自带 Key）的 **AI 带货短视频生成器**：一张商品图 → 脚本 → 配音字幕 → 本地 FFmpeg 合成 → 可直接发抖音小店/快手/小红书/视频号/TikTok Shop 的竖屏带货片（`README.md:3-7`）。

目标用户里作者**明确写了"独立开发者：基于此项目二次开发，构建 AI 视频 SaaS"**（`README.md:608`）—— 你的用法在作者的预期场景内。

### 2.2 体量（实测）

| 指标 | 数值 | 依据 |
|---|---|---|
| 源码文件（git 跟踪） | 643 个 | `git ls-files` |
| API 路由 | 72 个 `route.ts` | `src/app/api/**` |
| 媒体 Provider | 7 个（Atlas/fal/Replicate/火山/百炼/硅基/OpenAI） | `src/lib/providers/index.ts:29-76` |
| LLM 预设 | 10 个 | `src/lib/llm-presets.ts:22-40` |
| 内置模板 | 391 款（`ad-templates.ts` 335KB / 5885 行） | `src/lib/ad-templates.ts:1-38` |
| 测试 | 1184 个（README 自称） | `README.md:495` |
| 技术栈 | Next.js 16.2.1 / React 19 / TS5 / Tailwind4 / Electron 42 / better-sqlite3 / drizzle / FFmpeg / Zustand | `package.json:28-119` |

### 2.3 文档盘点（你让我一起看的）

| 文档 | 体量 | 质量评价 |
|---|---|---|
| `README.md` | 76 KB | 很扎实，功能按版本逐条记录；**但功能清单停在 v0.9.5**，v0.9.6–0.9.11 无记录 |
| `TUTORIAL.md` | 39 KB | 面向小白，含"报错对照表"，对二次开发最有用的就是它 |
| `docs/` | 52 个文件（md + html + 截图 + demo 视频） | 官网/说明站源码，内容与 README 大量重复，且**有版本号漂移**（0.9.7/0.9.11/0.9.12 混用） |
| `AGENTS.md` | 5 行 | **重要提醒**：强制要求"写代码前先读 `node_modules/next/dist/docs/`"，因为这是 Next.js 16，和训练数据里的不一样 |
| `docs/troubleshooting/desktop-and-video.md` | 3.4 KB | **二次开发必读**，里面写了视频兼容接口的两套契约和"适配器不会自动换端点" |
| `skills/`、`mcp/`、`.claude-plugin/` | — | 项目同时是一个 Agent Skill + MCP Server 的发行物，这套扩展机制可以复用 |

**文档与代码不一致的地方**（别被带偏）：
- 文档说"自定义模型"在 `Settings → Advanced → Custom models`，实际在设置页的"生成设置"区；
- 文档口径里没有"自定义平台"这个提法，等价能力叫"自定义接入点 baseUrl / 任意 OpenAI 兼容端点"（`TUTORIAL.md:281`）；
- 仓库是 **shallow clone**（只有 1 个提交），无法用 git 历史核对发版节奏。

### 2.4 一个对你有用的事实：这台机器上它已经跑通过

- `data/` 里有真实的 `sqlite.db` 和多个 `final_*.mp4` 成片（4 条，5.7–22MB）；
- `.dev/installers/ClipForge.Setup.0.9.12.exe` 已存在，**157.9 MB** —— 说明 `next build → bundle:standalone → electron-builder` 这条打包链路在你的机器上是通的。

→ **这意味着"改造 + 打包分发"的工程可行性已经验证了一半**，剩下的主要是接入和合规。

---

## 三、接入你的中转站：技术上要改什么

### 3.1 关键认知：这里是**四条相互独立的接入链路**

很多人会以为"加个平台"是一处改动，实际上这个项目里 LLM、图片、视频、TTS 是**四套独立配置、四套独立代码路径**：

| 链路 | 用途 | 配置位置 | 协议 | 能否纯配置接入 |
|---|---|---|---|---|
| **LLM** | 写脚本、商品图分析、判官、找素材关键词 | `settings.llm`（`settings-store.ts:29-35`） | OpenAI `/chat/completions` + `/models` | ✅ **完全零代码** |
| **图片** | 生图、商品保真图生图 | `providers.openai`（`index.ts:71-76`） | `/images/generations`、`/images/edits` | ✅ 零代码（有隐性限制） |
| **视频** | 图生视频、一键整片 | 同上 | `/videos` 或 `/video/generations` + 轮询 | ⚠️ **契约严，最易失败** |
| **TTS** | 配音 | `settings.tts`（`settings-store.ts:38-49`） | `/audio/speech` | ✅ 零代码 |

> 所以"加入我的中转站"要分四件事分别确认，不能笼统说"支持"。

### 3.2 今天就能用的零代码路径（建议你先花 10 分钟验一遍）

这是**验证可行性最快的办法**，也是后面所有改造的地基：

1. **LLM**：设置 → LLM → `API 地址` 填 `https://你的中转站/v1`，填 Key，模型名手填或点"读取可用模型"（`model-picker.tsx:27-56` 会打 `POST /api/llm/models`）→ 点"测试连接"。
2. **图片/视频**：设置 → 平台 → 找到 **OpenAI** 卡片 → 开启 → 填 Key → 展开"自定义接入点 baseUrl"填同一个地址（`settings/page.tsx:582-599`）。
3. **自定义模型**：生成设置 → 自定义模型 → provider 选 `OpenAI / Compatible` → 类型 image/video → 填中转站真实 model id（`gen-params.ts:18-30`）。**媒体侧不会自动发现模型**，必须手填。
4. **TTS**：配音 → 平台选"OpenAI 兼容 (/audio/speech)" → 填同一个 baseUrl / Key / model / voice。
5. 跑一条最短链路：上传商品图 → 生成脚本 → 生成一镜图片 → 生成一镜视频 → 配音。

**这一步能跑通，说明你的中转站是"真 OpenAI 兼容"，后面只需做体验优化；跑不通，问题基本会落在下面 8 个坑里。**

### 3.3 中转站必踩的 8 个坑（已逐条回源码核验）

| # | 坑 | 现象 | 源码原因 | 修法 | 成本 |
|---|---|---|---|---|---|
| 1 | **baseUrl 漏写 `/v1`** | 全部 404 | 代码只去尾斜杠，**不自动补 `/v1`**（`providers/openai.ts:51`、`llm-models.ts:19-21`） | 让默认值直接带 `/v1` | 1 行 |
| 2 | **拿不到 JSON 模式** | 弱模型偶尔解析失败、重生成 | `jsonModeParams()` 按**域名正则白名单**决定是否发 `response_format`（`llm-error.ts:157-161`），你的域名不在名单里就不发 | 把你的域名加进正则，或让中转站支持 json_object 后加白 | 1 行 |
| 3 | **思考型模型污染 JSON** | 时好时坏 | `reasoningParams()` 同样按域名白名单（`generator.ts:120-128`）；`<think>` 标签能自动清（`llm-clean.ts`），纯文本思维链不能 | 域名加白，或默认选非推理模型 | 1 行 |
| 4 | **媒体模型下拉框里没有你的模型** | 用户选不到 | 图片/视频的 `listModels()` 是**硬编码数组**，不请求远端（`providers/openai.ts:146-170`） | 往数组里加条目；想自动发现要照 `atlas-catalog.ts` 写一个（~100 行） | 15 行 / 1 天 |
| 5 | **视频状态名不匹配 → 永远转圈** | 任务不失败但永远出不来片 | 只认 `queued/pending/in_progress/processing/completed/failed/cancelled/canceled`（`providers/openai.ts:125-130`），`succeeded`/`running`/`SUCCESS` 直接抛 `UNKNOWN_STATUS` | 改适配器映射，或让中转站对齐状态名 | 10 行 |
| 6 | **取片 302 被拒** | 视频已完成但下载失败 | `downloadProviderVideo` 用 `redirect: "error"`（`providers/video-download.ts:16`），中转站若 302 到 CDN 直接挂 | 改成 `follow` 并校验域名，或让中转站直出字节流 | 5 行 |
| 7 | **多图参考编辑不可用** | 九宫格分镜报"缺少参考图" | `openai` provider 的 edit 只认单张 `referenceImageUrl`（`providers/openai.ts:206-208`），而九宫格传的是数组 | 实现多图 edit；或该功能在你版本里关掉 | 30–60 行 |
| 8 | **TTS 卡死无超时** | 整条合成管线挂住 | OpenAI 兼容 TTS 请求**没有超时**（`tts.ts:206-229`），且熔断器按 provider 名 `openai` 共享（`tts.ts:55-63`） | 补 `AbortSignal.timeout`；给中转站独立 provider 名 | 10 行 |

**另外三个不致命但要知道的**：
- 图片尺寸会被强制成 OpenAI 三档（`openai.ts:307-325`），默认 1080×1920 实际发 `1024x1536`；你的中转站若只认 `9:16` 字符串会 400。
- 所有 AI 调用只支持 `Authorization: Bearer`，**UI 无法配自定义请求头**（`ProviderConfig.headers` 存在但三条生成路由没传，见 `api/ai/image/route.ts:20`）。
- 任务恢复不记忆 baseUrl（`ai-tasks.ts:22-32`）—— 用户改了中转站地址，老任务就恢复不了。

### 3.4 三档改造深度（按你的目标选）

#### 方案 A：零代码（只给自己的小圈子用，配一份接入文档）
- 改动：**0 行**
- 效果：用户按文档手填 4 处地址 + 手动建自定义模型
- 风险：用户漏 `/v1`、模型 id 拼错 → 体验差、客服成本高
- **不推荐给"分享给别人"的场景**

#### 方案 B：预置 + 一键接入（**推荐**）
照项目已有的 "Atlas 一键接入" 机制复刻一套（`atlas-onekey.ts` 61 行 + `settings-store.ts:248-275` 的 store action + 设置页面板 + 落地页入口）：

| 步 | 文件 | 改动 | 量 |
|---|---|---|---|
| 1 | 新建 `src/lib/myrelay-onekey.ts` | 照 `atlas-onekey.ts`：网关地址、Key 领取页、默认模型（llm/vision/image/video/tts） | ~60 行 |
| 2 | `src/lib/stores/settings-store.ts` | 新增 `applyMyrelayOneKey(key)`：一次写好 LLM + providers.openai + 默认图/视频模型 + TTS；`version 5→6` + migrate | ~35 行 |
| 3 | `src/app/settings/page.tsx` | Atlas 面板旁加同款面板 | ~25 行 |
| 4 | `src/app/start/page.tsx` | 落地页内联"粘贴 Key 即用"入口 | ~30 行 |
| 5 | `src/lib/llm-presets.ts:22-40` | 加一条快捷预设 | 1 行 |
| 6 | `src/lib/tts-presets.ts:46-50` | TTS 加一条预设 | 1 行 |
| 7 | `src/lib/providers/openai.ts:146-170` | 模型列表里加你的模型 | ~15 行 |
| 8 | `src/lib/i18n/messages/{settings,start}.ts` | 文案（**中英必须成对**，测试会查键存在） | ~10 行 |
| 9 | 测试 | 照 `__tests__/atlas-onekey.test.ts` 写 | ~30 行 |

**合计：8–10 个文件 / ~200 行 / 0.5–1 天**。效果：用户粘一个 Key，脚本/生图/生视频/配音全配好，品牌和"获取 Key"入口都是你的。

#### 方案 C：独立品牌平台卡（想要"我的平台"而不是"OpenAI"）
在 B 之上再加：新建 `src/lib/providers/myrelay.ts`（继承 `OpenAIProvider` 只需覆写 `name/displayName`）+ 注册表登记（`index.ts`）+ UI 卡片（`settings/page.tsx:63-163`）+ i18n + 自定义模型下拉选项（`generation-settings.tsx:28-36`）。
**+0.5 天**，但注意：`name` 字符串必须在 **4 个地方**完全一致（注册表 key、存储 key、`AI_PROVIDERS.key`、`PROVIDER_OPTIONS.value`），否则会出现"模型能列出来但生成时找不到平台"。

#### 方案 D：协议级适配（你的中转站视频协议不标准）
方案 C 之上再改 `getTaskStatus` / `submitVideoTask` / 图片 size / 多图 edit。**+0.5–2 天**，取决于偏差多大。

### 3.5 一句话建议

**先跑方案 A 验证你的中转站到底有多"OpenAI 兼容"，再决定做 B 还是 C+D。** 不要一上来就写适配器——大概率你只需要 B。

---

## 四、分享给别人：AGPL 的真实成本（本次评估最重要的一节）

### 4.1 一句话规则

> **AGPL-3.0-only 不阻止你二次开发、改名、打包、部署、收费；它只强制两件事 —— ① 你分发出去的软件必须继续是 AGPL（源码可得、免费可得）；② 原作者的名必须留在版权声明里。**

### 4.2 六种场景的结论

| 场景 | 能不能做 | 核心义务 | 最大风险 |
|---|---|---|---|
| **A. 自己/公司内部用，不对外** | ✅ 可以 | 无需对外开源（`LICENSE:152-161`） | 边界易破：给外包/子公司/客户用就变成"分发"，义务立刻激活 |
| **B. 打包免费分享给网友** | ✅ 可以 | 继续 AGPL + 标注"我改了什么/日期" + 保留 LICENSE/NOTICE + **提供免费源码地址** + 补齐 ffmpeg GPL 义务 | 现在的安装包**连 LICENSE 都没有** |
| **C. 部署成在线服务（SaaS）** | ✅ 可以（AGPL 明确允许） | §13：必须向**所有**远程用户**显著**提供获取你修改版源码的途径（`LICENSE:542-551`） | 这套代码**没有任何鉴权**（我实测无 middleware/login），直接公网部署 = 谁都能用你的数据盘和 Key |
| **D. 收钱（卖包/会员/中转按量）** | ✅ 可以 | 收费本身合法（`LICENSE:193-194`）；但**只能卖服务/额度/支持**，不能卖"解除 AGPL 的权利"，不能加激活码/禁止转售 | 用别人的名字收费 = 商标/不正当竞争风险最高 |
| **E. 只发补丁/配置，想保留闭源核心** | ⚠️ 不行 | 补丁/插件本身就是衍生作品，必须 AGPL | "深度集成却闭源"站不住（`LICENSE:128-133`） |
| **F. 换 Logo/名字再分发** | ✅ 可以 | 必须保留原作者版权署名 + NOTICE + "非官方修改版"声明 | 换牌不彻底（appId/AIGC 元数据）会出数据互踩和合规事故 |

### 4.3 两个现存缺口（你分发前必须补，不是可选项）

**缺口 1：安装包不含 LICENSE / NOTICE**
`package.json:72-78` 的 `build.files` 只列了 `electron/**`、`package.json`、两个二进制包目录；`electron/after-pack.cjs:22-36` 只拷 `.next/standalone`。
→ **作者自己发出去的包也没带 AGPL 全文**。你分发前必须把 `LICENSE`、`NOTICE`、`THIRD-PARTY-NOTICES.md` 加进 `build.files` 或 `extraResources`。

**缺口 2：ffmpeg / ffprobe 是 GPL 二进制，需要单独履行义务**
- `ffmpeg-static` → **GPL-3.0-or-later**（实测 `node_modules/ffmpeg-static/package.json:37`）
- `@ffprobe-installer/win32-x64` → **GPL-3.0**（实测 `.../package.json:24`；外层 `@ffprobe-installer/ffprobe` 写 LGPL-2.1 是误导，以真正随包的二进制子包为准）
- 这俩合计 186 MB，是安装包 157.9MB（压缩后）的大头
→ 最省事的合规写法：在下载页 + App"关于"页 + `THIRD-PARTY-NOTICES.md` 写明 ffmpeg/ffprobe 的 GPL 许可与源码获取地址。

好消息：**没有任何 AGPL/GPL 的 JS 依赖**，主流依赖全是 MIT/Apache/ISC/OFL（`next`/`react`/`better-sqlite3`/`drizzle`/`openai`/`zustand`…），所以你的 JS 代码不会因依赖被迫换证，真正的 GPL 只有这两颗媒体二进制。

**另外确认过：Remotion 不在依赖、不在构建、不在安装包**（`remotion/README.md:1-5`、`tsconfig.json:33` 排除、`src/` 零引用）。这点很重要 —— Remotion 是**商业许可**（做"视频工具"要按次付费），保持现状不打包即安全，**千万别为了加动效把它打进分发版**。

### 4.4 分发前 checklist（可逐项打勾）

**法律/许可**
- [ ] `LICENSE`(661 行全文) + `NOTICE` 原样保留，且**打进安装包**
- [ ] `package.json` 的 `license` 仍是 `AGPL-3.0-only`，不加任何 EULA/激活码/禁止转售
- [ ] README 顶部 + App"关于"页写：`基于 ClipForge v0.9.12 © 2026 xixihhhh (AGPL-3.0-only)，本人于 <日期> 修改：<改了什么>`
- [ ] App 内有"关于 → 版本 → 版权 → AGPL 链接 → **你这一版源码的下载地址**"
- [ ] 下载页与源码在同一处、**免费**可得（`LICENSE:263-274`）
- [ ] `THIRD-PARTY-NOTICES.md`：ffmpeg/ffprobe=GPL-3.0（附源码链接）、libvips=LGPL、字体=OFL（附 `OFL.txt`）、Electron/Chromium、MIT/Apache 清单
- [ ] 打 git tag，源码包含全部构建脚本（`pnpm-lock.yaml`/`.npmrc`/`next.config.ts`/`electron/`/`scripts/`/`drizzle/`/`Dockerfile`）

**技术**
- [ ] 安装包内**没有** `data/`、没有你的中转站 Key、没有测试素材
- [ ] 发布前扫一遍产物关键词：`sk-`、`apiKey`、你的中转站域名、`Bearer `
- [ ] 确认没有打包 Remotion

### 4.5 你的中转站 Key 绝不能进包

**现状是安全的**（这点作者做得对）：
- Key 存在**客户端**：桌面走 IPC 写 `userData/data/settings/*.json`（0600 权限），浏览器走 `localStorage`（`persistent-storage.ts:13-33`）；
- 服务端**只用不存**：每个 API route 从请求体取 Key，当次用完即弃（如 `api/llm/script/route.ts:155`）；
- `.gitignore` 已排除 `.env*` 和 `/data/`；我实测**全仓无一处 `NEXT_PUBLIC_`**（不会把密钥内联进前端 bundle）。

**你要守住的**：
1. 不要把你的中转 Key / 内部地址写成源码常量（`atlas-onekey.ts:34` 硬编码了作者的返利链接，就是反面教材）；
2. 桌面版不要"预配置 Key"—— asar 只是归档，能被解包；
3. 想让用户"开箱即用"的正确做法：**预置地址和模型，Key 由用户自己填**（或 SaaS 模式下放服务端 + 加鉴权配额）。

---

## 五、容易被低估的长期成本（决定你三个月后是否还维护得动）

1. **上游是单人项目 + 高频更新**：README 里版本从 v0.8.90 一路堆到 v0.9.5（`README.md:44-84`），适配新模型靠"加一行预设/改一处正则"。你 fork 后每跟一次上游，都要重走一遍合并。
2. **适配逻辑靠"域名正则白名单"**：`jsonModeParams`（`llm-error.ts:157-161`）、`reasoningParams`（`generator.ts:120-128`）、`migrateSettings` 的 `hostRe`（`settings-store.ts:139-146`）都是按域名关键字匹配。你的中转站域名不在名单里 = 缺能力；而且 `migrateSettings` 用的是**包含匹配**，如果你的域名恰好含 `deepseek`/`volces.com` 等字样，升级时可能被误改模型名（自建反代域名要避开这些词）。
3. **i18n 双份**：所有文案 zh/en 必须成对新增，`__tests__/i18n-settings.test.ts` 会查键存在性，漏一个测试就红。
4. **换牌清单比想象的长**：`appId`/`productName`（`package.json:64-65`）、窗口标题（`electron/main.js:254`）、页面 metadata（`layout.tsx:13-30`）、侧栏品牌名 2 处（`app-shell.tsx:161,231`）、Logo 3 处、**AIGC 元数据里的"服务提供者"默认值**（`compliance-metadata.ts:33` 默认写死 `"ClipForge"`，SaaS/分发时应改成你的主体，否则国标隐式标识里是别人）、i18n 文案、MCP 包元数据。特别是 `appId` 不改会导致**你的用户数据和官方版共用同一个 userData 目录**，升级卸载互相破坏。
5. **作者的返利链接还在代码里**：`atlas-onekey.ts:34` = `https://www.atlascloud.ai?ref=JPM683`。这既是"默认推荐 Atlas"的商业动机证据，也意味着**你若原样分发，会把你的用户导给上游并让原作者拿返点**。建议替换为你自己的渠道链接（AGPL 完全允许改）。
6. **无鉴权、单用户设计**：`src/` 里没有任何 login/session/middleware（我实测），Docker 直接 `HOSTNAME=0.0.0.0` + 共享 `/data` 卷。**做在线服务必须自研鉴权与多租户隔离**，这是场景 C 最大的工程量，别以为改个品牌就能上线。
7. **默认依赖一个非官方接口**：免费配音走 Edge TTS 的 `wss://speech.platform.bing.com`（`edge-tts.ts:27`），这是非官方通道。量大被限流/改接口是迟早的事，**不要对"免费配音"承诺 SLA**。

---

## 六、风险清单（分级）

| 级别 | 风险 | 说明 | 建议动作 |
|---|---|---|---|
| 🔴 高 | 未开源就分发 | 违反 AGPL §5/§6，且作者 NOTICE 已明示 | 分发前完成 4.4 清单 |
| 🔴 高 | 视频契约不匹配 | 用户看到"永远转圈"，且 `redirect:error` 会放大问题 | 先做方案 A 实测一镜视频 |
| 🔴 高 | 把中转 Key 打进包 | 额度被白嫖，且违反你自己的商业模型 | Key 永远由用户填或放服务端 |
| 🟠 中 | 无鉴权直接公网部署 | 数据盘/Key 裸奔 | 上线前自研鉴权，或维持"本地/内网"形态 |
| 🟠 中 | 品牌换牌不彻底 | 数据互踩、AIGC 主体错误、用户误认官方 | 按 4.5 第 4 条清单逐个改 |
| 🟠 中 | 上游跟不动 | 功能与安全修复滞后 | 尽量"只加不改"，把改动集中在新增文件；定期 rebase |
| 🟡 低 | 文档漂移/版本号混乱 | 排查问题时被误导 | 以 `package.json` + 代码 + `pnpm test` 为准 |
| 🟡 低 | 未签名安装包 | Windows SmartScreen / macOS Gatekeeper 拦截 | 有预算就签名，没预算就写清楚安装说明 |

---

## 七、建议路线（三阶段）

### 阶段 0：验证（半天，不写代码）
1. 用方案 A 的 5 步，把你的中转站填进去；
2. **必须验证**：脚本生成 ✓ / 生图 ✓ / **一镜视频（含任务轮询和取片）** ✓ / TTS ✓；
3. 记录失败的环节，对照 3.3 的 8 个坑定位。

> 产出：一份"我的中转站支持/不支持什么"的事实清单。**这决定了后面 1 天还是 3 天。**

### 阶段 1：接入改造（1–2 天）
- 做方案 B（一键接入 + 预设 + 默认模型）；
- 若阶段 0 发现视频/图片协议不一致，补方案 D 的对应适配；
- 跑 `pnpm test`，重点看 provider 契约测试、i18n 键、onekey 常量。

### 阶段 2：可分发（1–2 天）
- 品牌换牌（4.5 第 4 条清单）+ 把作者的返利链接换成你自己的；
- 补 `LICENSE`/`NOTICE`/`THIRD-PARTY-NOTICES.md` 进安装包；
- README 写清"基于谁、改了什么、源码在哪"；
- 打 tag → 发安装包 + 源码（同页、免费）；
- 出一份你自己的《中转站接入说明》（给用户）。

**总计约 3–5 个工作日**，其中一半是合规与换牌，不是写代码。

---

## 八、我需要你确认的 4 件事（会影响上面的结论）

1. **你的中转站到底提供哪些端点？** 具体是：`/v1/chat/completions`、`/v1/images/generations`、`/v1/videos`（还是 `/v1/video/generations`）、`/v1/audio/speech`、`/v1/models` 各支持哪些？**视频部分的状态字段名是什么？取片是直出字节流还是 302 到 CDN？**
2. **分发形态**：只发 Windows 安装包？还是也要 Docker / 在线服务？如果是在线服务，鉴权这块要额外算 3–5 天。
3. **是否收费**？卖安装包/额度/会员，决定品牌与用户协议的写法（收费不能停掉源码可得性）。
4. **是否接受"必须开源你的修改"**？如果业务上做不到（比如公司要求闭源），**唯一合法路径是找作者谈单独授权**——否则建议换成"只做上游的外围工具（MCP/CLI/脚本），不改主程序"，那条路没有 AGPL 分发义务。

---

## 附：本次评估的核验记录

**我亲自回源码核验过的关键结论**（不是推断）：
- Provider 注册表是 `Map` 且 7 个写死，`registerCustomProvider` 全仓无调用方 → `src/lib/providers/index.ts:18-76,134-136`
- LLM baseUrl 纯用户自填、无平台白名单 → `settings-store.ts:184-190`、`settings/page.tsx:643-657`
- `jsonModeParams` / `reasoningParams` 的域名正则 → `llm-error.ts:157-161`、`generator.ts:120-128`
- 视频状态名白名单与 `UNKNOWN_STATUS` → `providers/openai.ts:125-130`
- 取片 `redirect: "error"` → `providers/video-download.ts:16`
- 安装包 `build.files` 不含 LICENSE/NOTICE → `package.json:72-78`
- ffmpeg GPL-3.0-or-later / ffprobe GPL-3.0 → `node_modules` 内 `package.json`
- 无鉴权、无 middleware → 全 `src/` grep
- 无 `NEXT_PUBLIC_` → 全 `src/` grep
- AIGC 元数据默认服务提供者 `"ClipForge"` → `compliance-metadata.ts:33`
- 作者返利链接 `?ref=JPM683` → `atlas-onekey.ts:34`
- 已打包产物 157.9MB → `.dev/installers/`
- `data/` 未被 git 跟踪（已 gitignore）→ `.gitignore:41` + `git check-ignore`

**未验证/无法验证**：
- 你的中转站实际响应格式（需你提供或实测）
- 上游 v0.9.6–v0.9.11 的具体变更（本地是 shallow clone，仓库内无 CHANGELOG）
- 商标权属、API 转售条款、国内生成式 AI 备案要求（需律师/合规顾问）

---

## 九、实施进展（第一轮改造已完成）

> 本节记录实际落地情况，与上文评估结论相互印证。日期：2026-10-26。

### 9.1 新增文件

| 文件 | 作用 |
|---|---|
| `src/lib/providers/max-relay.ts` | **Max API 适配器**（约 480 行）：JSON+metadata 视频契约、按模型族分参数、`/v1/assets` 素材上传、`unknown` 状态容错、按 endpoint 类型拆分模型目录 |
| `src/lib/max-onekey.ts` | 一键接入常量（网关/默认模型/领 Key 地址） |
| `src/lib/__tests__/providers-max-relay.test.ts` | 16 个契约测试，把实测出来的映射关系固化 |
| `THIRD-PARTY-NOTICES.md` | ffmpeg/ffprobe GPL-3.0 声明与源码获取路径、字体 OFL、Electron/Chromium、LGPL 等 |

### 9.2 改动文件（10 个，+117/−22）

| 文件 | 改动 |
|---|---|
| `src/lib/providers/index.ts` | 注册 `max-relay` |
| `src/lib/stores/settings-store.ts` | providers 默认项 + `applyMaxOneKey()` 一键接入 |
| `src/app/settings/page.tsx` | 新增 Max API 平台卡；一键接入面板从 Atlas 换成中转站（**不再把用户导给作者的返利链接**） |
| `src/lib/i18n/messages/settings.ts` | 中英文案（成对，i18n 键完整性测试通过） |
| `src/lib/llm-presets.ts` | 新增 "Max API" 脚本模型预设 |
| `src/lib/llm-error.ts` | ① `jsonModeParams` 加入 `max.xiafeng.co`（实测支持 `json_object`）；② 空 body 400 时自动去掉 `temperature` 重放一次（实测 `gpt-6-*` 会以空 body 400 拒绝 temperature，而 ClipForge 固定发 0.8） |
| `src/lib/gen-params.ts` | `toEditVariant` 增加中转站文生图 → 图生图的模型 id 映射（否则商品保真重绘会拿 t2i 模型硬发参考图） |
| `src/components/generation-settings.tsx` | 自定义模型下拉增加 Max API |
| `src/app/api/ai/test-provider/route.ts` | 连接测试默认地址 |
| `package.json` | `extraResources` 把 LICENSE / NOTICE / THIRD-PARTY-NOTICES.md 打进安装包（**原版缺这个，是硬性合规缺口**） |

### 9.3 真机验证结果（全部走 ClipForge 自己的 API 路由）

| 项目 | 结果 |
|---|---|
| 模型发现 `POST /api/ai/models` | ✅ 实时拉到 13 个图片模型 + 7 个视频模型（已过滤无法驱动的 `*-app` 场景模型） |
| 生图 `POST /api/ai/image` | ✅ 29.7s，1080×1920 请求 → 自动换算成 `aspect_ratio: 9:16` + `resolution: 1k`，返回签名 URL |
| 图生视频 `POST /api/ai/video` | ✅ **72.7s 全链路**：本地 `/api/files` 图 → data URI → `/v1/assets` 上传 → `wan-3.0` 提交 → 轮询 → 下载落盘 |
| 产物校验 | ✅ `ffprobe`：h264 / **480×854 竖屏** / 5.000s / 1.66MB |
| 类型检查 `tsc --noEmit` | ✅ 0 error |
| 测试套件 | ✅ 1316 passed（新增 16 个全过）；仅 7 个**环境性**历史失败（系统 FFmpeg 缺 `filter_complex_script`、Windows 路径分隔符），与本次改动无关 |

**本轮实测花费：¥5.62（$0.77），26 次请求** —— 余额从 $59.46 → $58.69。

### 9.4 已确认的中转站能力边界

- ✅ chat / 视觉识图 / json_object / 图片（含 size 枚举与竖屏）/ 视频（seedance·wan·vidu）/ 素材上传 / 带鉴权取片
- ❌ 没有 `/v1/audio/speech` → 配音继续用内置免费 Edge TTS
- ⚠️ `openai/gpt-6-*` 与 `bytedance/doubao-seed-2.0-lite` 拒绝 `temperature`（已做自动降级，但仍建议默认用 `deepseek/deepseek-v4.1-flash`）
- ⚠️ `supersolar-*-app` 场景模型参数契约不同，已从下拉框过滤

### 9.5 品牌换牌（第二轮已完成，2026-10-26）

产品名定为 **爆米AI**，Logo 为黑色圆角矩形 + 白色「米」。

| 类别 | 已完成 |
|---|---|
| 应用标识 | `package.json`：`name=baomi-ai`、`productName=爆米AI`、`appId=com.baomi.ai` |
| 数据目录隔离 | `electron/main.js` 显式 `setPath("userData", appData/BaoMiAI)` —— 品牌名中文但磁盘目录保持 ASCII，避免中文路径进入 ffmpeg 参数；同时与官方版数据完全隔离 |
| 窗口/标题 | Electron 窗口标题、启动日志、两个错误对话框；`layout.tsx` 的 title/description（description 里保留"基于 ClipForge（AGPL-3.0）二次开发"） |
| Logo | `public/logo.svg`、`src/app/icon.svg`（几何矢量，不依赖字体）、`electron/icon.png`（sharp 从 SVG 渲染 1024×1024）。按 Noto Sans CJK 的真实「米」字形结构绘制，已与字体渲染结果逐像素比对 |
| 界面文案 | 侧边栏 + 移动端顶栏品牌名；7 个 i18n 文件里的品牌引用；内置风格配方作者字段；导出文件名（`baomi-template-*`、`baomi-draft.*`）；EDL 注释（`BAOMI AI EDIT`） |
| **AIGC 元数据** | `compliance-metadata.ts` 的"服务提供者"默认值改为 `爆米AI` —— 这是 GB 45438 隐式标识的必填项 |
| 上游返利链接 | `ATLAS_KEYS_URL` 去掉 `?ref=JPM683`；设置页与落地页的一键接入都改成中转站；Atlas 卡片从"推荐首选"降级为"第三方平台，需自备 Key" |
| 抓取 UA | Wikimedia / 商品链接抓取的 User-Agent 去掉原作者仓库地址 |

**有意保留未改**（改了会破坏用户数据或文件互操作）：`clipforgeStorage` 存储桥、`clipforge:settings` IPC 通道、各 `localStorage` 键、`clipforge-style-pack@1` / `clipforge-transcript-edit@1` 等格式串、OTIO/EDL 元数据键、`CLIPFORGE_*` 环境变量。

**视觉验证**：dev 服务器实测，`<title>`、侧边栏、落地页、设置页均为「爆米AI」，落地页提示为"一键接 **Max API**——脚本 + 图 + 视频，一个 Key 全搞定"。

**合规材料**：新增 `MODIFICATIONS.md`（AGPL §5(a) 要求的修改声明）+ README 顶部横幅 + `THIRD-PARTY-NOTICES.md`，`LICENSE`/`NOTICE` 原样未动。

### 9.6 剩余待办

1. **建仓库并推代码**：然后在 `MODIFICATIONS.md` 里填上真实源码地址，README 也同步。这是 AGPL 分发的前提。
2. **打包**（你说先不做）：`pnpm build` + `electron-builder`，产包后确认 `resources/` 内有 `LICENSE` / `NOTICE` / `THIRD-PARTY-NOTICES.md`，并实测 `%APPDATA%\BaoMiAI\data` 落盘。
3. **《用户接入说明》**：注册中转站 → 领 Key → 粘贴 → 计费口径（图片按张、视频按秒，建议给出每档价格表）。
4. **可选清理**：`docs/`（上游官网 HTML）、`mcp/`、`skills/` 仍是 ClipForge 品牌与命名；这些不进入安装包，但如果要在仓库里对外展示，建议一并处理。
5. **可选**：`supersolar-*` 场景模型（虚拟 IP / 换装 / 武戏）若要支持，需要各自独立的参数契约（`MaxVirtualIPParameters` 等），属于增量功能。
