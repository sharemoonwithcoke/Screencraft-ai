"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft, Monitor, AppWindow, Crop, Circle, LayoutDashboard,
  RotateCcw, FileText, ChevronDown, ChevronUp, Sparkles, BarChart2, Video, VideoOff, X,
} from "lucide-react";
import { RecorderControls } from "./RecorderControls";
import { Teleprompter } from "./Teleprompter";
import { WaveformPreview } from "./WaveformPreview";
import { AICueOverlay } from "./AICueOverlay";
import { ZoomCanvas } from "./ZoomCanvas";
import { CameraPreview } from "./CameraPreview";
import { AIAssistantPanel } from "./AIAssistantPanel";
import { useRecorder } from "@/hooks/useRecorder";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useLiveCC } from "@/hooks/useLiveCC";
import { useScriptSuggestions } from "@/hooks/useScriptSuggestions";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { storeVideo } from "@/lib/videoStore";
import { saveRecordingGoals } from "@/lib/dev-store";
import { cn } from "@/lib/cn";
import type { RecordingGoals } from "@screencraft/shared";

const REGION_OPTIONS = [
  { value: "fullscreen", label: "Full screen", icon: Monitor, desc: "Capture your entire display" },
  { value: "window",     label: "Window",      icon: AppWindow, desc: "Select a specific app window" },
  { value: "custom",     label: "Custom area", icon: Crop,      desc: "Draw a custom capture region" },
] as const;

async function extractFirstFrame(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d");
        if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
        ctx.drawImage(video, 0, 0, 320, 180);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, video.duration > 0 ? video.duration / 4 : 0);
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    video.src = url;
  });
}

export function RecorderShell() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/login?callbackUrl=/recorder");
    }
  }, [status, router]);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [enableCamera, setEnableCamera] = useState(false);
  const [teleprompterContent, setTeleprompterContent] = useState("");
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [region, setRegion] = useState<"fullscreen" | "window" | "custom">("fullscreen");
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState("");
  const [goals, setGoals] = useState<RecordingGoals>({});

  const [stuckHint, setStuckHint] = useState<string | null>(null);
  const [stuckHintLoading, setStuckHintLoading] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastSpeechMsRef = useRef<number>(Date.now());
  const lastHintShownRef = useRef<number>(0);
  const hintFetchingRef = useRef(false);

  const { supported: ccSupported, enabled: ccEnabled, transcript: ccTranscript, wordCount: ccWordCount, avgConfidence: ccAvgConfidence, toggle: ccToggle, stop: ccStop } = useLiveCC();

  const { on: wsOn, sendChunk } = useWebSocket(recordingId);

  const { state, elapsed, elapsedSecs, error, start, pause, resume, stop, reset } =
    useRecorder({
      onChunk: useCallback(
        (blob: Blob, index: number) => {
          if (recordingId) sendChunk(blob, index, recordingId);
        },
        [recordingId, sendChunk]
      ),
      onStop: useCallback(
        (blob: Blob) => {
          if (!recordingId) return;
          storeVideo(recordingId, blob);
          // Extract first-frame thumbnail and persist it (fire-and-forget)
          extractFirstFrame(blob).then((dataUrl) => {
            if (!dataUrl) return;
            fetch(`/api/recordings/${recordingId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ thumbnailUrl: dataUrl }),
            }).catch(() => {});
          });
        },
        [recordingId]
      ),
    });

  // Append AI-generated script sentences to teleprompter and auto-show it
  const handleAiSentence = useCallback((sentence: string) => {
    setTeleprompterContent((prev) => {
      const sep = prev && !prev.endsWith("\n") ? " " : "";
      return prev + sep + sentence;
    });
    setShowTeleprompter(true);
  }, []);

  const { isGenerating: isAiWriting } = useScriptSuggestions({
    stream:        displayStream,
    isRecording:   state === "recording",
    ccTranscript,
    ccEnabled,
    scriptContent: teleprompterContent,
    goals,
    onSentence:    handleAiSentence,
  });

  const { captureRegionJpeg } = useScreenCapture(displayStream);

  // Reset last-speech tracker whenever the transcript updates
  useEffect(() => {
    if (ccTranscript) lastSpeechMsRef.current = Date.now();
  }, [ccTranscript]);

  // Stuck-hint detection: trigger when silence > 3 s during recording
  useEffect(() => {
    if (state !== "recording") return;
    const SILENCE_THRESHOLD_MS = 3000;
    const HINT_COOLDOWN_MS = 30000;

    const interval = setInterval(async () => {
      const silenceMs = Date.now() - lastSpeechMsRef.current;
      const msSinceLastHint = Date.now() - lastHintShownRef.current;

      if (
        silenceMs < SILENCE_THRESHOLD_MS ||
        msSinceLastHint < HINT_COOLDOWN_MS ||
        hintFetchingRef.current
      ) return;

      const viewport = viewportRef.current;
      if (!viewport) return;

      hintFetchingRef.current = true;
      setStuckHintLoading(true);
      try {
        const rect = viewport.getBoundingClientRect();
        const blob = await captureRegionJpeg(rect, 0.8);
        if (!blob) return;

        const fd = new FormData();
        fd.append("screenshot", blob, "screenshot.jpg");
        fd.append("spokenSoFar", ccTranscript ?? "");
        fd.append("currentScriptLine", teleprompterContent.split("\n").find((l) => l.trim()) ?? "");
        fd.append("fullScript", teleprompterContent ?? "");
        fd.append("videoType", goals.videoType ?? "PRODUCT_DEMO");

        const res = await fetch("/api/ai/stuck-hint", { method: "POST", body: fd });
        if (!res.ok) return;
        const { data } = await res.json();
        if (data?.hint) {
          setStuckHint(data.hint);
          lastHintShownRef.current = Date.now();
        }
      } catch {
        // Non-critical — swallow errors silently
      } finally {
        hintFetchingRef.current = false;
        setStuckHintLoading(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state, captureRegionJpeg, ccTranscript, teleprompterContent]);

  // ── Camera toggle ─────────────────────────────────────────────────────────
  const handleCameraToggle = useCallback(async () => {
    if (enableCamera) {
      // Turn off — stop any active camera stream
      cameraStream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      setEnableCamera(false);
    } else {
      // Turn on — request camera permission immediately so user sees the preview
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        setCameraStream(cam);
        setEnableCamera(true);
      } catch {
        // Permission denied or no camera — stay disabled
      }
    }
  }, [enableCamera, cameraStream]);

  const handleStart = useCallback(async () => {
    // getDisplayMedia MUST be called from an active user-gesture frame.
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60 },
        audio: false,
      });
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "AbortError") return;
      throw err;
    }

    // Microphone is optional
    let audio: MediaStream | null = null;
    try {
      audio = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      // Continue without mic
    }

    // Create recording entry after media is secured
    const res = await fetch("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled recording", region }),
    });
    const { data } = await res.json();
    setRecordingId(data.id);
    if (Object.keys(goals).some((k) => goals[k as keyof RecordingGoals] !== undefined)) {
      saveRecordingGoals(data.id, goals);
    }

    setDisplayStream(display);
    setAudioStream(audio);
    if (teleprompterContent.trim()) setShowTeleprompter(true);
    await start(display, audio ?? undefined);
  }, [region, start, teleprompterContent, goals]);

  const handleStop = useCallback(async () => {
    ccStop();

    // Stop the display stream tracks FIRST so the browser's screen-share
    // indicator clears immediately. The MediaRecorder will detect the track
    // ended event and flush its remaining buffer (ondataavailable → onstop)
    // before going inactive — data is not lost.
    displayStream?.getTracks().forEach((t) => t.stop());
    audioStream?.getTracks().forEach((t) => t.stop());

    // Now stop the recorder (no-op if already stopped by track-end auto-stop)
    stop();

    // Stop camera stream
    cameraStream?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);

    if (recordingId) {
      // Store actual duration so the analyze route can use it in the Gemini prompt
      await fetch(`/api/recordings/${recordingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing", duration: elapsedSecs }),
      });
      // Pass CC transcript and goals so Gemini can tailor analysis to video type and audience
      fetch(`/api/recordings/${recordingId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: ccTranscript || undefined,
          videoType: goals.videoType,
          audienceType: goals.audienceType,
        }),
      }).catch(() => {});
    }
  }, [stop, ccStop, recordingId, displayStream, audioStream, cameraStream, elapsedSecs, ccTranscript]);

  const handleReset = useCallback(() => {
    setDisplayStream(null);
    setAudioStream(null);
    // Keep cameraStream alive so the preview continues into next recording
    setRecordingId(null);
    setShowTeleprompter(false);
    reset();
  }, [reset]);

  const handleAiOptimize = useCallback(async () => {
    if (!teleprompterContent.trim()) return;
    setOptimizing(true);
    setOptimizeError("");
    try {
      const res = await fetch("/api/ai/optimize-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: teleprompterContent }),
      });
      const json = await res.json();
      if (!res.ok) {
        setOptimizeError(json?.error?.message ?? "Optimization failed");
      } else {
        setTeleprompterContent(json.data.optimized);
      }
    } catch {
      setOptimizeError("Network error — check your connection");
    } finally {
      setOptimizing(false);
    }
  }, [teleprompterContent]);

  // ── Auth loading / redirect ─────────────────────────────────────────────
  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  // ── Pre-recording start screen ──────────────────────────────────────────
  if (state === "idle") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        <div className="flex items-center px-6 py-4 border-b border-white/10">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8 py-10">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-2">New recording</h1>
            <p className="text-slate-400 text-sm">Choose what to capture, then press Record</p>
          </div>

          {/* Region selector */}
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xl">
            {REGION_OPTIONS.map(({ value, label, icon: Icon, desc }) => (
              <button
                key={value}
                onClick={() => setRegion(value)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-2 px-5 py-5 rounded-2xl border text-sm font-medium transition-all duration-200",
                  region === value
                    ? "bg-brand-500/15 border-brand-500 text-white"
                    : "bg-white/5 border-white/10 text-slate-400 hover:border-white/25 hover:text-white"
                )}
              >
                <Icon className={cn("w-6 h-6", region === value ? "text-brand-400" : "")} />
                <span>{label}</span>
                <span className="text-xs text-slate-500 font-normal text-center">{desc}</span>
              </button>
            ))}
          </div>

          {/* Camera toggle */}
          <div className="w-full max-w-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                {enableCamera
                  ? <Video className="w-5 h-5 text-brand-400" />
                  : <VideoOff className="w-5 h-5 text-slate-400" />}
                <div>
                  <p className="text-sm font-medium text-slate-300">Webcam</p>
                  <p className="text-xs text-slate-500">
                    {enableCamera ? "Camera active — will show during recording" : "Show your camera as a picture-in-picture overlay"}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCameraToggle}
                className={cn(
                  "relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0",
                  enableCamera ? "bg-brand-500" : "bg-white/15 hover:bg-white/25"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200",
                  enableCamera && "translate-x-5"
                )} />
              </button>
            </div>

            {/* Inline camera preview when enabled */}
            {enableCamera && cameraStream && (
              <div className="border-t border-white/10 flex justify-center py-3">
                <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-brand-400/50">
                  <video
                    autoPlay
                    muted
                    playsInline
                    ref={(el) => { if (el) el.srcObject = cameraStream; }}
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Script editor (collapsible) */}
          <div className="w-full max-w-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowScriptEditor((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-slate-300 hover:text-white transition-colors duration-200"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" />
                Script / Teleprompter
                {teleprompterContent.trim() && (
                  <span className="text-xs bg-brand-500/20 text-brand-300 px-2 py-0.5 rounded-full">
                    {teleprompterContent.split("\n").filter(Boolean).length} lines
                  </span>
                )}
              </div>
              {showScriptEditor ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {showScriptEditor && (
              <div className="border-t border-white/10">
                <textarea
                  value={teleprompterContent}
                  onChange={(e) => setTeleprompterContent(e.target.value)}
                  placeholder="Paste or write your script here. It will scroll automatically while you record."
                  className="w-full h-40 bg-transparent text-sm text-slate-300 placeholder-slate-600 px-5 py-4 resize-none focus:outline-none font-mono leading-relaxed"
                />
                <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
                  <span className="text-xs text-slate-500">
                    {teleprompterContent.trim() ? `${teleprompterContent.trim().split(/\s+/).length} words` : "No script added"}
                  </span>
                  <button
                    onClick={handleAiOptimize}
                    disabled={!teleprompterContent.trim() || optimizing}
                    className="flex items-center gap-1.5 text-xs font-medium text-brand-400 hover:text-brand-300 disabled:opacity-40 transition-colors duration-200"
                  >
                    <Sparkles className={cn("w-3.5 h-3.5", optimizing && "animate-spin")} />
                    {optimizing ? "Optimizing…" : "AI Optimize"}
                  </button>
                </div>
                {optimizeError && (
                  <p className="px-5 pb-3 text-xs text-red-400">{optimizeError}</p>
                )}
              </div>
            )}
          </div>

          {/* Recording goals */}
          <div className="w-full max-w-xl bg-white/5 border border-white/10 rounded-2xl px-5 py-4 flex flex-col gap-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Recording goals <span className="font-normal normal-case text-slate-600">(optional — improves AI coaching &amp; analysis)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Video type</label>
                <select
                  value={goals.videoType ?? ""}
                  onChange={(e) => setGoals((g) => ({ ...g, videoType: e.target.value as RecordingGoals["videoType"] || undefined }))}
                  className="w-full bg-white/10 border border-white/15 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-400"
                >
                  <option value="">Not specified</option>
                  <option value="PRODUCT_DEMO">Product Demo</option>
                  <option value="TUTORIAL">Tutorial / Onboarding</option>
                  <option value="TECHNICAL_DEMO">Internal / Technical Demo</option>
                  <option value="PRESENTATION">Presentation</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Audience</label>
                <select
                  value={goals.audienceType ?? ""}
                  onChange={(e) => setGoals((g) => ({ ...g, audienceType: e.target.value as RecordingGoals["audienceType"] || undefined }))}
                  className="w-full bg-white/10 border border-white/15 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-400"
                >
                  <option value="">Not specified</option>
                  <option value="non-technical">Non-technical</option>
                  <option value="technical">Technical</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Duration target</label>
              <select
                value={goals.durationTargetSecs ?? ""}
                onChange={(e) => setGoals((g) => ({ ...g, durationTargetSecs: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-full bg-white/10 border border-white/15 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-400"
              >
                <option value="">No limit</option>
                <option value="120">2 minutes</option>
                <option value="180">3 minutes</option>
                <option value="300">5 minutes</option>
                <option value="600">10 minutes</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Objectives <span className="text-slate-600">(what you want to show)</span></label>
              <input
                type="text"
                value={goals.objectives ?? ""}
                onChange={(e) => setGoals((g) => ({ ...g, objectives: e.target.value || undefined }))}
                placeholder="e.g. demo the auth flow and onboarding steps"
                className="w-full bg-white/10 border border-white/15 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 placeholder-slate-600 focus:outline-none focus:border-brand-400"
              />
            </div>
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            className="flex items-center gap-3 bg-red-500 hover:bg-red-600 text-white px-10 py-4 rounded-2xl text-base font-semibold shadow-xl shadow-red-500/30 transition-all duration-200 active:scale-95"
          >
            <Circle className="w-5 h-5 fill-white" />
            Start recording
          </button>
        </div>

        {error && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-xl text-sm shadow-lg z-50">
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Post-recording summary screen ───────────────────────────────────────
  if (state === "stopped") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        <div className="flex items-center px-6 py-4 border-b border-white/10">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-1">Recording saved</h2>
            <p className="text-slate-400 text-sm">AI analysis is running automatically in the background…</p>
          </div>

          {/* Animated analysis-in-progress indicator */}
          <div className="flex items-center gap-3 bg-brand-500/15 border border-brand-500/30 rounded-2xl px-5 py-3">
            <BarChart2 className="w-4 h-4 text-brand-400 animate-pulse" />
            <span className="text-sm text-brand-300">Analysing with Gemini — usually takes ~15 s</span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => recordingId && router.push(`/recordings/${recordingId}`)}
              disabled={!recordingId}
              className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-200"
            >
              <BarChart2 className="w-4 h-4" />
              View recording
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white px-6 py-3 rounded-xl text-sm font-medium transition-all duration-200"
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white px-6 py-3 rounded-xl text-sm font-medium transition-all duration-200"
            >
              <RotateCcw className="w-4 h-4" />
              Record another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Live recording view (recording / paused) ─────────────────────────────
  return (
    <div className="relative min-h-screen bg-slate-950 flex flex-col">
      {/* Top bar */}
      <div className={cn(
        "flex items-center px-6 py-3 border-b border-white/10 transition-opacity duration-300 z-20",
        state === "recording" ? "opacity-30 hover:opacity-100" : "opacity-100"
      )}>
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors duration-200"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </button>
        {state === "recording" && (
          <div className="ml-auto flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-slate-500">Recording in progress</span>
          </div>
        )}
      </div>

      <AIAssistantPanel
        isRecording={state === "recording"}
        elapsed={elapsed}
        recordingId={recordingId}
        ccTranscript={ccTranscript}
        ccWordCount={ccEnabled ? ccWordCount : undefined}
        ccAvgConfidence={ccEnabled ? ccAvgConfidence : undefined}
        scriptDraft={teleprompterContent}
        goals={goals}
      />

      <AICueOverlay wsOn={wsOn} />

      {/* Main recording viewport */}
      <div ref={viewportRef} className="flex-1 relative overflow-hidden">
        {displayStream && <ZoomCanvas stream={displayStream} />}

        {/* Floating camera picture-in-picture overlay */}
        {cameraStream && <CameraPreview stream={cameraStream} />}

        {/* Stuck-hint toast — appears above CC subtitles */}
        {(stuckHint || stuckHintLoading) && (
          <div className="absolute bottom-16 left-0 right-0 flex justify-center px-8 z-40 pointer-events-none">
            <div className="bg-brand-600/95 backdrop-blur-sm text-white px-5 py-3 rounded-2xl shadow-xl flex items-start gap-3 max-w-md pointer-events-auto">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-brand-200" />
              {stuckHintLoading && !stuckHint
                ? <span className="text-sm text-brand-100">Thinking of a suggestion…</span>
                : <span className="text-sm leading-snug">{stuckHint}</span>}
              {stuckHint && (
                <button
                  onClick={() => setStuckHint(null)}
                  className="ml-auto p-0.5 rounded hover:bg-brand-700 shrink-0 text-brand-200 hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Live CC subtitle overlay */}
        {ccEnabled && ccTranscript && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center px-8 pointer-events-none z-30">
            <div className="bg-black/80 text-white text-sm font-medium px-5 py-2.5 rounded-xl text-center max-w-2xl leading-snug backdrop-blur-sm">
              {ccTranscript}
            </div>
          </div>
        )}
      </div>

      {/* Bottom dock */}
      <div className="relative z-10 bg-slate-900/90 backdrop-blur-md border-t border-white/10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-6">
          {audioStream && (
            <WaveformPreview stream={audioStream} isRecording={state === "recording"} />
          )}
          <RecorderControls
            state={state}
            elapsed={elapsed}
            region={region}
            onRegionChange={setRegion}
            onStart={handleStart}
            onPause={pause}
            onResume={resume}
            onStop={handleStop}
            onReset={handleReset}
            onToggleTeleprompter={() => setShowTeleprompter((v) => !v)}
            ccSupported={ccSupported}
            ccEnabled={ccEnabled}
            onToggleCC={ccToggle}
            cameraEnabled={enableCamera}
            onToggleCamera={handleCameraToggle}
          />
        </div>
      </div>

      {/* Teleprompter — shows if there's a script and toggled on */}
      {showTeleprompter && (
        <Teleprompter
          content={teleprompterContent}
          onChange={setTeleprompterContent}
          isRecording={state === "recording"}
          isAiGenerating={isAiWriting}
          wsOn={wsOn}
        />
      )}

      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-xl text-sm shadow-lg z-50">
          {error}
        </div>
      )}
    </div>
  );
}
