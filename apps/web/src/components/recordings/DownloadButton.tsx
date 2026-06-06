"use client";

import { Download } from "lucide-react";
import { getVideo } from "@/lib/videoStore";

interface Props {
  recordingId: string;
  className?: string;
}

export function DownloadButton({ recordingId, className }: Props) {
  const handleDownload = () => {
    const blob = getVideo(recordingId);
    if (!blob) {
      alert(
        "Video not available for download.\n\n" +
        "The video is only kept in memory during the current session. " +
        "To download, re-record and use the Download button right after stopping."
      );
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${recordingId}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <button
      onClick={handleDownload}
      className={
        className ??
        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-brand-500 hover:bg-brand-600 text-white transition-all duration-200"
      }
    >
      <Download className="w-4 h-4" />
      Export
    </button>
  );
}
