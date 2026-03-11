"use client";

import Link from "next/link";
import { BarChart2, Clock, MoreHorizontal } from "lucide-react";
import type { Recording } from "@screencraft/shared";
import { cn } from "@/lib/cn";

const statusColors: Record<Recording["status"], string> = {
  idle: "bg-slate-100 text-slate-600",
  recording: "bg-red-100 text-red-600",
  paused: "bg-yellow-100 text-yellow-600",
  processing: "bg-blue-100 text-blue-600",
  ready: "bg-green-100 text-green-600",
  error: "bg-red-100 text-red-700",
};

interface Props {
  recording: Recording;
}

export function RecordingCard({ recording }: Props) {
  const durationStr = recording.duration
    ? `${Math.floor(recording.duration / 60)}:${String(recording.duration % 60).padStart(2, "0")}`
    : null;

  return (
    <Link
      href={`/recordings/${recording.id}`}
      className="group bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition-all duration-200"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-slate-100 relative overflow-hidden">
        {recording.thumbnailUrl ? (
          <img
            src={recording.thumbnailUrl}
            alt={recording.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-slate-200" />
          </div>
        )}
        {durationStr && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 text-white text-xs px-2 py-0.5 rounded-lg">
            <Clock className="w-3 h-3" />
            {durationStr}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-900 line-clamp-1 group-hover:text-brand-600 transition-colors duration-200">
            {recording.title}
          </h3>
          <button
            onClick={(e) => e.preventDefault()}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors duration-200 flex-shrink-0"
          >
            <MoreHorizontal className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium capitalize",
              statusColors[recording.status]
            )}
          >
            {recording.status}
          </span>
          <span className="text-xs text-slate-400">
            {new Date(recording.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </Link>
  );
}
