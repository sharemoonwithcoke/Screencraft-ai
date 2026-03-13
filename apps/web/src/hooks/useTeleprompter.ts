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
  const [spokenLineIndex, setSpokenLineIndex] = useState(-1);
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

  // Track spoken lines based on scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) { setSpokenLineIndex(-1); return; }
      const progress = scrollTop / maxScroll;
      // The line currently at the top-center of the viewport is being read
      // Lines above that fraction of total lines are "spoken"
      setSpokenLineIndex(Math.floor(progress * lines.length) - 1);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [lines.length]);

  useEffect(() => {
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  return {
    containerRef,
    lines,
    missedLines,
    spokenLineIndex,
    isScrolling,
    startAutoScroll,
    stopAutoScroll,
    markLineMissed,
    clearMissedLines,
  };
}
