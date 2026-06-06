import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRecording, getAnalysisReport } from "@/lib/dev-store";
import { AnalysisPageContent } from "@/components/analysis/AnalysisPageContent";
import { StatusPoller } from "@/components/recordings/StatusPoller";

export const metadata = { title: "Analysis" };

interface Props { params: { id: string } }

const USE_SERVER = Boolean(process.env.SERVER_URL);

async function fetchReport(recordingId: string) {
  if (USE_SERVER) {
    try {
      const res = await fetch(
        `${process.env.SERVER_URL}/recordings/${recordingId}/analysis`,
        { cache: "no-store" }
      );
      if (!res.ok) return null;
      return (await res.json()).data ?? null;
    } catch {
      return null;
    }
  }
  return getAnalysisReport(recordingId);
}

async function fetchRecordingStatus(recordingId: string) {
  if (USE_SERVER) {
    try {
      const res = await fetch(
        `${process.env.SERVER_URL}/recordings/${recordingId}`,
        { cache: "no-store" }
      );
      if (!res.ok) return null;
      return (await res.json()).data ?? null;
    } catch {
      return null;
    }
  }
  return getRecording(recordingId);
}

export default async function AnalyzePage({ params }: Props) {
  const [report, recording] = await Promise.all([
    fetchReport(params.id),
    fetchRecordingStatus(params.id),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      {recording && <StatusPoller status={recording.status} />}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link
            href={`/recordings/${params.id}`}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors duration-200"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Quality Analysis</h1>
          {recording && (
            <span className="ml-auto text-xs text-slate-400 capitalize bg-slate-100 px-2.5 py-1 rounded-full">
              {recording.status}
            </span>
          )}
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* AnalysisPageContent tries a client-side API fetch if server-side
            store lookup returned null (happens after hot reload / restart) */}
        <AnalysisPageContent
          recordingId={params.id}
          recordingStatus={recording?.status ?? "ready"}
          initialReport={report}
        />
      </main>
    </div>
  );
}
