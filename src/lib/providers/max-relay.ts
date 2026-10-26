/**
 * Max API（Supersolar / max.xiafeng.co）Provider —— 一个"形似 OpenAI、实则按模型分契约"的中转站。
 *
 * 为什么需要独立 Provider，而不是把 baseUrl 填进 OpenAI 平台：
 *  1. 视频提交：OpenAI 兼容接口期望 `multipart/form-data` + 扁平 `{model,prompt,seconds,size}`；
 *     Max 的 `POST /v1/videos` **只接受 application/json**，且 **`metadata` 为必填**，
 *     生成参数放 `metadata.parameters`、素材放 `metadata.assets`。扁平请求体一律 400。
 *  2. 视频参数按模型族分裂：wan 的 resolution 是 `480P/720P/1080P`（大写 P），
 *     seedance/vidu 是小写 `480p/720p`；seedance-2.5 没有 `generation_mode` 而是用
 *     `omni_reference_task_type`；素材引用有的吃 asset id、有的只吃 url。
 *  3. 任务状态多一个 `unknown`：OpenAI 那套白名单不认，会抛 UNKNOWN_STATUS 让任务"永远转圈"。
 *  4. 图生图/图生视频的参考图必须是**外部可达地址或 asset id**，
 *     而 ClipForge 手里的首帧是本地 `/api/files/...`，所以必须先走 `POST /v1/assets` 上传。
 *
 * 以上全部来自实测（2026-10-26）：文生视频 5s/480P 约 289s 完成、图生视频约 73s 完成，
 * `GET /v1/videos/{id}/content` 直接返回 200 + video/mp4（无重定向）。
 */
import { BaseProvider, ProviderError } from './base'
import { getDataDir } from '@/lib/paths'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import type {
  ImageOptions,
  ImageResult,
  MediaType,
  Model,
  TaskStatus,
  VideoOptions,
  VideoResult,
} from './types'
import { downloadProviderVideo } from './video-download'

// ==================== 模型族 ====================

/** 视频模型族：决定 metadata.parameters 的字段名与大小写。 */
type VideoFamily = 'wan' | 'seedance2' | 'seedance25' | 'vidu' | 'generic'

export function videoFamilyOf(modelId: string): VideoFamily {
  const id = (modelId || '').toLowerCase()
  if (id.startsWith('wan-3.0')) return 'wan'
  if (id.startsWith('seedance-2.5')) return 'seedance25'
  if (id.startsWith('seedance-2.0')) return 'seedance2'
  if (id.startsWith('vidu-q4')) return 'vidu'
  return 'generic'
}

type ResolutionTier = '480P' | '720P' | '1080P'

/** 由 ClipForge 的 width/height 反推分辨率档位，避免直接发它不认识的 `size: 720x1280`。 */
export function resolutionTierOf(width?: number, height?: number): ResolutionTier {
  const long = Math.max(width ?? 0, height ?? 0)
  const short = Math.min(width ?? 0, height ?? 0)
  if (!long) return '720P'
  // 竖屏 720x1280 → long=1280；1080x1920 → long=1920
  if (long >= 1920 || short >= 1080) return '1080P'
  if (long >= 1280 || short >= 720) return '720P'
  return '480P'
}

/** wan 用大写 P，其余用小写 p（实测：混用会 400）。 */
export function resolutionFor(family: VideoFamily, tier: ResolutionTier): string {
  return family === 'wan' ? tier : tier.toLowerCase()
}

export function ratioOf(width?: number, height?: number): string {
  if (!width || !height) return 'adaptive'
  const r = width / height
  if (Math.abs(r - 9 / 16) < 0.02) return '9:16'
  if (Math.abs(r - 16 / 9) < 0.02) return '16:9'
  if (Math.abs(r - 1) < 0.02) return '1:1'
  if (Math.abs(r - 3 / 4) < 0.02) return '3:4'
  if (Math.abs(r - 4 / 3) < 0.02) return '4:3'
  return 'adaptive'
}

/** 图片方面：Max 的 size 是固定枚举，不认识的尺寸要换成 aspect_ratio + resolution。 */
const IMAGE_SIZE_ENUM = new Set(['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '4096x4096'])

function imageResolutionTier(width?: number, height?: number): '1k' | '2k' {
  return Math.max(width ?? 0, height ?? 0) >= 2000 ? '2k' : '1k'
}

function aspectRatioOfImage(width?: number, height?: number): string {
  const r = ratioOf(width, height)
  return r === 'adaptive' ? '1:1' : r
}

// ==================== 响应类型 ====================

interface MaxImageResponse {
  created?: number
  data?: Array<{ url?: string; b64_json?: string; expires_at?: number }>
}

interface MaxAsset {
  id: string
  url?: string
  type?: string
  mime_type?: string
  size?: number
  name?: string
}

interface MaxVideoObject {
  id?: string
  task_id?: string
  object?: string
  model?: string
  status?: string
  progress?: number
  created_at?: number
  completed_at?: number
  seconds?: string
  size?: string
  error?: { message?: string; code?: string } | string
  metadata?: { url?: string; [k: string]: unknown }
}

interface MaxModelsResponse {
  object?: string
  data?: Array<{ id?: string; supported_endpoint_types?: string[]; owned_by?: string; capabilities?: unknown }>
}

/** `GET /v1/models` 的 endpoint 分类 → ClipForge 的媒体类型。 */
const EPS_IMAGE = 'image-generation'
const EPS_VIDEO = 'openai-video'

/** 视频任务状态映射：`unknown` 必须当作"未完成"，否则会误判为不可恢复的失败。 */
const STATUS_MAP: Record<string, TaskStatus['status']> = {
  queued: 'pending',
  pending: 'pending',
  in_progress: 'processing',
  processing: 'processing',
  running: 'processing',
  completed: 'completed',
  succeeded: 'completed',
  failed: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  unknown: 'pending',
}

const DEFAULT_BASE_URL = 'https://max.xiafeng.co/v1'

const DEFAULT_IMAGE_MODELS = [
  'gpt-image-2.0/text-to-image/economy',
  'gpt-image-2.0/edit/economy',
  'gpt-image-2.5-flare/text-to-image',
  'nano-banana-2/text-to-image/economy',
  'nano-banana-2/image-to-image/economy',
  'seedream-5.0-pro',
  'supersolar-image/text-to-image',
  'supersolar-image/image-to-image',
]

const DEFAULT_VIDEO_MODELS = [
  'wan-3.0',
  'wan-3.0-prime',
  'seedance-2.0',
  'seedance-2.0-fast',
  'seedance-2.0-mini',
  'seedance-2.5',
  'vidu-q4-preview',
]

function mimeFromName(name: string, fallback = 'image/png'): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'png') return 'image/png'
  return fallback
}

// ==================== Provider ====================

export class MaxRelayProvider extends BaseProvider {
  readonly name = 'max-relay'
  readonly displayName = 'Max API'

  /** 目录来源上报给 UI（live=从 /models 拉到，static=内置兜底）。 */
  catalogMetadata?: { source: 'static' | 'live' | 'cache' | 'stale'; updatedAt?: string; fallback?: boolean }

  constructor(config: { name: string; apiKey: string; baseUrl?: string; timeout?: number; headers?: Record<string, string>; extra?: Record<string, unknown> }) {
    const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    super({ ...config, baseUrl: base })
  }

  // ---------- 图片 ----------

  async generateImage(options: ImageOptions): Promise<ImageResult> {
    const started = Date.now()
    const body: Record<string, unknown> = {
      model: options.modelId,
      prompt: options.prompt,
      n: Math.min(Math.max(Math.round(options.count ?? 1), 1), 4),
    }

    // 尺寸：优先发 Max 认识的枚举 size；不认识就换算成 aspect_ratio + resolution。
    const w = options.width
    const h = options.height
    const openaiSize = options.extra?.size
    if (typeof openaiSize === 'string' && IMAGE_SIZE_ENUM.has(openaiSize)) {
      body.size = openaiSize
    } else if (w && h) {
      const exact = `${w}x${h}`
      if (IMAGE_SIZE_ENUM.has(exact)) {
        body.size = exact
      } else {
        body.aspect_ratio = aspectRatioOfImage(w, h)
        body.resolution = imageResolutionTier(w, h)
      }
    }
    if (typeof options.seed === 'number' && Number.isFinite(options.seed)) body.seed = options.seed

    // 参考图：本地地址先上传换签名 URL，再用 image_urls / image 传给编辑模型。
    const refs = [
      ...(options.referenceImageUrls ?? []),
      ...(options.referenceImageUrl ? [options.referenceImageUrl] : []),
    ].filter(Boolean)
    if (refs.length > 0) {
      const urls: string[] = []
      for (const ref of refs.slice(0, 10)) {
        urls.push(await this.ensurePublicUrl(ref))
      }
      if (urls.length === 1) body.image = urls[0]
      else body.image_urls = urls
    }

    const res = await this.request<MaxImageResponse>('/images/generations', {
      method: 'POST',
      body,
      timeout: 180000,
      idempotent: false,
    })

    const imageUrls = (res.data ?? [])
      .map((d) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : ''))
      .filter(Boolean)
    if (imageUrls.length === 0) {
      throw new ProviderError('图片接口未返回任何图片', 'NO_IMAGES', this.name)
    }

    return {
      taskId: `max-image-${started}`,
      imageUrls,
      modelId: options.modelId,
      duration: Date.now() - started,
    }
  }

  // ---------- 视频 ----------

  async submitVideoTask(options: VideoOptions): Promise<{ taskId: string; modelId: string }> {
    const family = videoFamilyOf(options.modelId)
    const parameters: Record<string, unknown> = {
      seconds: this.normalizeSeconds(options.duration),
      resolution: resolutionFor(family, resolutionTierOf(options.width, options.height)),
      ratio: ratioOf(options.width, options.height),
      seed: typeof options.seed === 'number' && Number.isFinite(options.seed) ? options.seed : 0,
    }

    const assets: Array<Record<string, unknown>> = []
    const wantsImageToVideo = options.mode === 'image-to-video' || Boolean(options.firstFrameUrl)

    if (wantsImageToVideo && !options.firstFrameUrl) {
      throw new ProviderError('图生视频缺少首帧图片', 'BAD_REFERENCE', this.name)
    }

    if (options.firstFrameUrl) {
      assets.push(await this.buildImageAsset(options.firstFrameUrl, 'first_frame', family, 1))
    }
    if (options.lastFrameUrl) {
      assets.push(await this.buildImageAsset(options.lastFrameUrl, 'last_frame', family, 2))
    }
    if (options.referenceImageUrls?.length) {
      let i = assets.length + 1
      for (const ref of options.referenceImageUrls.slice(0, 6)) {
        assets.push(await this.buildImageAsset(ref, 'reference_image', family, i++))
      }
    }
    if (options.referenceVideoUrls?.length) {
      // Seedance 2.5 的参考视频只吃 url（无 asset 上传通道）。
      for (const ref of options.referenceVideoUrls.slice(0, 3)) {
        assets.push({ type: 'video', role: 'reference_video', url: await this.ensurePublicUrl(ref), alias: `视频${assets.length + 1}` })
      }
    }

    const generationMode = wantsImageToVideo ? 'image_to_video' : 'text_to_video'
    if (family === 'wan' || family === 'vidu' || family === 'seedance2' || family === 'generic') {
      parameters.generation_mode = assets.length > 0 && !options.firstFrameUrl ? 'reference_to_video' : generationMode
    }
    // 各族独有的"显式关闭"开关：不传会走服务端默认，可能白花钱生成音频。
    if (family === 'wan') parameters.audio = false
    if (family === 'seedance2') {
      parameters.generate_audio = false
      parameters.return_last_frame = true
    }
    if (family === 'seedance25') {
      if (options.lastFrameUrl) parameters.return_last_frame = true
    }
    if (family === 'vidu') {
      parameters.audio = false
      parameters.watermark = false
    }

    const body: Record<string, unknown> = {
      model: options.modelId,
      prompt: options.prompt,
      metadata: { parameters, ...(assets.length > 0 ? { assets } : {}) },
    }

    const res = await this.request<MaxVideoObject>('/videos', {
      method: 'POST',
      body,
      // 视频提交可能排队较久；同时这是计费 POST，绝不能自动重试。
      timeout: 240000,
      idempotent: false,
    })
    const taskId = res.id ?? res.task_id
    if (!taskId || typeof taskId !== 'string') {
      throw new ProviderError('视频接口未返回任务 ID，请到中转站后台核对，勿直接重复提交', 'NO_TASK_ID', this.name)
    }
    return { taskId, modelId: res.model ?? options.modelId }
  }

  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    const { taskId } = await this.submitVideoTask(options)
    const status = await this.waitForTask(taskId)
    return this.requireResult(status.result, '任务完成但未返回视频', 'NO_RESULT') as VideoResult
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const res = await this.request<MaxVideoObject>(`/videos/${encodeURIComponent(taskId)}`, { timeout: 60000 })
    const rawStatus = String(res.status ?? '').toLowerCase()
    const mapped = STATUS_MAP[rawStatus]
    if (!mapped) {
      const err = new ProviderError(`未知视频任务状态: ${res.status}`, 'UNKNOWN_STATUS', this.name)
      err.taskId = taskId
      throw err
    }

    const status: TaskStatus = {
      taskId,
      status: mapped,
      ...(typeof res.progress === 'number' && { progress: res.progress }),
      ...(res.error && {
        error: typeof res.error === 'string' ? res.error : res.error.message,
        errorCode: typeof res.error === 'string' ? undefined : res.error.code,
      }),
    }

    if (mapped === 'completed') {
      // 内容接口要求 Bearer；实测 200 + video/mp4 且不重定向，下载后落本地，避免把带签名/鉴权的
      // 远端地址写进任务表（与原 OpenAI 实现保持一致的账本语义）。
      const videoUrl = await downloadProviderVideo(
        `${this.config.baseUrl}/videos/${encodeURIComponent(taskId)}/content`,
        this.getAuthHeaders() as Record<string, string>,
      )
      status.result = {
        taskId,
        modelId: res.model ?? '',
        videoUrls: [videoUrl],
        ...(res.seconds && { duration: Number(res.seconds) }),
      }
    }
    return status
  }

  // ---------- 模型清单 ----------

  async listModels(mediaType?: MediaType): Promise<Model[]> {
    let imageIds = DEFAULT_IMAGE_MODELS
    let videoIds = DEFAULT_VIDEO_MODELS
    let source: 'live' | 'static' = 'static'

    try {
      const res = await this.request<MaxModelsResponse>('/models', { timeout: 15000 })
      const rows = res.data ?? []
      const liveImage = rows
        .filter((m) => Array.isArray(m.supported_endpoint_types) && m.supported_endpoint_types.includes(EPS_IMAGE) && m.id)
        .map((m) => m.id as string)
      const liveVideo = rows
        .filter((m) => Array.isArray(m.supported_endpoint_types) && m.supported_endpoint_types.includes(EPS_VIDEO) && m.id)
        .map((m) => m.id as string)
        // `*-app` 是"场景创作"包装模型（虚拟 IP / 换装 / 武戏），参数是另一套
        // （MaxVirtualIPParameters 等，需要人物图/音色等固定素材），本适配器驱动不了，
        // 放进下拉框只会让用户选中后必然失败。
        .filter((id) => !id.endsWith('-app'))
      if (liveImage.length || liveVideo.length) {
        imageIds = liveImage.length ? liveImage : imageIds
        videoIds = liveVideo.length ? liveVideo : videoIds
        source = 'live'
      }
    } catch {
      // 目录失败不是错误：退回内置清单，保证下拉框永远有东西可选。
    }

    this.catalogMetadata = source === 'live' ? { source: 'live', updatedAt: new Date().toISOString() } : { source: 'static' }

    const models: Model[] = []
    if (!mediaType || mediaType === 'image') {
      for (const id of imageIds) {
        models.push({
          id,
          name: id,
          mediaType: 'image',
          provider: this.name,
          modes: ['text-to-image', 'image-to-image'],
        })
      }
    }
    if (!mediaType || mediaType === 'video') {
      for (const id of videoIds) {
        models.push({
          id,
          name: id,
          mediaType: 'video',
          provider: this.name,
          modes: ['text-to-video', 'image-to-video'],
          supportsAudio: false,
        })
      }
    }
    return models
  }

  // ---------- 素材上传 ----------

  /**
   * 把 ClipForge 手里的本地/数据 URI 参考图变成中转站可取的公开地址。
   * data: → 直接透传（图片接口接受 data URI）；本站 /api/files/* → 上传换签名 URL。
   */
  private async ensurePublicUrl(ref: string): Promise<string> {
    if (!ref) throw new ProviderError('参考素材地址为空', 'BAD_REFERENCE', this.name)
    if (ref.startsWith('data:')) return ref
    if (/^https?:\/\//i.test(ref)) {
      // 本站自己的文件地址（127.0.0.1 / localhost）中转站取不到，必须上传。
      if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(ref)) return ref
    }
    const asset = await this.uploadAsset(ref)
    return asset.url ?? ref
  }

  /** 上传一个本地素材，返回 asset（含 id / 签名 url / mime / 字节数）。 */
  private async uploadAsset(ref: string): Promise<MaxAsset> {
    const { blob, filename } = await this.readRef(ref)
    return this.uploadBlob(blob, filename)
  }

  /**
   * 供 API 路由上传本地参考视频/音频：返回中转站的签名 URL。
   * 路由在 referenceVideoUrls / referenceAudioUrls 是本地路径时会调它（见 api/ai/video/route.ts）。
   */
  async uploadLocalMedia(filePath: string): Promise<string> {
    const buf = await readFile(filePath)
    const mime = mimeFromName(filePath, 'application/octet-stream')
    const ext = filePath.split('.').pop() || 'bin'
    const asset = await this.uploadBlob(new Blob([new Uint8Array(buf)], { type: mime }), `media.${ext}`)
    if (!asset.url) throw new ProviderError('素材上传未返回可访问地址', 'UPLOAD_FAILED', this.name)
    return asset.url
  }

  private async uploadBlob(blob: Blob, filename: string): Promise<MaxAsset> {
    const form = new FormData()
    form.append('file', blob, filename)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 300000)
    try {
      const res = await fetch(`${this.config.baseUrl}/assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: controller.signal,
      })
      const text = await res.text().catch(() => '')
      if (!res.ok) {
        throw new ProviderError(`素材上传失败: ${res.status} ${text.slice(0, 200)}`, 'UPLOAD_FAILED', this.name, res.status)
      }
      const asset = JSON.parse(text) as MaxAsset
      if (!asset?.id) throw new ProviderError('素材上传未返回 id', 'UPLOAD_FAILED', this.name)
      return asset
    } finally {
      clearTimeout(timer)
    }
  }

  /** 读取一个引用（data URI / 本站 /api/files / 绝对 URL）为 Blob。 */
  private async readRef(ref: string): Promise<{ blob: Blob; filename: string }> {
    if (ref.startsWith('data:')) {
      const comma = ref.indexOf(',')
      if (comma === -1) throw new ProviderError('参考图 data URI 解析失败', 'BAD_REFERENCE', this.name)
      const mime = ref.slice(5, comma).split(';')[0] || 'image/png'
      const buf = Buffer.from(ref.slice(comma + 1), 'base64')
      return { blob: new Blob([new Uint8Array(buf)], { type: mime }), filename: `ref.${mime.split('/')[1] || 'png'}` }
    }

    // 本站文件直接读磁盘：Electron 的本地服务端口是随机的，用 HTTP 拼 127.0.0.1:PORT 必然猜错；
    // 而 `/api/files/<seg>` 的语义就是 `<data>/uploads/<seg>`（见 api/files/[...path]/route.ts）。
    if (ref.startsWith('/api/files/')) {
      const uploadsRoot = join(getDataDir(), 'uploads')
      const segments = ref.slice('/api/files/'.length).split('?')[0].split('/').map((s) => decodeURIComponent(s))
      const filePath = normalize(join(uploadsRoot, ...segments))
      if (filePath !== uploadsRoot && !filePath.startsWith(uploadsRoot + sep)) {
        throw new ProviderError('参考素材路径非法', 'BAD_REFERENCE', this.name)
      }
      const buf = await readFile(filePath)
      const mime = mimeFromName(filePath)
      return { blob: new Blob([new Uint8Array(buf)], { type: mime }), filename: segments[segments.length - 1] || 'ref.png' }
    }

    const url = absoluteUrl(ref)
    const res = await fetch(url)
    if (!res.ok) throw new ProviderError(`参考素材读取失败: ${res.status}`, 'BAD_REFERENCE', this.name, res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type')?.split(';')[0] || mimeFromName(url)
    return { blob: new Blob([new Uint8Array(buf)], { type: mime }), filename: url.split('/').pop()?.split('?')[0] || 'ref.png' }
  }

  /** 组装一条 video metadata.assets 条目：seedance-2.5 只吃 url，其余吃 asset id。 */
  private async buildImageAsset(
    ref: string,
    role: string,
    family: VideoFamily,
    index: number,
  ): Promise<Record<string, unknown>> {
    const alias = `图片${index}`
    if (family === 'seedance25') {
      return { type: 'image', role, url: await this.ensurePublicUrl(ref), alias }
    }
    const asset = await this.uploadAsset(ref)
    return {
      id: asset.id,
      type: 'image',
      role,
      mime_type: asset.mime_type ?? 'image/png',
      size: asset.size ?? 0,
      alias,
    }
  }

  /** Max 的 seconds 是枚举（wan: 2~30，seedance: 4~15），非整数/越界要收敛。 */
  private normalizeSeconds(duration?: number): number {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return 5
    return Math.min(30, Math.max(2, Math.round(duration)))
  }
}

/** 相对路径补成本机绝对地址（服务端 fetch 不认 `/api/...`）。 */
function absoluteUrl(ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref
  const base = process.env.CLIPFORGE_INTERNAL_BASE
    || `http://127.0.0.1:${process.env.PORT || 3000}`
  return `${base.replace(/\/+$/, '')}${ref.startsWith('/') ? ref : `/${ref}`}`
}

export default MaxRelayProvider
