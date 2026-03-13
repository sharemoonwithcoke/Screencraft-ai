import { Plus, Search, Video } from "lucide-react";
import Link from "next/link";
import { RecordingCard } from "@/components/dashboard/RecordingCard";
import { getSession } from "@/lib/dev-auth";
import { getRecordings } from "@/lib/dev-store";
import { redirect } from "next/navigation";
import type { Recording } from "@screencraft/shared";

export const metadata = { title: "Dashboard" };

const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

async function fetchRecordings(): Promise<Recording[]> {
  if (DEV_MODE) {
    return getRecordings();
  }
  try {
    const res = await fetch(`${process.env.SERVER_URL}/recordings`, { cache: "no-store" });
    if (!res.ok) return [];
    const { data } = await res.json();
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login");

  const recordings = await fetchRecordings();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center">
              <Video className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">My Recordings</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="search"
                placeholder="Search recordings…"
                className="pl-9 pr-4 py-2 text-sm bg-slate-100 rounded-xl border-0 focus:outline-none focus:ring-2 focus:ring-brand-500 w-56 transition-all duration-200"
              />
            </div>
            <Link
              href="/recorder"
              className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New recording
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {recordings.length === 0 ? (
          <div className="flex flex-col items-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center mb-4">
              <Plus className="w-8 h-8 text-brand-500" />
            </div>
            <p className="text-slate-600 font-medium mb-2">No recordings yet</p>
            <p className="text-sm text-slate-400 mb-6">Start your first recording to see it here</p>
            <Link
              href="/recorder"
              className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
            >
              Start recording
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {recordings.map((rec) => (
              <RecordingCard key={rec.id} recording={rec} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
