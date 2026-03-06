"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart2 } from "lucide-react";

interface Props {
  recordingId: string;
}

export function AnalysisTrigger({ recordingId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    await fetch(`/api/recordings/${recordingId}/analyze`, { method: "POST" });
    // Poll until analysis is ready
    const poll = setInterval(async () => {
      const res = await fetch(`/api/recordings/${recordingId}`);
      const { data } = await res.json();
      if (data.status === "ready") {
        clearInterval(poll);
        router.refresh();
      }
    }, 3000);
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
        Gemini will scan your recording and generate a timestamped report scoring
        speech clarity, content coverage, pacing, and visual quality.
      </p>
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-medium transition-all duration-200 disabled:opacity-50"
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Analyzing…
          </>
        ) : (
          <>
            <BarChart2 className="w-4 h-4" />
            Analyze recording
          </>
        )}
      </button>
    </div>
  );
}
