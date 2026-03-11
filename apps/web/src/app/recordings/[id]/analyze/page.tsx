import Link from "next/link";
import { ArrowLeft, BarChart2, Zap } from "lucide-react";
import { getRecording } from "@/lib/dev-store";

export const metadata = { title: "Analysis" };

interface Props { params: { id: string } }

const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

export default async function AnalyzePage({ params }: Props) {
  // In dev mode show placeholder — analysis requires backend AI processing
  if (DEV_MODE) {
    const recording = getRecording(params.id);
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center gap-4">
            <Link href={`/recordings/${params.id}`} className="p-2 rounded-xl hover:bg-slate-100 transition-colors duration-200">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </Link>
            <h1 className="text-lg font-semibold text-slate-900">Quality Analysis</h1>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-16 flex flex-col items-center text-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
            <BarChart2 className="w-8 h-8 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Analysis not yet available</h2>
            <p className="text-sm text-slate-400 max-w-sm">
              Quality analysis runs after the backend processes your recording.
              Connect the backend server to enable this feature.
            </p>
          </div>
          {/* Preview of what the analysis will show */}
          <div className="w-full max-w-xl grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 opacity-40 pointer-events-none">
            {["Speech Clarity", "Content Coverage", "Presentation Flow", "Visual Quality", "Opening/Closing", "Overall Score"].map((label) => (
              <div key={label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <p className="text-2xl font-bold text-slate-900">—</p>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Production: fetch real analysis
  try {
    const res = await fetch(`${process.env.SERVER_URL}/recordings/${params.id}/analysis`, { cache: "no-store" });
    const { AnalysisReport } = await import("@/components/analysis/AnalysisReport");
    const { AnalysisTrigger } = await import("@/components/analysis/AnalysisTrigger");
    const hasReport = res.ok;
    const report = hasReport ? (await res.json()).data : null;
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center gap-4">
            <Link href={`/recordings/${params.id}`} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </Link>
            <h1 className="text-lg font-semibold text-slate-900">Quality Analysis</h1>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-8">
          {report ? <AnalysisReport report={report} /> : <AnalysisTrigger recordingId={params.id} />}
        </main>
      </div>
    );
  } catch {
    return <div className="p-8 text-slate-500 text-sm">Backend unavailable</div>;
  }
}
