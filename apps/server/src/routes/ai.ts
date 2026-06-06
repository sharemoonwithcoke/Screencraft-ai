import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GeminiService } from "../services/gemini.js";
import { db } from "../db/index.js";
import { analysisReports } from "../db/schema.js";

export async function aiRoutes(fastify: FastifyInstance) {
  const gemini = new GeminiService();

  /**
   * GET /ai/diagnose
   * Tests the two distinct Gemini API surfaces independently so you can see
   * exactly which one is failing and what error it returns.
   *
   * Generation API  — used by live coach, stuck hints, script optimizer
   * Files API       — used by analyzeVisual, streamTranscript, edit-plan
   */
  fastify.get("/diagnose", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return { ok: false, error: "GEMINI_API_KEY is not set on the server" };
    }

    const results: Record<string, string> = {};

    // ── Test 1: Generation API (text-only, no file upload) ──────────────────
    try {
      const client = new GoogleGenerativeAI(key);
      const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });
      const res = await model.generateContent("Reply with the single word OK");
      results.generation_api = `ok — model replied: "${res.response.text().trim().slice(0, 40)}"`;
    } catch (err: any) {
      results.generation_api = `FAIL — ${err?.message ?? String(err)}`;
    }

    // ── Test 2: Files API (upload a tiny text file, then delete it) ─────────
    const tmpPath = path.join(os.tmpdir(), `sc-diag-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tmpPath, "screencraft files api diagnostic probe");
      const fileManager = new GoogleAIFileManager(key);
      const upload = await fileManager.uploadFile(tmpPath, {
        mimeType: "text/plain",
        displayName: "sc-diag-probe",
      });
      await fileManager.deleteFile(upload.file.name).catch(() => {});
      results.files_api = `ok — uploaded as ${upload.file.name}`;
    } catch (err: any) {
      results.files_api = `FAIL — ${err?.message ?? String(err)}`;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    const allOk = Object.values(results).every((v) => v.startsWith("ok"));
    return { ok: allOk, data: results };
  });

  /**
   * POST /ai/transcript (streaming SSE)
   * Live audio → Gemini streaming transcript.
   * Client sends audio chunks; server streams back text events.
   */
  fastify.post<{ Body: { recordingId: string; language?: string } }>(
    "/transcript",
    async (req, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const stream = gemini.streamTranscript(req.body.recordingId, req.body.language);

      for await (const chunk of stream) {
        reply.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      reply.raw.end();
    }
  );

  /**
   * POST /ai/suggest
   * Fetch stored analysis issues and generate an edit plan via Prompt 4.
   */
  fastify.post<{
    Body: { recordingId: string; analysisReportId: string };
  }>("/suggest", async (req, reply) => {
    const [report] = await db
      .select()
      .from(analysisReports)
      .where(eq(analysisReports.id, req.body.analysisReportId))
      .limit(1);

    if (!report) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "Analysis report not found" } };
    }

    const issues = report.issuesJson as {
      visual_issues?: unknown[];
      audio_issues?: unknown[];
    } ?? {};

    const editPlan = await gemini.generateEditPlan(
      { visual_issues: (issues.visual_issues ?? []) as never },
      { audio_issues: (issues.audio_issues ?? []) as never },
      0,  // recordingDurationSeconds unknown at re-plan time
      [], // screenChangeTimestamps reserved for future integration
    );

    return { ok: true, data: editPlan };
  });
}
