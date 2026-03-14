import type { Server, Socket } from "socket.io";
import { AiCueService } from "../services/ai-cue.js";
import { StorageService } from "../services/storage.js";
import { db } from "../db/index.js";
import { recordingChunks } from "../db/schema.js";
import { randomUUID } from "crypto";

/**
 * Registers all Socket.io event handlers.
 *
 * Namespace: default (/)
 * Each socket must authenticate with a recordingId in the auth handshake.
 *
 * Events (client → server):
 *   recorder:chunk  — binary video chunk + metadata
 *   recorder:control — start | pause | resume | stop
 *
 * Events (server → client):
 *   ai:speech:rate, ai:teleprompter:miss, ai:zoom:trigger, etc.
 */
export function registerSocketHandlers(io: Server) {
  const storage = new StorageService();
  const aiCue = new AiCueService(io);

  io.on("connection", (socket: Socket) => {
    const recordingId = socket.handshake.auth?.recordingId as string | undefined;

    if (!recordingId) {
      socket.disconnect(true);
      return;
    }

    socket.join(`recording:${recordingId}`);
    socket.data.recordingId = recordingId;

    socket.on("recorder:chunk", async (payload: {
      blob: ArrayBuffer;
      timestamp: number;
      index: number;
      recordingId: string;
    }) => {
      const audioBuffer = Buffer.from(payload.blob);

      // 1 & 2. Persist to GCS + DB — non-fatal so local dev without GCS/DB still works
      let s3Key = `recordings/${payload.recordingId}/chunks/${String(payload.index).padStart(6, "0")}.webm`;
      try {
        s3Key = await storage.uploadChunk(payload.recordingId, payload.index, audioBuffer);
        await db.insert(recordingChunks).values({
          id: randomUUID(),
          recordingId: payload.recordingId,
          index: payload.index,
          s3Key,
          duration: 5,
        });
      } catch {
        // Storage / DB unavailable in local dev — proceed to AI analysis anyway
      }

      // 3. AI cue analysis — pass buffer directly to skip GCS download
      try {
        await aiCue.processChunk(payload.recordingId, payload.index, s3Key, audioBuffer);
      } catch (err) {
        socket.emit("recorder:error", { message: (err as Error).message });
      }
    });

    socket.on("recorder:control", (payload: {
      action: "start" | "pause" | "resume" | "stop";
      recordingId: string;
    }) => {
      aiCue.handleControl(payload.action, payload.recordingId);
    });

    socket.on("disconnect", () => {
      aiCue.cleanup(recordingId);
    });
  });
}
