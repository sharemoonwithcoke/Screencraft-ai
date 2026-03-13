"use client";

import { useEffect } from "react";
import { useTeleprompter } from "@/hooks/useTeleprompter";
import { cn } from "@/lib/cn";
import { Play, Pause, X } from "lucide-react";
import type { ServerToClientEvent } from "@screencraft/shared";

interface Props {
  content: string;
  onChange: (v: string) => void;
  isRecording: boolean;
  wsOn: <E extends ServerToClientEvent["event"]>(
    event: E,
    handler: (event: Extract<ServerToClientEvent, { event: E }>) => void
  ) => () => void;
}

/**
 * Teleprompter — rendered OUTSIDE the recording area (fixed bottom panel).
 * The AI highlights missed lines in real time via WebSocket events.
 */
export function Teleprompter({ content, onChange, isRecording, wsOn }: Props) {
  const { containerRef, lines, missedLines, spokenLineIndex, isScrolling, startAutoScroll, stopAutoScroll, markLineMissed } =
    useTeleprompter({ content });

  // Subscribe to AI missed-line events
  useEffect(() => {
    const off = wsOn("ai:teleprompter:miss", (e) => {
      markLineMissed(e.payload.lineIndex);
    });
    return off;
  }, [wsOn, markLineMissed]);

  // Auto-start scroll when recording begins
  useEffect(() => {
    if (isRecording && content.trim()) {
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  }, [isRecording, content, startAutoScroll, stopAutoScroll]);

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-[560px] z-40 bg-slate-900/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-xl shadow-black/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Teleprompter
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={isScrolling ? stopAutoScroll : startAutoScroll}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all duration-200"
          >
            {isScrolling ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Content — not recording mode: text area for editing */}
      {!isRecording ? (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your script here. The AI will track your progress while you record…"
          className="w-full h-40 bg-transparent text-sm text-slate-300 placeholder-slate-600 p-4 resize-none focus:outline-none font-mono leading-relaxed"
        />
      ) : (
        /* Recording mode: read-only scrolling display */
        <div
          ref={containerRef}
          className="h-40 overflow-y-auto p-4 space-y-1 scroll-smooth"
        >
          {lines.map((line, i) => (
            <p
              key={i}
              className={cn(
                "text-sm leading-relaxed font-mono transition-colors duration-300",
                missedLines.has(i)
                  ? "text-red-400 bg-red-400/10 rounded-lg px-2 -mx-2"
                  : i <= spokenLineIndex
                  ? "text-slate-600 line-through decoration-slate-700"
                  : "text-slate-300"
              )}
            >
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
