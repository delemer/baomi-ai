"use client";

import { create } from "zustand";
import { useCallback } from "react";

/**
 * 爆款复刻页的**草稿缓存**。
 *
 * 为什么需要它：页面原来把参考视频、结构卡、商品图、商品名/卖点全放在组件 useState 里，
 * 而工作台的板块切换是真正的路由跳转 → 组件卸载 → 所有填写内容清零。用户切去看一眼别的
 * 板块再回来，就得从头再填一遍（实测反馈："体验很糟糕"）。
 *
 * 放在 zustand（模块级内存，不进 localStorage）的原因：
 *  - 商品图是 `File` 对象，序列化不了，localStorage/sessionStorage 存不进去；
 *  - 内存 store 能原样持有 File 与 blob 预览地址，切页面回来图还在；
 *  - 不落盘 → 刷新页面才清空，符合"草稿"的预期，也不会把用户的素材持久化到磁盘。
 */

export interface CloneDraftImage {
  id: string;
  /** 原始文件（上传时直接 append 到 FormData） */
  file: File;
  /** object URL，用于展示缩略图 */
  previewUrl: string;
}

/** 草稿数据（不含操作方法） */
export interface CloneDraftData {
  videoUrl: string;
  refVideoFileName: string | null;
  refVideoFile: File | null;
  /** analyze 接口的原始返回（含 shots / referenceStructure / duration） */
  refAnalysis: Record<string, unknown> | null;
  storyboards: unknown[];
  productImages: CloneDraftImage[];
  productName: string;
  productFeatures: string;
  /** 模型级复刻的产物（url + projectId） */
  replicateResult: { url: string; projectId: string } | null;
}

interface CloneDraftState extends CloneDraftData {
  patch: (part: Partial<CloneDraftData>) => void;
  reset: () => void;
}

const createEmpty = (): CloneDraftData => ({
  videoUrl: "",
  refVideoFileName: null,
  refVideoFile: null,
  refAnalysis: null,
  storyboards: [],
  productImages: [],
  productName: "",
  productFeatures: "",
  replicateResult: null,
});

export const useCloneDraft = create<CloneDraftState>((set) => ({
  ...createEmpty(),
  patch: (part) => set(part),
  reset: () => set(createEmpty()),
}));

/**
 * 与 useState 同签名的草稿字段 hook（支持函数式更新），
 * 这样页面里原有的 `setXxx(...)` 调用点一行都不用改。
 */
export function useDraftField<K extends keyof CloneDraftData>(
  key: K,
): [
  CloneDraftData[K],
  (value: CloneDraftData[K] | ((prev: CloneDraftData[K]) => CloneDraftData[K])) => void,
] {
  const value = useCloneDraft((s) => s[key]);
  const setValue = useCallback(
    (next: CloneDraftData[K] | ((prev: CloneDraftData[K]) => CloneDraftData[K])) => {
      const state = useCloneDraft.getState();
      const resolved =
        typeof next === "function"
          ? (next as (prev: CloneDraftData[K]) => CloneDraftData[K])(state[key])
          : next;
      state.patch({ [key]: resolved } as Partial<CloneDraftData>);
    },
    [key],
  );
  return [value, setValue];
}
