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

export interface CoachingResult {
  wpm: number;
  fillerWords: string[];
  pauseDetected: boolean;
  monotone: boolean;
  transcript: string;
}

const FALLBACK: CoachingResult = {
  wpm: 0,
  fillerWords: [],
  pauseDetected: false,
  monotone: false,
  transcript: "",
};

export async function POST(req: NextRequest) {
  const { audio, mimeType } = (await req.json()) as { audio: string; mimeType: string };

  if (!audio) {
    return NextResponse.json({ ok: false, error: { code: "MISSING_AUDIO" } }, { status: 400 });
  }

  if (!GEMINI_KEY) {
    return NextResponse.json({ ok: false, error: { code: "NO_API_KEY" } }, { status: 500 });
  }

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || "audio/webm",
                  data: audio,
                },
              },
              {
                text: `Analyze this short audio clip from a live screen recording session.
Return JSON only, no explanation:
{
  "wpm": 120,
  "fillerWords": ["um", "like"],
  "pauseDetected": false,
  "monotone": false,
  "transcript": "exact words spoken"
}`,
              },
            ],
          },
        ],
      }),
    }
  );

  if (!geminiRes.ok) {
    return NextResponse.json({ ok: false, error: { code: "GEMINI_ERROR" } }, { status: 502 });
  }

  const geminiData = await geminiRes.json();
  const text: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const result = parseJson<CoachingResult>(text, FALLBACK);

  return NextResponse.json({ ok: true, data: result });
}
