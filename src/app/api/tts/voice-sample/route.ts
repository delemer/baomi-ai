import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDataDir } from "@/lib/paths";
import { ffprobeBin } from "@/lib/ffmpeg-path";
import { apiError, errText } from "@/lib/api-error";

const execFileAsync = promisify(execFile);

const MAX_BYTES = 15 * 1024 * 1024; // 15MB：一段 30 秒的 mp3 通常 < 1MB，15MB 已很宽松
const MIN_SECONDS = 2;
const MAX_SECONDS = 120;
const ALLOWED_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

/** 音色样本存放目录（generateSpeechMiMo 只允许从这里读） */
export function voiceSampleDir(): string {
  return join(getDataDir(), "uploads", "tts-voices");
}

/**
 * 上传一段音色样本，供 MiMo voiceclone 使用。
 *
 * 只存文件、返回路径：样本的 base64 可能有几百 KB，塞进 localStorage 设置里既超限又会被
 * 每次请求体重复携带。服务端在真正合成时才读文件编码。
 *
 * 校验：扩展名白名单 + 体积上限 + ffprobe 读出时长必须在 2–120 秒之间（太短克隆不稳定）。
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return apiError(req, "缺少音频文件", "Missing audio file", 400);
    }
    if (file.size > MAX_BYTES) {
      return apiError(req, `文件过大（${Math.round(file.size / 1024 / 1024)}MB），上限 15MB`, "File too large (max 15MB)", 400);
    }
    const name = file.name || "sample.mp3";
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return apiError(req, `不支持的格式 ${ext}，请用 mp3 / wav / m4a / aac / ogg`, `Unsupported format ${ext}`, 400);
    }

    const dir = voiceSampleDir();
    await mkdir(dir, { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    const id = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const target = join(dir, `${id}${ext}`);
    if (!resolve(target).startsWith(resolve(dir) + sep)) {
      return apiError(req, "非法文件名", "Invalid filename", 400);
    }
    await writeFile(target, buf);

    // 用 ffprobe 读时长：克隆样本太短效果差，太长又浪费上传与推理时间
    let seconds = 0;
    try {
      const { stdout } = await execFileAsync(ffprobeBin(), [
        "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", target,
      ]);
      seconds = Number(String(stdout).trim()) || 0;
    } catch {
      return apiError(req, "音频无法解析，请确认是有效的 mp3/wav 文件", "Cannot parse the audio file", 400);
    }
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
      return apiError(
        req,
        `样本时长 ${seconds.toFixed(1)} 秒，请提供 ${MIN_SECONDS}–${MAX_SECONDS} 秒的清晰人声（无背景音乐、无人声重叠）`,
        `Sample is ${seconds.toFixed(1)}s — provide ${MIN_SECONDS}-${MAX_SECONDS}s of clean speech`,
        400,
      );
    }

    return NextResponse.json({ ok: true, path: target, name, seconds: Number(seconds.toFixed(2)), bytes: buf.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : errText(req, "上传失败", "Upload failed") },
      { status: 500 },
    );
  }
}
