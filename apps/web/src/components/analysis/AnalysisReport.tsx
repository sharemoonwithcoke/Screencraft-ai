"use client";

import { useState } from "react";
import type { AnalysisReport as ReportType, IssueTag } from "@screencraft/shared";
import { ScoreCard } from "./ScoreCard";
import { cn } from "@/lib/cn";
import { AlertTriangle, Info, XCircle, Download } from "lucide-react";

interface Props {
  report: ReportType;
}

const tagConfig: Record<IssueTag, { label: string; icon: React.ElementType; color: string }> = {
  critical: { label: "Critical", icon: XCircle, color: "text-red-500 bg-red-50 border-red-200" },
  warning: { label: "Warning", icon: AlertTriangle, color: "text-amber-600 bg-amber-50 border-amber-200" },
  suggestion: { label: "Suggestion", icon: Info, color: "text-blue-600 bg-blue-50 border-blue-200" },
};

export function AnalysisReport({ report }: Props) {
  const [filter, setFilter] = useState<IssueTag | "all">("all");
  const [activeTimestamp, setActiveTimestamp] = useState<number | null>(null);

  const filtered =
    filter === "all"
      ? report.issues
      : report.issues.filter((i) => i.tag === filter);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const counts = {
    critical: report.issues.filter((i) => i.tag === "critical").length,
    warning: report.issues.filter((i) => i.tag === "warning").length,
    suggestion: report.issues.filter((i) => i.tag === "suggestion").length,
  };

  return (
    <div className="space-y-6">
      {/* Score overview */}
      <ScoreCard score={report.score} speechStats={report.speechStats} coveragePercent={report.contentCoveragePercent} />

      {/* Issue filter tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(["all", "critical", "warning", "suggestion"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-200",
                filter === f
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {f === "all" ? `All (${report.issues.length})` : `${tagConfig[f].label} (${counts[f]})`}
            </button>
          ))}
        </div>
        <button className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 transition-colors duration-200">
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {/* Issue list */}
      <div className="space-y-3">
        {filtered.map((issue, i) => {
          const { icon: Icon, color } = tagConfig[issue.tag];
          return (
            <div
              key={i}
              onClick={() => setActiveTimestamp(issue.timestampMs)}
              className={cn(
                "flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-all duration-200 hover:shadow-sm",
                color,
                activeTimestamp === issue.timestampMs && "ring-2 ring-brand-500"
              )}
            >
              <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-sm font-medium">{issue.title}</span>
                  <span className="text-xs font-mono flex-shrink-0 opacity-70">
                    {formatTime(issue.timestampMs)}
                  </span>
                </div>
                <p className="text-xs opacity-80 leading-relaxed">{issue.description}</p>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm">
            No issues in this category
          </div>
        )}
      </div>
    </div>
  );
}
