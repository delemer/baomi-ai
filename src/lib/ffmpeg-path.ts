/**
 * ffmpeg / ffprobe binary path resolution — allows commands to target the bundled binary,
 * supporting Electron packaging.
 *
 * Development: falls back to `ffmpeg` / `ffprobe` on the system PATH (same behaviour as before).
 * Electron package: the main process injects the absolute paths extracted from ffmpeg-static /
 * @ffprobe-installer into FFMPEG_PATH / FFPROBE_PATH, so users don't need to install ffmpeg themselves.
 *
 * Note: return values are interpolated into shell command strings; paths may contain spaces —
 * callers must wrap them in double quotes.
 */

import { spawnSync } from "node:child_process";

/** Path to the ffmpeg executable (callers must quote it if it contains spaces) */
export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

/** Path to the ffprobe executable (callers must quote it if it contains spaces) */
export function ffprobeBin(): string {
  return process.env.FFPROBE_PATH || "ffprobe";
}

/**
 * The argv pair that feeds a filtergraph from a file.
 *
 * FFmpeg 7 **removed** `-filter_complex_script`; the replacement is its generic
 * "read the option value from a file" syntax: `-/filter_complex <file>`.
 * Shipped builds are not uniform (the bundled ffmpeg-static already resolves to 9.x here,
 * while older installs still have 6.x), and the failure mode is a hard
 * `Unrecognized option 'filter_complex_script'` — i.e. every compose/render job dies.
 * So pick the syntax from the binary's actual major version, cached after the first probe.
 */
export function filterScriptArgs(filterFile: string, graph?: string): string[] {
  if (ffmpegMajorVersion() >= 7) {
    // FFmpeg 7+ 移除了 `-filter_complex_script`。它的替代品 `-/filter_complex <file>` 读文件时
    // **不做 option-value 层的反转义**，而我们的滤镜图是按"还要被反转义一层"生成的 ——
    // 直接换语法会让 Windows 盘符路径（`fontsdir=D\:/...`）解析失败。
    // 这些调用点都用 execFile（不经过 shell），所以把滤镜图按 raw 形式内联进 argv：
    // 少一个临时文件、少一层转义，且不受 cmd.exe 8191 字符上限影响
    // （Windows argv 上限 32767，实测 6 分镜合成图约 12k 字符，分镜上限 9，余量充足）。
    if (graph) return ["-filter_complex", toRawFilterGraph(graph)];
    return ["-/filter_complex", filterFile];
  }
  return ["-filter_complex_script", filterFile];
}

/**
 * 把"差一层反转义"的滤镜图转换成原始形式。
 *
 * 实测（ffmpeg 9.0.2）：同一份滤镜图直接内联时，
 *  - **单引号内**必须保持单反斜杠（`fontfile='D\:/...'` 可用；加倍会报 `No option name near ...`）
 *  - **引号外**必须加成双反斜杠（`fontsdir=D\\:/...` 可用；单反斜杠会失败）
 * 所以只对引号外的反斜杠加倍，引号内原样保留。
 */
export function toRawFilterGraph(graph: string): string {
  let out = "";
  let inQuote = false;
  for (let i = 0; i < graph.length; i++) {
    const ch = graph[i];
    if (ch === "'") {
      inQuote = !inQuote;
      out += ch;
      continue;
    }
    out += !inQuote && ch === "\\" ? "\\\\" : ch;
  }
  return out;
}

/**
 * Content to write into a filter-script file.
 *
 * The two syntaxes read the file at **different escaping levels**:
 *  - `-filter_complex_script` (≤6) runs the file through the option-value unescaper first, so the
 *    on-disk form is what we already generate (e.g. `fontsdir=D\:/path` — one backslash);
 *  - `-/filter_complex` (7+) takes the bytes verbatim, so every backslash must be doubled to
 *    survive the filtergraph parser (`fontsdir=D\\:/path`).
 * Without this, Windows paths with a drive letter fail with `No option name near '/path'`.
 */
export function filterScriptContent(graph: string): string {
  return ffmpegMajorVersion() >= 7 ? graph.replace(/\\/g, "\\\\") : graph;
}

let cachedMajor: number | undefined;

/** Major version of the ffmpeg binary in use (`0` when it cannot be determined). */
export function ffmpegMajorVersion(): number {
  if (cachedMajor !== undefined) return cachedMajor;
  try {
    const out = spawnSync(ffmpegBin(), ["-version"], { encoding: "utf8", timeout: 10_000 });
    // "ffmpeg version 9.0.2-essentials_build-www.gyan.dev ..." / "ffmpeg version n7.1 ..."
    const m = /ffmpeg version\s+n?(\d+)/i.exec(out.stdout || "");
    cachedMajor = m ? Number(m[1]) : 0;
  } catch {
    cachedMajor = 0;
  }
  return cachedMajor;
}

/** Test hook: forget the probed version (e.g. after changing FFMPEG_PATH). */
export function resetFfmpegVersionCache(): void {
  cachedMajor = undefined;
}
