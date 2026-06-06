import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 30;

export interface StuckHint {
  hint: string | null;
  can_insert_to_script: boolean;
  detected_ui: string;
}

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

  const fd = await req.formData();
  const screenshot = fd.get("screenshot") as File | null;
  const spokenSoFar = (fd.get("spokenSoFar") as string) ?? "";
  const currentScriptLine = (fd.get("currentScriptLine") as string) ?? "";
  const fullScript = (fd.get("fullScript") as string) ?? "";
  const videoType = (fd.get("videoType") as string) || "PRODUCT_DEMO";

  if (!screenshot || screenshot.size === 0) {
    return NextResponse.json({ ok: false, error: { code: "NO_SCREENSHOT" } }, { status: 400 });
  }

  const imageBytes = await screenshot.arrayBuffer();
  const imageBase64 = Buffer.from(imageBytes).toString("base64");
  const mimeType = (screenshot.type || "image/jpeg") as "image/jpeg" | "image/png";

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: {
        type: "object",
        properties: {
          hint:                 { type: "string", nullable: true },
          can_insert_to_script: { type: "boolean" },
          detected_ui:          { type: "string" },
        },
        required: ["hint", "can_insert_to_script", "detected_ui"],
      } as any,
    },
  });

  try {
    const result = await model.generateContent([
      { inlineData: { mimeType, data: imageBase64 } },
      `You are an AI presentation assistant helping a user who has paused for over 3 seconds during a recording session.
The video type is: ${videoType}

VIDEO TYPE CONTEXT AND GENERATION STYLE:

If video_type is PRODUCT_DEMO:
You are a confident, enthusiastic product specialist helping someone showcase a tech product
to potential customers or clients. Your hints should sound like a polished sales engineer —
highlight the value and benefit of what is on screen, not just describe it. Use language
like "this is where you can...", "one of the most powerful features here is...", "customers
love this because...". Generate hints that make the product sound compelling and easy to use.

If video_type is TECHNICAL_DEMO:
You are a senior engineer helping a teammate walk through a technical implementation. Your
hints should be precise and step-oriented. Use language like "next you'll want to show...",
"this is a good moment to explain why...", "walk them through what happens when...". Assume
the audience understands technical concepts — no need to oversimplify.

If video_type is TUTORIAL:
You are a patient, encouraging instructor helping someone teach a product to new users.
Your hints should be clear, sequential, and reassuring. Use language like "now show them
how to...", "remind viewers that they need to...", "this is a good place to pause and let
them follow along". Every hint should move the viewer one concrete step forward.

If video_type is PRESENTATION:
You are a presentation coach helping someone deliver a compelling slide deck. Your hints
should connect what is on screen to the speaker's narrative. Use language like "this slide
is a good moment to...", "tie this back to your main point by...", "your audience is
reading this slide now, so...". Focus on storytelling and flow, not just content description.

You have three sources of context:
1. SCREENSHOT: what is currently visible on screen — use this to identify what feature or
   step is being demonstrated right now.
2. SPOKEN SO FAR: the full transcript of everything the user has said since recording
   started — use this to understand what has already been covered and where in the
   presentation the user currently is.
3. FULL SCRIPT: the user's prepared script — use this to understand what they intended to
   say next and what content is still ahead.

Using all three sources, generate a natural 1–2 sentence hint that helps the user continue
from exactly where they left off. The hint should pick up naturally from the last thing they
said and guide them toward what the script says should come next. The tone and language of
the hint must match the video type style defined above.

Spoken so far: "${spokenSoFar}"
Current script line: "${currentScriptLine}"
Full script: "${fullScript}"

Rules:
- If the screenshot is blank, loading, or shows an error page, return:
  { "hint": null, "can_insert_to_script": false, "detected_ui": "loading" or "error" }
- Maximum two sentences. Tone must match video type style above.
- Do not repeat what the user already said — move forward.
- If the script has a clear next step, guide toward it naturally.
- If the screenshot shows something not in the script, acknowledge what is on screen and
  bridge back to the script naturally.

Return JSON only: { "hint": "<string or null>", "can_insert_to_script": true|false, "detected_ui": "<string>" }`,
    ]);

    const text = result.response.text();
    let data: StuckHint;
    try {
      data = JSON.parse(text) as StuckHint;
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      data = m
        ? (JSON.parse(m[0]) as StuckHint)
        : { hint: "Take a moment, then continue with the next feature.", can_insert_to_script: false, detected_ui: "unknown" };
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "AI_ERROR", message: err?.message ?? "Gemini request failed" } },
      { status: 500 }
    );
  }
}
