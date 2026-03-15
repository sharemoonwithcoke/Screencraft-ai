import { NextRequest, NextResponse } from "next/server";

const GEMINI_KEY = process.env.GEMINI_API_KEY!;

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
  const { script } = await req.json();

  if (!script?.trim()) {
    return NextResponse.json({ ok: false, error: { code: "MISSING_SCRIPT" } }, { status: 400 });
  }

  if (!GEMINI_KEY) {
    return NextResponse.json({ ok: false, error: { code: "NO_API_KEY" } }, { status: 500 });
  }

  const prompt = `You are a demo script optimization assistant.
The user has provided a teleprompter script. Please:
- Break it into short natural phrases (max 15 words each)
- Mark words that should be spoken slowly (key terms)
- Estimate reading time per line (in seconds)
- Suggest where mouse actions should accompany speech
Output JSON only, no additional commentary.
User script input: ${script}
Output format:
{
  "script_lines": [
    {
      "text": "First, let's open the settings page",
      "estimated_seconds": 3,
      "action_hint": "Move mouse toward the settings button",
      "emphasis": ["settings page"]
    }
  ],
  "total_estimated_seconds": 120
}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  if (!geminiRes.ok) {
    const err = await geminiRes.text();
    return NextResponse.json({ ok: false, error: { code: "GEMINI_ERROR", detail: err } }, { status: 502 });
  }

  const geminiData = await geminiRes.json();
  const text: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  const result = parseJson(text, { script_lines: [], total_estimated_seconds: 0 });
  return NextResponse.json({ ok: true, data: result });
}
