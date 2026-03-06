import type { Server, Socket } from "socket.io";
import { AiCueService } from "../services/ai-cue.js";
import { StorageService } from "../services/storage.js";
import { db } from "../db/index.js";
import { recordingChunks } from "../db/schema.js";

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
      try {
        // 1. Persist chunk to S3
        const s3Key = await storage.uploadChunk(
          payload.recordingId,
          payload.index,
          Buffer.from(payload.blob)
        );

        // 2. Insert chunk record
        await db.insert(recordingChunks).values({
          recordingId: payload.recordingId,
          index: payload.index,
          s3Key,
          duration: 5, // default chunk interval
        });

        // 3. Forward to AI cue service for real-time analysis
        await aiCue.processChunk(payload.recordingId, payload.index, s3Key);
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
