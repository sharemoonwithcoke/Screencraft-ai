"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { ServerToClientEvent } from "@screencraft/shared";

interface Props {
  wsOn: <E extends ServerToClientEvent["event"]>(
    event: E,
    handler: (event: Extract<ServerToClientEvent, { event: E }>) => void
  ) => () => void;
}

interface Cue {
  id: string;
  type: "fast" | "slow" | "pause" | "filler" | "monotone";
  message: string;
}

/**
 * Non-intrusive AI cue overlays displayed at the screen edge.
 * Never interrupts the recording flow — purely visual signals.
 */
export function AICueOverlay({ wsOn }: Props) {
  const [cues, setCues] = useState<Cue[]>([]);
  const [edgePulse, setEdgePulse] = useState<"orange" | "blue" | null>(null);
  const [blurActive, setBlurActive] = useState(false);

  const addCue = (cue: Omit<Cue, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setCues((prev) => [...prev.slice(-2), { ...cue, id }]); // max 3 cues
    setTimeout(() => {
      setCues((prev) => prev.filter((c) => c.id !== id));
    }, 5000);
  };

  useEffect(() => {
    const offs = [
      wsOn("ai:speech:rate", (e) => {
        if (e.payload.level === "fast") {
          setEdgePulse("orange");
          addCue({ type: "fast", message: "Slow down a bit" });
          setTimeout(() => setEdgePulse(null), 6000);
        } else if (e.payload.level === "slow") {
          setEdgePulse("blue");
          addCue({ type: "slow", message: "Pick up the pace" });
          setTimeout(() => setEdgePulse(null), 6000);
        }
      }),

      wsOn("ai:pause:detected", (e) => {
        if (e.payload.durationMs > 3000) {
          addCue({ type: "pause", message: "Still going? 🎙️" });
        }
      }),

      wsOn("ai:filler:detected", (e) => {
        addCue({
          type: "filler",
          message: `"${e.payload.word}" × ${e.payload.count}`,
        });
      }),

      wsOn("ai:monotone:detected", (e) => {
        addCue({ type: "monotone", message: e.payload.suggestion });
      }),

      wsOn("ai:blur:toggle", (e) => {
        setBlurActive(e.payload.active);
      }),
    ];

    return () => offs.forEach((off) => off());
  }, [wsOn]);

  return (
    <>
      {/* Edge breathing light — speech too fast (orange) or slow (blue) */}
      {edgePulse && (
        <div
          className={cn(
            "ai-cue-overlay inset-0 rounded-none border-4",
            edgePulse === "orange"
              ? "border-orange-500 animate-pulse-orange"
              : "border-blue-500 animate-pulse-blue"
          )}
        />
      )}

      {/* Thinking-pause blur overlay */}
      {blurActive && (
        <div className="ai-cue-overlay inset-0 backdrop-blur-sm bg-black/20 transition-all duration-500" />
      )}

      {/* Cue bubbles — right edge */}
      <div className="ai-cue-overlay right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2">
        {cues.map((cue) => (
          <div
            key={cue.id}
            className={cn(
              "px-3 py-2 rounded-xl text-xs font-medium text-white shadow-lg animate-slide-up",
              cue.type === "fast" && "bg-orange-500/90",
              cue.type === "slow" && "bg-blue-500/90",
              cue.type === "pause" && "bg-slate-700/90",
              cue.type === "filler" && "bg-purple-500/90",
              cue.type === "monotone" && "bg-teal-600/90"
            )}
          >
            {cue.message}
          </div>
        ))}
      </div>
    </>
  );
}
