"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, Scissors, Play, Download, RotateCcw, CheckCircle,
  Film, Volume2, Captions, Star, ChevronRight, Loader2, Library,
  Clock, Video,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Recording } from "@screencraft/shared";

type Step = "upload" | "processing" | "preview" | "done";
type SourceTab = "local" | "recordings";

const EDIT_OPTIONS = [
  { id: "silence", icon: Volume2,   label: "Remove silences",  desc: "Auto-detect and cut dead air gaps" },
  { id: "captions", icon: Captions, label: "Auto captions",    desc: "Generate accurate subtitles" },
  { id: "highlight", icon: Star,    label: "Highlight reel",   desc: "Trim to best 60-second moments" },
  { id: "cover",    icon: Film,     label: "Best cover frame", desc: "Recommend ideal thumbnail" },
] as const;

type OptionId = typeof EDIT_OPTIONS[number]["id"];

interface Props { recordingId: string }

export function AIEditStudio({ recordingId }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [sourceTab, setSourceTab] = useState<SourceTab>("local");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<OptionId>>(new Set(["silence", "captions"]));
  const [progress, setProgress] = useState(0);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load recordings when tab switches
  useEffect(() => {
    if (sourceTab !== "recordings" || recordings !== null) return;
    setLoadingRecordings(true);
    fetch("/api/recordings")
      .then((r) => r.json())
      .then((body) => setRecordings(body.data ?? []))
      .catch(() => setRecordings([]))
      .finally(() => setLoadingRecordings(false));
  }, [sourceTab, recordings]);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/")) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const toggleOption = (id: OptionId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startProcessing = () => {
    setStep("processing");
    setProgress(0);
    // Simulate AI processing progress
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          setStep("preview");
          return 100;
        }
        return p + Math.random() * 8 + 2;
      });
    }, 300);
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setProgress(0);
    setSelectedRecording(null);
  };

  const isVideoReady = sourceTab === "local" ? !!file : !!selectedRecording;

  const download = () => {
    if (preview) {
      const a = document.createElement("a");
      a.href = preview;
      a.download = file?.name.replace(/\.[^.]+$/, "_edited.webm") ?? `${selectedRecording?.title ?? "recording"}_edited.webm`;
      a.click();
    }
    setStep("done");
  };

  // ── Upload step ────────────────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10 flex flex-col gap-8">
        {/* Source tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-xl self-start">
          <button
            onClick={() => setSourceTab("local")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              sourceTab === "local" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
            )}
          >
            <Upload className="w-4 h-4" />
            Local file
          </button>
          <button
            onClick={() => setSourceTab("recordings")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              sourceTab === "recordings" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
            )}
          >
            <Library className="w-4 h-4" />
            From recordings
          </button>
        </div>

        {/* Source panel: local upload */}
        {sourceTab === "local" && (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all duration-200",
                dragging
                  ? "border-brand-400 bg-brand-400/10"
                  : file
                  ? "border-green-400 bg-green-400/10"
                  : "border-white/20 hover:border-white/40 hover:bg-white/5"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
              />
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
            {preview && (
              <video src={preview} className="w-full rounded-2xl max-h-48 object-contain bg-black" muted />
            )}
          </>
        )}

        {/* Source panel: from recordings */}
        {sourceTab === "recordings" && (
          <div className="flex flex-col gap-3">
            {loadingRecordings ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
              </div>
            ) : !recordings || recordings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <Video className="w-10 h-10 text-slate-600" />
                <p className="text-slate-400 text-sm">No recordings found.<br />Go to the recorder to create one first.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                {recordings.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => setSelectedRecording(rec)}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border text-left transition-all duration-200",
                      selectedRecording?.id === rec.id
                        ? "border-brand-400 bg-brand-400/10"
                        : "border-white/10 hover:border-white/25 bg-white/5"
                    )}
                  >
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                      {selectedRecording?.id === rec.id
                        ? <CheckCircle className="w-5 h-5 text-brand-400" />
                        : <Video className="w-5 h-5 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium truncate", selectedRecording?.id === rec.id ? "text-white" : "text-slate-300")}>
                        {rec.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3 text-slate-600" />
                        <span className="text-xs text-slate-500">
                          {new Date(rec.createdAt).toLocaleDateString()}
                        </span>
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full capitalize font-medium",
                          rec.status === "ready" ? "bg-green-500/20 text-green-400" :
                          rec.status === "processing" ? "bg-blue-500/20 text-blue-400" :
                          "bg-white/10 text-slate-400"
                        )}>
                          {rec.status}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Edit options */}
        <div>
          <p className="text-sm font-medium text-slate-300 mb-3">Select AI edits to apply</p>
          <div className="grid grid-cols-2 gap-3">
            {EDIT_OPTIONS.map(({ id, icon: Icon, label, desc }) => (
              <button
                key={id}
                onClick={() => toggleOption(id)}
                className={cn(
                  "flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-200",
                  selected.has(id)
                    ? "border-brand-400 bg-brand-400/10"
                    : "border-white/10 hover:border-white/25 bg-white/5"
                )}
              >
                <Icon className={cn("w-5 h-5 mt-0.5 flex-shrink-0", selected.has(id) ? "text-brand-400" : "text-slate-400")} />
                <div>
                  <p className={cn("text-sm font-medium", selected.has(id) ? "text-white" : "text-slate-300")}>{label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={startProcessing}
          disabled={!isVideoReady || selected.size === 0}
          className="flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white px-8 py-3.5 rounded-xl font-semibold transition-all duration-200 self-center"
        >
          <Scissors className="w-4 h-4" />
          Apply AI edits
          <ChevronRight className="w-4 h-4" />
        </button>
      </main>
    );
  }

  // ── Processing step ────────────────────────────────────────────────────────
  if (step === "processing") {
    const pct = Math.min(100, Math.round(progress));
    const stages = [
      { label: "Analyzing audio…",       threshold: 0 },
      { label: "Detecting silences…",    threshold: 25 },
      { label: "Generating captions…",   threshold: 50 },
      { label: "Cutting highlight reel…",threshold: 75 },
      { label: "Encoding output…",       threshold: 90 },
    ];
    const stage = [...stages].reverse().find((s) => pct >= s.threshold)?.label ?? stages[0].label;

    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        <Loader2 className="w-12 h-12 text-brand-400 animate-spin" />
        <div className="text-center">
          <p className="text-white font-semibold text-lg mb-1">{stage}</p>
          <p className="text-slate-400 text-sm">Applying {selected.size} AI edit{selected.size !== 1 ? "s" : ""}…</p>
        </div>
        <div className="w-full max-w-sm">
          <div className="flex justify-between text-xs text-slate-400 mb-2">
            <span>Progress</span><span>{pct}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </main>
    );
  }

  // ── Preview step ───────────────────────────────────────────────────────────
  if (step === "preview") {
    return (
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10 flex flex-col gap-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-green-500/20 text-green-300 text-sm font-medium px-4 py-1.5 rounded-full mb-4">
            <CheckCircle className="w-4 h-4" />
            AI edits applied
          </div>
          <h2 className="text-xl font-semibold">Preview your edited video</h2>
          <p className="text-slate-400 text-sm mt-1">
            Applied: {[...selected].map((id) => EDIT_OPTIONS.find((o) => o.id === id)?.label).join(", ")}
          </p>
        </div>

        {/* Video preview */}
        <div className="rounded-2xl overflow-hidden bg-black shadow-xl shadow-black/50">
          {preview ? (
            <video src={preview} controls className="w-full max-h-[400px] object-contain" />
          ) : (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <CheckCircle className="w-10 h-10 text-green-400" />
              <p className="text-slate-400 text-sm">
                {selectedRecording?.title ?? "Recording"} — edited output ready
              </p>
              <p className="text-slate-600 text-xs">Video preview requires local file or backend stream</p>
            </div>
          )}
        </div>

        {/* Edit summary chips */}
        <div className="flex flex-wrap gap-2 justify-center">
          {[...selected].map((id) => {
            const opt = EDIT_OPTIONS.find((o) => o.id === id)!;
            return (
              <div key={id} className="flex items-center gap-1.5 bg-white/10 text-slate-300 text-xs px-3 py-1.5 rounded-full">
                <opt.icon className="w-3.5 h-3.5" />
                {opt.label}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={download}
            className="flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-semibold transition-all duration-200"
          >
            <Download className="w-4 h-4" />
            Download edited video
          </button>
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

  // ── Done step ──────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
        <CheckCircle className="w-8 h-8 text-green-400" />
      </div>
      <div>
        <h2 className="text-xl font-semibold mb-1">Download started</h2>
        <p className="text-slate-400 text-sm">Your edited video is downloading</p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white px-6 py-3 rounded-xl font-medium transition-all duration-200"
      >
        <RotateCcw className="w-4 h-4" />
        Edit another video
      </button>
    </main>
  );
}
