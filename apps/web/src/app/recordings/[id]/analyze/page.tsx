import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnalysisReport } from "@/components/analysis/AnalysisReport";
import { AnalysisTrigger } from "@/components/analysis/AnalysisTrigger";

export const metadata = { title: "Analysis" };

interface Props {
  params: { id: string };
}

export default async function AnalyzePage({ params }: Props) {
  const res = await fetch(
    `${process.env.SERVER_URL}/api/recordings/${params.id}/analysis`,
    { cache: "no-store" }
  );

  const hasReport = res.ok;
  const report = hasReport ? (await res.json()).data : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link
            href={`/recordings/${params.id}`}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors duration-200"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">
            Quality Analysis
          </h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {report ? (
          <AnalysisReport report={report} />
        ) : (
          <AnalysisTrigger recordingId={params.id} />
        )}
      </main>
    </div>
  );
}
