"use client";

import { useRef, useCallback, useEffect } from "react";

interface ZoomPanState {
  x: number; // translate x (px)
  y: number; // translate y (px)
  scale: number;
}

interface ZoomTarget {
  x: number; // 0–1 normalized
  y: number;
  scale: number;
  duration: number; // ms
}

/**
 * Manages Canvas 2D transform matrix for Zoom & Pan.
 * Inspired by Cap's open-source implementation (MIT).
 * Uses CSS transform on the canvas element for GPU acceleration.
 */
export function useZoomPan(containerRef: React.RefObject<HTMLElement>) {
  const stateRef = useRef<ZoomPanState>({ x: 0, y: 0, scale: 1 });
  const animFrameRef = useRef<number | null>(null);

  const applyTransform = useCallback(
    (state: ZoomPanState) => {
      const el = containerRef.current;
      if (!el) return;
      el.style.transform = `scale(${state.scale}) translate(${state.x}px, ${state.y}px)`;
      el.style.transformOrigin = "center center";
    },
    [containerRef]
  );

  const animateTo = useCallback(
    (target: ZoomTarget) => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }

      const container = containerRef.current;
      if (!container) return;

      const { width, height } = container.getBoundingClientRect();

      // Target translate: center the zoom on the focal point
      const targetX = (0.5 - target.x) * width * (target.scale - 1);
      const targetY = (0.5 - target.y) * height * (target.scale - 1);

      const start = stateRef.current;
      const startTime = performance.now();

      function easeInOutCubic(t: number) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function frame(now: number) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / target.duration, 1);
        const eased = easeInOutCubic(t);

        const current: ZoomPanState = {
          x: start.x + (targetX - start.x) * eased,
          y: start.y + (targetY - start.y) * eased,
          scale: start.scale + (target.scale - start.scale) * eased,
        };

        stateRef.current = current;
        applyTransform(current);

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(frame);
        }
      }

      animFrameRef.current = requestAnimationFrame(frame);
    },
    [containerRef, applyTransform]
  );

  const zoomTo = useCallback(
    ({ x, y, scale, duration }: ZoomTarget) => {
      animateTo({ x, y, scale, duration });
    },
    [animateTo]
  );

  const reset = useCallback(
    (duration = 400) => {
      animateTo({ x: 0, y: 0, scale: 1, duration });
    },
    [animateTo]
  );

  // Track mouse hover for auto-zoom trigger
  const mouseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOVER_THRESHOLD_MS = 1500;

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);

      const { left, top, width, height } = container.getBoundingClientRect();
      const nx = (e.clientX - left) / width;
      const ny = (e.clientY - top) / height;

      mouseTimerRef.current = setTimeout(() => {
        // Only zoom if currently at 1x (don't fight voice-triggered zoom)
        if (stateRef.current.scale === 1) {
          zoomTo({ x: nx, y: ny, scale: 2, duration: 500 });
        }
      }, HOVER_THRESHOLD_MS);
    },
    [containerRef, zoomTo]
  );

  const onMouseLeave = useCallback(() => {
    if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (mouseTimerRef.current !== null) {
        clearTimeout(mouseTimerRef.current);
      }
    };
  }, []);

  return { zoomTo, reset, onMouseMove, onMouseLeave };
}
