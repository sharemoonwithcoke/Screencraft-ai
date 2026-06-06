"use client";

import { useRef, useEffect } from "react";

interface Props {
  stream: MediaStream;
}

/**
 * ZoomCanvas — renders the display stream onto a canvas element.
 */
export function ZoomCanvas({ stream }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const paintRafRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    video.srcObject = stream;
    video.play().catch(() => {});

    function paint() {
      paintRafRef.current = requestAnimationFrame(paint);
      if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;

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

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
