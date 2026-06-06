"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, Scissors, Download, RotateCcw, CheckCircle,
  Film, ChevronRight, Loader2, Library, Clock, Video,
  AlertCircle, Info, BookOpen, Star, Image, Captions, List,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { getVideo } from "@/lib/videoStore";
import type { Recording } from "@screencraft/shared";
import type { EditPlan, EditCut, TocEntry, HighlightClip } from "@/app/api/ai/edit-plan/route";
import { useFFmpegEdit } from "@/hooks/useFFmpegEdit";

type Step = "upload" | "processing" | "preview" | "exporting" | "done";
type SourceTab = "local" | "recordings";

interface Props { recordingId: string }

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── SRT generation (timestamps adjusted for applied cuts) ─────────────────────
function buildSRT(
  captions: Array<{ timestampMs: number; text: string }>,
  cuts: EditCut[],
): string {
  const sorted = [...cuts].sort((a, b) => a.startMs - b.startMs);

  const cutsBefore = (t: number): number => {
    let total = 0;
    for (const c of sorted) {
      if (c.startMs >= t) break;
      total += Math.min(c.endMs, t) - c.startMs;
    }
    return total;
  };

  const inCut = (t: number): boolean =>
    sorted.some((c) => t >= c.startMs && t < c.endMs);

  const fmt = (ms: number): string => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const f = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(f).padStart(3, "0")}`;
  };

  const entries = captions
    .filter((cap) => !inCut(cap.timestampMs))
    .map((cap, i, arr) => {
      const adjStart = cap.timestampMs - cutsBefore(cap.timestampMs);
      const rawEnd = arr[i + 1]?.timestampMs ?? cap.timestampMs + 3000;
      const clampedEnd = Math.min(rawEnd, cap.timestampMs + 4000);
      const adjEnd = clampedEnd - cutsBefore(clampedEnd);
      return { start: adjStart, end: Math.max(adjStart + 500, adjEnd), text: cap.text };
    });

  return entries.map((e, i) => `${i + 1}\n${fmt(e.start)} --> ${fmt(e.end)}\n${e.text}\n`).join("\n");
}

// ── Edit timeline ─────────────────────────────────────────────────────────────
interface EditTimelineProps {
  durationMs: number;
  cuts: EditCut[];
  highlights: HighlightClip[];
  toc: TocEntry[];
  coverFrameMs: number;
  currentMs?: number;
  onSeek?: (ms: number) => void;
}

function EditTimeline({ durationMs, cuts, highlights, toc, coverFrameMs, currentMs, onSeek }: EditTimelineProps) {
  if (!durationMs) return null;
  const pct = (ms: number) => `${((ms / durationMs) * 100).toFixed(2)}%`;

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-3 select-none">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Edit timeline</p>
      <div className="relative h-6 bg-white/10 rounded-md overflow-hidden">
        {/* Cut regions — red overlay (rendered first so highlights appear on top) */}
        {cuts.map((c, i) => (
          <div
            key={`c${i}`}
            title={`Cut: ${c.reason}`}
            className="absolute top-0 bottom-0 bg-red-500/60 border-x border-red-400/80"
            style={{ left: pct(c.startMs), width: pct(c.endMs - c.startMs) }}
          />
        ))}

        {/* Highlight clips — teal, rendered after cuts so they're always visible */}
        {highlights.map((h, i) => (
          <div
            key={`h${i}`}
            title={`Highlight: ${h.reason} — click to preview`}
            onClick={() => onSeek?.(h.startMs)}
            className={cn(
              "absolute top-0 bottom-0 bg-teal-400/75 border-x-2 border-teal-300",
              onSeek && "cursor-pointer hover:bg-teal-400/90 transition-colors",
            )}
            style={{ left: pct(h.startMs), width: pct(h.endMs - h.startMs) }}
          />
        ))}

        {/* Chapter markers — white vertical lines */}
        {toc.map((ch, i) => (
          <div
            key={`ch${i}`}
            title={ch.title}
            className="absolute top-0 bottom-0 w-px bg-white/60"
            style={{ left: pct(ch.timestampMs) }}
          />
        ))}

        {/* Cover frame — yellow diamond */}
        <div
          title={`Cover frame: ${formatMs(coverFrameMs)}`}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-yellow-400 rotate-45 shadow-sm"
          style={{ left: pct(coverFrameMs) }}
        />

        {/* Playback position — white line */}
        {currentMs != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none"
            style={{ left: pct(currentMs) }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {[
          { color: "bg-red-500/70",   label: `${cuts.length} cuts` },
          { color: "bg-teal-400/80",  label: `${highlights.length} highlights` },
          { color: "bg-white/60 w-px h-3", label: `${toc.length} chapters` },
          { color: "bg-yellow-400 rotate-45 w-2 h-2", label: "Cover frame" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={cn("w-3 h-3 rounded-sm shrink-0", color)} />
            <span className="text-[10px] text-slate-400">{label}</span>
          </div>
        ))}
        <span className="text-[10px] text-slate-600 ml-auto">{formatMs(durationMs)} total</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function AIEditStudio({ recordingId }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [sourceTab, setSourceTab] = useState<SourceTab>("local");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState(0);
  const [sendingVideo, setSendingVideo] = useState(false);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [editPlan, setEditPlan] = useState<EditPlan | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState<number | undefined>(undefined);
  const [videoDurationMs, setVideoDurationMs] = useState<number>(0);
  const [insertTitleCards, setInsertTitleCards] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBlobRef = useRef<Blob | null>(null);

  const { status: ffStatus, progress: ffProgress, errorMsg: ffError, applyEdits } = useFFmpegEdit();

  useEffect(() => {
    if (sourceTab !== "recordings" || recordings !== null) return;
    setLoadingRecordings(true);
    fetch("/api/recordings")
      .then((r) => r.json())
      .then((body) => setRecordings(body.data ?? []))
      .catch(() => setRecordings([]))
      .finally(() => setLoadingRecordings(false));
  }, [sourceTab, recordings]);

  // Track video playhead for timeline
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handle = () => setCurrentMs(video.currentTime * 1000);
    video.addEventListener("timeupdate", handle);
    return () => video.removeEventListener("timeupdate", handle);
  }, [step]);

  // Track video duration once loaded
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handle = () => setVideoDurationMs(video.duration * 1000);
    video.addEventListener("loadedmetadata", handle);
    return () => video.removeEventListener("loadedmetadata", handle);
  }, [step]);

  // Skip cut regions during preview playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !editPlan?.cuts?.length) return;
    const cuts = editPlan.cuts;
    const handle = () => {
      const tMs = video.currentTime * 1000;
      for (const cut of cuts) {
        if (tMs >= cut.startMs && tMs < cut.endMs) {
          video.currentTime = cut.endMs / 1000;
          break;
        }
      }
    };
    video.addEventListener("timeupdate", handle);
    return () => video.removeEventListener("timeupdate", handle);
  }, [editPlan]);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/")) return;
    setFile(f);
    videoBlobRef.current = f;
    setPreview(URL.createObjectURL(f));
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const startProcessing = useCallback(async () => {
    setStep("processing");
    setGenProgress(10);
    setErrorMsg(null);

    const blob = videoBlobRef.current;
    setSendingVideo(!!blob);

    const fakeProgress = setInterval(() => {
      setGenProgress((p) => Math.min(p + (90 - p) * 0.04, 88));
    }, 500);

    try {
      const srcId = selectedRecording?.id ?? recordingId;

      let res: Response;
      if (blob) {
        // Send actual video so Gemini can watch it and generate content-aware edits
        const fd = new FormData();
        fd.append("recordingId", srcId);
        fd.append("video", blob, file?.name ?? "recording.webm");
        res = await fetch("/api/ai/edit-plan", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/ai/edit-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordingId: srcId }),
        });
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "AI edit plan failed");
      const plan = body.data as EditPlan;
      setEditPlan(plan);
      if (plan.durationMs) setVideoDurationMs(plan.durationMs);
      setGenProgress(100);
      setStep("preview");
    } catch (err: any) {
      setErrorMsg(err.message ?? "Failed to generate edit plan");
      setStep("upload");
    } finally {
      clearInterval(fakeProgress);
    }
  }, [recordingId, selectedRecording]);

  const handleExport = useCallback(async () => {
    if (!editPlan) return;

    // Resolve video blob from file upload or in-session recording
    let blob = videoBlobRef.current;
    if (!blob && selectedRecording) {
      blob = getVideo(selectedRecording.id) ?? null;
    }

    if (!blob) {
      // No local blob — fall back to downloading the raw preview URL
      if (preview) {
        const a = document.createElement("a");
        a.href = preview;
        a.download = `${selectedRecording?.title ?? "recording"}_edited.webm`;
        a.click();
      } else {
        alert("No local video available for export. Re-record or upload a local file.");
      }
      setStep("done");
      return;
    }

    setStep("exporting");
    const durationMs = editPlan.durationMs ?? videoDurationMs;
    const edited = await applyEdits(blob, editPlan.cuts ?? [], durationMs);

    if (edited) {
      const url = URL.createObjectURL(edited);
      const a = document.createElement("a");
      a.href = url;
      const baseName = file?.name.replace(/\.[^.]+$/, "") ?? selectedRecording?.title ?? "recording";
      a.download = `${baseName}_edited.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStep("done");
    } else {
      // FFmpeg failed — surface error, go back to preview
      setStep("preview");
    }
  }, [editPlan, videoDurationMs, selectedRecording, preview, file, applyEdits]);

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setGenProgress(0);
    setSendingVideo(false);
    setSelectedRecording(null);
    setEditPlan(null);
    setErrorMsg(null);
    setCurrentMs(undefined);
    setVideoDurationMs(0);
    setInsertTitleCards(false);
    videoBlobRef.current = null;
  };

  const isVideoReady = sourceTab === "local" ? !!file : !!selectedRecording;
  const timelineDurationMs = editPlan?.durationMs ?? videoDurationMs;

  // ── Upload step ─────────────────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10 flex flex-col gap-8">
        {errorMsg && (
          <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Source tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-xl self-start">
          {(["local", "recordings"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSourceTab(tab)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                sourceTab === tab ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              )}
            >
              {tab === "local" ? <Upload className="w-4 h-4" /> : <Library className="w-4 h-4" />}
              {tab === "local" ? "Local file" : "From recordings"}
            </button>
          ))}
        </div>

        {/* Local file upload */}
        {sourceTab === "local" && (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all duration-200",
                dragging ? "border-brand-400 bg-brand-400/10"
                  : file ? "border-green-400 bg-green-400/10"
                  : "border-white/20 hover:border-white/40 hover:bg-white/5"
              )}
            >
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              {file ? (
                <>
                  <CheckCircle className="w-10 h-10 text-green-400" />
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-slate-400 text-sm">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-slate-400" />
                  <div className="text-center">
                    <p className="text-white font-medium">Drop your video here</p>
                    <p className="text-slate-400 text-sm mt-1">or click to browse — MP4, MOV, WebM</p>
                  </div>
                </>
              )}
            </div>
            {preview && <video src={preview} className="w-full rounded-2xl max-h-48 object-contain bg-black" muted controls />}
          </>
        )}

        {/* From recordings */}
        {sourceTab === "recordings" && (
          <div className="flex flex-col gap-3">
            {loadingRecordings ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
              </div>
            ) : !recordings?.length ? (
              <div className="flex flex-col items-center py-12 gap-3 text-center">
                <Video className="w-10 h-10 text-slate-600" />
                <p className="text-slate-400 text-sm">No recordings yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                {recordings.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => {
                      setSelectedRecording(rec);
                      const blob = getVideo(rec.id);
                      if (blob) {
                        videoBlobRef.current = blob;
                        if (preview) URL.revokeObjectURL(preview);
                        setPreview(URL.createObjectURL(blob));
                      } else {
                        videoBlobRef.current = null;
                        setPreview(null);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border text-left transition-all duration-200",
                      selectedRecording?.id === rec.id ? "border-brand-400 bg-brand-400/10" : "border-white/10 hover:border-white/25 bg-white/5"
                    )}
                  >
                    <div className="w-10 h-10 rounded-lg bg-white/10 overflow-hidden flex items-center justify-center shrink-0 relative">
                      {rec.thumbnailUrl
                        ? <img src={rec.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        : <Video className="w-5 h-5 text-slate-400" />}
                      {selectedRecording?.id === rec.id && (
                        <div className="absolute inset-0 bg-brand-500/60 flex items-center justify-center">
                          <CheckCircle className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium truncate", selectedRecording?.id === rec.id ? "text-white" : "text-slate-300")}>{rec.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3 text-slate-600" />
                        <span className="text-xs text-slate-500">{new Date(rec.createdAt).toLocaleDateString()}</span>
                        <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium capitalize",
                          rec.status === "ready" ? "bg-green-500/20 text-green-400" : rec.status === "processing" ? "bg-blue-500/20 text-blue-400" : "bg-white/10 text-slate-400"
                        )}>{rec.status}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selectedRecording && !preview && (
              <div className="flex items-start gap-2.5 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-400">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                Video preview only available for recordings made in this session. The edit package will still be generated.
              </div>
            )}
            {selectedRecording && preview && <video src={preview} className="w-full rounded-2xl max-h-48 object-contain bg-black" muted controls />}
          </div>
        )}

        {/* What the pipeline does */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm font-medium text-white mb-3">
          What Gemini generates{videoBlobRef.current ? " — by watching your actual video" : ""}
        </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            {[
              { icon: Scissors,  label: "Silence removal",       desc: "Cut dead air and restarts" },
              { icon: Captions,  label: "Auto captions",          desc: "Full subtitle track" },
              { icon: BookOpen,  label: "Table of contents",      desc: "Named chapter markers" },
              { icon: Star,      label: "Highlight reel",         desc: "Best 20–30 s clips" },
              { icon: Image,     label: "Cover frame",            desc: "Best thumbnail moment" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-2">
                <Icon className="w-3.5 h-3.5 mt-0.5 text-brand-400 shrink-0" />
                <div>
                  <span className="text-slate-300 font-medium">{label}</span>
                  <span className="text-slate-600"> — {desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={startProcessing}
          disabled={!isVideoReady}
          className="flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white px-8 py-3.5 rounded-xl font-semibold transition-all duration-200 self-center"
        >
          <Film className="w-4 h-4" />
          Generate complete edit package
          <ChevronRight className="w-4 h-4" />
        </button>
      </main>
    );
  }

  // ── Processing step ─────────────────────────────────────────────────────────
  if (step === "processing") {
    const pct = Math.min(100, Math.round(genProgress));
    const stages = sendingVideo
      ? [
          { label: "Uploading video to Gemini…",   threshold: 0 },
          { label: "Gemini is watching the video…", threshold: 15 },
          { label: "Identifying silences and cuts…", threshold: 35 },
          { label: "Finding chapter transitions…",  threshold: 55 },
          { label: "Selecting highlight moments…",  threshold: 70 },
          { label: "Choosing best thumbnail…",      threshold: 85 },
        ]
      : [
          { label: "Reviewing recording data…",    threshold: 0 },
          { label: "Planning silence cuts…",       threshold: 20 },
          { label: "Generating captions…",         threshold: 40 },
          { label: "Building table of contents…",  threshold: 55 },
          { label: "Selecting highlight clips…",   threshold: 70 },
          { label: "Picking best cover frame…",    threshold: 85 },
        ];
    const stage = [...stages].reverse().find((s) => pct >= s.threshold)?.label ?? stages[0].label;

    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        <Loader2 className="w-12 h-12 text-brand-400 animate-spin" />
        <div className="text-center">
          <p className="text-white font-semibold text-lg mb-1">{stage}</p>
          <p className="text-slate-400 text-sm">
            {sendingVideo
              ? "Gemini is watching your video to make content-aware edits…"
              : "Gemini is generating your complete edit package…"}
          </p>
        </div>
        <div className="w-full max-w-sm">
          <div className="flex justify-between text-xs text-slate-400 mb-2"><span>Progress</span><span>{pct}%</span></div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </main>
    );
  }

  // ── Exporting step ──────────────────────────────────────────────────────────
  if (step === "exporting") {
    const pct = ffProgress;
    const statusLabel =
      ffStatus === "loading" ? "Loading FFmpeg WASM…" :
      ffStatus === "processing" ? "Applying cuts with FFmpeg…" :
      "Finalising…";

    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        <Loader2 className="w-12 h-12 text-teal-400 animate-spin" />
        <div className="text-center">
          <p className="text-white font-semibold text-lg mb-1">{statusLabel}</p>
          <p className="text-slate-400 text-sm">Running entirely in your browser — no upload needed</p>
        </div>
        {ffError && (
          <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300 max-w-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{ffError}</span>
          </div>
        )}
        <div className="w-full max-w-sm">
          <div className="flex justify-between text-xs text-slate-400 mb-2"><span>Progress</span><span>{pct}%</span></div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </main>
    );
  }

  // ── Preview step ─────────────────────────────────────────────────────────────
  if (step === "preview" && editPlan) {
    return (
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10 flex flex-col gap-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-green-500/20 text-green-300 text-sm font-medium px-4 py-1.5 rounded-full mb-4">
            <CheckCircle className="w-4 h-4" />
            Complete edit package ready
          </div>
          <h2 className="text-xl font-semibold text-white">Preview &amp; Export</h2>
          <p className="text-slate-400 text-sm mt-1">{editPlan.summary}</p>
        </div>

        {/* FFmpeg export error */}
        {ffError && (
          <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Export failed: {ffError}. Try again or use the raw download.</span>
          </div>
        )}

        {/* Video player */}
        <div className="rounded-2xl overflow-hidden bg-black shadow-xl">
          {preview ? (
            <>
              <video ref={videoRef} src={preview} controls autoPlay className="w-full max-h-[380px] object-contain" />
              <div className="px-4 py-2 bg-black/80 text-xs text-slate-400 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 shrink-0" />
                Playback skips {editPlan.cuts.length} cut{editPlan.cuts.length !== 1 ? "s" : ""} — export applies them permanently
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 gap-3 px-6 text-center">
              <CheckCircle className="w-10 h-10 text-green-400" />
              <p className="text-slate-400 text-sm">No video preview — edit package generated from recording data.</p>
            </div>
          )}
        </div>

        {/* Chapter nav row — clickable chapter markers below the player */}
        {editPlan.tableOfContents.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 flex items-center gap-1 flex-wrap">
            <List className="w-3.5 h-3.5 text-slate-500 shrink-0 mr-1" />
            {editPlan.tableOfContents.map((ch, i) => (
              <button
                key={i}
                onClick={() => {
                  if (preview && videoRef.current) {
                    videoRef.current.currentTime = ch.timestampMs / 1000;
                    videoRef.current.play();
                  }
                }}
                disabled={!preview}
                title={`Jump to ${formatMs(ch.timestampMs)}`}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors font-medium",
                  preview
                    ? "text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
                    : "text-slate-500 cursor-default",
                  currentMs != null && currentMs >= ch.timestampMs &&
                    (i === editPlan.tableOfContents.length - 1 || currentMs < editPlan.tableOfContents[i + 1].timestampMs)
                    ? "bg-brand-500/20 text-brand-300"
                    : ""
                )}
              >
                <span className="font-mono text-[10px] text-slate-500">{formatMs(ch.timestampMs)}</span>
                {ch.title}
              </button>
            ))}
          </div>
        )}

        {/* Edit timeline */}
        {timelineDurationMs > 0 && (
          <EditTimeline
            durationMs={timelineDurationMs}
            cuts={editPlan.cuts ?? []}
            highlights={editPlan.highlights ?? []}
            toc={editPlan.tableOfContents ?? []}
            coverFrameMs={editPlan.coverFrameMs ?? 0}
            currentMs={currentMs}
            onSeek={preview ? (ms) => {
              if (videoRef.current) {
                videoRef.current.currentTime = ms / 1000;
                videoRef.current.play();
              }
            } : undefined}
          />
        )}

        {/* Results grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Cuts */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5" /> {editPlan.cuts.length} cut{editPlan.cuts.length !== 1 ? "s" : ""} removed
            </p>
            <div className="space-y-1.5">
              {editPlan.cuts.length === 0
                ? <p className="text-xs text-slate-500">No cuts needed</p>
                : editPlan.cuts.map((c, i) => (
                    <div key={i} className="text-xs text-slate-300">
                      <span className="font-mono text-slate-500">{formatMs(c.startMs)}–{formatMs(c.endMs)}</span> {c.reason}
                    </div>
                  ))}
            </div>
          </div>

          {/* Table of contents */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5" /> {editPlan.tableOfContents.length} chapter{editPlan.tableOfContents.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-1.5">
              {editPlan.tableOfContents.length === 0
                ? <p className="text-xs text-slate-500">No chapters generated</p>
                : editPlan.tableOfContents.map((ch, i) => (
                    <div key={i} className="text-xs text-slate-300">
                      <span className="font-mono text-slate-500">{formatMs(ch.timestampMs)}</span> {ch.title}
                    </div>
                  ))}
            </div>
          </div>

          {/* Highlights */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Star className="w-3.5 h-3.5" /> {editPlan.highlights.length} highlight clip{editPlan.highlights.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-1">
              {editPlan.highlights.length === 0
                ? <p className="text-xs text-slate-500">No highlights selected</p>
                : editPlan.highlights.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (preview && videoRef.current) {
                          videoRef.current.currentTime = h.startMs / 1000;
                          videoRef.current.play();
                        }
                      }}
                      disabled={!preview}
                      className={cn(
                        "w-full text-left text-xs text-slate-300 rounded-lg px-2 py-1 transition-colors",
                        preview ? "hover:bg-teal-500/10 hover:text-teal-200 cursor-pointer" : "cursor-default",
                      )}
                    >
                      <span className="font-mono text-teal-400">{formatMs(h.startMs)}–{formatMs(h.endMs)}</span>{" "}
                      {h.reason}
                      {preview && <span className="ml-1 text-teal-600 text-[10px]">▶ play</span>}
                    </button>
                  ))}
            </div>
          </div>

          {/* Captions + cover frame */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                <Captions className="w-3.5 h-3.5" /> {editPlan.captions.length} caption line{editPlan.captions.length !== 1 ? "s" : ""}
              </p>
              {editPlan.captions.slice(0, 4).map((cap, i) => (
                <div key={i} className="text-xs text-slate-300 mb-1">
                  <span className="font-mono text-slate-500">{formatMs(cap.timestampMs)}</span> {cap.text}
                </div>
              ))}
              {editPlan.captions.length > 4 && (
                <p className="text-xs text-slate-600">+{editPlan.captions.length - 4} more</p>
              )}
            </div>
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-2">
                <Image className="w-3.5 h-3.5" /> Best cover frame
              </p>
              <p className="text-xs text-slate-300">
                <span className="font-mono text-slate-500">{formatMs(editPlan.coverFrameMs)}</span> — recommended thumbnail moment
              </p>
            </div>
          </div>
        </div>

        {/* Chapter title card toggle */}
        {editPlan.tableOfContents.length > 0 && (
          <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
              <div>
                <p className="text-sm text-slate-300 font-medium">Insert chapter title cards</p>
                <p className="text-xs text-slate-500">
                  {insertTitleCards
                    ? `${editPlan.tableOfContents.length} title card${editPlan.tableOfContents.length !== 1 ? "s" : ""} will be noted in the export`
                    : "Add a chapter title overlay at each chapter marker"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setInsertTitleCards((v) => !v)}
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0",
                insertTitleCards ? "bg-brand-500" : "bg-white/15 hover:bg-white/25"
              )}
            >
              <span className={cn(
                "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200",
                insertTitleCards && "translate-x-5"
              )} />
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={handleExport}
            className="flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-semibold transition-all duration-200"
          >
            <Download className="w-4 h-4" />
            {videoBlobRef.current ? "Export edited video" : "Download video"}
          </button>
          {editPlan.captions.length > 0 && (
            <button
              onClick={() => {
                const srt = buildSRT(editPlan.captions, editPlan.cuts ?? []);
                const blob = new Blob([srt], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                const baseName = file?.name.replace(/\.[^.]+$/, "") ?? selectedRecording?.title ?? "recording";
                a.download = `${baseName}_captions.srt`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 3000);
              }}
              className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white px-6 py-3 rounded-xl font-medium transition-all duration-200"
            >
              <Captions className="w-4 h-4" />
              Download SRT
            </button>
          )}
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white px-6 py-3 rounded-xl font-medium transition-all duration-200"
          >
            <RotateCcw className="w-4 h-4" />
            Start over
          </button>
        </div>
      </main>
    );
  }

  // ── Done step ─────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
        <CheckCircle className="w-8 h-8 text-green-400" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Download started</h2>
        <p className="text-slate-400 text-sm">Your edited video is downloading</p>
      </div>
      <button onClick={reset} className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white px-6 py-3 rounded-xl font-medium transition-all duration-200">
        <RotateCcw className="w-4 h-4" />
        Edit another video
      </button>
    </main>
  );
}
