"use client";

import { useState, useRef, useCallback } from "react";
import { RecorderControls } from "./RecorderControls";
import { CameraPreview } from "./CameraPreview";
import { Teleprompter } from "./Teleprompter";
import { WaveformPreview } from "./WaveformPreview";
import { AICueOverlay } from "./AICueOverlay";
import { ZoomCanvas } from "./ZoomCanvas";
import { useRecorder } from "@/hooks/useRecorder";
import { useWebSocket } from "@/hooks/useWebSocket";

/**
 * RecorderShell — top-level compositor for the recording experience.
 * Manages media stream acquisition and wires up all sub-components.
 */
export function RecorderShell() {
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
          if (recordingId) {
            sendChunk(blob, index, recordingId);
          }
        },
        [recordingId, sendChunk]
      ),
    });

  const handleStart = useCallback(async () => {
    // 1. Create recording session via API
    const res = await fetch("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled recording", region }),
    });
    const { data } = await res.json();
    setRecordingId(data.id);

    // 2. Acquire display stream
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 60 },
      audio: false,
    });

    // 3. Acquire audio stream
    const audio = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    setDisplayStream(display);
    setAudioStream(audio);

    // 4. Start MediaRecorder
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

  return (
    <div className="relative min-h-screen bg-slate-950 flex flex-col">
      {/* AI cue overlay — edge overlays, never interrupts recording */}
      <AICueOverlay wsOn={wsOn} />

      {/* Main recording viewport */}
      <div className="flex-1 relative overflow-hidden">
        {displayStream ? (
          <ZoomCanvas stream={displayStream} wsOn={wsOn} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-slate-500 text-sm">
              Press "Start" to begin recording
            </p>
          </div>
        )}

        {/* Camera picture-in-picture */}
        {audioStream && (
          <CameraPreview />
        )}
      </div>

      {/* Bottom dock */}
      <div className="relative z-10 bg-slate-900/90 backdrop-blur-md border-t border-white/10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-6">
          {/* Waveform */}
          {audioStream && (
            <WaveformPreview stream={audioStream} isRecording={state === "recording"} />
          )}

          {/* Controls */}
          <RecorderControls
            state={state}
            elapsed={elapsed}
            region={region}
            onRegionChange={setRegion}
            onStart={handleStart}
            onPause={pause}
            onResume={resume}
            onStop={handleStop}
            onReset={reset}
            onToggleTeleprompter={() => setShowTeleprompter((v) => !v)}
          />
        </div>
      </div>

      {/* Teleprompter panel — outside recording area */}
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
