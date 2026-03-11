import Link from "next/link";
import { ArrowLeft, Scissors, Zap } from "lucide-react";
import { getRecording } from "@/lib/dev-store";

export const metadata = { title: "Edit" };

interface Props { params: { id: string } }

const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

export default async function EditPage({ params }: Props) {
  if (DEV_MODE) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        <header className="border-b border-white/10 px-6 py-4">
          <div className="max-w-full mx-auto flex items-center gap-4">
            <Link href={`/recordings/${params.id}`} className="p-2 rounded-xl hover:bg-white/10 transition-colors duration-200">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-base font-semibold">AI Edit Studio</h1>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center">
            <Scissors className="w-8 h-8 text-purple-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">AI Edit Studio</h2>
            <p className="text-sm text-slate-400 max-w-sm">
              Auto-cut silences, generate captions, create a highlight reel,
              and find the best cover frame — powered by Gemini AI.
            </p>
          </div>
          <div className="w-full max-w-xl grid grid-cols-2 gap-3 mt-2 opacity-40 pointer-events-none">
            {[
              { label: "Remove silences", desc: "Auto-detect and cut dead air" },
              { label: "Auto captions", desc: "Generate accurate subtitles" },
              { label: "Highlight reel", desc: "Best moments in 60 seconds" },
              { label: "Cover frame", desc: "Recommend best thumbnail" },
            ].map(({ label, desc }) => (
              <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-4 text-left">
                <p className="text-sm font-medium text-white mb-1">{label}</p>
                <p className="text-xs text-slate-500">{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-2">Connect the backend server to enable editing</p>
        </main>
      </div>
    );
  }

  // Production
  try {
    const res = await fetch(`${process.env.SERVER_URL}/recordings/${params.id}/edit-session`, { cache: "no-store" });
    if (!res.ok) throw new Error("Not found");
    const { data: editSession } = await res.json();
    const { EditStudio } = await import("@/components/editor/EditStudio");
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        <header className="border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href={`/recordings/${params.id}`} className="p-2 rounded-xl hover:bg-white/10 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-base font-semibold">AI Edit Studio</h1>
          </div>
        </header>
        <EditStudio recordingId={params.id} editSession={editSession} />
      </div>
    );
  } catch {
    return <div className="p-8 text-slate-400 text-sm">Backend unavailable</div>;
  }
}
