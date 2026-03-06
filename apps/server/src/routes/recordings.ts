import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { recordings, analysisReports, editSessions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { GeminiService } from "../services/gemini.js";
import { FFmpegService } from "../services/ffmpeg.js";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  region: z.enum(["fullscreen", "window", "custom"]),
  resolution: z.string().optional(),
  teleprompterContent: z.string().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["idle", "recording", "paused", "processing", "ready", "error"]).optional(),
});

export async function recordingsRoutes(fastify: FastifyInstance) {
  const gemini = new GeminiService();
  const ffmpeg = new FFmpegService();

  // GET /recordings
  fastify.get("/", async (req) => {
    const all = await db.select().from(recordings).orderBy(recordings.createdAt);
    return { ok: true, data: all };
  });

  // POST /recordings
  fastify.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const id = randomUUID();

    const [recording] = await db
      .insert(recordings)
      .values({
        id,
        userId: "stub-user", // replaced by real JWT extraction
        title: body.title,
        status: "idle",
        resolution: body.resolution ?? null,
      })
      .returning();

    reply.code(201);
    return { ok: true, data: recording };
  });

  // GET /recordings/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const [recording] = await db
      .select()
      .from(recordings)
      .where(eq(recordings.id, req.params.id));

    if (!recording) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "Recording not found" } };
    }

    return { ok: true, data: recording };
  });

  // PATCH /recordings/:id
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = updateSchema.parse(req.body);

    const [updated] = await db
      .update(recordings)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(recordings.id, req.params.id))
      .returning();

    if (!updated) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "Recording not found" } };
    }

    return { ok: true, data: updated };
  });

  // DELETE /recordings/:id
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await db.delete(recordings).where(eq(recordings.id, req.params.id));
    reply.code(204);
  });

  // POST /recordings/:id/analyze — trigger Gemini analysis (async job)
  fastify.post<{ Params: { id: string } }>("/:id/analyze", async (req, reply) => {
    const body = req.body as { scriptContent?: string };

    // Mark as processing
    await db
      .update(recordings)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(recordings.id, req.params.id));

    // Fire-and-forget analysis job
    gemini
      .analyzeRecording(req.params.id, body?.scriptContent)
      .then(async (report) => {
        await db.insert(analysisReports).values({
          id: randomUUID(),
          recordingId: req.params.id,
          score: report.score,
          issuesJson: report.issues,
        });
        await db
          .update(recordings)
          .set({ status: "ready", updatedAt: new Date() })
          .where(eq(recordings.id, req.params.id));
      })
      .catch(async (err) => {
        fastify.log.error(err, "Analysis failed");
        await db
          .update(recordings)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(recordings.id, req.params.id));
      });

    reply.code(202);
    return { ok: true, data: { message: "Analysis started" } };
  });

  // GET /recordings/:id/analysis
  fastify.get<{ Params: { id: string } }>("/:id/analysis", async (req, reply) => {
    const [report] = await db
      .select()
      .from(analysisReports)
      .where(eq(analysisReports.recordingId, req.params.id))
      .orderBy(analysisReports.createdAt)
      .limit(1);

    if (!report) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "No analysis report yet" } };
    }

    return { ok: true, data: report };
  });

  // POST /recordings/:id/export — trigger FFmpeg export job
  fastify.post<{ Params: { id: string } }>("/:id/export", async (req, reply) => {
    const body = req.body as {
      format: "mp4" | "webm";
      quality: "720p" | "1080p" | "4k";
      includeCaptions?: boolean;
    };

    // Kick off async FFmpeg job
    ffmpeg
      .exportRecording(req.params.id, body)
      .catch((err) => fastify.log.error(err, "Export failed"));

    reply.code(202);
    return { ok: true, data: { message: "Export started" } };
  });

  // GET /recordings/:id/edit-session
  fastify.get<{ Params: { id: string } }>("/:id/edit-session", async (req, reply) => {
    const [session] = await db
      .select()
      .from(editSessions)
      .where(eq(editSessions.recordingId, req.params.id))
      .limit(1);

    if (!session) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "No edit session" } };
    }

    return { ok: true, data: session };
  });
}
