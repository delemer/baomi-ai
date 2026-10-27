import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, extname } from "path";
import { getDataDir } from "@/lib/paths";
import { probeMedia } from "@/lib/media-probe";
import { detectSceneTimes } from "@/lib/video-composer/contact-sheet";
import { shotPlanFromCuts, replicateReferenceStructure, REPLICATE_MAX_REF_SEC } from "@/lib/replicate-plan";
import { safeFetch } from "@/lib/ssrf-guard";
import { apiError, errText } from "@/lib/api-error";

/** Single-file limit (matches the materials route; the model tier's own cap is 50MB/15s, reported per-mode) */
const MAX_FILE_SIZE = 80 * 1024 * 1024;
const ALLOWED_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const EXT_BY_MIME: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
/** 直链下载：抖音/快手/小红书的分享页是反爬壳页，拿不到播放地址；只有真实直链才走这条路 */
const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/**
 * POST /api/replicate/analyze —— 参考视频的真实分析（镜头切点 + 节奏骨架）。
 *
 * 两种入参：
 *  1. multipart `file=<video>`：本地文件上传（主路径）。
 *  2. JSON `{ url }`：**直链** mp4/webm/mov，服务端下载后分析（SSRF 防护走 safeFetch）。
 *     注意：平台分享链接（v.douyin.com、xhslink 等）是反爬壳页，这里会明确报错而不是静默降级。
 *
 * 处理：落盘到 uploads/replicate/ → ffmpeg 检测场景切点 → 镜头骨架 + 参考结构 prompt。
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  let buffer: Buffer;
  let mime: string;
  let sourceLabel: string;

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { url?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return apiError(req, "缺少视频链接", "Missing video URL", 400);
    if (!/^https?:\/\//i.test(url)) return apiError(req, "链接必须以 http(s) 开头", "URL must start with http(s)", 400);
    if (!DIRECT_VIDEO_RE.test(url)) {
      return apiError(
        req,
        "这个链接不是视频直链（抖音/快手/小红书的分享页有反爬验证，服务端取不到播放地址）。请把视频下载到本地后用「选择视频文件」上传，或粘贴以 .mp4/.mov/.webm 结尾的直链。",
        "That link is not a direct video URL (share pages for Douyin/Kuaishou/Xiaohongshu are anti-bot guarded). Download the clip and upload the file, or paste a direct .mp4/.mov/.webm URL.",
        400,
      );
    }
    let res: Response;
    try {
      res = await safeFetch(url, { signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      return apiError(
        req,
        `下载参考视频失败：${e instanceof Error ? e.message : String(e)}`,
        `Failed to download the reference video: ${e instanceof Error ? e.message : String(e)}`,
        400,
      );
    }
    if (!res.ok) {
      return apiError(req, `下载参考视频失败：HTTP ${res.status}`, `Failed to download the reference video: HTTP ${res.status}`, 400);
    }
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_FILE_SIZE) {
      return apiError(req, "参考视频超过 80MB 大小限制", "Reference video exceeds the 80MB size limit", 400);
    }
    buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) {
      return apiError(req, "参考视频超过 80MB 大小限制", "Reference video exceeds the 80MB size limit", 400);
    }
    const headerType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    mime = ALLOWED_MIME.has(headerType) ? headerType : "";
    const urlExt = extname(new URL(url).pathname).toLowerCase().replace(".", "");
    sourceLabel = url;
    // 头里没给合法 mime（很多直链是 application/octet-stream），就按扩展名推断，最后仍有 ffprobe 兜底
    if (!mime) {
      mime = urlExt === "webm" ? "video/webm" : urlExt === "mov" ? "video/quicktime" : "video/mp4";
    }
  } else {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return apiError(req, "无效的表单数据", "Invalid form data", 400);
    }
    const file = formData.get("file") as File | null;
    if (!file) return apiError(req, "请上传参考视频文件", "Please upload a reference video file", 400);
    if (file.size > MAX_FILE_SIZE) {
      return apiError(req, "参考视频超过 80MB 大小限制", "Reference video exceeds the 80MB size limit", 400);
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return apiError(req, "仅支持 mp4/webm/mov 视频", "Only mp4/webm/mov videos are supported", 400);
    }
    buffer = Buffer.from(await file.arrayBuffer());
    mime = file.type;
    sourceLabel = file.name;
  }

  try {
    const dir = join(getDataDir(), "uploads", "replicate");
    await mkdir(dir, { recursive: true });
    // renamed on save (original filename never reused — same policy as the materials route)
    const name = `ref-${Date.now()}.${EXT_BY_MIME[mime] ?? "mp4"}`;
    const filePath = join(dir, name);
    await writeFile(filePath, buffer);

    const probe = await probeMedia(filePath);
    if (!probe.duration) {
      return apiError(req, "无法读取视频时长，文件可能损坏", "Could not read the video duration — the file may be corrupt", 400);
    }
    const cuts = await detectSceneTimes(filePath);
    const shots = shotPlanFromCuts(cuts, probe.duration);

    return NextResponse.json({
      path: `/api/files/replicate/${name}`,
      source: sourceLabel,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      shots,
      referenceStructure: replicateReferenceStructure(shots, probe.duration),
      // model-tier eligibility (Seedance reference_videos: ≤15s) decided server-side once
      modelTierEligible: probe.duration <= REPLICATE_MAX_REF_SEC,
      maxRefSec: REPLICATE_MAX_REF_SEC,
    });
  } catch (error) {
    console.error("Reference video analysis failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "参考视频分析失败", "Reference video analysis failed") },
      { status: 500 }
    );
  }
}
