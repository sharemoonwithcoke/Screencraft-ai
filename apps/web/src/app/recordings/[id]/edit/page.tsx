import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EditStudio } from "@/components/editor/EditStudio";

export const metadata = { title: "Edit" };

interface Props {
  params: { id: string };
}

export default async function EditPage({ params }: Props) {
  const res = await fetch(
    `${process.env.SERVER_URL}/api/recordings/${params.id}/edit-session`,
    { cache: "no-store" }
  );

  if (!res.ok) notFound();

  const { data: editSession } = await res.json();

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-full mx-auto flex items-center gap-4">
          <Link
            href={`/recordings/${params.id}`}
            className="p-2 rounded-xl hover:bg-white/10 transition-colors duration-200"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-base font-semibold">AI Edit Studio</h1>
        </div>
      </header>

      <EditStudio recordingId={params.id} editSession={editSession} />
    </div>
  );
}
