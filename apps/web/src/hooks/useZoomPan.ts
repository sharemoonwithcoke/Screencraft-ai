"use client";

import { useRef, useCallback, useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Who triggered this zoom — used for priority arbitration */
export type ZoomTriggerSource = "voice" | "hover" | "ws_event" | "manual" | "edge_pan";

/** A discrete zoom segment (mirrors Cap's ZoomTrack segment structure).
 *  Used to log / replay zoom history and for future timeline editing. */
export interface ZoomSegment {
  id: string;
  startMs: number;
  endMs: number | null;       // null = still active
  focalX: number;             // 0–1 normalized focal point
  focalY: number;
  scale: number;              // e.g. 2.0
  source: ZoomTriggerSource;
}

/** Live transform state applied to the canvas element */
interface TransformState {
  focalX: number;   // 0–1 — where we're zoomed into
  focalY: number;
  scale: number;
  translateX: number; // computed px offset (kept in sync with focal)
  translateY: number;
}

/** Input to request a zoom animation */
export interface ZoomRequest {
  focalX: number;   // 0–1 normalized
  focalY: number;
  scale: number;
  durationMs: number;
  source: ZoomTriggerSource;
  easing?: "ease-in-out-cubic" | "ease-out-expo" | "linear";
}

/** What useZoomPan exposes to the consumer */
export interface UseZoomPanReturn {
  /** Current live scale (reactive) */
  scale: number;
  /** Current trigger source (reactive) */
  activeSource: ZoomTriggerSource | null;
  /** All completed zoom segments this session */
  segments: ZoomSegment[];
  /** Programmatically zoom to a target */
  zoomTo: (req: ZoomRequest) => void;
  /** Smoothly return to 1× */
  resetZoom: (durationMs?: number) => void;
  /** Attach to the container div's onMouseMove */
  onMouseMove: (e: React.MouseEvent) => void;
  /** Attach to the container div's onMouseLeave */
  onMouseLeave: () => void;
  /** Force-cancel any in-progress animation */
  cancelAnimation: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOVER_DELAY_MS = 1500;       // ms before hover triggers zoom (per spec)
const HOVER_ZOOM_SCALE = 2.0;
const HOVER_ZOOM_DURATION_MS = 500;
const EDGE_PAN_ZONE = 0.08;        // 8% from each edge triggers pan
const EDGE_PAN_DURATION_MS = 350;
const MAX_SCALE = 4.0;
const MIN_SCALE = 1.0;
const RESET_DURATION_MS = 400;

// Voice/WS events always win over hover
const SOURCE_PRIORITY: Record<ZoomTriggerSource, number> = {
  ws_event: 10,
  voice: 9,
  manual: 8,
  edge_pan: 5,
  hover: 1,
};

// ── Easing functions (from Cap's approach) ────────────────────────────────────

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function linear(t: number): number {
  return t;
}

const easingFns = {
  "ease-in-out-cubic": easeInOutCubic,
  "ease-out-expo": easeOutExpo,
  linear,
};

// ── Core transform math (adapted from Cap's origin-preserving algorithm) ──────

/**
 * Computes the CSS translate offsets needed to keep focalX/focalY
 * visually stationary as we scale.
 *
 * Cap's key insight: track the focal point in normalized space,
 * then derive the pixel translation from containerWidth/Height.
 *
 * With transform-origin at top-left (0 0):
 *   translateX = -focalX * containerWidth  * (scale - 1)
 *   translateY = -focalY * containerHeight * (scale - 1)
 */
function computeTranslate(
  focalX: number,
  focalY: number,
  scale: number,
  containerWidth: number,
  containerHeight: number
): { translateX: number; translateY: number } {
  return {
    translateX: -focalX * containerWidth * (scale - 1),
    translateY: -focalY * containerHeight * (scale - 1),
  };
}

/**
 * When zooming into a new focal point while already zoomed,
 * we need to preserve the visual anchor.
 *
 * This is Cap's "origin percentage" technique:
 *   newFocal = lerp(currentFocal, targetFocal, t)
 * then recompute translate for the blended focal + blended scale.
 */
function interpolateTransform(
  from: TransformState,
  toFocalX: number,
  toFocalY: number,
  toScale: number,
  t: number,
  containerWidth: number,
  containerHeight: number
): TransformState {
  const scale = from.scale + (toScale - from.scale) * t;
  const focalX = from.focalX + (toFocalX - from.focalX) * t;
  const focalY = from.focalY + (toFocalY - from.focalY) * t;
  const { translateX, translateY } = computeTranslate(
    focalX,
    focalY,
    scale,
    containerWidth,
    containerHeight
  );
  return { scale, focalX, focalY, translateX, translateY };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useZoomPan(
  containerRef: React.RefObject<HTMLElement>
): UseZoomPanReturn {
  // ── Reactive state (minimal — just what UI needs to observe) ──────────────
  const [scale, setScale] = useState(1);
  const [activeSource, setActiveSource] = useState<ZoomTriggerSource | null>(null);
  const [segments, setSegments] = useState<ZoomSegment[]>([]);

  // ── Mutable refs (no re-render needed) ───────────────────────────────────
  const transformRef = useRef<TransformState>({
    focalX: 0.5,
    focalY: 0.5,
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const animRef = useRef<number | null>(null);
  const activeSourceRef = useRef<ZoomTriggerSource | null>(null);
  const currentSegmentIdRef = useRef<string | null>(null);
  const segmentStartMsRef = useRef<number>(0);

  // Hover state
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoverPosRef = useRef<{ nx: number; ny: number }>({ nx: 0.5, ny: 0.5 });

  // ── RAF-batched pending zoom (Cap's "pendingZoomDelta" pattern) ───────────
  const pendingZoomRef = useRef<ZoomRequest | null>(null);
  const pendingRafRef = useRef<number | null>(null);

  // ── Apply CSS transform to DOM element ───────────────────────────────────

  const applyTransform = useCallback((state: TransformState) => {
    const el = containerRef.current;
    if (!el) return;
    // transform-origin at top-left so our translate math holds
    el.style.transformOrigin = "0 0";
    el.style.transform =
      `translate(${state.translateX.toFixed(3)}px, ${state.translateY.toFixed(3)}px) ` +
      `scale(${state.scale.toFixed(4)})`;
  }, [containerRef]);

  // ── Animation engine ──────────────────────────────────────────────────────

  const cancelAnimation = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const runAnimation = useCallback((
    toFocalX: number,
    toFocalY: number,
    toScale: number,
    durationMs: number,
    source: ZoomTriggerSource,
    easingKey: ZoomRequest["easing"] = "ease-in-out-cubic"
  ) => {
    cancelAnimation();

    const container = containerRef.current;
    if (!container) return;

    const { width, height } = container.getBoundingClientRect();
    const fromState = { ...transformRef.current };
    const startTime = performance.now();
    const ease = easingFns[easingKey ?? "ease-in-out-cubic"];

    // Register segment
    const segId = `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    currentSegmentIdRef.current = segId;
    segmentStartMsRef.current = Date.now();

    // Update reactive source
    activeSourceRef.current = source;
    setActiveSource(source);
    setScale(toScale);

    function frame(now: number) {
      const elapsed = now - startTime;
      const rawT = Math.min(elapsed / durationMs, 1);
      const t = ease(rawT);

      const next = interpolateTransform(
        fromState,
        toFocalX,
        toFocalY,
        toScale,
        t,
        width,
        height
      );

      transformRef.current = next;
      applyTransform(next);

      if (rawT < 1) {
        animRef.current = requestAnimationFrame(frame);
      } else {
        animRef.current = null;
      }
    }

    animRef.current = requestAnimationFrame(frame);
  }, [containerRef, cancelAnimation, applyTransform]);

  // ── Public: zoomTo ────────────────────────────────────────────────────────

  const zoomTo = useCallback((req: ZoomRequest) => {
    const currentPriority = activeSourceRef.current
      ? SOURCE_PRIORITY[activeSourceRef.current]
      : -1;
    const requestPriority = SOURCE_PRIORITY[req.source];

    // Lower-priority sources can't interrupt higher-priority ones
    if (transformRef.current.scale !== 1 && requestPriority < currentPriority) {
      return;
    }

    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, req.scale));
    const clampedX = Math.max(0, Math.min(1, req.focalX));
    const clampedY = Math.max(0, Math.min(1, req.focalY));

    runAnimation(clampedX, clampedY, clampedScale, req.durationMs, req.source, req.easing);
  }, [runAnimation]);

  // ── Public: resetZoom ─────────────────────────────────────────────────────

  const resetZoom = useCallback((durationMs = RESET_DURATION_MS) => {
    // Close the current zoom segment
    if (currentSegmentIdRef.current) {
      const segId = currentSegmentIdRef.current;
      setSegments(prev =>
        prev.map(s => s.id === segId ? { ...s, endMs: Date.now() } : s)
      );
      currentSegmentIdRef.current = null;
    }

    activeSourceRef.current = null;
    setActiveSource(null);
    setScale(1);

    runAnimation(0.5, 0.5, 1, durationMs, "manual", "ease-out-expo");
  }, [runAnimation]);

  // ── Hover trigger ─────────────────────────────────────────────────────────

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const { left, top, width, height } = container.getBoundingClientRect();
    const nx = (e.clientX - left) / width;
    const ny = (e.clientY - top) / height;

    lastHoverPosRef.current = { nx, ny };

    // Clear pending hover timer
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

    // ── Edge pan detection ────────────────────────────────────────────────
    if (transformRef.current.scale > 1) {
      let panFocalX = transformRef.current.focalX;
      let panFocalY = transformRef.current.focalY;
      let didPan = false;

      if (nx < EDGE_PAN_ZONE) {
        panFocalX = Math.max(0, transformRef.current.focalX - 0.15);
        didPan = true;
      } else if (nx > 1 - EDGE_PAN_ZONE) {
        panFocalX = Math.min(1, transformRef.current.focalX + 0.15);
        didPan = true;
      }
      if (ny < EDGE_PAN_ZONE) {
        panFocalY = Math.max(0, transformRef.current.focalY - 0.15);
        didPan = true;
      } else if (ny > 1 - EDGE_PAN_ZONE) {
        panFocalY = Math.min(1, transformRef.current.focalY + 0.15);
        didPan = true;
      }

      if (didPan) {
        zoomTo({
          focalX: panFocalX,
          focalY: panFocalY,
          scale: transformRef.current.scale,
          durationMs: EDGE_PAN_DURATION_MS,
          source: "edge_pan",
          easing: "ease-out-expo",
        });
        return;
      }
    }

    // ── Hover-to-zoom (only when at 1×) ───────────────────────────────────
    if (transformRef.current.scale === 1) {
      hoverTimerRef.current = setTimeout(() => {
        // Re-read latest position in case mouse moved slightly
        const { nx: hx, ny: hy } = lastHoverPosRef.current;
        zoomTo({
          focalX: hx,
          focalY: hy,
          scale: HOVER_ZOOM_SCALE,
          durationMs: HOVER_ZOOM_DURATION_MS,
          source: "hover",
          easing: "ease-in-out-cubic",
        });
      }, HOVER_DELAY_MS);
    }
  }, [containerRef, zoomTo]);

  const onMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // If zoomed via hover only, reset on leave
    if (activeSourceRef.current === "hover") {
      resetZoom();
    }
  }, [resetZoom]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimation();
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (pendingRafRef.current) cancelAnimationFrame(pendingRafRef.current);
    };
  }, [cancelAnimation]);

  return {
    scale,
    activeSource,
    segments,
    zoomTo,
    resetZoom,
    onMouseMove,
    onMouseLeave,
    cancelAnimation,
  };
}
