"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Monitor, AppWindow, Crop, Circle, LayoutDashboard, RotateCcw } from "lucide-react";
import { RecorderControls } from "./RecorderControls";
import { CameraPreview } from "./CameraPreview";
import { Teleprompter } from "./Teleprompter";
import { WaveformPreview } from "./WaveformPreview";
import { AICueOverlay } from "./AICueOverlay";
import { ZoomCanvas } from "./ZoomCanvas";
import { useRecorder } from "@/hooks/useRecorder";
import { useWebSocket } from "@/hooks/useWebSocket";
import { cn } from "@/lib/cn";

const REGION_OPTIONS = [
  { value: "fullscreen", label: "Full screen", icon: Monitor, desc: "Capture your entire display" },
  { value: "window",     label: "Window",      icon: AppWindow, desc: "Select a specific app window" },
  { value: "custom",     label: "Custom area", icon: Crop,      desc: "Draw a custom capture region" },
] as const;

/**
 * RecorderShell — top-level compositor for the recording experience.
 * Manages media stream acquisition and wires up all sub-components.
 *
 * Three screen states:
 *  idle    → pre-recording start screen
 *  recording/paused → live recording view with bottom dock
 *  stopped → post-recording summary screen
 */
export function RecorderShell() {
  const router = useRouter();
  const { status } = useSession();

  // Redirect to login if not authenticated
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

  const { on: wsOn, sendChunk } = useWebSocket(recordingId);

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
    const res = await fetch("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled recording", region }),
    });
    const { data } = await res.json();
    setRecordingId(data.id);

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 60 },
      audio: false,
    });
    const audio = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    setDisplayStream(display);
    setAudioStream(audio);
    await start(display, audio);
  }, [region, start]);

  const handleStop = useCallback(async () => {
    stop();
    if (recordingId) {
      await fetch(`/api/recordings/${recordingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing" }),
      });
    }
  }, [stop, recordingId]);

  const handleReset = useCallback(() => {
    setDisplayStream(null);
    setAudioStream(null);
    setRecordingId(null);
    reset();
  }, [reset]);

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
        {/* Top bar */}
        <div className="flex items-center px-6 py-4 border-b border-white/10">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </button>
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-10">
          {/* Title */}
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
          {/* Status icon */}
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
      {/* Top bar — back button, dimmed during active recording */}
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
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            Recording in progress
          </div>
        )}
      </div>

      {/* AI cue overlay */}
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
