import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { recordings, analysisReports, scoringReports, editSessions, users, recordingChunks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID, createHash } from "crypto";
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
  thumbnailUrl: z.string().optional(),
});

/**
 * Resolve the calling user from trusted server-to-server headers set by the
 * Next.js API layer (which has already verified the NextAuth session).
 * Upserts the user so the FK constraint on recordings.user_id is always satisfied.
 * Returns the stable user ID.
 */
async function resolveUserId(req: FastifyRequest): Promise<string> {
  const email = (req.headers["x-user-email"] as string | undefined)?.trim() || "guest@screencraft.app";
  const name  = (req.headers["x-user-name"]  as string | undefined)?.trim() || "Guest";
  // Stable 32-char hex ID derived from the email — same email always produces the same ID
  const id = createHash("sha256").update(email).digest("hex").slice(0, 32);
  await db.insert(users).values({ id, email, name }).onConflictDoNothing();
  return id;
}

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
    const userId = await resolveUserId(req);
    const id = randomUUID();

    const [recording] = await db
      .insert(recordings)
      .values({
        id,
        userId,
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

  // POST /recordings/:id/analyze — trigger 3-step Gemini pipeline (async job)
  fastify.post<{ Params: { id: string } }>("/:id/analyze", async (req, reply) => {
    const recordingId = req.params.id;
    const body = req.body as { transcript?: string; videoType?: string; audienceType?: string } | null ?? {};
    const videoType  = body.videoType  ?? "PRODUCT_DEMO";
    const audienceType = body.audienceType ?? "mixed";

    // Mark as processing
    await db
      .update(recordings)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(recordings.id, recordingId));

    // Fire-and-forget: visual + speech in parallel, then edit plan
    // Wrap in a 5-minute hard timeout — if any GCS/Gemini call hangs
    // indefinitely the recording will be marked error instead of stuck forever.
    const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Analysis timed out after 5 minutes")), ANALYSIS_TIMEOUT_MS)
    );

    Promise.race([
      (async () => {
        try {
          // Step 0: assemble WebSocket chunks into output.mp4 (skipped if no chunks)
          const chunkRows = await db
            .select({ id: recordingChunks.id })
            .from(recordingChunks)
            .where(eq(recordingChunks.recordingId, recordingId))
            .limit(1);
          if (chunkRows.length > 0) {
            await ffmpeg.assembleChunks(recordingId).catch((err) => {
              fastify.log.warn({ err, recordingId }, "Assembly failed — continuing with text-only analysis");
            });
          }

          // Step 1: collect transcript (streamed → joined)
          let transcript = body.transcript ?? "";
          if (!transcript) {
            try {
              for await (const chunk of gemini.streamTranscript(recordingId)) {
                transcript += chunk;
              }
            } catch (err) {
              fastify.log.warn({ err, recordingId }, "Transcript stream failed — proceeding without transcript");
            }
          }

          // Step 2: visual analysis + speech analysis + chapter markers — all in parallel
          // Visual analysis requires the video file; fall back to empty result if unavailable.
          const [visualResult, audioResult, chaptersResult] = await Promise.all([
            gemini.analyzeVisual(recordingId, videoType, audienceType).catch((err) => {
              fastify.log.warn({ err, recordingId }, "Visual analysis failed — using empty result");
              return { visual_issues: [] as import("../services/gemini.js").VisualIssue[] };
            }),
            gemini.analyzeSpeech(transcript, videoType, audienceType),
            gemini.generateChapters(transcript, videoType),
          ]);

          // Step 3: generate edit plan from both issue sets
          // Extract recording duration from the last [MM:SS] timestamp in the transcript
          const tsMatches = transcript.match(/\[(\d+):(\d+)\]/g) ?? [];
          let recordingDurationSeconds = 0;
          if (tsMatches.length > 0) {
            const lastTs = tsMatches[tsMatches.length - 1].match(/\[(\d+):(\d+)\]/)!;
            recordingDurationSeconds = Number(lastTs[1]) * 60 + Number(lastTs[2]);
          }
          const editPlan = gemini.generateEditPlan(
            visualResult,
            audioResult,
            recordingDurationSeconds,
            [], // screenChangeTimestamps reserved for future integration
            chaptersResult.chapters,
          );

          // Persist combined analysis report
          await db.insert(analysisReports).values({
            id: randomUUID(),
            recordingId,
            score: {},   // score breakdown reserved for future model
            issuesJson: {
              visual_issues: visualResult.visual_issues,
              audio_issues: audioResult.audio_issues,
              edit_plan: editPlan,
              chapters: chaptersResult.chapters,
            },
          });

          await db
            .update(recordings)
            .set({ status: "ready", updatedAt: new Date() })
            .where(eq(recordings.id, recordingId));

          // Delete the uploaded file from Gemini to free quota
          gemini.cleanupRecording(recordingId).catch(() => {});
        } catch (err: any) {
          const message = err?.message ?? String(err);
          fastify.log.error({ err, recordingId, message }, "Analysis pipeline failed");
          await db
            .update(recordings)
            .set({
              status: "error",
              resolution: message.slice(0, 500),
              updatedAt: new Date(),
            })
            .where(eq(recordings.id, recordingId));
        }
      })(),
      timeoutPromise,
    ]).catch(async (err: any) => {
      const message = err?.message ?? String(err);
      fastify.log.error({ recordingId, message }, "Analysis pipeline aborted");
      await db
        .update(recordings)
        .set({ status: "error", resolution: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(recordings.id, recordingId));
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

  // POST /recordings/:id/report — upsert the Next.js-format scoring report
  fastify.post<{ Params: { id: string } }>("/:id/report", async (req, reply) => {
    const recordingId = req.params.id;
    const body = req.body as { report: unknown };

    if (!body?.report || typeof body.report !== "object") {
      reply.code(400);
      return { ok: false, error: { code: "BAD_REQUEST", message: "Missing report object" } };
    }

    await db
      .insert(scoringReports)
      .values({ id: randomUUID(), recordingId, reportJson: body.report })
      .onConflictDoUpdate({
        target: scoringReports.recordingId,
        set: { reportJson: body.report, updatedAt: new Date() },
      });

    reply.code(200);
    return { ok: true };
  });

  // GET /recordings/:id/report — retrieve the Next.js-format scoring report
  fastify.get<{ Params: { id: string } }>("/:id/report", async (req, reply) => {
    const [row] = await db
      .select()
      .from(scoringReports)
      .where(eq(scoringReports.recordingId, req.params.id))
      .limit(1);

    if (!row) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "No scoring report yet" } };
    }

    return { ok: true, data: row.reportJson };
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
