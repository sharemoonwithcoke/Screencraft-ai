"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UseTeleprompterOptions {
  content: string;
  scrollSpeedWpm?: number; // words per minute → auto-scroll speed
}

export function useTeleprompter({
  content,
  scrollSpeedWpm = 130,
}: UseTeleprompterOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [missedLines, setMissedLines] = useState<Set<number>>(new Set());
  const [isScrolling, setIsScrolling] = useState(false);
  const animRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startScrollTopRef = useRef(0);

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const totalWords = lines.reduce((acc, l) => acc + l.split(/\s+/).length, 0);

  // Duration to scroll full content at given WPM
  const totalDurationMs = (totalWords / scrollSpeedWpm) * 60 * 1000;

  const startAutoScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setIsScrolling(true);
    startTimeRef.current = performance.now();
    startScrollTopRef.current = container.scrollTop;
    const maxScroll = container.scrollHeight - container.clientHeight;

    function frame(now: number) {
      if (!startTimeRef.current) return;
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(elapsed / totalDurationMs, 1);
      if (container) {
        container.scrollTop =
          startScrollTopRef.current + (maxScroll - startScrollTopRef.current) * progress;
      }
      if (progress < 1) {
        animRef.current = requestAnimationFrame(frame);
      } else {
        setIsScrolling(false);
      }
    }

    animRef.current = requestAnimationFrame(frame);
  }, [totalDurationMs]);

  const stopAutoScroll = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    setIsScrolling(false);
    startTimeRef.current = null;
  }, []);

  const markLineMissed = useCallback((lineIndex: number) => {
    setMissedLines((prev) => new Set([...prev, lineIndex]));
  }, []);

  const clearMissedLines = useCallback(() => {
    setMissedLines(new Set());
  }, []);

  const adjustSpeed = useCallback(
    (newWpm: number) => {
      // Restart scroll from current position with new speed
      stopAutoScroll();
      // Re-initialize with new WPM — caller should update scrollSpeedWpm
    },
    [stopAutoScroll]
  );

  useEffect(() => {
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  return {
    containerRef,
    lines,
    missedLines,
    isScrolling,
    startAutoScroll,
    stopAutoScroll,
    markLineMissed,
    clearMissedLines,
  };
}
