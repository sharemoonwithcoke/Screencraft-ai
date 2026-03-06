import type { FastifyInstance } from "fastify";
import { GeminiService } from "../services/gemini.js";

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

      const stream = await gemini.streamTranscript(req.body.recordingId, req.body.language);

      for await (const chunk of stream) {
        reply.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      reply.raw.end();
    }
  );

  /**
   * POST /ai/suggest
   * Generate edit suggestions from an analysis report.
   */
  fastify.post<{
    Body: { recordingId: string; analysisReportId: string };
  }>("/suggest", async (req) => {
    const suggestions = await gemini.generateEditSuggestions(
      req.body.recordingId,
      req.body.analysisReportId
    );
    return { ok: true, data: suggestions };
  });
}
