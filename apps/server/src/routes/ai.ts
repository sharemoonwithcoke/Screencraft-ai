import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { GeminiService } from "../services/gemini.js";
import { db } from "../db/index.js";
import { analysisReports } from "../db/schema.js";

export async function aiRoutes(fastify: FastifyInstance) {
  const gemini = new GeminiService();

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
      { audio_issues: (issues.audio_issues ?? []) as never }
    );

    return { ok: true, data: editPlan };
  });
}
