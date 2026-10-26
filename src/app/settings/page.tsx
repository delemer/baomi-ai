"use client";

/**
 * 极简设置页（爆米AI 的默认设置入口）。
 *
 * 设计目标（对应二次开发的三个痛点）：
 *  1. 不出现"平台"概念 —— 只有"连接中转站"，用户不需要知道有 8 个平台可选；
 *  2. 不分标签 —— 单页滚动，一屏看完，靠滚动而不是靠找标签；
 *  3. 不暴露模型名 —— 用"写脚本 / 看商品图 / 生成图片 / 生成视频"四个用途 + 档位表达，
 *     技术参数与模型选择全部收进 `/settings/advanced`（上游原版设置页，保留全部能力）。
 *
 * 唯一输入是 API Key：粘贴后走 `applyMaxOneKey` 一次配好四个模型，用户不需要逐项设置。
 */

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LuCheck, LuZap, LuTriangleAlert, LuExternalLink } from "react-icons/lu";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { MAX_KEYS_URL, MAX_ONEKEY_MODELS } from "@/lib/max-onekey";

type Resolution = "720p" | "1080p";
type Ratio = "9:16" | "16:9" | "1:1";

/** 把模型 id 折叠成人话，避免在极简页里出现一长串技术字符串。 */
function friendlyModel(id: string | undefined): string {
  if (!id) return "—";
  const map: Record<string, string> = {
    [MAX_ONEKEY_MODELS.llm]: "智能档 · DeepSeek",
    [MAX_ONEKEY_MODELS.vision]: "识图档 · Gemini",
    [MAX_ONEKEY_MODELS.image]: "标准档 · GPT Image",
    [MAX_ONEKEY_MODELS.video]: "标准档 · Wan 3.0",
  };
  if (map[id]) return map[id];
  // 非默认值：只显示厂商前缀，不显示完整 id
  const head = id.split("/")[0].split("-")[0];
  return `${head}（自定义）`;
}

export default function SimpleSettingsPage() {
  const t = useT("settings");
  const providers = useSettingsStore((s) => s.providers);
  const llm = useSettingsStore((s) => s.llm);
  const defaultResolution = useSettingsStore((s) => s.defaultResolution);
  const defaultAspectRatio = useSettingsStore((s) => s.defaultAspectRatio);
  const spendCapUsd = useSettingsStore((s) => s.spendCapUsd);
  const defaultImageModel = useSettingsStore((s) => s.defaultImageModel);
  const defaultVideoModel = useSettingsStore((s) => s.defaultVideoModel);
  const applyMaxOneKey = useSettingsStore((s) => s.applyMaxOneKey);
  const setDefaultResolution = useSettingsStore((s) => s.setDefaultResolution);
  const setDefaultAspectRatio = useSettingsStore((s) => s.setDefaultAspectRatio);
  const setSpendCapUsd = useSettingsStore((s) => s.setSpendCapUsd);

  const [keyDraft, setKeyDraft] = useState("");
  const [saved, setSaved] = useState(false);

  const relay = providers["max-relay"];
  const connected = Boolean(relay?.enabled && relay?.apiKey && llm?.apiKey);

  const connect = () => {
    const key = keyDraft.trim();
    if (!key) return;
    applyMaxOneKey(key);
    setKeyDraft("");
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  };

  const resolutionOptions: { value: Resolution; labelKey: string }[] = [
    { value: "720p", labelKey: "simpleQualityStd" },
    { value: "1080p", labelKey: "simpleQualityHigh" },
  ];
  const ratioOptions: { value: Ratio; labelKey: string }[] = [
    { value: "9:16", labelKey: "simpleRatio916" },
    { value: "16:9", labelKey: "simpleRatio169" },
    { value: "1:1", labelKey: "simpleRatio11" },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{t("simpleTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("simpleSubtitle")}</p>
      </header>

      {/* ① 连接中转站 —— 唯一的输入 */}
      <Card className="mb-5 glass-card">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t("simpleConnTitle")}</h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                connected ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"
              }`}
            >
              {connected ? <LuCheck className="size-3" /> : <LuTriangleAlert className="size-3" />}
              {connected ? t("simpleConnOk") : t("simpleConnNone")}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("simpleConnKeyLabel")}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") connect();
                }}
                placeholder={t("simpleConnPlaceholder")}
                className="flex-1 font-mono text-xs"
              />
              <Button
                onClick={connect}
                disabled={!keyDraft.trim()}
                className="brand-gradient shrink-0 border-0 text-white"
              >
                <LuZap className="mr-1.5 size-4" />
                {connected ? t("simpleConnReplace") : t("simpleConnSave")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("simpleConnHint")}</p>
            <a
              href={MAX_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("simpleConnGetKey")}
              <LuExternalLink className="size-3" />
            </a>
          </div>

          {saved && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-500">
              <LuCheck className="size-3.5" />
              {t("simpleConnSaved")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ② 出片质量 —— 用"贵/便宜"替代技术参数 */}
      <Card className="mb-5 glass-card">
        <CardContent className="p-5">
          <h2 className="mb-1 text-sm font-semibold">{t("simpleQualityTitle")}</h2>
          <p className="mb-4 text-xs text-muted-foreground">{t("simpleQualityHint")}</p>

          <div className="mb-4 space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("simpleQualityLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              {resolutionOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDefaultResolution(opt.value)}
                  className={`min-h-9 rounded-lg border px-3 text-xs font-medium transition-colors ${
                    defaultResolution === opt.value
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 bg-background hover:border-primary/30"
                  }`}
                >
                  {t(opt.labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("simpleRatioLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              {ratioOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDefaultAspectRatio(opt.value)}
                  className={`min-h-9 rounded-lg border px-3 text-xs font-medium transition-colors ${
                    defaultAspectRatio === opt.value
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 bg-background hover:border-primary/30"
                  }`}
                >
                  {t(opt.labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("simpleCapLabel")}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step={1}
                value={spendCapUsd}
                onChange={(e) => setSpendCapUsd(e.target.value === "" ? 0 : Number(e.target.value))}
                className="w-28 font-mono text-xs"
              />
              <span className="text-xs text-muted-foreground">USD ≈ ¥{Math.round(spendCapUsd * 7.3)}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("simpleCapHint")}</p>
          </div>
        </CardContent>
      </Card>

      {/* ③ 当前用的是什么 —— 只报用途，不报模型名 */}
      <Card className="mb-5 glass-card">
        <CardContent className="p-5">
          <h2 className="mb-1 text-sm font-semibold">{t("simpleModelTitle")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("simpleModelHint")}</p>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {[
              { label: t("simpleModelScript"), value: connected ? friendlyModel(llm?.model) : t("simpleModelPending") },
              { label: t("simpleModelVision"), value: connected ? friendlyModel(llm?.visionModel) : t("simpleModelPending") },
              { label: t("simpleModelImage"), value: connected ? friendlyModel(defaultImageModel) : t("simpleModelPending") },
              { label: t("simpleModelVideo"), value: connected ? friendlyModel(defaultVideoModel) : t("simpleModelPending") },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("simpleAdvancedHint")}</p>
        <Link
          href="/settings/advanced"
          className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-border/60 bg-background px-3 text-xs font-medium hover:border-primary/40 hover:text-primary"
        >
          {t("simpleAdvanced")} →
        </Link>
      </div>
    </div>
  );
}
