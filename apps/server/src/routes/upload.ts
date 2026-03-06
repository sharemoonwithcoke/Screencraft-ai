import type { FastifyInstance } from "fastify";
import { StorageService } from "../services/storage.js";
import { db } from "../db/index.js";
import { recordingChunks } from "../db/schema.js";
import { randomUUID } from "crypto";

export async function uploadRoutes(fastify: FastifyInstance) {
  const storage = new StorageService();

  /**
   * POST /upload
   * Multipart chunked upload.
   * Headers: x-recording-id, x-chunk-index, x-total-chunks
   */
  fastify.post("/", async (req, reply) => {
    const data = await req.file();

    if (!data) {
      reply.code(400);
      return { ok: false, error: { code: "BAD_REQUEST", message: "No file received" } };
    }

    const recordingId = req.headers["x-recording-id"] as string;
    const chunkIndex = Number(req.headers["x-chunk-index"]);
    const totalChunks = Number(req.headers["x-total-chunks"]);

    if (!recordingId) {
      reply.code(400);
      return { ok: false, error: { code: "BAD_REQUEST", message: "Missing x-recording-id header" } };
    }

    const buffer = await data.toBuffer();
    const s3Key = await storage.uploadChunk(recordingId, chunkIndex, buffer);

    await db.insert(recordingChunks).values({
      id: randomUUID(),
      recordingId,
      index: chunkIndex,
      s3Key,
      duration: 5,
    });

    const isLast = chunkIndex === totalChunks - 1;

    if (isLast) {
      // Trigger server-side concatenation asynchronously
      storage.assembleChunks(recordingId, totalChunks).catch((err) => {
        fastify.log.error(err, "Failed to assemble chunks");
      });
    }

    reply.code(201);
    return {
      ok: true,
      data: { s3Key, chunkIndex, isLast },
    };
  });
}
