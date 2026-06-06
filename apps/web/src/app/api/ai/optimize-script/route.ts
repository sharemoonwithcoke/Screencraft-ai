import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

function parseJson<T>(text: string, fallback: T): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const { script } = await req.json();
  if (!script?.trim()) {
    return NextResponse.json({ ok: false, error: { code: "EMPTY_SCRIPT" } }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_API_KEY", message: "GEMINI_API_KEY is not configured" } },
      { status: 503 }
    );
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `You are a demo script optimization assistant. Improve the following teleprompter script for a software demo recording.

Rules:
- Break long sentences into short, natural phrases (max 15 words per line)
- Add natural pause markers using "..." at transitions
- Improve clarity and flow
- Keep the original meaning and all key points
- Use conversational, engaging language
- Do NOT add any explanation or commentary — return the improved script only as plain text

Original script:
${script}

Improved script:`;

  try {
    const result = await model.generateContent(prompt);
    const optimized = result.response.text().trim();
    return NextResponse.json({ ok: true, data: { optimized } });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "GEMINI_ERROR", message: err.message ?? "AI request failed" } },
      { status: 500 }
    );
  }
}
