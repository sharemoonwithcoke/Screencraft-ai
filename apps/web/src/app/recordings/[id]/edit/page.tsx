import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AIEditStudio } from "@/components/recordings/AIEditStudio";

export const metadata = { title: "AI Edit Studio" };

interface Props { params: { id: string } }

const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

export default async function EditPage({ params }: Props) {
  if (DEV_MODE) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        <header className="border-b border-white/10 px-6 py-4 flex-shrink-0">
          <div className="max-w-5xl mx-auto flex items-center gap-4">
            <Link href={`/recordings/${params.id}`} className="p-2 rounded-xl hover:bg-white/10 transition-colors duration-200">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-base font-semibold">AI Edit Studio</h1>
          </div>
        </header>
        <AIEditStudio recordingId={params.id} />
      </div>
    );
  }

  // Production: load existing edit session
  try {
    const res = await fetch(`${process.env.SERVER_URL}/recordings/${params.id}/edit-session`, { cache: "no-store" });
    const editSession = res.ok ? (await res.json()).data : null;
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
