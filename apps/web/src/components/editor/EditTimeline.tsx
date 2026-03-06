"use client";

import { useRef, useEffect } from "react";
import type { EditSession } from "@screencraft/shared";

interface Props {
  session: EditSession;
  recordingId: string;
}

/**
 * Visual timeline — renders chapters and cuts as colored bands.
 * Click on a chapter/cut to seek the video preview.
 * Full drag-resize editing is a V1 scope item.
 */
export function EditTimeline({ session, recordingId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const totalMs =
    session.chapters.length > 0
      ? session.chapters[session.chapters.length - 1].endMs
      : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || totalMs === 0) return;

    const ctx = canvas.getContext("2d")!;
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = 48 * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const w = canvas.offsetWidth;
    const h = 48;

    // Background
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.roundRect(0, 0, w, h, 8);
    ctx.fill();

    // Chapters
    session.chapters.forEach((chapter) => {
      const x = (chapter.startMs / totalMs) * w;
      const width = ((chapter.endMs - chapter.startMs) / totalMs) * w;
      ctx.fillStyle = "rgba(99,112,246,0.25)";
      ctx.fillRect(x, 4, width - 2, h - 8);
    });

    // Applied cuts
    session.cuts
      .filter((c) => c.applied)
      .forEach((cut) => {
        const x = (cut.startMs / totalMs) * w;
        const width = ((cut.endMs - cut.startMs) / totalMs) * w;
        ctx.fillStyle = "rgba(239,68,68,0.4)";
        ctx.fillRect(x, 0, width, h);
        // Strikethrough lines
        ctx.strokeStyle = "rgba(239,68,68,0.7)";
        ctx.lineWidth = 1;
        for (let i = 0; i < width; i += 8) {
          ctx.beginPath();
          ctx.moveTo(x + i, 0);
          ctx.lineTo(x + i + 8, h);
          ctx.stroke();
        }
      });
  }, [session, totalMs]);

  if (totalMs === 0) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        No chapter data available yet
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <canvas ref={canvasRef} className="w-full h-12 rounded-xl" />
      <div className="space-y-2">
        {session.chapters.map((chapter) => (
          <div
            key={chapter.id}
            className="flex items-center gap-3 text-sm text-slate-300"
          >
            <span className="text-xs font-mono text-slate-500 w-24 flex-shrink-0">
              {formatMs(chapter.startMs)} – {formatMs(chapter.endMs)}
            </span>
            <span>{chapter.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
