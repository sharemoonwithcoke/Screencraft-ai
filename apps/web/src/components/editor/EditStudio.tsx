"use client";

import { useState } from "react";
import type { EditSession } from "@screencraft/shared";
import { EditTimeline } from "./EditTimeline";
import { EditSuggestions } from "./EditSuggestions";
import { Scissors, Film, Subtitles, Download } from "lucide-react";

interface Props {
  recordingId: string;
  editSession: EditSession;
}

type Panel = "suggestions" | "timeline" | "captions" | "export";

export function EditStudio({ recordingId, editSession }: Props) {
  const [activePanel, setActivePanel] = useState<Panel>("suggestions");
  const [session, setSession] = useState<EditSession>(editSession);

  const panels: Array<{ id: Panel; label: string; icon: React.ElementType }> = [
    { id: "suggestions", label: "AI Suggestions", icon: Scissors },
    { id: "timeline", label: "Timeline", icon: Film },
    { id: "captions", label: "Captions", icon: Subtitles as React.ElementType },
    { id: "export", label: "Export", icon: Download },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-white/10 flex flex-col">
        <nav className="p-2 space-y-1">
          {panels.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActivePanel(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                activePanel === id
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {activePanel === "suggestions" && (
          <EditSuggestions
            cuts={session.cuts}
            recordingId={recordingId}
            onApplyCut={(cutId) => {
              setSession((prev) => ({
                ...prev,
                cuts: prev.cuts.map((c) =>
                  c.id === cutId ? { ...c, applied: true } : c
                ),
              }));
            }}
          />
        )}
        {activePanel === "timeline" && (
          <EditTimeline session={session} recordingId={recordingId} />
        )}
        {activePanel === "captions" && (
          <div className="text-slate-400 text-sm">
            Caption editor — subtitle SRT generation via Gemini transcript.
          </div>
        )}
        {activePanel === "export" && (
          <ExportPanel recordingId={recordingId} />
        )}
      </div>
    </div>
  );
}

function ExportPanel({ recordingId }: { recordingId: string }) {
  const [format, setFormat] = useState<"mp4" | "webm">("mp4");
  const [quality, setQuality] = useState<"720p" | "1080p">("1080p");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    await fetch(`/api/recordings/${recordingId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, quality, includeCaptions: true }),
    });
    setExporting(false);
  };

  return (
    <div className="space-y-6 max-w-sm">
      <div>
        <label className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-2 block">
          Format
        </label>
        <div className="flex gap-2">
          {(["mp4", "webm"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                format === f ? "bg-brand-500 text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-2 block">
          Quality
        </label>
        <div className="flex gap-2">
          {(["720p", "1080p"] as const).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                quality === q ? "bg-brand-500 text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50"
      >
        <Download className="w-4 h-4" />
        {exporting ? "Exporting…" : "Export video"}
      </button>
    </div>
  );
}
