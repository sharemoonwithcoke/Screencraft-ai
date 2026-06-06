import { NextRequest } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 });
  }

  const { recordingId, language = "en" } = await req.json();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await model.generateContentStream(
          `Transcribe the audio from this recording (ID: ${recordingId}) in ${language}. ` +
          `Return only the spoken text with timestamps in [MM:SS] format, no metadata.`
        );
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`)
            );
          }
        }
      } catch (err: any) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
