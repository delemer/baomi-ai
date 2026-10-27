import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, join, normalize, sep } from "node:path";
import { getDataDir } from "@/lib/paths";
import { assertPublicUrl } from "@/lib/ssrf-guard";

/**
 * 长素材转写的模型文件代理。
 *
 * 为什么需要：浏览器端 Whisper（transformers.js）默认从 huggingface.co 拉模型，
 * 再失败从 cdn.jsdelivr.net 拉 onnxruntime 的 wasm —— 这两个域名在国内网络下**不可达**；
 * 而 hf-mirror.com 在浏览器里也可能因为 307 跳转 / CORS 而失败（实测 resolve 路径报
 * "Failed to fetch"，但服务端直连是 200）。
 *
 * 做法：worker 把 remoteHost 指到本站的 /api/asr/model，由 Next 路由去镜像取文件，
 * 浏览器只需要连 127.0.0.1。附带一层本地磁盘缓存：模型动辄几十 MB，第二次起直接读盘。
 *
 * 上游地址可用 ASR_HF_ENDPOINT 覆盖（默认 https://hf-mirror.com）。
 */

export const runtime = "nodejs";

const UPSTREAM = (process.env.ASR_HF_ENDPOINT || "https://hf-mirror.com").replace(/\/+$/, "");
/** 只代理模型仓库这类路径；拒绝任何越权访问 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function cacheRoot(): string {
  return join(getDataDir(), "cache", "asr-models");
}

function cachePathFor(segments: string[]): string | undefined {
  const root = normalize(cacheRoot());
  const target = normalize(join(root, ...segments));
  if (target !== root && !target.startsWith(root + sep)) return undefined;
  return target;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!Array.isArray(path) || path.length < 2 || path.some((s) => !SAFE_SEGMENT.test(s))) {
    return NextResponse.json({ error: "非法的模型路径" }, { status: 400 });
  }

  const filePath = cachePathFor(path);
  if (!filePath) return NextResponse.json({ error: "非法的模型路径" }, { status: 400 });

  // 命中磁盘缓存：直接回文件
  try {
    const info = await stat(filePath);
    if (info.isFile() && info.size > 0) {
      return new NextResponse(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
        headers: {
          "Content-Type": guessType(filePath),
          "Content-Length": String(info.size),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  } catch {
    /* 未缓存，继续回源 */
  }

  const upstreamUrl = `${UPSTREAM}/${path.map(encodeURIComponent).join("/")}`;
  try {
    await assertPublicUrl(upstreamUrl);
  } catch {
    return NextResponse.json({ error: "上游地址不可用" }, { status: 502 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(180_000),
      headers: { "User-Agent": "baomi-ai-asr-proxy/1.0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `拉取模型文件失败：${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `上游返回 ${upstream.status}` }, { status: 502 });
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  // 缓存失败不影响本次返回
  await mkdir(dirname(filePath), { recursive: true }).catch(() => {});
  await writeFile(filePath, buf).catch(() => {});

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": upstream.headers.get("content-type") || guessType(filePath),
      "Content-Length": String(buf.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function guessType(file: string): string {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".onnx")) return "application/octet-stream";
  return "application/octet-stream";
}
