"use client";

import { useRef, useCallback, useEffect } from "react";

// Low-res comparison canvas dimensions (fast pixel diff)
const CMP_W = 80;
const CMP_H = 45;
// Per-channel pixel difference threshold
const PIXEL_DIFF = 30;

export function useScreenCapture(stream: MediaStream | null) {
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const cmpCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevDataRef = useRef<Uint8ClampedArray | null>(null);

  useEffect(() => {
    const track = stream?.getVideoTracks()[0] ?? null;
    trackRef.current = track;
    if (track) {
      const c = document.createElement("canvas");
      c.width = CMP_W;
      c.height = CMP_H;
      cmpCanvasRef.current = c;
    } else {
      cmpCanvasRef.current = null;
    }
    prevDataRef.current = null;
  }, [stream]);

  // Grab the current video frame using the ImageCapture API (Chrome/Edge)
  const grabBitmap = useCallback(async (): Promise<ImageBitmap | null> => {
    const track = trackRef.current;
    if (!track || track.readyState !== "live") return null;
    try {
      const ic = new (window as any).ImageCapture(track);
      return await (ic.grabFrame() as Promise<ImageBitmap>);
    } catch {
      return null;
    }
  }, []);

  /** Capture a JPEG blob at 1024×576 for sending to Gemini. */
  const captureJpeg = useCallback(
    async (quality = 0.7): Promise<Blob | null> => {
      const bitmap = await grabBitmap();
      if (!bitmap) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 576;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, 1024, 576);
      bitmap.close();
      return new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
    },
    [grabBitmap],
  );

  /**
   * Capture a JPEG blob cropped to a CSS-coordinate region.
   * Maps the CSS bounding rect to stream pixel coordinates using the stream's
   * natural dimensions relative to the window viewport.
   */
  const captureRegionJpeg = useCallback(
    async (cssRect: DOMRect, quality = 0.8): Promise<Blob | null> => {
      const bitmap = await grabBitmap();
      if (!bitmap) return null;

      const scaleX = bitmap.width / window.innerWidth;
      const scaleY = bitmap.height / window.innerHeight;

      const sx = Math.round(cssRect.left * scaleX);
      const sy = Math.round(cssRect.top * scaleY);
      const sw = Math.round(cssRect.width * scaleX);
      const sh = Math.round(cssRect.height * scaleY);

      const clampedSx = Math.max(0, Math.min(sx, bitmap.width));
      const clampedSy = Math.max(0, Math.min(sy, bitmap.height));
      const clampedSw = Math.min(sw, bitmap.width - clampedSx);
      const clampedSh = Math.min(sh, bitmap.height - clampedSy);

      if (clampedSw <= 0 || clampedSh <= 0) {
        bitmap.close();
        return null;
      }

      const canvas = document.createElement("canvas");
      canvas.width = clampedSw;
      canvas.height = clampedSh;
      canvas.getContext("2d")!.drawImage(bitmap, clampedSx, clampedSy, clampedSw, clampedSh, 0, 0, clampedSw, clampedSh);
      bitmap.close();

      return new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
    },
    [grabBitmap],
  );

  /**
   * Grab the current frame, compare it to the previous one, and return
   * the fraction of pixels (0–1) that changed significantly.
   * Updates the stored reference frame as a side-effect.
   */
  const getFrameDiff = useCallback(async (): Promise<number> => {
    const canvas = cmpCanvasRef.current;
    if (!canvas) return 0;
    const bitmap = await grabBitmap();
    if (!bitmap) return 0;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, CMP_W, CMP_H);
    bitmap.close();
    const cur = ctx.getImageData(0, 0, CMP_W, CMP_H).data;
    const prev = prevDataRef.current;
    prevDataRef.current = new Uint8ClampedArray(cur);
    if (!prev) return 0;
    let changed = 0;
    for (let i = 0; i < cur.length; i += 4) {
      if (Math.abs(cur[i] - prev[i]) > PIXEL_DIFF) changed++;
    }
    return changed / (CMP_W * CMP_H);
  }, [grabBitmap]);

  return { captureJpeg, captureRegionJpeg, getFrameDiff };
}
