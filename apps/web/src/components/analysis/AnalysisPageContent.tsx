"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AnalysisReport } from "./AnalysisReport";
import { AnalysisTrigger } from "./AnalysisTrigger";
import type { AnalysisReport as ReportType } from "@screencraft/shared";

interface Props {
  recordingId: string;
  recordingStatus: string;
  initialReport: ReportType | null;
}

export function AnalysisPageContent({ recordingId, recordingStatus, initialReport }: Props) {
  const [report, setReport] = useState<ReportType | null>(initialReport);
  const [loading, setLoading] = useState(false);

  // If the server didn't have the report (in-memory store was cleared after a
  // hot reload or server restart) but the recording is marked ready, try the
  // API endpoint client-side — it hits the same store but in a fresh request
  // that may have re-hydrated it, or fall back gracefully.
  useEffect(() => {
    if (report) return;
    if (recordingStatus !== "ready") return;

    setLoading(true);
    fetch(`/api/recordings/${recordingId}/analyze/report`)
      .then((r) => r.json())
      .then(({ data }) => { if (data) setReport(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [recordingId, recordingStatus, report]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  if (report) return <AnalysisReport report={report} />;

  return <AnalysisTrigger recordingId={recordingId} />;
}
