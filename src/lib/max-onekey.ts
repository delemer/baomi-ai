/**
 * Max API 中转站的"一个 Key 全搞定"预置。
 *
 * 与 atlas-onekey.ts 同构：把 baseUrl / 默认模型收在一处，避免散落在设置页、
 * provider 默认值和迁移逻辑里各写一份（写散的下场见 issue #24：素材网关被写进聊天槽）。
 *
 * 默认模型的选取不是随便挑的，全部来自 2026-10-26 的实测：
 *  - 脚本模型 deepseek/deepseek-v4.1-flash：**接受 temperature**，且带识图能力。
 *    openai/gpt-6-luna 与 openai/gpt-6.1-sol 会以空 body 400 拒绝 temperature，
 *    而 ClipForge 写脚本固定发 temperature:0.8 —— 选它们当默认会让新用户第一次生成就失败。
 *  - 视觉模型 google/gemini-3.8-flash：同样接受 temperature，识图稳定。
 *  - 生图 gpt-image-2.0/text-to-image/economy：命中 ClipForge 的 `gpt-image*` 分支
 *    （不发 response_format、尺寸走任意分辨率），竖屏 9:16 实测可出图。
 *  - 生视频 wan-3.0：文生/图生都实测通过，分辨率档用大写 `480P/720P/1080P`。
 */

/** 聊天网关（OpenAI 兼容）：写脚本、商品图分析 */
export const MAX_LLM_BASE_URL = "https://max.xiafeng.co/v1";

/** 媒体网关（与聊天同一个 host，独立常量是为了将来若分路径时只改一处） */
export const MAX_MEDIA_BASE_URL = "https://max.xiafeng.co/v1";

/** 中转站后台（领取 Key / 充值） */
export const MAX_KEYS_URL = "https://max.xiafeng.co";

export const MAX_ONEKEY_MODELS = {
  /** 脚本模型：实测接受 temperature，JSON 模式可用 */
  llm: "deepseek/deepseek-v4.1-flash",
  /** 商品图分析：实测识图 + 接受 temperature */
  vision: "google/gemini-3.8-flash",
  /** 生图：gpt-image 分支，竖屏实测可出图 */
  image: "gpt-image-2.0/text-to-image/economy",
  /** 商品保真重绘（图生图）：必须配 edit 变体，否则会拿 text-to-image 硬发参考图 */
  imageEdit: "gpt-image-2.0/edit/economy",
  /** 生视频：文生/图生都实测通过，最便宜的稳定档 */
  video: "wan-3.0",
} as const;

/** 不覆盖用户已选模型，只在空值时补默认。 */
export function fillMaxModelDefaults(current: { image?: string; video?: string }): { image: string; video: string } {
  return {
    image: current.image?.trim() ? current.image : MAX_ONEKEY_MODELS.image,
    video: current.video?.trim() ? current.video : MAX_ONEKEY_MODELS.video,
  };
}
