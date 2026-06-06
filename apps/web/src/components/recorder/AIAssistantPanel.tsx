"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, X, GripVertical, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RecordingGoals } from "@screencraft/shared";

// ── VU-meter bars ─────────────────────────────────────────────────────────────
function VUBars({ level, colorClass }: { level: number; colorClass: string }) {
  const [heights, setHeights] = useState(() => Array.from({ length: 7 }, () => 0.3));

  useEffect(() => {
    const interval = setInterval(() => {
      setHeights((prev) =>
        prev.map((_, i) => {
          const variance = (Math.random() - 0.5) * 0.3;
          const stagger = Math.sin(Date.now() / 300 + i) * 0.15;
          return Math.max(0.1, Math.min(1, level + variance + stagger));
        })
      );
    }, 80);
    return () => clearInterval(interval);
  }, [level]);

  return (
    <div className="flex items-end gap-0.5 h-5">
      {heights.map((h, i) => (
        <div
          key={i}
          className={cn("w-1.5 rounded-sm transition-all duration-75", colorClass)}
          style={{ height: `${Math.round(h * 100)}%`, opacity: h > 0.15 ? 1 : 0.2 }}
        />
      ))}
    </div>
  );
}

// ── Emoji indicator ────────────────────────────────────────────────────────────
function Indicator({ label, emojis, level }: { label: string; emojis: [string, string, string]; level: number }) {
  const index = level < 0.35 ? 0 : level < 0.65 ? 1 : 2;
  const barColor = level < 0.35 ? "bg-red-500" : level < 0.65 ? "bg-yellow-400" : "bg-green-400";
  return (
    <div className="flex-1 bg-slate-100 rounded-xl px-3 py-2.5 flex flex-col gap-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{label}</p>
      <div className="flex justify-between items-center">
        {emojis.map((e, i) => (
          <span key={i} className={cn("text-base transition-all duration-300", i === index ? "opacity-100 scale-125" : "opacity-25 scale-90")}>
            {e}
          </span>
        ))}
      </div>
      <VUBars level={level} colorClass={barColor} />
    </div>
  );
}

type AIState = "recording" | "drift_warning" | "generating" | "script_ready";

const COACHING_MSGS = [
  "You're on track — keep going!",
  "Good pacing. Remember to pause after key points.",
  "Strong energy. Try making eye contact with the camera.",
  "You're covering the content well. Stay focused.",
];

interface Props {
  isRecording: boolean;
  elapsed: string;
  recordingId?: string | null;
  ccTranscript?: string;
  ccWordCount?: number;
  ccAvgConfidence?: number;
  scriptDraft?: string;
  goals?: RecordingGoals;
}

/** Normalize WPM to 0–1 for the rate indicator (🐢 / 👍 / 🐇) */
function wpmToLevel(wpm: number): number {
  if (wpm <= 0) return 0.1;
  if (wpm < 80) return (wpm / 80) * 0.35;
  if (wpm > 220) return Math.min(1, 0.65 + ((wpm - 220) / 200) * 0.35);
  return 0.35 + ((wpm - 80) / 140) * 0.30;
}

export function AIAssistantPanel({ isRecording, elapsed, recordingId, ccTranscript, ccWordCount, ccAvgConfidence, scriptDraft, goals }: Props) {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(288);
  const [height, setHeight] = useState(360);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizing = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const [aiState, setAIState] = useState<AIState>("recording");
  const [aiText, setAIText] = useState(COACHING_MSGS[0]);
  const [confidence, setConfidence] = useState(0.75);
  const [rate, setRate] = useState(0.70);
  const [driftWarningAt, setDriftWarningAt] = useState<number | null>(null);
  const coachingIdx = useRef(0);
  const elapsedSecsRef = useRef(0);

  // Track when speech was last detected (for silence penalty)
  const lastSpeechMs = useRef<number>(Date.now());
  const prevWordCount = useRef<number>(0);

  useEffect(() => {
    const parts = elapsed.split(":").map(Number);
    elapsedSecsRef.current = parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 3600 + parts[1] * 60 + parts[2];
  }, [elapsed]);

  // When CC word count grows or transcript changes → user is speaking
  useEffect(() => {
    if (ccWordCount != null && ccWordCount > prevWordCount.current) {
      lastSpeechMs.current = Date.now();
      prevWordCount.current = ccWordCount;
    }
  }, [ccWordCount]);
  useEffect(() => {
    if (ccTranscript) lastSpeechMs.current = Date.now();
  }, [ccTranscript]);

  // Unified metric update: real CC data with silence penalty, or simulation fallback
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      const ccActive = ccWordCount != null;
      const silenceSecs = (Date.now() - lastSpeechMs.current) / 1000;

      if (ccActive) {
        // ── Speech rate ─────────────────────────────────────────────────────
        // Drop toward 🐢 after 3 s of silence; recover when speaking again
        if (silenceSecs > 3) {
          setRate((r) => Math.max(0.05, r - 0.06));
        } else {
          const secs = elapsedSecsRef.current;
          const wpm = secs > 0 ? (ccWordCount! / secs) * 60 : 0;
          setRate(wpmToLevel(wpm));
        }

        // ── Confidence ──────────────────────────────────────────────────────
        // Silence > 4 s degrades confidence (stuttering / thinking / lost)
        const baseConf = ccAvgConfidence ?? 0.75;
        if (silenceSecs > 4) {
          setConfidence((c) => Math.max(0.18, c - 0.025));
        } else {
          // Recover toward the CC-reported baseline
          setConfidence((c) => c + (baseConf - c) * 0.3);
        }
      } else {
        // ── Simulation fallback when CC is off ──────────────────────────────
        setRate((r) => Math.max(0.25, Math.min(1, r + (Math.random() - 0.5) * 0.06)));
        setConfidence((c) => Math.max(0.3, Math.min(1, c + (Math.random() - 0.52) * 0.08)));
      }
    }, 600);
    return () => clearInterval(interval);
  }, [isRecording, ccWordCount, ccAvgConfidence]);

  // AI state machine: coaching → drift/duration warning
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      const secs = elapsedSecsRef.current;
      const target = goals?.durationTargetSecs;

      if (aiState === "recording") {
        if (secs > 0 && secs % 20 < 2) {
          coachingIdx.current = (coachingIdx.current + 1) % COACHING_MSGS.length;
          setAIText(COACHING_MSGS[coachingIdx.current]);
        }

        // Duration target warning at 80% and 100%
        if (target && !driftWarningAt) {
          const pct = secs / target;
          if (pct >= 1) {
            setAIState("drift_warning");
            setDriftWarningAt(secs);
            setAIText(
              `⏱️ You've reached your ${Math.round(target / 60)}-minute target.\n\nConsider wrapping up to stay on time, or generate a concise closing below.`
            );
            return;
          }
          if (pct >= 0.8) {
            setAIState("drift_warning");
            setDriftWarningAt(secs);
            setAIText(
              `⏱️ 80% of your ${Math.round(target / 60)}-minute target reached.\n\nStart moving toward your conclusion.`
            );
            return;
          }
        }

        // Fallback drift warning after 40 s when no target set
        if (!target && secs >= 40 && !driftWarningAt) {
          setAIState("drift_warning");
          setDriftWarningAt(secs);
          setAIText(
            "⚠️ Topic drift detected — you appear to be straying from your script.\n\nRefocus on the main topic, or generate a continuation below."
          );
        }
      }
      if (aiState === "drift_warning" && driftWarningAt !== null && secs - driftWarningAt >= 30) {
        triggerGenerate(secs);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording, aiState, driftWarningAt, goals]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerGenerate = useCallback(async (secs?: number) => {
    const elapsedSecs = secs ?? elapsedSecsRef.current;
    setAIState("generating");
    setAIText("Generating script from your content…");
    try {
      const res = await fetch("/api/ai/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: recordingId ?? undefined,
          elapsedSecs,
          spokenSoFar: ccTranscript || undefined,
          preparedScript: scriptDraft || undefined,
        }),
      });
      const body = await res.json();
      if (body.ok && body.data?.script) {
        setAIState("script_ready");
        setAIText(body.data.script);
      } else {
        throw new Error(body?.error?.message ?? "Generation failed");
      }
    } catch {
      setAIState("script_ready");
      setAIText("Wrap up by summarising the key features you demonstrated, highlight the main benefit for your audience, and invite them to try it or ask questions.");
    }
  }, [recordingId, ccTranscript, scriptDraft]);

  const dismissDrift = useCallback(() => {
    setAIState("recording");
    setDriftWarningAt(null);
    setAIText(COACHING_MSGS[coachingIdx.current]);
  }, []);

  // ── Resize drag ───────────────────────────────────────────────────────────
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = { startX: e.clientX, startY: e.clientY, startW: width, startH: height };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setWidth(Math.max(220, Math.min(520, resizing.current.startW + (resizing.current.startX - ev.clientX))));
      setHeight(Math.max(260, Math.min(700, resizing.current.startH + (resizing.current.startY - ev.clientY))));
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width, height]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed right-4 bottom-24 z-40 w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-200",
          aiState === "drift_warning" || aiState === "generating"
            ? "bg-amber-500 animate-pulse"
            : "bg-brand-500 hover:bg-brand-600"
        )}
      >
        <Sparkles className="w-5 h-5 text-white" />
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      style={{ width, height, minWidth: 220, minHeight: 260 }}
      className="fixed right-4 bottom-24 z-40 bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden flex flex-col select-none"
    >
      <div
        onMouseDown={onResizeStart}
        className="absolute top-0 left-0 w-6 h-6 flex items-center justify-center cursor-nw-resize z-10 text-slate-300 hover:text-slate-500 transition-colors"
        title="Drag to resize"
      >
        <GripVertical className="w-3 h-3 rotate-45" />
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-500" />
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">AI Assistant</span>
          {(aiState === "drift_warning" || aiState === "generating") && (
            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">Alert</span>
          )}
        </div>
        <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex gap-2 px-3 pt-3 flex-shrink-0">
        <Indicator label="Confidence" emojis={["😟", "😐", "😊"]} level={confidence} />
        <Indicator label="Speech rate" emojis={["🐢", "👍", "🐇"]} level={rate} />
      </div>

      <div className={cn(
        "mx-3 mt-2 mb-3 rounded-xl p-3 text-sm leading-relaxed flex-1 overflow-y-auto whitespace-pre-wrap transition-colors duration-300",
        aiState === "drift_warning"  ? "bg-amber-50 border border-amber-300 text-amber-900"
          : aiState === "generating"  ? "bg-blue-50 border border-blue-200 text-blue-900"
          : aiState === "script_ready"? "bg-green-50 border border-green-300 text-green-900"
          : "bg-slate-50 border border-slate-200 text-slate-800"
      )}>
        {aiState === "generating"
          ? <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{aiText}</span>
          : aiText}
      </div>

      {/* Action buttons */}
      {aiState === "drift_warning" && (
        <div className="flex gap-2 px-3 pb-3 flex-shrink-0">
          <button
            onClick={dismissDrift}
            className="flex-1 text-xs py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
          >
            I&apos;m on track
          </button>
          <button
            onClick={() => triggerGenerate()}
            className="flex-1 text-xs py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-colors"
          >
            Generate script
          </button>
        </div>
      )}

      {/* Manual generate button when coaching */}
      {aiState === "recording" && (
        <div className="px-3 pb-3 flex-shrink-0">
          <button
            onClick={() => triggerGenerate()}
            className="w-full text-xs py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3 h-3" />
            Draft script continuation
          </button>
        </div>
      )}

      {aiState === "script_ready" && (
        <div className="px-3 pb-3 flex-shrink-0">
          <button
            onClick={dismissDrift}
            className="w-full text-xs py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors"
          >
            Back to coaching
          </button>
        </div>
      )}
    </div>
  );
}
