import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { getAnalysisReport } from "@/lib/dev-store";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_API_KEY", message: "Add GEMINI_API_KEY to .env.local" } },
      { status: 503 }
    );
  }

  const { recordingId, elapsedSecs, spokenSoFar, preparedScript } = await req.json() as {
    recordingId?: string;
    elapsedSecs: number;
    spokenSoFar?: string;   // live CC transcript — what the user has said
    preparedScript?: string; // teleprompter content — what they planned to say
  };

  const report = recordingId ? getAnalysisReport(recordingId) : null;
  const minutes = Math.floor(elapsedSecs / 60);
  const seconds = elapsedSecs % 60;

  const sections: string[] = [];

  if (preparedScript?.trim()) {
    sections.push(`Prepared script (what they planned to cover):\n"${preparedScript.trim().slice(0, 600)}"`);
  }

  if (spokenSoFar?.trim()) {
    sections.push(`What they have said so far (live captions):\n"${spokenSoFar.trim().slice(-400)}"`);
  }

  if (report) {
    sections.push(
      `Quality analysis: score ${report.score.total}/100. Top issues: ${report.issues.slice(0, 3).map((i) => i.title).join("; ")}.`
    );
  }

  const context = sections.length
    ? sections.join("\n\n")
    : "No additional context available.";

  const prompt = `You are a live presentation coach. The presenter is ${minutes}m ${seconds}s into a screen recording demo.

${context}

Based on what they have already said and their prepared script, generate a natural 3-5 sentence continuation they can speak right now.
- Pick up smoothly from where they left off (don't repeat what was already said)
- Cover any key points from the prepared script not yet mentioned
- End with a clear next step or call-to-action
Return only the script text — no labels, no preamble, just the words they should say.`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    const result = await model.generateContent(prompt);
    const script = result.response.text().trim();
    return NextResponse.json({ ok: true, data: { script } });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "AI_ERROR", message: err.message ?? "Gemini request failed" } },
      { status: 500 }
    );
  }
}
