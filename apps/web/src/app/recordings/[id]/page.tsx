import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart2, Scissors, Download } from "lucide-react";

export const metadata = { title: "Recording" };

interface Props {
  params: { id: string };
}

export default async function RecordingDetailPage({ params }: Props) {
  // Data fetched server-side via internal API
  const res = await fetch(
    `${process.env.SERVER_URL}/api/recordings/${params.id}`,
    { cache: "no-store" }
  );

  if (!res.ok) notFound();

  const { data: recording } = await res.json();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link
            href="/dashboard"
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors duration-200"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1 className="text-lg font-semibold text-slate-900 flex-1 truncate">
            {recording.title}
          </h1>
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
              Edit
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
        <div className="aspect-video bg-slate-900 rounded-2xl flex items-center justify-center mb-8 shadow-lg">
          <p className="text-slate-500 text-sm">Video player</p>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Duration</p>
            <p className="text-lg font-semibold text-slate-900">
              {recording.duration
                ? `${Math.floor(recording.duration / 60)}:${String(recording.duration % 60).padStart(2, "0")}`
                : "—"}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Resolution</p>
            <p className="text-lg font-semibold text-slate-900">
              {recording.resolution ?? "—"}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-400 mb-1">Status</p>
            <p className="text-lg font-semibold text-slate-900 capitalize">
              {recording.status}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
