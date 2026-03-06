"use client";

import { Circle, Pause, Play, Square, RotateCcw, Monitor, AlignLeft } from "lucide-react";
import type { RecorderState } from "@/hooks/useRecorder";
import { cn } from "@/lib/cn";

interface Props {
  state: RecorderState;
  elapsed: string;
  region: "fullscreen" | "window" | "custom";
  onRegionChange: (r: "fullscreen" | "window" | "custom") => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
  onToggleTeleprompter: () => void;
}

const regionLabels = {
  fullscreen: "Full screen",
  window: "Window",
  custom: "Custom",
};

export function RecorderControls({
  state,
  elapsed,
  region,
  onRegionChange,
  onStart,
  onPause,
  onResume,
  onStop,
  onReset,
  onToggleTeleprompter,
}: Props) {
  return (
    <div className="flex items-center gap-4 flex-1 justify-between">
      {/* Region selector */}
      <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1">
        {(["fullscreen", "window", "custom"] as const).map((r) => (
          <button
            key={r}
            onClick={() => onRegionChange(r)}
            disabled={state !== "idle"}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-40",
              region === r
                ? "bg-white text-slate-900"
                : "text-slate-400 hover:text-white"
            )}
          >
            {regionLabels[r]}
          </button>
        ))}
      </div>

      {/* Primary controls */}
      <div className="flex items-center gap-3">
        {/* Timer */}
        {state !== "idle" && (
          <div className="flex items-center gap-2 font-mono text-sm text-white">
            {state === "recording" && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
            {elapsed}
          </div>
        )}

        {state === "idle" && (
          <button
            onClick={onStart}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 shadow-md shadow-red-500/30"
          >
            <Circle className="w-4 h-4 fill-white" />
            Record
          </button>
        )}

        {state === "recording" && (
          <>
            <button
              onClick={onPause}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all duration-200"
            >
              <Pause className="w-5 h-5" />
            </button>
            <button
              onClick={onStop}
              className="p-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-all duration-200"
            >
              <Square className="w-5 h-5" />
            </button>
          </>
        )}

        {state === "paused" && (
          <>
            <button
              onClick={onResume}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all duration-200"
            >
              <Play className="w-5 h-5" />
            </button>
            <button
              onClick={onStop}
              className="p-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-all duration-200"
            >
              <Square className="w-5 h-5" />
            </button>
          </>
        )}

        {state === "stopped" && (
          <button
            onClick={onReset}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
          >
            <RotateCcw className="w-4 h-4" />
            New recording
          </button>
        )}
      </div>

      {/* Teleprompter toggle */}
      <button
        onClick={onToggleTeleprompter}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-medium transition-all duration-200"
      >
        <AlignLeft className="w-4 h-4" />
        Script
      </button>
    </div>
  );
}
