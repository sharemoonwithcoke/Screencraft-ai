"use client";

import { useRef, useState, useCallback } from "react";

export type RecorderState = "idle" | "recording" | "paused" | "stopped";

interface UseRecorderOptions {
  onChunk?: (blob: Blob, index: number) => void;
  chunkIntervalMs?: number; // how often to slice & emit (default 5000ms)
}

export function useRecorder({
  onChunk,
  chunkIntervalMs = 5000,
}: UseRecorderOptions = {}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(
    async (displayStream: MediaStream, audioStream: MediaStream) => {
      try {
        // Merge display + audio tracks
        const combined = new MediaStream([
          ...displayStream.getVideoTracks(),
          ...audioStream.getAudioTracks(),
        ]);
        streamRef.current = combined;

        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm";

        const recorder = new MediaRecorder(combined, { mimeType });
        mediaRecorderRef.current = recorder;
        chunkIndexRef.current = 0;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            onChunk?.(e.data, chunkIndexRef.current++);
          }
        };

        recorder.start(chunkIntervalMs);
        setState("recording");

        // Elapsed timer
        timerRef.current = setInterval(() => {
          setElapsedSecs((s) => s + 1);
        }, 1000);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [onChunk, chunkIntervalMs]
  );

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setState("paused");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setState("recording");
      timerRef.current = setInterval(() => {
        setElapsedSecs((s) => s + 1);
      }, 1000);
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setState("stopped");
  }, []);

  const reset = useCallback(() => {
    stop();
    setElapsedSecs(0);
    chunkIndexRef.current = 0;
    setError(null);
    setState("idle");
  }, [stop]);

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
