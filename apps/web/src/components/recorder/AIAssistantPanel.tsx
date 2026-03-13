"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";

// ── VU-meter bars (animated frequency visualizer) ─────────────────────────────
function VUBars({ level, colorClass }: { level: number; colorClass: string }) {
  const [heights, setHeights] = useState(() => Array.from({ length: 7 }, () => 0.3));

  useEffect(() => {
    const interval = setInterval(() => {
      setHeights((prev) =>
        prev.map((_, i) => {
          const base = level;
          const variance = (Math.random() - 0.5) * 0.3;
          const stagger = Math.sin(Date.now() / 300 + i) * 0.15;
          return Math.max(0.1, Math.min(1, base + variance + stagger));
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

// ── Emoji indicator row ────────────────────────────────────────────────────────
interface IndicatorProps {
  label: string;
  emojis: [string, string, string]; // bad, mid, good
  level: number; // 0=bad, 0.5=mid, 1=good
}

function Indicator({ label, emojis, level }: IndicatorProps) {
  const index = level < 0.35 ? 0 : level < 0.65 ? 1 : 2;
  const barColor = level < 0.35 ? "bg-red-500" : level < 0.65 ? "bg-yellow-400" : "bg-green-400";

  return (
    <div className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 flex flex-col gap-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{label}</p>
      <div className="flex justify-between items-center">
        {emojis.map((e, i) => (
          <span
            key={i}
            className={cn(
              "text-base transition-all duration-300",
              i === index ? "opacity-100 scale-125" : "opacity-25 scale-90"
            )}
          >
            {e}
          </span>
        ))}
      </div>
      <VUBars level={level} colorClass={barColor} />
    </div>
  );
}

// ── AI state machine types ────────────────────────────────────────────────────
type AIState = "recording" | "drift_warning" | "generating" | "script_ready";

const COACHING_MSGS = [
  "You're on track — keep going!",
  "Good pacing. Remember to pause after key points.",
  "Strong energy. Try making eye contact with the camera.",
  "You're covering the content well. Stay focused.",
];

const MOCK_GENERATED_SCRIPT = `Based on what you've said so far, here's a suggested continuation:

"To summarise, the key points we've covered are:
1. The core value proposition for our users
2. How our approach differs from competitors
3. The roadmap for the next quarter

Let me now walk you through a quick demo..."`;

// ── Main component ─────────────────────────────────────────────────────────────
interface Props {
  isRecording: boolean;
  elapsed: string; // "MM:SS" from useRecorder
}

export function AIAssistantPanel({ isRecording, elapsed }: Props) {
  const [open, setOpen] = useState(true);
  const [aiState, setAIState] = useState<AIState>("recording");
  const [aiText, setAIText] = useState(COACHING_MSGS[0]);
  const [confidence, setConfidence] = useState(0.75);
  const [rate, setRate] = useState(0.70);
  const [driftWarningAt, setDriftWarningAt] = useState<number | null>(null);
  const coachingIdx = useRef(0);
  const elapsedSecsRef = useRef(0);

  // Parse elapsed "MM:SS" → seconds
  useEffect(() => {
    const parts = elapsed.split(":").map(Number);
    elapsedSecsRef.current = parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 3600 + parts[1] * 60 + parts[2];
  }, [elapsed]);

  // Simulate confidence + rate drift over time
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setConfidence((c) => Math.max(0.3, Math.min(1, c + (Math.random() - 0.52) * 0.08)));
      setRate((r) => Math.max(0.25, Math.min(1, r + (Math.random() - 0.5) * 0.06)));
    }, 2500);
    return () => clearInterval(interval);
  }, [isRecording]);

  // AI state machine: coaching messages → drift warning → script gen
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      const secs = elapsedSecsRef.current;

      if (aiState === "recording") {
        // Rotate coaching messages every 20s
        if (secs > 0 && secs % 20 < 2) {
          coachingIdx.current = (coachingIdx.current + 1) % COACHING_MSGS.length;
          setAIText(COACHING_MSGS[coachingIdx.current]);
        }
        // Trigger drift warning after 40s
        if (secs >= 40 && !driftWarningAt) {
          setAIState("drift_warning");
          setDriftWarningAt(secs);
          setAIText(
            "⚠️ Topic drift detected — you appear to be straying from your script.\n\nRefocus on the main topic, or I'll generate a continuation in 20 seconds."
          );
        }
      }

      if (aiState === "drift_warning" && driftWarningAt !== null) {
        if (secs - driftWarningAt >= 20) {
          setAIState("generating");
          setAIText("Generating script from your current content…");
          setTimeout(() => {
            setAIState("script_ready");
            setAIText(MOCK_GENERATED_SCRIPT);
          }, 2500);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording, aiState, driftWarningAt]);

  const dismissDrift = useCallback(() => {
    setAIState("recording");
    setDriftWarningAt(null);
    setAIText(COACHING_MSGS[coachingIdx.current]);
  }, []);

  // ── Collapsed: just floating icon ──────────────────────────────────────────
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

  // ── Expanded panel ──────────────────────────────────────────────────────────
  return (
    <div className="fixed right-4 bottom-24 z-40 w-72 bg-slate-900/97 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-400" />
          <span className="text-xs font-semibold text-white uppercase tracking-wider">AI Assistant</span>
          {(aiState === "drift_warning" || aiState === "generating") && (
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full font-medium">Alert</span>
          )}
        </div>
        <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Meters */}
      <div className="flex gap-2 px-3 pt-3">
        <Indicator label="Confidence" emojis={["😟", "😐", "😊"]} level={confidence} />
        <Indicator label="Speech rate" emojis={["🐢", "👍", "🐇"]} level={rate} />
      </div>

      {/* AI text area */}
      <div className={cn(
        "mx-3 mt-2 mb-3 rounded-xl p-3 text-xs leading-relaxed flex-1 min-h-[120px] max-h-48 overflow-y-auto whitespace-pre-wrap transition-colors duration-300",
        aiState === "drift_warning" ? "bg-amber-500/10 border border-amber-500/30 text-amber-200" :
        aiState === "generating" ? "bg-brand-500/10 border border-brand-500/20 text-brand-300 animate-pulse" :
        aiState === "script_ready" ? "bg-green-500/10 border border-green-500/20 text-green-200" :
        "bg-white/5 border border-white/10 text-slate-300"
      )}>
        {aiText}
      </div>

      {/* Drift action buttons */}
      {aiState === "drift_warning" && (
        <div className="flex gap-2 px-3 pb-3">
          <button
            onClick={dismissDrift}
            className="flex-1 text-xs py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-colors"
          >
            I'm on track
          </button>
          <button
            onClick={() => {
              setAIState("generating");
              setAIText("Generating script from your current content…");
              setTimeout(() => {
                setAIState("script_ready");
                setAIText(MOCK_GENERATED_SCRIPT);
              }, 2000);
            }}
            className="flex-1 text-xs py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white transition-colors"
          >
            Generate script
          </button>
        </div>
      )}
    </div>
  );
}
