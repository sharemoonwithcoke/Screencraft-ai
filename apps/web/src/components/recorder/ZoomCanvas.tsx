"use client";

import { useRef, useEffect } from "react";
import { useZoomPan } from "@/hooks/useZoomPan";
import type { ServerToClientEvent } from "@screencraft/shared";

interface Props {
  stream: MediaStream;
  wsOn: <E extends ServerToClientEvent["event"]>(
    event: E,
    handler: (event: Extract<ServerToClientEvent, { event: E }>) => void
  ) => () => void;
}

/**
 * Renders the display stream onto a canvas and applies
 * smooth zoom & pan transforms driven by AI cue events.
 */
export function ZoomCanvas({ stream, wsOn }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number | null>(null);

  const { zoomTo, reset, onMouseMove, onMouseLeave } = useZoomPan(containerRef);

  // Paint video → canvas at display frame rate
  useEffect(() => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    video.srcObject = stream;
    video.play();

    function paint() {
      animRef.current = requestAnimationFrame(paint);
      if (video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
      }
    }

    paint();

    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [stream]);

  // Subscribe to AI zoom events
  useEffect(() => {
    const offZoom = wsOn("ai:zoom:trigger", (e) => {
      zoomTo({
        x: e.payload.x,
        y: e.payload.y,
        scale: e.payload.scale,
        duration: e.payload.duration,
      });
    });

    const offReset = wsOn("ai:zoom:reset", (e) => {
      reset(e.payload.duration);
    });

    return () => {
      offZoom();
      offReset();
    };
  }, [wsOn, zoomTo, reset]);

  // Click ripple effect
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const ripple = document.createElement("div");
    ripple.className =
      "absolute w-6 h-6 rounded-full bg-blue-400/60 animate-ripple pointer-events-none";
    ripple.style.left = `${e.nativeEvent.offsetX - 12}px`;
    ripple.style.top = `${e.nativeEvent.offsetY - 12}px`;
    containerRef.current?.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onClick={handleClick}
      onMouseMove={(e) => onMouseMove(e.nativeEvent)}
      onMouseLeave={onMouseLeave}
    >
      {/* Hidden video element as source */}
      <video ref={videoRef} className="hidden" muted playsInline />
      {/* Canvas receives zoom/pan transform */}
      <canvas ref={canvasRef} className="zoom-canvas" />
    </div>
  );
}
