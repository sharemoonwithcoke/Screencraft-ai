"use client";

import { useRef, useState, useCallback } from "react";
import type { EditCut } from "@/app/api/ai/edit-plan/route";

// Load FFmpeg from CDN at runtime — NOT via webpack/npm.
// @ffmpeg/ffmpeg creates cross-origin Web Workers from its own CDN path, so
// bundling it via webpack causes "Module not found" errors from the package's
// "node" export-map condition. CDN script-tag injection is the standard
// approach for FFmpeg.wasm in Next.js.
const FFMPEG_UMD_URL = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js";
const FFCORE_BASE    = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

type ExportStatus = "idle" | "loading" | "processing" | "done" | "error";

interface UseFFmpegEdit {
  status: ExportStatus;
  progress: number;
  errorMsg: string | null;
  applyEdits: (videoBlob: Blob, cuts: EditCut[], durationMs: number) => Promise<Blob | null>;
}

// ── Inline utilities (replaces @ffmpeg/util) ─────────────────────────────────

/** Fetch a URL and return a same-origin Blob URL — needed for cross-origin WASM. */
async function toBlobURL(url: string, mimeType: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed for ${url} (${resp.status})`);
  return URL.createObjectURL(new Blob([await resp.arrayBuffer()], { type: mimeType }));
}

/** Convert a Blob to a Uint8Array for ffmpeg.writeFile(). */
async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// ── CDN loader ────────────────────────────────────────────────────────────────

let ffmpegConstructorCache: (new () => any) | null = null;

/** Inject the @ffmpeg/ffmpeg UMD script once, then return the FFmpeg class. */
function loadFFmpegConstructor(): Promise<new () => any> {
  if (ffmpegConstructorCache) return Promise.resolve(ffmpegConstructorCache);

  const w = window as any;
  if (w.FFmpegWASM?.FFmpeg) {
    ffmpegConstructorCache = w.FFmpegWASM.FFmpeg;
    return Promise.resolve(ffmpegConstructorCache!);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = FFMPEG_UMD_URL;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const Ctor = w.FFmpegWASM?.FFmpeg;
      if (Ctor) {
        ffmpegConstructorCache = Ctor;
        resolve(Ctor);
      } else {
        reject(new Error("FFmpegWASM not exposed after script load"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load FFmpeg from CDN"));
    document.head.appendChild(script);
  });
}

// ── Segment helpers ───────────────────────────────────────────────────────────

function getKeptSegments(cuts: EditCut[], durationMs: number): Array<[number, number]> {
  const durationSecs = durationMs / 1000;
  if (!cuts.length) return [[0, durationSecs]];

  const sorted = [...cuts].sort((a, b) => a.startMs - b.startMs);
  const kept: Array<[number, number]> = [];
  let cursor = 0;

  for (const cut of sorted) {
    const start = cut.startMs / 1000;
    const end   = cut.endMs   / 1000;
    if (start > cursor + 0.01) kept.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < durationSecs - 0.01) kept.push([cursor, durationSecs]);
  return kept.filter(([s, e]) => e - s > 0.1);
}

function buildFilter(segments: Array<[number, number]>, hasAudio: boolean): string {
  const n = segments.length;
  const vFilters = segments
    .map(([s, e], i) => `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`)
    .join(";");
  const vInputs = segments.map((_, i) => `[v${i}]`).join("");

  if (!hasAudio) {
    return `${vFilters};${vInputs}concat=n=${n}:v=1:a=0[outv]`;
  }

  const aFilters = segments
    .map(([s, e], i) => `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`)
    .join(";");
  const aInputs = segments.map((_, i) => `[a${i}]`).join("");
  return `${vFilters};${aFilters};${vInputs}concat=n=${n}:v=1:a=0[outv];${aInputs}concat=n=${n}:v=0:a=1[outa]`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFFmpegEdit(): UseFFmpegEdit {
  const [status,   setStatus]   = useState<ExportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ffmpegRef = useRef<any>(null);

  const applyEdits = useCallback(
    async (videoBlob: Blob, cuts: EditCut[], durationMs: number): Promise<Blob | null> => {
      setStatus("loading");
      setProgress(0);
      setErrorMsg(null);

      try {
        // Lazy-init: load FFmpeg from CDN then initialise core WASM
        if (!ffmpegRef.current) {
          const FFmpeg = await loadFFmpegConstructor();
          const ffmpeg = new FFmpeg();

          ffmpeg.on("progress", ({ progress: p }: { progress: number }) => {
            setProgress(Math.round(p * 100));
          });

          await ffmpeg.load({
            coreURL: await toBlobURL(`${FFCORE_BASE}/ffmpeg-core.js`,   "text/javascript"),
            wasmURL: await toBlobURL(`${FFCORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
          });

          ffmpegRef.current = ffmpeg;
        }

        const ffmpeg = ffmpegRef.current;
        setStatus("processing");

        const ext  = videoBlob.type.includes("mp4") ? "mp4" : "webm";
        const inF  = `input.${ext}`;
        const outF = `output.${ext}`;

        await ffmpeg.writeFile(inF, await blobToUint8Array(videoBlob));

        const segments = getKeptSegments(cuts, durationMs);
        if (segments.length === 0) {
          setStatus("done");
          setProgress(100);
          return videoBlob;
        }

        // Try with audio; fall back to video-only on failure
        let hasAudio = true;
        try {
          await ffmpeg.exec(["-i", inF, "-an", "-t", "0.1", "-f", "null", "-"]);
        } catch {
          hasAudio = false;
        }

        const filter  = buildFilter(segments, hasAudio);
        const mapArgs = hasAudio ? ["-map", "[outv]", "-map", "[outa]"] : ["-map", "[outv]"];

        try {
          await ffmpeg.exec([
            "-i", inF,
            "-filter_complex", filter,
            ...mapArgs,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
            outF,
          ]);
        } catch {
          // Video-only fallback
          await ffmpeg.exec([
            "-i", inF,
            "-filter_complex", buildFilter(segments, false),
            "-map", "[outv]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            outF,
          ]);
        }

        const data = await ffmpeg.readFile(outF) as Uint8Array;
        await ffmpeg.deleteFile(inF);
        await ffmpeg.deleteFile(outF);

        setStatus("done");
        setProgress(100);
        return new Blob([data.buffer as ArrayBuffer], { type: `video/${ext}` });
      } catch (err: any) {
        const msg = err?.message ?? "FFmpeg export failed";
        setErrorMsg(msg);
        setStatus("error");
        return null;
      }
    },
    []
  );

  return { status, progress, errorMsg, applyEdits };
}
