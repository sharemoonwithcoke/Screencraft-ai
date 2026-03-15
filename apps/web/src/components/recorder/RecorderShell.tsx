"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft, Monitor, AppWindow, Crop, Circle, LayoutDashboard,
  RotateCcw, FileText, ChevronDown, ChevronUp, Sparkles,
} from "lucide-react";
import { RecorderControls } from "./RecorderControls";
import { CameraPreview } from "./CameraPreview";
import { Teleprompter } from "./Teleprompter";
import { WaveformPreview } from "./WaveformPreview";
import { AICueOverlay } from "./AICueOverlay";
import { ZoomCanvas } from "./ZoomCanvas";
import { AIAssistantPanel } from "./AIAssistantPanel";
import { useRecorder } from "@/hooks/useRecorder";
import { useWebSocket } from "@/hooks/useWebSocket";
import { cn } from "@/lib/cn";

type CoachingResult = {
  wpm: number;
  fillerWords: string[];
  pauseDetected: boolean;
  monotone: boolean;
  transcript: string;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const REGION_OPTIONS = [
  { value: "fullscreen", label: "Full screen", icon: Monitor, desc: "Capture your entire display" },
  { value: "window",     label: "Window",      icon: AppWindow, desc: "Select a specific app window" },
  { value: "custom",     label: "Custom area", icon: Crop,      desc: "Draw a custom capture region" },
] as const;

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
  const [teleprompterContent, setTeleprompterContent] = useState("");
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [region, setRegion] = useState<"fullscreen" | "window" | "custom">("fullscreen");
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [liveCoaching, setLiveCoaching] = useState<CoachingResult | null>(null);
  const coachRecorderRef = useRef<MediaRecorder | null>(null);

  const { on: wsOn, sendChunk } = useWebSocket(recordingId);

  const analyzeAudioChunk = useCallback(async (blob: Blob) => {
    try {
      const base64 = await blobToBase64(blob);
      const res = await fetch("/api/ai/coach-chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, mimeType: blob.type || "audio/webm" }),
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setLiveCoaching(json.data as CoachingResult);
    } catch {
      // Coaching is non-critical — ignore errors silently
    }
  }, []);

  const { state, elapsed, error, start, pause, resume, stop, reset } =
    useRecorder({
      onChunk: useCallback(
        (blob: Blob, index: number) => {
          if (recordingId) sendChunk(blob, index, recordingId);
        },
        [recordingId, sendChunk]
      ),
    });

  const handleStart = useCallback(async () => {
    // Request media FIRST — getDisplayMedia requires an active user gesture.
    // Any await before this call (e.g. fetch) consumes the transient activation
    // and causes NotAllowedError in Chromium.
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 60 },
      audio: false,
    });
    // Microphone is optional — some environments deny it or have no device
    let audio: MediaStream | null = null;
    try {
      audio = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      // Continue without mic; recording will have no audio track
    }

    // Create recording entry after media is secured
    const res = await fetch("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled recording", region }),
    });
    const { data } = await res.json();
    setRecordingId(data.id);

    setDisplayStream(display);
    setAudioStream(audio);
    if (teleprompterContent.trim()) setShowTeleprompter(true);

    // Set up audio-only coaching recorder (smaller blobs than video+audio)
    if (audio) {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const coachRec = new MediaRecorder(audio, { mimeType });
      coachRecorderRef.current = coachRec;
      coachRec.ondataavailable = (e) => {
        if (e.data.size > 0) void analyzeAudioChunk(e.data);
      };
      coachRec.start(5000);
    }

    await start(display, audio ?? undefined);
  }, [region, start, teleprompterContent, analyzeAudioChunk]);

  const handleStop = useCallback(async () => {
    coachRecorderRef.current?.stop();
    coachRecorderRef.current = null;
    // Stop all media tracks immediately so camera/mic indicator lights turn off
    displayStream?.getTracks().forEach((t) => t.stop());
    audioStream?.getTracks().forEach((t) => t.stop());
    stop();
    if (recordingId) {
      await fetch(`/api/recordings/${recordingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing" }),
      });
    }
  }, [stop, recordingId, displayStream, audioStream]);

  const handleReset = useCallback(() => {
    coachRecorderRef.current?.stop();
    coachRecorderRef.current = null;
    setLiveCoaching(null);
    setDisplayStream(null);
    setAudioStream(null);
    setRecordingId(null);
    setShowTeleprompter(false);
    reset();
  }, [reset]);

  const handleAiOptimize = useCallback(async () => {
    if (!teleprompterContent.trim()) return;
    setOptimizing(true);
    try {
      const res = await fetch("/api/ai/optimize-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: teleprompterContent }),
      });
      const json = await res.json();
      if (json.ok && json.data?.script_lines?.length > 0) {
        // Convert structured lines back to plain teleprompter text
        setTeleprompterContent(
          json.data.script_lines
            .map((l: { text: string }) => l.text)
            .join("\n")
        );
      }
    } catch {
      // API unavailable — leave script unchanged
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
              </div>
            )}
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
            <p className="text-slate-400 text-sm">Your recording is being processed</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-200"
            >
              <LayoutDashboard className="w-4 h-4" />
              View in Dashboard
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

      <AIAssistantPanel isRecording={state === "recording"} elapsed={elapsed} wsOn={wsOn} liveCoaching={liveCoaching} />

      <AICueOverlay wsOn={wsOn} />

      {/* Main recording viewport */}
      <div className="flex-1 relative overflow-hidden">
        {displayStream && <ZoomCanvas stream={displayStream} wsOn={wsOn} />}
        {audioStream && <CameraPreview />}
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
          />
        </div>
      </div>

      {/* Teleprompter — shows if there's a script and toggled on */}
      {showTeleprompter && (
        <Teleprompter
          content={teleprompterContent}
          onChange={setTeleprompterContent}
          isRecording={state === "recording"}
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
