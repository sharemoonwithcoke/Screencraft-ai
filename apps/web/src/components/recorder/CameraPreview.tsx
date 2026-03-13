"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/cn";

type Shape = "circle" | "square";

/**
 * Draggable, resizable camera preview (picture-in-picture).
 * Shape toggles between circle and square via double-click.
 */
export function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null); // ref so cleanup always sees latest stream

  const [shape, setShape] = useState<Shape>("circle");
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const [size, setSize] = useState(140);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((s) => {
        streamRef.current = s;
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {
        // Camera not available or denied — PiP hidden gracefully
      });

    return () => {
      // Use ref so this cleanup always has the actual stream, not the initial null
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  if (!stream) return null;

  return (
    <div
      ref={containerRef}
      onDoubleClick={() => setShape((s) => (s === "circle" ? "square" : "circle"))}
      style={{
        width: size,
        height: size,
        bottom: pos.y,
        right: pos.x,
        cursor: isDraggingRef.current ? "grabbing" : "grab",
      }}
      className={cn(
        "absolute overflow-hidden border-2 border-white/30 shadow-lg shadow-black/40 transition-[border-radius] duration-200",
        shape === "circle" ? "rounded-full" : "rounded-2xl"
      )}
      onMouseDown={(e) => {
        isDraggingRef.current = true;
        dragStartRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
        e.preventDefault();
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover scale-x-[-1]"
      />
      {/* Resize handle */}
      <div
        className="absolute bottom-1 left-1 w-4 h-4 cursor-nwse-resize opacity-0 hover:opacity-100 transition-opacity duration-200"
        onMouseDown={(e) => {
          e.stopPropagation();
          const startSize = size;
          const startX = e.clientX;

          const onMove = (me: MouseEvent) => {
            const delta = startX - me.clientX;
            setSize(Math.max(80, Math.min(300, startSize + delta)));
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
      >
        <div className="w-2 h-2 border-l-2 border-b-2 border-white/60 rounded-bl-sm" />
      </div>
    </div>
  );
}
