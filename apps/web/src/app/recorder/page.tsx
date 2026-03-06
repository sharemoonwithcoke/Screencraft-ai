"use client";

import { Suspense } from "react";
import { RecorderShell } from "@/components/recorder/RecorderShell";

export default function RecorderPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
        </div>
      }
    >
      <RecorderShell />
    </Suspense>
  );
}
