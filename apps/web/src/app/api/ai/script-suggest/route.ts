import { NextRequest } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Gemini multimodal + streaming is fast, but give it room for slow networks
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!process.env.GEMINI_API_KEY) return new Response("No API key", { status: 503 });

  let screenshot: File | null = null;
  let transcript = "";
  let script     = "";
  let goals      = "{}";
  let trigger    = "change";

  try {
    const fd = await req.formData();
    screenshot = fd.get("screenshot") as File | null;
    transcript = (fd.get("transcript") as string | null) ?? "";
    script     = (fd.get("script")     as string | null) ?? "";
    goals      = (fd.get("goals")      as string | null) ?? "{}";
    trigger    = (fd.get("trigger")    as string | null) ?? "change";
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (!screenshot || screenshot.size === 0) {
    return new Response("No screenshot", { status: 400 });
  }

  const imgBytes = await screenshot.arrayBuffer();
  const base64   = Buffer.from(imgBytes).toString("base64");
  const mimeType = (screenshot.type || "image/jpeg").split(";")[0];

  let parsedGoals: { objectives?: string; audienceType?: string } = {};
  try { parsedGoals = JSON.parse(goals); } catch { /* ignore */ }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Build compact context block
  const ctxParts: string[] = [];
  if (transcript) ctxParts.push(`Recently spoken: "${transcript}"`);
  if (script)     ctxParts.push(`Existing script (last few lines):\n${script}`);
  if (parsedGoals.objectives)  ctxParts.push(`Goal: ${parsedGoals.objectives}`);
  if (parsedGoals.audienceType) ctxParts.push(`Audience: ${parsedGoals.audienceType}`);

  const triggerLine = trigger === "pause"
    ? "The presenter paused. Suggest a natural next sentence to continue the narration."
    : "The screen content just changed. Narrate the new state for the viewer.";

  const prompt = [
    "You are a live teleprompter writer for a software demo screen recording.",
    triggerLine,
    "",
    ...ctxParts,
    "",
    "Generate 1–2 short sentences the presenter should say next.",
    "Rules:",
    "- Output ONLY the sentences — no preamble, no markdown, no labels",
    "- Each sentence must be under 15 words",
    "- Natural first-person voice: \"Now I'll…\", \"Here you can see…\", \"Let me show you…\"",
    "- Do not repeat anything already spoken",
    "- Sound conversational, as if speaking live to an audience",
  ].join("\n");

  // SSE stream — one sentence at a time as Gemini streams tokens
  const responseStream = new ReadableStream({
    async start(controller) {
      const enc  = new TextEncoder();
      const send = (sentence: string) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ sentence })}\n\n`));

      // Regex: match up to the first sentence-terminating punctuation (.!?)
      // followed by optional closing chars and whitespace/end-of-string.
      const sentenceRe = /[^.!?]*[.!?]["')\]]*(?=\s|$)/g;

      try {
        const result = await model.generateContentStream([
          { inlineData: { mimeType, data: base64 } },
          prompt,
        ]);

        let buf = "";
        for await (const chunk of result.stream) {
          buf += chunk.text();
          sentenceRe.lastIndex = 0;
          let last = 0;
          let m: RegExpExecArray | null;
          while ((m = sentenceRe.exec(buf)) !== null) {
            const s = m[0].trim();
            if (s) send(s);
            last = sentenceRe.lastIndex;
          }
          buf = buf.slice(last);
        }
        // Flush anything remaining (last sentence may lack trailing space)
        if (buf.trim()) send(buf.trim());
      } catch (err: any) {
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ error: err?.message ?? "Gemini error" })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
