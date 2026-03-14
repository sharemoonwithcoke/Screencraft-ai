import type { Server } from "socket.io";
import { GeminiService } from "./gemini.js";
import { StorageService } from "./storage.js";

/**
 * AiCueService — orchestrates real-time AI cue delivery.
 *
 * Flow per chunk:
 * 1. Fetch audio buffer from S3
 * 2. Run Gemini speech analysis
 * 3. Emit appropriate WebSocket events to the recording room
 */
export class AiCueService {
  private io: Server;
  private gemini: GeminiService;
  private storage: StorageService;

  // Per-recording state for consecutive filler word tracking
  private fillerState: Map<string, Record<string, number>> = new Map();

  constructor(io: Server) {
    this.io = io;
    this.gemini = new GeminiService();
    this.storage = new StorageService();
  }

  // directBuffer: pass the raw audio bytes to skip the GCS round-trip in local dev.
  async processChunk(recordingId: string, index: number, s3Key: string, directBuffer?: Buffer) {
    try {
      const audioBuffer = directBuffer ?? await this.storage.downloadChunk(s3Key);
      const analysis = await this.gemini.analyzeSpeechChunk(audioBuffer);

      const room = `recording:${recordingId}`;

      // ── Speech rate cue ──────────────────────────────────────────────────
      if (analysis.wpm > 0) {
        const level =
          analysis.wpm > 180 ? "fast" : analysis.wpm < 60 ? "slow" : "ok";
        this.io.to(room).emit("ai:speech:rate", { wpm: analysis.wpm, level });
      }

      // ── Pause detection ──────────────────────────────────────────────────
      if (analysis.pauseDetected) {
        this.io.to(room).emit("ai:pause:detected", { durationMs: 3500 });
      }

      // ── Filler words ─────────────────────────────────────────────────────
      if (analysis.fillerWords.length > 0) {
        const fillers = this.fillerState.get(recordingId) ?? {};
        for (const word of analysis.fillerWords) {
          fillers[word] = (fillers[word] ?? 0) + 1;
          if (fillers[word] >= 3) {
            this.io.to(room).emit("ai:filler:detected", {
              word,
              count: fillers[word],
            });
          }
        }
        this.fillerState.set(recordingId, fillers);
      }

      // ── Monotone detection ───────────────────────────────────────────────
      if (analysis.monotone) {
        this.io.to(room).emit("ai:monotone:detected", {
          durationMs: 30000,
          suggestion: "Try emphasizing a key word here",
        });
      }

      // ── Zoom trigger (voice-based) ────────────────────────────────────────
      if (analysis.transcript) {
        const zoomResult = await this.gemini.detectZoomTrigger(
          analysis.transcript,
          0.5, // cursor coordinates fetched from client state in V1
          0.5
        );
        if (zoomResult.shouldZoom) {
          this.io.to(room).emit("ai:zoom:trigger", {
            x: zoomResult.zoomX,
            y: zoomResult.zoomY,
            scale: zoomResult.scale,
            duration: 500,
            trigger: "keyword",
          });
        } else if (zoomResult.shouldReset) {
          this.io.to(room).emit("ai:zoom:reset", { duration: 400 });
        }

        // ── Hold-on / thinking pause blur ────────────────────────────────
        const holdPhrases = ["hold on", "wait", "let me think"];
        if (holdPhrases.some((p) => analysis.transcript.toLowerCase().includes(p))) {
          this.io.to(room).emit("ai:blur:toggle", {
            active: true,
            reason: "hold_on",
          });
          setTimeout(() => {
            this.io.to(room).emit("ai:blur:toggle", { active: false, reason: "hold_on" });
          }, 4000);
        }
      }
    } catch (err) {
      // Non-fatal — AI cues are best-effort
      console.error("AI cue processing error:", err);
    }
  }

  handleControl(action: string, recordingId: string) {
    if (action === "stop") {
      this.cleanup(recordingId);
    }
  }

  cleanup(recordingId: string) {
    this.fillerState.delete(recordingId);
  }
}
