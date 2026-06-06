"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart2, AlertCircle, Loader2, ChevronRight, RefreshCw, X, XCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AnalysisReport, IssueTag } from "@screencraft/shared";

interface Props {
  recordingId: string;
  initialStatus: string;
  initialReport: AnalysisReport | null;
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-700 tabular-nums w-12 text-right">
        {value}/{max}
      </span>
    </div>
  );
}

const tagConfig: Record<IssueTag, { label: string; icon: React.ElementType; color: string }> = {
  critical:   { label: "Critical",    icon: XCircle,       color: "text-red-500 bg-red-50 border-red-200" },
  warning:    { label: "Warning",     icon: AlertTriangle, color: "text-amber-600 bg-amber-50 border-amber-200" },
  suggestion: { label: "Suggestion",  icon: Info,          color: "text-blue-600 bg-blue-50 border-blue-200" },
};

function ReportModal({ report, onClose }: { report: AnalysisReport; onClose: () => void }) {
  const totalColor =
    report.score.total >= 80 ? "text-green-600" :
    report.score.total >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <BarChart2 className="w-5 h-5 text-brand-500" />
            <h2 className="text-lg font-semibold text-slate-900">Quality Analysis Report</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Score overview */}
        <div className="flex items-center gap-8 px-6 pt-6 pb-4">
          <div className="text-center shrink-0">
            <div className={cn("text-6xl font-bold tabular-nums", totalColor)}>
              {report.score.total}
            </div>
            <div className="text-xs text-slate-400 mt-1">/ 100</div>
          </div>
          <div className="flex-1 space-y-2.5">
            <ScoreBar label="Speech Clarity"    value={report.score.speechClarity}    max={30} />
            <ScoreBar label="Content Coverage"  value={report.score.contentCoverage}  max={25} />
            <ScoreBar label="Presentation Flow" value={report.score.presentationFlow} max={20} />
            <ScoreBar label="Visual Quality"    value={report.score.visualQuality}    max={15} />
            <ScoreBar label="Opening / Closing" value={report.score.openingClosing}   max={10} />
          </div>
        </div>

        {/* Speech stats */}
        {report.speechStats && (
          <div className="mx-6 mb-4 grid grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">Avg speed</p>
              <p className="text-base font-semibold text-slate-800">{report.speechStats.avgWpm} WPM</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">Long pauses</p>
              <p className="text-base font-semibold text-slate-800">{report.speechStats.pauseCount}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">Content coverage</p>
              <p className="text-base font-semibold text-slate-800">{report.contentCoveragePercent ?? "—"}%</p>
            </div>
          </div>
        )}

        {/* All issues */}
        {report.issues.length > 0 && (
          <div className="px-6 pb-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
              All issues ({report.issues.length})
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {report.issues.map((issue, i) => {
                const cfg = tagConfig[issue.tag] ?? tagConfig.suggestion;
                const Icon = cfg.icon;
                const ts = `${Math.floor(issue.timestampMs / 60000)}:${String(Math.floor((issue.timestampMs % 60000) / 1000)).padStart(2, "0")}`;
                return (
                  <div key={i} className={cn("flex items-start gap-3 p-3 rounded-xl border text-sm", cfg.color)}>
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{issue.title}</span>
                        <span className="text-xs font-mono opacity-60">{ts}</span>
                      </div>
                      {issue.description && (
                        <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{issue.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AnalysisCard({ recordingId, initialStatus, initialReport }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [report, setReport] = useState<AnalysisReport | null>(initialReport);
  const [showModal, setShowModal] = useState(false);

  // Poll recording status while processing
  useEffect(() => {
    if (status !== "processing") return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/recordings/${recordingId}`);
        if (!res.ok) return;
        const { data } = await res.json();
        if (data?.status && data.status !== "processing") {
          setStatus(data.status);
          if (data.status === "ready") {
            const rRes = await fetch(`/api/recordings/${recordingId}/analyze/report`);
            if (rRes.ok) {
              const { data: rData } = await rRes.json();
              setReport(rData ?? null);
            }
          }
        }
      } catch { /* ignore */ }
    };
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [status, recordingId]);

  // When status is already "ready" but the server-side render didn't have the
  // report yet (race condition or cold Lambda instance), keep polling until we
  // get it. Stops automatically once report is populated.
  useEffect(() => {
    if (status !== "ready" || report !== null) return;
    const fetchReport = async () => {
      try {
        const rRes = await fetch(`/api/recordings/${recordingId}/analyze/report`);
        if (rRes.ok) {
          const { data } = await rRes.json();
          if (data) setReport(data);
        }
      } catch { /* ignore */ }
    };
    fetchReport();
    const id = setInterval(fetchReport, 2000);
    return () => clearInterval(id);
  }, [status, report, recordingId]);

  const retry = useCallback(async () => {
    setStatus("processing");
    try {
      await fetch(`/api/recordings/${recordingId}/analyze`, { method: "POST" });
    } catch { /* ignore */ }
  }, [recordingId]);

  // ── Processing ───────────────────────────────────────────────────────────
  if (status === "processing") {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
          <div>
            <p className="font-semibold text-sm text-blue-800">AI analysis is running…</p>
            <p className="text-xs text-blue-600 mt-0.5">Scores and suggestions will appear here automatically (~15 s)</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm text-red-800">Analysis failed</p>
            <p className="text-xs text-red-600 mt-0.5">Check that GEMINI_API_KEY is set in .env.local</p>
          </div>
          <button
            onClick={retry}
            className="flex items-center gap-1.5 text-xs font-medium text-red-700 hover:text-red-900 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-xl transition-all duration-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Ready with report ────────────────────────────────────────────────────
  if (status === "ready" && report) {
    const totalColor =
      report.score.total >= 80 ? "text-green-600" :
      report.score.total >= 60 ? "text-amber-600" : "text-red-600";

    const topIssues = report.issues
      .filter((i) => i.tag === "critical" || i.tag === "warning")
      .slice(0, 3);

    return (
      <>
        {showModal && <ReportModal report={report} onClose={() => setShowModal(false)} />}

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Score header */}
          <div className="flex items-center gap-6 px-6 pt-6 pb-4">
            <div className="text-center shrink-0">
              <div className={cn("text-5xl font-bold tabular-nums", totalColor)}>
                {report.score.total}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">/ 100</div>
            </div>
            <div className="flex-1 space-y-2">
              <ScoreBar label="Speech Clarity"    value={report.score.speechClarity}    max={30} />
              <ScoreBar label="Content Coverage"  value={report.score.contentCoverage}  max={25} />
              <ScoreBar label="Presentation Flow" value={report.score.presentationFlow} max={20} />
              <ScoreBar label="Visual Quality"    value={report.score.visualQuality}    max={15} />
              <ScoreBar label="Opening / Closing" value={report.score.openingClosing}   max={10} />
            </div>
          </div>

          {/* Top issues */}
          {topIssues.length > 0 && (
            <div className="px-6 pb-4 space-y-1.5">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Key issues</p>
              {topIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className={cn(
                    "mt-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0",
                    issue.tag === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  )}>
                    {Math.floor(issue.timestampMs / 60000)}:{String(Math.floor((issue.timestampMs % 60000) / 1000)).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-slate-700">{issue.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* CTA — opens modal, no navigation */}
          <button
            onClick={() => setShowModal(true)}
            className="w-full flex items-center justify-between px-6 py-4 bg-slate-50 hover:bg-slate-100 border-t border-slate-200 text-sm font-medium text-slate-700 hover:text-brand-600 transition-all duration-200 group"
          >
            <span>View full report — {report.issues.length} issue{report.issues.length !== 1 ? "s" : ""} found</span>
            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-200" />
          </button>
        </div>
      </>
    );
  }

  // ── Ready but no report ──────────────────────────────────────────────────
  if (status === "ready") {
    return (
      <div className="flex items-center gap-4 bg-green-50 border border-green-200 text-green-800 rounded-2xl p-5">
        <BarChart2 className="w-5 h-5 text-green-600 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold text-sm">Analysis complete</p>
          <p className="text-xs text-green-700 mt-0.5">Loading report…</p>
        </div>
        <Loader2 className="w-4 h-4 text-green-600 animate-spin shrink-0" />
      </div>
    );
  }

  return null;
}
