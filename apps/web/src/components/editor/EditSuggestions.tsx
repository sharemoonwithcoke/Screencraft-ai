"use client";

import type { Cut } from "@screencraft/shared";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  cuts: Cut[];
  recordingId: string;
  onApplyCut: (cutId: string) => void;
}

export function EditSuggestions({ cuts, recordingId, onApplyCut }: Props) {
  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const pending = cuts.filter((c) => !c.applied);
  const applied = cuts.filter((c) => c.applied);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">
          Pending suggestions ({pending.length})
        </h3>
        <div className="space-y-2">
          {pending.map((cut) => (
            <div
              key={cut.id}
              className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono text-slate-400">
                    {formatTime(cut.startMs)} → {formatTime(cut.endMs)}
                  </span>
                  <span className="text-xs text-slate-500">
                    ({Math.round((cut.endMs - cut.startMs) / 1000)}s)
                  </span>
                </div>
                <p className="text-sm text-slate-300">{cut.reason}</p>
              </div>
              <button
                onClick={() => onApplyCut(cut.id)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium transition-all duration-200"
              >
                <Check className="w-3 h-3" />
                Apply
              </button>
            </div>
          ))}
          {pending.length === 0 && (
            <p className="text-sm text-slate-500 py-4 text-center">
              All suggestions applied
            </p>
          )}
        </div>
      </div>

      {applied.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-500 mb-3">
            Applied ({applied.length})
          </h3>
          <div className="space-y-2">
            {applied.map((cut) => (
              <div
                key={cut.id}
                className="flex items-center gap-3 bg-white/3 border border-white/5 rounded-xl p-3 opacity-50"
              >
                <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono text-slate-500">
                    {formatTime(cut.startMs)} → {formatTime(cut.endMs)}
                  </span>
                  <p className="text-sm text-slate-400">{cut.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
