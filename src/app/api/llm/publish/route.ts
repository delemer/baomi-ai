import { NextRequest, NextResponse } from "next/server";
import { completeWithJsonRetry, extractJSON } from "@/lib/script-engine/generator";
import { buildPublishPrompt, buildCommentKit, type CommentKit } from "@/lib/publish-pack";
import { apiError, errText } from "@/lib/api-error";
import { createLLMClient, llmErrorPair } from "@/lib/llm-error";

/**
 * Generate publish copy: 3 titles, #hashtags, a one-line promotional caption, plus the
 * comment-section ops kit (pinned self-Q&A + objection reply templates).
 * Used for copy-pasting when publishing commerce videos to Douyin/Kuaishou/Xiaohongshu.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productName, productDescription, category, platform, llmConfig, locale } = body;

    if (!productName) {
      return apiError(req, "缺少商品名称", "Missing product name");
    }
    if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
      return apiError(req, "请先配置 LLM", "Please configure the LLM first");
    }

    const client = createLLMClient(llmConfig);
    const en = locale === "en";
    const prompt = buildPublishPrompt({ productName, category, productDescription, platform }, en ? "en" : "zh");

    // 走 completeWithJsonRetry（与脚本生成同一个 JSON 稳健性阶梯）：
    // 推理模型（deepseek-v4.1-flash 等）会把 reasoning 与正文吃同一份 max_tokens 预算，
    // 旧实现硬编码 1200 且无重试 → 约 1/3 概率 finish_reason=length 被截断或 content 为空，
    // 表现为发布文案随机 500。这里起步就给 4000，并在 length+reasoning 时自动再抬到 ≥8192。
    const parsed = await completeWithJsonRetry<{
      titles?: string[];
      hashtags?: string[];
      caption?: string;
      commentKit?: { pinned?: string; objections?: { q?: string; a?: string }[] };
    }>(
      client,
      {
        model: llmConfig.model,
        messages: [
          { role: "system", content: en ? "You only output JSON, no explanation." : "你只输出 JSON，不输出任何解释。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.9,
        max_tokens: 4000,
      },
      llmConfig,
      (content) => JSON.parse(extractJSON(content)),
    );

    // comment kit: keep only well-formed LLM entries; fall back to the deterministic
    // template kit so the field is never missing (the notice always comes from our side —
    // the compliance wording is not the LLM's to rewrite)
    const fallback = buildCommentKit({ productName, category, sellingPoints: productDescription, locale: en ? "en" : "zh" });
    const rawKit = parsed.commentKit;
    const objections = Array.isArray(rawKit?.objections)
      ? rawKit.objections
          .filter((o): o is { q: string; a: string } => typeof o?.q === "string" && !!o.q.trim() && typeof o?.a === "string" && !!o.a.trim())
          .slice(0, 3)
      : [];
    const commentKit: CommentKit = {
      pinned: typeof rawKit?.pinned === "string" && rawKit.pinned.trim() ? rawKit.pinned.trim() : fallback.pinned,
      objections: objections.length > 0 ? objections : fallback.objections,
      notice: fallback.notice,
    };

    return NextResponse.json({
      titles: Array.isArray(parsed.titles) ? parsed.titles.slice(0, 3) : [],
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      caption: parsed.caption ?? "",
      commentKit,
    });
  } catch (error) {
    console.error("生成发布文案失败:", error);
    const { zh, en } = llmErrorPair(error);
    return NextResponse.json(
      { error: errText(req, zh || "生成失败", en || "Generation failed") },
      { status: 500 }
    );
  }
}
