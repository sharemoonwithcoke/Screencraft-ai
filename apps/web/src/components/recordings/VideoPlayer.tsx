"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Video } from "lucide-react";
import { getVideo } from "@/lib/videoStore";

interface Props {
  recordingId: string;
}

export function VideoPlayer({ recordingId }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let attempts = 0;

    const revoke = () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };

    const tryLoad = () => {
      if (!mounted) return;
      const blob = getVideo(recordingId);
      if (blob) {
        revoke(); // clean up any previous URL
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setBlobUrl(url);
        return;
      }
      // recorder.onstop fires asynchronously after stop() — retry with backoff
      // so the video appears as soon as the blob lands in the store.
      if (attempts < 20) {
        const delay = Math.min((attempts + 1) * 100, 1000); // 100ms … 1000ms
        attempts++;
        setTimeout(tryLoad, delay);
      }
    };

    tryLoad();

    return () => {
      mounted = false;
      revoke();
    };
  }, [recordingId]);

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `recording-${recordingId}.webm`;
    a.click();
  };

  if (!blobUrl) {
    return (
      <div className="aspect-video bg-slate-900 rounded-2xl flex flex-col items-center justify-center gap-3 shadow-lg">
        <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
          <Video className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-slate-500 text-sm text-center px-6">
          Video preview is only available right after recording in the same browser tab.
        </p>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl overflow-hidden shadow-lg bg-slate-900 group">
      <video
        src={blobUrl}
        controls
        className="w-full aspect-video"
        preload="metadata"
      />
      <button
        onClick={handleDownload}
        className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-black/60 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      >
        <Download className="w-3.5 h-3.5" />
        Download
      </button>
    </div>
  );
}
