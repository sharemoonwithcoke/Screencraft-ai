"use client";

import { useRef, useState, useCallback } from "react";

export type RecorderState = "idle" | "recording" | "paused" | "stopped";

interface UseRecorderOptions {
  onChunk?: (blob: Blob, index: number) => void;
  /** Called with the complete recording blob once the recorder fully stops. */
  onStop?: (blob: Blob) => void;
  chunkIntervalMs?: number;
}

export function useRecorder({
  onChunk,
  onStop,
  chunkIntervalMs = 5000,
}: UseRecorderOptions = {}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("video/webm");

  // Use refs for callbacks so start/stop never need to be recreated when
  // the caller's closures change (e.g. recordingId updating after fetch).
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  const startTimer = useCallback(() => {
    // Guard: never have two timers running at once
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSecs((s) => s + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (displayStream: MediaStream, audioStream?: MediaStream) => {
      try {
        const combined = new MediaStream([
          ...displayStream.getVideoTracks(),
          ...(audioStream?.getAudioTracks() ?? []),
        ]);
        streamRef.current = combined;

        const MIME_PRIORITY = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4;codecs=h264,aac",
          "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
          "video/mp4",
        ];
        const mimeType = MIME_PRIORITY.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
        mimeTypeRef.current = mimeType;

        const recorder = new MediaRecorder(combined, { mimeType });
        mediaRecorderRef.current = recorder;
        chunkIndexRef.current = 0;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
            onChunkRef.current?.(e.data, chunkIndexRef.current++);
          }
        };

        recorder.onstop = () => {
          const blob =
            chunksRef.current.length > 0
              ? new Blob(chunksRef.current, { type: mimeTypeRef.current })
              : null;
          if (blob) onStopRef.current?.(blob);
        };

        recorder.start(chunkIntervalMs);
        setState("recording");
        startTimer();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [chunkIntervalMs, startTimer]
  );

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setState("paused");
      stopTimer();
    }
  }, [stopTimer]);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setState("recording");
      startTimer();
    }
  }, [startTimer]);

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already stopped (e.g. all tracks ended and browser auto-stopped it)
      }
    }
    // Stop all combined stream tracks to turn off OS recording indicators
    streamRef.current?.getTracks().forEach((t) => t.stop());
    stopTimer();
    setState("stopped");
  }, [stopTimer]);

  const reset = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    stopTimer();
    chunksRef.current = [];
    setElapsedSecs(0);
    chunkIndexRef.current = 0;
    setError(null);
    setState("idle");
  }, [stopTimer]);

  const formatElapsed = useCallback(() => {
    const h = Math.floor(elapsedSecs / 3600);
    const m = Math.floor((elapsedSecs % 3600) / 60);
    const s = elapsedSecs % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [elapsedSecs]);

  return {
    state,
    elapsedSecs,
    elapsed: formatElapsed(),
    error,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
