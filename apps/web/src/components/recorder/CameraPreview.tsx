"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/cn";

type Shape = "circle" | "square";

interface Props {
  stream: MediaStream;
}

/**
 * Draggable, resizable camera picture-in-picture overlay.
 * Parent owns the camera stream lifecycle; this component just renders it.
 * Double-click toggles circle ↔ square. Resize handle at bottom-left.
 */
export function CameraPreview({ stream }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shape, setShape] = useState<Shape>("circle");
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const [size, setSize] = useState(140);

  // Wire stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startMX = e.clientX;
    const startMY = e.clientY;
    const startPX = pos.x;
    const startPY = pos.y;

    const onMove = (ev: MouseEvent) => {
      setPos({
        x: Math.max(0, startPX - (ev.clientX - startMX)),
        y: Math.max(0, startPY + (ev.clientY - startMY)),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  // ── Resize ───────────────────────────────────────────────────────────────────
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startSize = size;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setSize(Math.max(80, Math.min(300, startSize + delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [size]);

  return (
    <div
      onDoubleClick={() => setShape((s) => (s === "circle" ? "square" : "circle"))}
      onMouseDown={onDragStart}
      style={{ width: size, height: size, top: pos.y, right: pos.x }}
      className={cn(
        "absolute overflow-hidden border-2 border-white/30 shadow-lg shadow-black/40 cursor-grab active:cursor-grabbing transition-[border-radius] duration-200 z-30",
        shape === "circle" ? "rounded-full" : "rounded-2xl"
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover scale-x-[-1]"
      />

      {/* Resize handle — bottom-left corner */}
      <div
        onMouseDown={onResizeStart}
        className="absolute bottom-1 left-1 w-4 h-4 cursor-nwse-resize opacity-0 hover:opacity-100 transition-opacity duration-200 flex items-end justify-start"
        title="Drag to resize"
      >
        <div className="w-2 h-2 border-l-2 border-b-2 border-white/60 rounded-bl-sm" />
      </div>
    </div>
  );
}
