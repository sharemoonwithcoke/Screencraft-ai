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

  const { visualIssues, audioIssues } = await req.json();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `You are a professional video editor.
Below are two analysis reports for the same demo video:
Visual analysis result: ${JSON.stringify(visualIssues ?? { visual_issues: [] })}
Audio analysis result: ${JSON.stringify(audioIssues ?? { audio_issues: [] })}
Based on these two reports, generate a final edit plan:
- Prioritize deleting segments with severity: high
- Insert silence where pauses are insufficient
- Insert TTS narration where explanation is unclear
- Ensure the edited video remains logically coherent
Output JSON only, no additional commentary.
Output format:
{
  "edit_instructions": [
    {
      "action": "delete",
      "start": "0:45",
      "end": "0:52",
      "reason": "erratic mouse movement"
    }
  ],
  "summary": "X issues found. Y segments deleted, Z pauses inserted."
}`;

  try {
    const result = await model.generateContent([prompt]);
    const editPlan = parseJson(result.response.text(), {
      edit_instructions: [],
      summary: "No edits generated.",
    });
    return NextResponse.json({ ok: true, data: editPlan });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "AI_ERROR", message: err.message } },
      { status: 500 }
    );
  }
}
