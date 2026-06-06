"use client";

import { useRef, useEffect } from "react";

interface Props {
  stream: MediaStream;
  isRecording: boolean;
}

/**
 * Live audio waveform rendered on a Canvas element.
 * Uses the Web Audio API AnalyserNode for real-time frequency data.
 */
export function WaveformPreview({ stream, isRecording }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current!;
    const cCtx = canvas.getContext("2d")!;

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      cCtx.clearRect(0, 0, canvas.width, canvas.height);

      cCtx.lineWidth = 2;
      cCtx.strokeStyle = isRecording ? "#f97316" : "#64748b";
      cCtx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) {
          cCtx.moveTo(x, y);
        } else {
          cCtx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      cCtx.lineTo(canvas.width, canvas.height / 2);
      cCtx.stroke();
    }

    draw();

    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      ctx.close();
    };
  }, [stream, isRecording]);

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={40}
      className="waveform-canvas rounded-lg opacity-80"
    />
  );
}
