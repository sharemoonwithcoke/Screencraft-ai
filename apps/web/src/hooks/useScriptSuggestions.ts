"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { RecordingGoals } from "@screencraft/shared";
import { useScreenCapture } from "./useScreenCapture";

const MIN_INTERVAL_MS   = 12_000; // min gap between Gemini calls
const PAUSE_TRIGGER_MS  =  2_000; // silence before triggering on pause
const CHANGE_THRESHOLD  =   0.12; // pixel-diff fraction that counts as "significant"
const POLL_MS           =  1_000; // how often to check for triggers

interface Options {
  stream:        MediaStream | null;
  isRecording:   boolean;
  ccTranscript:  string;
  ccEnabled:     boolean;
  scriptContent: string;
  goals:         RecordingGoals;
  onSentence:    (sentence: string) => void;
}

export function useScriptSuggestions({
  stream, isRecording, ccTranscript, ccEnabled, scriptContent, goals, onSentence,
}: Options): { isGenerating: boolean } {
  const { captureJpeg, getFrameDiff } = useScreenCapture(stream);
  const [isGenerating, setIsGenerating] = useState(false);

  const lastTriggerRef      = useRef(0);
  const inFlightRef         = useRef(false);
  const lastTranscriptRef   = useRef(ccTranscript);
  const lastTranscriptTimeRef = useRef(Date.now());
  const pollRef             = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable refs so the setInterval closure always reads the latest props
  const transcriptRef  = useRef(ccTranscript);
  const scriptRef      = useRef(scriptContent);
  const goalsRef       = useRef(goals);
  const onSentenceRef  = useRef(onSentence);

  useEffect(() => { transcriptRef.current = ccTranscript; }, [ccTranscript]);
  useEffect(() => { scriptRef.current     = scriptContent; }, [scriptContent]);
  useEffect(() => { goalsRef.current      = goals; }, [goals]);
  useEffect(() => { onSentenceRef.current = onSentence; }, [onSentence]);

  // Detect speech pauses via transcript staleness
  useEffect(() => {
    if (ccTranscript !== lastTranscriptRef.current) {
      lastTranscriptRef.current   = ccTranscript;
      lastTranscriptTimeRef.current = Date.now();
    }
  }, [ccTranscript]);

  const trigger = useCallback(async (reason: "change" | "pause") => {
    if (inFlightRef.current) return;
    const now = Date.now();
    if (now - lastTriggerRef.current < MIN_INTERVAL_MS) return;

    lastTriggerRef.current = now;
    inFlightRef.current    = true;
    setIsGenerating(true);

    try {
      const blob = await captureJpeg(0.7);
      if (!blob) return;

      const fd = new FormData();
      fd.append("screenshot", blob, "frame.jpg");
      fd.append("transcript",
        transcriptRef.current.slice(-300));
      fd.append("script",
        scriptRef.current.split("\n").filter(Boolean).slice(-5).join("\n"));
      fd.append("goals",   JSON.stringify(goalsRef.current));
      fd.append("trigger", reason);

      const res = await fetch("/api/ai/script-suggest", { method: "POST", body: fd });
      if (!res.ok || !res.body) return;

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop()!;
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(part.slice(6)) as { sentence?: string };
            if (parsed.sentence?.trim()) onSentenceRef.current(parsed.sentence.trim());
          } catch { /* malformed SSE chunk — ignore */ }
        }
      }
    } finally {
      inFlightRef.current = false;
      setIsGenerating(false);
    }
  }, [captureJpeg]);

  useEffect(() => {
    if (!isRecording || !stream) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    // Baseline comparison frame so first check doesn't spuriously fire
    getFrameDiff();

    pollRef.current = setInterval(async () => {
      const diff      = await getFrameDiff();
      const pausedMs  = ccEnabled ? Date.now() - lastTranscriptTimeRef.current : 0;

      if (diff > CHANGE_THRESHOLD) {
        trigger("change");
      } else if (ccEnabled && pausedMs > PAUSE_TRIGGER_MS) {
        trigger("pause");
      }
    }, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isRecording, stream, ccEnabled, getFrameDiff, trigger]);

  return { isGenerating };
}
