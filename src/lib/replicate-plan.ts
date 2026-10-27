/**
 * Viral-replication planning: parse a reference commerce video, keep its pacing,
 * camera, and framing, then substitute the user's product through ordinal media references.
 *
 * Two replication tiers share this module:
 *  - RHYTHM tier (free, any LLM): scene-cut times from the reference video become a
 *    shot-duration skeleton, injected into script generation as referenceStructure —
 *    the generated script matches the reference's shot count and pacing.
 *  - MODEL tier (Seedance 2.0 reference-to-video): the reference video (≤15s) plus
 *    product images go straight into one multimodal generation call; the prompt uses
 *    the official "video 1 / image 1" ordinal references.
 *
 * Pure functions, no I/O — the analyze route feeds in cut times from detectSceneTimes.
 */

export interface ReplicateShot {
  /** 1-based shot index */
  index: number;
  /** Segment start time in seconds */
  start: number;
  /** Segment duration in seconds (0.1s precision) */
  duration: number;
}

/** Segments shorter than this get merged into their predecessor (flash frames, cut jitter). */
const MIN_SHOT_SEC = 1.0;
/** Skeleton cap — scripts beyond ~12 shots degrade (Seedance docs: >10 shots turn chaotic). */
const MAX_SHOTS = 12;
/** Seedance 2.0 reference_videos hard limit: total reference duration ≤ 15s. */
export const REPLICATE_MAX_REF_SEC = 15;

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Turn detected scene-cut timestamps into a shot skeleton:
 * segments = [0, ...cuts, total]; sub-second fragments merge into the previous
 * segment; when over MAX_SHOTS, the shortest segment repeatedly merges into its
 * shorter neighbor until capped. Returns [] when the duration is unusable.
 */
export function shotPlanFromCuts(
  cuts: number[],
  totalDuration: number,
  opts?: { minShotSec?: number; maxShots?: number },
): ReplicateShot[] {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return [];
  const minSec = opts?.minShotSec ?? MIN_SHOT_SEC;
  const maxShots = Math.max(1, opts?.maxShots ?? MAX_SHOTS);

  // clean cut times: inside (0, total), deduped, ascending
  const inner = [...new Set(cuts.filter((t) => Number.isFinite(t) && t > 0 && t < totalDuration))].sort((a, b) => a - b);
  const bounds = [0, ...inner, totalDuration];
  let durations: number[] = [];
  for (let i = 1; i < bounds.length; i++) durations.push(bounds[i] - bounds[i - 1]);

  // merge sub-minimum fragments into the previous segment (the first merges forward)
  const merged: number[] = [];
  for (const d of durations) {
    if (d < minSec && merged.length > 0) merged[merged.length - 1] += d;
    else merged.push(d);
  }
  if (merged.length > 1 && merged[0] < minSec) {
    merged[1] += merged[0];
    merged.shift();
  }
  durations = merged;

  // cap the shot count: repeatedly merge the shortest segment into its shorter neighbor
  while (durations.length > maxShots) {
    let idx = 0;
    for (let i = 1; i < durations.length; i++) if (durations[i] < durations[idx]) idx = i;
    if (idx === 0) {
      durations[1] += durations[0];
      durations.splice(0, 1);
    } else if (idx === durations.length - 1 || durations[idx - 1] <= durations[idx + 1]) {
      durations[idx - 1] += durations[idx];
      durations.splice(idx, 1);
    } else {
      durations[idx + 1] += durations[idx];
      durations.splice(idx, 1);
    }
  }

  let start = 0;
  return durations.map((d, i) => {
    const shot: ReplicateShot = { index: i + 1, start: round1(start), duration: round1(d) };
    start += d;
    return shot;
  });
}

/**
 * The rhythm skeleton as a referenceStructure block for script generation
 * (injected under the existing 【参考爆款结构】 prompt header). Chinese only —
 * the commerce script prompt is Chinese with a language-override for EN products.
 */
export function replicateReferenceStructure(shots: ReplicateShot[], totalDuration: number): string {
  if (shots.length === 0) return "";
  const beats = shots.map((s) => `第${s.index}镜 ${s.duration}s`).join("、");
  return [
    `以下节奏骨架来自一条参考爆款视频的真实镜头切分（共 ${shots.length} 镜、全长约 ${round1(totalDuration)}s）：${beats}。`,
    `请生成相同数量的分镜，每个分镜的 duration 逐一对应上述时长（允许 ±1s 微调），镜头节奏快慢跟随参考：短镜头配紧凑有冲击力的画面与文案，长镜头承载演示或情绪铺垫。`,
    `不要照搬参考内容，只复刻节奏与结构。`,
  ].join("\n");
}

/**
 * Prompt for the model-tier one-shot replication (Seedance reference-to-video):
 * ordinal references per the official syntax — video 1 = the reference clip,
 * image 1..N = product photos. Product fidelity wording mirrors PRODUCT_CONSTRAINT.
 */
export function buildReplicatePrompt(input: { productName: string; sellingPoints?: string; imageCount: number }): string {
  const parts = [
    `参考 视频1 的运镜、节奏、景别与转场，复刻一条同样风格的带货短视频`,
    input.imageCount > 0
      ? `把画面中的商品替换为 图1${input.imageCount > 1 ? `~图${input.imageCount}` : ""} 中的「${input.productName}」，商品的外观、包装、颜色、logo 与文字必须与参考图完全一致，不得扭曲变形`
      : `商品为「${input.productName}」`,
  ];
  const points = input.sellingPoints?.trim();
  if (points) parts.push(`商品卖点：${points.slice(0, 100)}`);
  parts.push("无人声说话，自然环境音与动作音效贴合画面");
  return parts.join("。") + "。";
}

/**
 * Map a configured video model to its reference-to-video sibling. Families with a
 * reference variant on Atlas: Seedance 2.0 (incl. fast/mini), MiniMax H3, Wan 2.7,
 * Kling Video O3. Returns undefined when the model family can't replicate — the UI
 * disables the model-tier button with a hint.
 */
const REFERENCE_FAMILY_PATTERN =
  /^(bytedance\/seedance-2\.0(?:-fast|-mini)?|minimax\/h3|alibaba\/wan-2\.7|kwaivgi\/kling-video-o3-(?:std|pro))\//;

/**
 * Max API 中转站里**本身就是参考生视频**的型号 —— 它们没有 `.../reference-to-video` 这类
 * sibling id，模型 id 自己就能吃参考素材。旧逻辑只认 Atlas 的 `<family>/<mode>` 命名，
 * 于是把这些型号全判成"不支持参考生视频"，按钮永远置灰（用户明明选的是参考模型）。
 */
const MAX_REFERENCE_MODELS = new Set([
  // 多参生视频：参考图 ≤9 / 参考视频 ≤3 / 参考音频 ≤3，成片上限 60s
  "supersolar-multi-reference-v2-app",
  // seedance-2.5：用 omni_reference_task_type=reference 声明参考模式
  "seedance-2.5",
  // 文戏（generation_mode=0 即"参考图/纯文生"模式）
  "supersolar-literary-drama-app",
]);

/** 每个型号允许的最长参考视频时长；不是所有参考模型都只有 15 秒。 */
export function referenceMaxRefSeconds(modelId: string | undefined): number {
  if (modelId === "supersolar-multi-reference-v2-app") return 60;
  return REPLICATE_MAX_REF_SEC;
}

export function referenceModelFor(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const id = modelId.trim();
  // 中转站型号：自己就是参考型号，不换 id
  if (MAX_REFERENCE_MODELS.has(id)) return id;
  const family = id.match(REFERENCE_FAMILY_PATTERN)?.[1];
  if (!family) return undefined;
  if (id === `${family}/reference-to-video`) return id;
  if (/\/(?:text|image)-to-video$/.test(id)) return `${family}/reference-to-video`;
  return undefined;
}
