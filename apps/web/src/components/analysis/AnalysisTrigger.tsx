"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart2, AlertCircle } from "lucide-react";

interface Props {
  recordingId: string;
}

export function AnalysisTrigger({ recordingId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // The route is synchronous — it awaits Gemini and only responds once
      // status has been updated to "ready" or "error" in the store.
      const res = await fetch(`/api/recordings/${recordingId}/analyze`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "Analysis failed");
      }
      router.refresh(); // re-renders the server component which now sees the report
    } catch (err: any) {
      setErrorMsg(err.message ?? "Analysis failed — check that GEMINI_API_KEY is set");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center py-20 text-center">
      <div className="w-20 h-20 rounded-2xl bg-brand-100 flex items-center justify-center mb-6">
        <BarChart2 className="w-10 h-10 text-brand-500" />
      </div>
      <h2 className="text-xl font-semibold text-slate-900 mb-2">
        Run AI Quality Analysis
      </h2>
      <p className="text-sm text-slate-500 mb-8 max-w-sm">
        Gemini will analyse your recording and generate a timestamped report
        scoring speech clarity, pacing, and visual quality.
      </p>

      {errorMsg && (
        <div className="flex items-start gap-2 mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 max-w-sm text-left">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-medium transition-all duration-200 disabled:opacity-50"
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Analysing… (this may take ~15 s)
          </>
        ) : (
          <>
            <BarChart2 className="w-4 h-4" />
            {errorMsg ? "Retry analysis" : "Analyse recording"}
          </>
        )}
      </button>
    </div>
  );
}
