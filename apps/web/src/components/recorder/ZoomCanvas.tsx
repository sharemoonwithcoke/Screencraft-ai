"use client";

import { useRef, useEffect, useCallback } from "react";
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
 * ZoomCanvas — renders the display stream onto a canvas and applies
 * smooth zoom & pan via useZoomPan.
 *
 * Transform architecture:
 *  <div.wrapper>     ← overflow:hidden, fills parent
 *    <div.container> ← receives CSS transform (translate + scale), transform-origin 0 0
 *      <canvas>      ← always fills container, painted from MediaStream
 *    </div>
 *  </div>
 *
 * All focal math lives in useZoomPan; this component just wires events.
 */
export function ZoomCanvas({ stream, wsOn }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const paintRafRef = useRef<number | null>(null);

  const {
    scale,
    activeSource,
    zoomTo,
    resetZoom,
    onMouseMove,
    onMouseLeave,
  } = useZoomPan(containerRef);

  // ── Paint MediaStream → canvas at display frame rate ──────────────────────

  useEffect(() => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    video.srcObject = stream;
    video.play().catch(() => {});

    function paint() {
      paintRafRef.current = requestAnimationFrame(paint);
      if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;

      // Sync canvas resolution to video (only when it actually changes)
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      ctx.drawImage(video, 0, 0);
    }

    paintRafRef.current = requestAnimationFrame(paint);

    return () => {
      if (paintRafRef.current !== null) cancelAnimationFrame(paintRafRef.current);
      video.srcObject = null;
    };
  }, [stream]);

  // ── WebSocket: AI zoom trigger ────────────────────────────────────────────

  useEffect(() => {
    const offZoom = wsOn("ai:zoom:trigger", (e) => {
      zoomTo({
        focalX: e.payload.x,
        focalY: e.payload.y,
        scale: e.payload.scale,
        durationMs: e.payload.duration,
        source: "ws_event",
        easing: "ease-in-out-cubic",
      });
    });

    const offReset = wsOn("ai:zoom:reset", (e) => {
      resetZoom(e.payload.duration);
    });

    return () => {
      offZoom();
      offReset();
    };
  }, [wsOn, zoomTo, resetZoom]);

  // ── Click: ripple + recenter when already zoomed ──────────────────────────

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const { left, top, width, height } = container.getBoundingClientRect();
    const nx = (e.clientX - left) / width;
    const ny = (e.clientY - top) / height;

    spawnRipple(container, e.nativeEvent.offsetX, e.nativeEvent.offsetY);

    // When already zoomed: recenter on click point without changing scale
    if (scale > 1) {
      zoomTo({
        focalX: nx,
        focalY: ny,
        scale,
        durationMs: 300,
        source: "manual",
        easing: "ease-out-expo",
      });
    }
  }, [scale, zoomTo]);

  // ── Double-click: reset zoom ──────────────────────────────────────────────

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    resetZoom();
  }, [resetZoom]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {/* Hidden video element — MediaStream source only */}
      <video ref={videoRef} className="hidden" muted playsInline />

      {/* This div is what useZoomPan transforms */}
      <div
        ref={containerRef}
        className="absolute inset-0 will-change-transform"
        style={{ transformOrigin: "0 0" }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Zoom HUD — outside the transformed div so it stays fixed on screen */}
      {scale > 1 && (
        <ZoomHUD scale={scale} source={activeSource} onReset={resetZoom} />
      )}
    </div>
  );
}

// ── Zoom HUD ──────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  voice:    "Voice",
  hover:    "Hover",
  ws_event: "AI",
  manual:   "Manual",
  edge_pan: "Pan",
};

interface HudProps {
  scale: number;
  source: string | null;
  onReset: () => void;
}

function ZoomHUD({ scale, source, onReset }: HudProps) {
  return (
    <div className="absolute top-3 right-3 flex items-center gap-2 animate-fade-in pointer-events-none">
      <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full">
        <span className="font-mono font-semibold">{scale.toFixed(1)}×</span>
        {source && (
          <span className="text-white/50">· {SOURCE_LABELS[source] ?? source}</span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onReset(); }}
        className="pointer-events-auto bg-black/60 backdrop-blur-sm text-white/70 hover:text-white text-xs px-2.5 py-1.5 rounded-full transition-colors duration-200"
        title="Reset zoom (or double-click)"
      >
        Reset
      </button>
    </div>
  );
}

// ── Ripple helper ─────────────────────────────────────────────────────────────

function spawnRipple(container: HTMLElement, x: number, y: number) {
  const el = document.createElement("div");
  el.style.cssText = `
    position:absolute;
    width:24px;height:24px;
    left:${x - 12}px;top:${y - 12}px;
    border-radius:9999px;
    background:rgba(96,165,250,0.55);
    pointer-events:none;
    animation:ripple 0.6s ease-out forwards;
    z-index:50;
  `;
  container.appendChild(el);
  setTimeout(() => el.remove(), 700);
}
