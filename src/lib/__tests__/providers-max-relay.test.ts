/**
 * MaxRelayProvider 契约测试。
 *
 * 这些断言值全部来自 2026-10-26 对 https://max.xiafeng.co 的真实调用：
 *  - 视频必须 JSON + metadata（multipart/扁平体一律 400）
 *  - wan 的分辨率是大写 480P/720P/1080P，seedance/vidu 是小写
 *  - 图生视频的素材必须先 POST /v1/assets 换 id（seedance-2.5 例外，只吃 url）
 *  - 状态枚举多一个 unknown，必须当"未完成"而不是失败
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MaxRelayProvider, ratioOf, resolutionFor, resolutionTierOf, videoFamilyOf } from "@/lib/providers/max-relay";

const BASE = "https://max.xiafeng.co/v1";

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(text: string, init: { status?: number } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

type Call = { url: string; init?: RequestInit };

function stubFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

describe("模型族与尺寸映射", () => {
  it("按模型前缀判定族（决定分辨率大小写）", () => {
    expect(videoFamilyOf("wan-3.0")).toBe("wan");
    expect(videoFamilyOf("wan-3.0-prime")).toBe("wan");
    expect(videoFamilyOf("seedance-2.0-fast")).toBe("seedance2");
    expect(videoFamilyOf("seedance-2.5")).toBe("seedance25");
    expect(videoFamilyOf("vidu-q4-preview")).toBe("vidu");
    expect(videoFamilyOf("unknown-model")).toBe("generic");
  });

  it("wan 用大写 P，其余小写", () => {
    expect(resolutionFor("wan", "720P")).toBe("720P");
    expect(resolutionFor("seedance2", "720P")).toBe("720p");
    expect(resolutionFor("vidu", "1080P")).toBe("1080p");
  });

  it("由宽高反推档位与比例（ClipForge 传的是像素尺寸，不是档位）", () => {
    expect(resolutionTierOf(720, 1280)).toBe("720P");
    expect(resolutionTierOf(1080, 1920)).toBe("1080P");
    expect(resolutionTierOf(854, 480)).toBe("480P");
    expect(ratioOf(720, 1280)).toBe("9:16");
    expect(ratioOf(1920, 1080)).toBe("16:9");
    expect(ratioOf(1024, 1024)).toBe("1:1");
    expect(ratioOf(undefined, undefined)).toBe("adaptive");
  });
});

describe("submitVideoTask", () => {
  let provider: MaxRelayProvider;
  beforeEach(() => {
    provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("文生视频：JSON + metadata.parameters，wan 用大写分辨率且关闭音频", async () => {
    const calls = stubFetch(() => jsonResponse({ id: "task_t2v", status: "queued" }));

    const out = await provider.submitVideoTask({
      modelId: "wan-3.0",
      mode: "text-to-video",
      prompt: "a mug",
      width: 720,
      height: 1280,
      duration: 5,
    });

    expect(out.taskId).toBe("task_t2v");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/videos`);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.model).toBe("wan-3.0");
    expect(body.metadata.parameters).toMatchObject({
      generation_mode: "text_to_video",
      seconds: 5,
      resolution: "720P",
      ratio: "9:16",
      audio: false,
    });
    expect(body.metadata.assets).toBeUndefined();
  });

  it("seedance 用小写分辨率并显式关掉音频", async () => {
    const calls = stubFetch(() => jsonResponse({ id: "task_sd" }));
    await provider.submitVideoTask({
      modelId: "seedance-2.0-fast",
      mode: "text-to-video",
      prompt: "p",
      width: 720,
      height: 1280,
      duration: 5,
    });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.metadata.parameters.resolution).toBe("720p");
    expect(body.metadata.parameters.generate_audio).toBe(false);
  });

  it("图生视频：先把首帧上传成 asset，再用 asset id 提交", async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/assets")) {
        return jsonResponse({ id: "asset_1", url: "https://max/x.png", mime_type: "image/png", size: 123 });
      }
      return jsonResponse({ id: "task_i2v" });
    });

    const out = await provider.submitVideoTask({
      modelId: "wan-3.0",
      mode: "image-to-video",
      prompt: "p",
      width: 720,
      height: 1280,
      duration: 5,
      firstFrameUrl: "data:image/png;base64,iVBORw0KGgo=",
    });

    expect(out.taskId).toBe("task_i2v");
    expect(calls[0].url).toBe(`${BASE}/assets`);
    expect(calls[1].url).toBe(`${BASE}/videos`);
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.metadata.parameters.generation_mode).toBe("image_to_video");
    expect(body.metadata.assets[0]).toMatchObject({ id: "asset_1", type: "image", role: "first_frame" });
  });

  it("本站 /api/files 首帧直接读磁盘（不猜端口）后上传", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-maxrelay-"));
    const prev = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = dir;
    try {
      await mkdir(join(dir, "uploads", "products"), { recursive: true });
      await writeFile(join(dir, "uploads", "products", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const calls = stubFetch((call) =>
        call.url.endsWith("/assets")
          ? jsonResponse({ id: "asset_disk", url: "https://max/a.png", mime_type: "image/png", size: 4 })
          : jsonResponse({ id: "task_disk" }),
      );

      const out = await provider.submitVideoTask({
        modelId: "wan-3.0",
        mode: "image-to-video",
        prompt: "p",
        duration: 5,
        firstFrameUrl: "/api/files/products/a.png",
      });

      expect(out.taskId).toBe("task_disk");
      expect(calls[0].url).toBe(`${BASE}/assets`);
      const body = JSON.parse(String(calls[1].init?.body));
      expect(body.metadata.assets[0].id).toBe("asset_disk");
    } finally {
      if (prev === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = prev;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("seedance-2.5 的素材只吃 url，不上传 asset", async () => {
    const calls = stubFetch(() => jsonResponse({ id: "task_25" }));
    await provider.submitVideoTask({
      modelId: "seedance-2.5",
      mode: "image-to-video",
      prompt: "p",
      duration: 5,
      firstFrameUrl: "https://cdn.example.com/first.png",
    });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.metadata.assets[0]).toMatchObject({ type: "image", role: "first_frame", url: "https://cdn.example.com/first.png" });
    expect(body.metadata.assets[0].id).toBeUndefined();
  });

  it("没有返回任务 id 时报 NO_TASK_ID，提醒不要重复提交", async () => {
    stubFetch(() => jsonResponse({ status: "queued" }));
    await expect(
      provider.submitVideoTask({ modelId: "wan-3.0", mode: "text-to-video", prompt: "p", duration: 5 }),
    ).rejects.toMatchObject({ code: "NO_TASK_ID" });
  });
});

describe("getTaskStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unknown 视为未完成（不能抛 UNKNOWN_STATUS）", async () => {
    const provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
    stubFetch(() => jsonResponse({ id: "t", status: "unknown", progress: 0 }));
    const status = await provider.getTaskStatus("t");
    expect(status.status).toBe("pending");
  });

  it("in_progress → processing，并透传 progress", async () => {
    const provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
    stubFetch(() => jsonResponse({ id: "t", status: "in_progress", progress: 42 }));
    const status = await provider.getTaskStatus("t");
    expect(status.status).toBe("processing");
    expect(status.progress).toBe(42);
  });
});

describe("generateImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("OpenAI 枚举外的尺寸换算成 aspect_ratio + resolution", async () => {
    const provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
    const calls = stubFetch(() => jsonResponse({ created: 1, data: [{ url: "https://max/img.png" }] }));

    const out = await provider.generateImage({
      modelId: "gpt-image-2.0/text-to-image/economy",
      mode: "text-to-image",
      prompt: "mug",
      width: 1080,
      height: 1920,
    });

    expect(out.imageUrls).toEqual(["https://max/img.png"]);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.size).toBeUndefined();
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.resolution).toBe("1k");
  });

  it("枚举内的尺寸原样下发", async () => {
    const provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
    const calls = stubFetch(() => jsonResponse({ data: [{ url: "https://max/img.png" }] }));
    await provider.generateImage({
      modelId: "gpt-image-2.0/text-to-image/economy",
      mode: "text-to-image",
      prompt: "mug",
      width: 1024,
      height: 1536,
    });
    expect(JSON.parse(String(calls[0].init?.body)).size).toBe("1024x1536");
  });

  it("没有图片返回时报 NO_IMAGES", async () => {
    const provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
    stubFetch(() => jsonResponse({ data: [] }));
    await expect(
      provider.generateImage({ modelId: "gpt-image-2.0/text-to-image/economy", mode: "text-to-image", prompt: "p" }),
    ).rejects.toMatchObject({ code: "NO_IMAGES" });
  });
});

describe("listModels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("按 supported_endpoint_types 拆分图片/视频", async () => {
    const provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
    stubFetch(() =>
      jsonResponse({
        data: [
          { id: "img-a", supported_endpoint_types: ["image-generation"] },
          { id: "vid-a", supported_endpoint_types: ["openai-video"] },
          { id: "chat-a", supported_endpoint_types: ["openai"] },
        ],
      }),
    );
    const images = await provider.listModels("image");
    const videos = await provider.listModels("video");
    expect(images.map((m) => m.id)).toEqual(["img-a"]);
    expect(videos.map((m) => m.id)).toEqual(["vid-a"]);
    expect(images[0].provider).toBe("max-relay");
  });

  it("目录接口失败时退回内置清单，不抛错", async () => {
    const provider = new MaxRelayProvider({ name: "max-relay", apiKey: "k", baseUrl: BASE });
    stubFetch(() => textResponse("{}", { status: 500 }));
    const videos = await provider.listModels("video");
    expect(videos.length).toBeGreaterThan(0);
    expect(provider.catalogMetadata?.source).toBe("static");
  });
});
