"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface LiveCC {
  supported: boolean;
  enabled: boolean;
  transcript: string;
  wordCount: number;
  avgConfidence: number;
  toggle: () => void;
  stop: () => void;
}

export function useLiveCC(): LiveCC {
  const [enabled, setEnabled] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [avgConfidence, setAvgConfidence] = useState(0.75);

  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(false);
  const confidenceSamplesRef = useRef<number[]>([]);

  // Compute after mount to avoid SSR/hydration mismatch
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(
      !!(
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition
      )
    );
  }, []);

  const stop = useCallback(() => {
    enabledRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setEnabled(false);
    setTranscript("");
    setWordCount(0);
    setAvgConfidence(0.75);
    confidenceSamplesRef.current = [];
  }, []);

  const start = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      let newWords = 0;

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          final += text + " ";
          newWords += text.trim().split(/\s+/).filter(Boolean).length;

          // Track per-result confidence (Web Speech API provides this on final results)
          const conf: number = result[0].confidence;
          if (conf > 0) {
            confidenceSamplesRef.current.push(conf);
            if (confidenceSamplesRef.current.length > 12) {
              confidenceSamplesRef.current.shift();
            }
            const avg =
              confidenceSamplesRef.current.reduce((a, b) => a + b, 0) /
              confidenceSamplesRef.current.length;
            setAvgConfidence(avg);
          }
        } else {
          interim += text;
        }
      }

      if (newWords > 0) setWordCount((prev) => prev + newWords);

      // Keep last ~120 chars so the CC overlay doesn't overflow
      const full = (final + interim).slice(-120);
      setTranscript(full);
    };

    recognition.onerror = () => stop();

    // Auto-restart when the browser stops recognition (~1 min timeout)
    recognition.onend = () => {
      if (enabledRef.current && recognitionRef.current === recognition) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    enabledRef.current = true;
    setEnabled(true);
  }, [stop]);

  const toggle = useCallback(() => {
    if (enabledRef.current) stop();
    else start();
  }, [start, stop]);

  // Cleanup on unmount
  useEffect(() => () => { stop(); }, [stop]);

  return { supported, enabled, transcript, wordCount, avgConfidence, toggle, stop };
}
