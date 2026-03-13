import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart2, Scissors, Download, Video } from "lucide-react";
import { getRecording } from "@/lib/dev-store";
import { RecordingTitle } from "@/components/recordings/RecordingTitle";

export const metadata = { title: "Recording" };

interface Props { params: { id: string } }

const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

async function fetchRecording(id: string) {
  if (DEV_MODE) {
    return getRecording(id);
  }
  try {
    const res = await fetch(`${process.env.SERVER_URL}/recordings/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const { data } = await res.json();
    return data;
  } catch {
    return null;
  }
}

export default async function RecordingDetailPage({ params }: Props) {
  const recording = await fetchRecording(params.id);
  if (!recording) notFound();

  const durationStr = recording.duration
    ? `${Math.floor(recording.duration / 60)}:${String(recording.duration % 60).padStart(2, "0")}`
    : "—";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link href="/dashboard" className="p-2 rounded-xl hover:bg-slate-100 transition-colors duration-200">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <RecordingTitle id={params.id} initialTitle={recording.title} />
          <div className="flex items-center gap-2">
            <Link
              href={`/recordings/${params.id}/analyze`}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all duration-200"
            >
              <BarChart2 className="w-4 h-4" />
              Analyze
            </Link>
            <Link
              href={`/recordings/${params.id}/edit`}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all duration-200"
            >
              <Scissors className="w-4 h-4" />
              AI Edit
            </Link>
            <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-brand-500 hover:bg-brand-600 text-white transition-all duration-200">
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Video player placeholder */}
        <div className="aspect-video bg-slate-900 rounded-2xl flex flex-col items-center justify-center mb-8 shadow-lg gap-3">
          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
            <Video className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-slate-500 text-sm">
            {recording.status === "processing" ? "Video is processing…" : "Video player"}
          </p>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Duration</p>
            <p className="text-lg font-semibold text-slate-900">{durationStr}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Resolution</p>
            <p className="text-lg font-semibold text-slate-900">{recording.resolution ?? "—"}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Status</p>
            <p className="text-lg font-semibold text-slate-900 capitalize">{recording.status}</p>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href={`/recordings/${params.id}/analyze`}
            className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-3">
              <BarChart2 className="w-5 h-5 text-blue-500" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-brand-600 transition-colors">Quality Analysis</h3>
            <p className="text-sm text-slate-400">Speech clarity, pacing, content coverage score</p>
          </Link>
          <Link
            href={`/recordings/${params.id}/edit`}
            className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center mb-3">
              <Scissors className="w-5 h-5 text-purple-500" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-brand-600 transition-colors">AI Edit Studio</h3>
            <p className="text-sm text-slate-400">Auto-cut silences, add captions, highlight reel</p>
          </Link>
        </div>
      </main>
    </div>
  );
}
