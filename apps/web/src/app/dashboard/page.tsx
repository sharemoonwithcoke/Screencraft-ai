import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { RecordingCard } from "@/components/dashboard/RecordingCard";
import { getSession } from "@/lib/dev-auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">Recordings</h1>
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
        {/* Placeholder grid — populated from API */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* RecordingCard components rendered here after data fetch */}
          <div className="col-span-full flex flex-col items-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center mb-4">
              <Plus className="w-8 h-8 text-brand-500" />
            </div>
            <p className="text-slate-600 font-medium mb-2">No recordings yet</p>
            <p className="text-sm text-slate-400 mb-6">
              Start your first recording to see it here
            </p>
            <Link
              href="/recorder"
              className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
            >
              Start recording
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
