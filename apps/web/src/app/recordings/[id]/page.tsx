import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Scissors } from "lucide-react";
import { getRecording, getAnalysisReport } from "@/lib/dev-store";
import { RecordingTitle } from "@/components/recordings/RecordingTitle";
import { VideoPlayer } from "@/components/recordings/VideoPlayer";
import { DownloadButton } from "@/components/recordings/DownloadButton";
import { AnalysisCard } from "@/components/recordings/AnalysisCard";

export const metadata = { title: "Recording" };

interface Props { params: { id: string } }

const USE_DEV_STORE = !process.env.SERVER_URL || process.env.DEV_BYPASS_AUTH === "true";

async function fetchRecording(id: string) {
  if (USE_DEV_STORE) return getRecording(id);
  try {
    const res = await fetch(`${process.env.SERVER_URL}/recordings/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).data;
  } catch { return null; }
}

async function fetchReport(id: string) {
  if (USE_DEV_STORE) return getAnalysisReport(id);
  try {
    const res = await fetch(`${process.env.SERVER_URL}/recordings/${id}/report`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).data ?? null;
  } catch { return null; }
}

export default async function RecordingDetailPage({ params }: Props) {
  const [recording, report] = await Promise.all([
    fetchRecording(params.id),
    fetchReport(params.id),
  ]);
  if (!recording) notFound();

  const durationStr = recording.duration
    ? `${Math.floor(recording.duration / 60)}:${String(recording.duration % 60).padStart(2, "0")}`
    : "—";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link href="/dashboard" className="p-2 rounded-xl hover:bg-slate-100 transition-colors duration-200 shrink-0">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <RecordingTitle id={params.id} initialTitle={recording.title} />
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/recordings/${params.id}/edit`}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all duration-200"
            >
              <Scissors className="w-4 h-4" />
              AI Edit
            </Link>
            <DownloadButton recordingId={params.id} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Video player */}
        <VideoPlayer recordingId={params.id} />

        {/* Metadata row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Duration</p>
            <p className="text-lg font-semibold text-slate-900">{durationStr}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Resolution</p>
            <p className="text-lg font-semibold text-slate-900">{recording.resolution ?? "—"}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Recorded</p>
            <p className="text-lg font-semibold text-slate-900">
              {new Date(recording.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Analysis section — client component handles polling + navigation */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">AI Analysis</h2>
          <AnalysisCard
            recordingId={params.id}
            initialStatus={recording.status}
            initialReport={report}
          />
        </div>

        {/* AI Edit Studio card */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Tools</h2>
          <Link
            href={`/recordings/${params.id}/edit`}
            className="flex items-center gap-4 bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-all duration-200 group"
          >
            <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
              <Scissors className="w-6 h-6 text-purple-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 group-hover:text-brand-600 transition-colors">AI Edit Studio</h3>
              <p className="text-sm text-slate-400 mt-0.5">Auto-cut silences, add captions, create a highlight reel</p>
            </div>
            <ArrowLeft className="w-4 h-4 text-slate-300 rotate-180 group-hover:text-brand-400 transition-colors" />
          </Link>
        </div>
      </main>
    </div>
  );
}
