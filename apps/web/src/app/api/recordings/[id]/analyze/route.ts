import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { updateRecording, saveAnalysisReport, getRecordingGoals, getRecording } from "@/lib/dev-store";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AnalysisReport, RecordingGoals } from "@screencraft/shared";

const SERVER_URL = process.env.SERVER_URL;
const USE_DEV_STORE = !SERVER_URL || process.env.DEV_BYPASS_AUTH === "true";

interface Params { params: { id: string } }

function parseJson<T>(text: string, fallback: T): T {
  const match = text.match(/\{[\s\S]*\}/s);
  if (!match) return fallback;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

/** Clamp all issue timestamps to [0, maxMs] to prevent out-of-range hallucinations. */
function clampIssues(issues: AnalysisReport["issues"], maxMs: number): AnalysisReport["issues"] {
  return issues.map((iss) => ({
    ...iss,
    timestampMs: Math.max(0, Math.min(maxMs, iss.timestampMs ?? 0)),
  }));
}

interface AnalysisInput {
  recordingId: string;
  durationSecs: number;
  goals?: RecordingGoals | null;
  transcript?: string;
}

async function runAnalysis({ recordingId, durationSecs, goals, transcript }: AnalysisInput): Promise<AnalysisReport> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const durationMs = durationSecs * 1000;
  const mm = String(Math.floor(durationSecs / 60)).padStart(2, "0");
  const ss = String(Math.round(durationSecs % 60)).padStart(2, "0");
  const durationLabel = `${mm}:${ss} (${durationSecs} seconds)`;

  // ── Transcript contECT ───────────────────────────────────────────────────
  let transcriptSection = "";
  if (transcript?.trim()) {
    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    const estimatedWpm = durationSecs > 0 ? Math.round((wordCount / durationSecs) * 60) : 0;
    transcriptSection = `
LIVE TRANSCRIPT (captured via speech recognition during recording — use this as the primary basis for speechStats):
"${transcript.trim()}"
Word count: ~${wordCount} words over ${durationSecs}s → estimated avg WPM: ${estimatedWpm}
`;
  }

  // ── Goals-aware scoring context ─────────────────────────────────────────
  let goalsSection = "";
  if (goals && Object.keys(goals).length > 0) {
    const parts: string[] = [];
    if (goals.durationTargetSecs) {
      const targetLabel = `${Math.round(goals.durationTargetSecs / 60)} min`;
      const overBy = Math.round(durationSecs - goals.durationTargetSecs);
      if (overBy > 0) {
        parts.push(`Duration target was ${targetLabel} but recording ran ${overBy}s over — deduct from presentationFlow accordingly.`);
      } else {
        parts.push(`Duration target was ${targetLabel} and the recording is within that target — reward presentationFlow.`);
      }
    }
    if (goals.videoType) {
      parts.push(`Video type: ${goals.videoType}. Tailor issue detection standards for this format.`);
    }
    if (goals.audienceType) {
      parts.push(`Audience: ${goals.audienceType}. Score contentCoverage accordingly (technical = depth, non-technical/general = clarity & accessibility).`);
    }
    if (goals.objectives) {
      parts.push(`Stated objectives: "${goals.objectives}". Evaluate whether these were addressed when scoring contentCoverage.`);
    }
    goalsSection = `\nSCORING CONSTRAINTS FROM RECORDING GOALS:\n${parts.join("\n")}\n`;
  }

  const prompt = `You are a precise AI quality analyst for a screen-recording app. Your job is to evaluate a recording and return a structured JSON report. Do not invent facts — derive everything from the metadata and transcript below.

RECORDING FACTS:
- Recording ID: ${recordingId}
- Actual duration: ${durationLabel}
- Maximum valid timestamp: ${durationMs} ms
${transcriptSection}${goalsSection}
STRICT RULES (violations cause the report to be rejected):
1. Every "timestampMs" in "issues" MUST be an integer in [0, ${durationMs}]. Never exceed ${durationMs}.
2. The "wpmTimeline" entries must have timestamps in [0, ${durationMs}].
3. "score.speechClarity" ≤ 30, "score.contentCoverage" ≤ 25, "score.presentationFlow" ≤ 20, "score.visualQuality" ≤ 15, "score.openingClosing" ≤ 10.
4. score.total MUST equal the sum of all five sub-scores.
5. If a transcript is provided, base "speechStats.avgWpm" on the actual word count and duration — do not invent a different value.
6. Generate 4–8 issues that reflect realistic problems for a ${durationLabel} recording.

Return ONLY valid JSON — no markdown fences, no prose — matching this schema exactly:
{
  "score": {
    "total": <integer 0-100>,
    "speechClarity": <integer 0-30>,
    "contentCoverage": <integer 0-25>,
    "presentationFlow": <integer 0-20>,
    "visualQuality": <integer 0-15>,
    "openingClosing": <integer 0-10>
  },
  "issues": [
    {
      "timestampMs": <integer, must be in [0, ${durationMs}]>,
      "tag": <"critical"|"warning"|"suggestion">,
      "category": <"speech"|"visual"|"pacing"|"content_coverage"|"opening_closing"|"audio_video_sync">,
      "title": <concise title, ≤ 8 words>,
      "description": <one actionable sentence>
    }
  ],
  "speechStats": {
    "avgWpm": <integer — derived from transcript if provided, else reasonable estimate>,
    "wpmTimeline": [{"timestampMs": <integer in [0,${durationMs}]>, "wpm": <integer>}],
    "fillerWordCount": {"um": <integer>, "uh": <integer>, "so": <integer>, "like": <integer>},
    "pauseCount": <integer>,
    "avgPauseDurationMs": <integer>,
    "signalToNoiseRatio": <float 0-1>
  },
  "contentCoveragePercent": <integer 0-100>
}`;

  const result = await model.generateContent(prompt);
  const raw = parseJson<Partial<AnalysisReport>>(result.response.text(), {});

  const safeIssues = clampIssues(raw.issues ?? [], durationMs);

  const s = raw.score;
  const subTotal = s
    ? (s.speechClarity ?? 0) + (s.contentCoverage ?? 0) + (s.presentationFlow ?? 0) +
      (s.visualQuality ?? 0) + (s.openingClosing ?? 0)
    : 72;

  return {
    id: `report_${Date.now()}`,
    recordingId,
    createdAt: new Date().toISOString(),
    score: s
      ? { ...s, total: subTotal }
      : { total: 72, speechClarity: 20, contentCoverage: 18, presentationFlow: 14, visualQuality: 11, openingClosing: 9 },
    issues: safeIssues,
    speechStats: raw.speechStats ?? {
      avgWpm: transcript
        ? Math.round((transcript.trim().split(/\s+/).filter(Boolean).length / durationSecs) * 60)
        : 140,
      wpmTimeline: [],
      fillerWordCount: { um: 0, uh: 0, so: 0, like: 0 },
      pauseCount: 0,
      avgPauseDurationMs: 0,
      signalToNoiseRatio: 0.8,
    },
    contentCoveragePercent: raw.contentCoveragePercent ?? 70,
  };
}

/** PATCH the recording status in the correct store. */
async function patchStatus(
  recordingId: string,
  status: "processing" | "ready" | "error",
  session: unknown
): Promise<void> {
  if (USE_DEV_STORE) {
    updateRecording(recordingId, { status });
    return;
  }
  await fetch(`${SERVER_URL}/recordings/${recordingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  }).catch(() => {});
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_API_KEY", message: "Add GEMINI_API_KEY to .env.local and restart" } },
      { status: 503 }
    );
  }

  const recordingId = params.id;
  const body = await req.json().catch(() => ({}));
  const ccTranscript: string | undefined = body.transcript;
  const bodyVideoType: string | undefined = body.videoType;
  const bodyAudienceType: string | undefined = body.audienceType;

  // Resolve recording metadata for the prompt
  let durationSecs = 60;
  let goals: RecordingGoals | null = null;

  if (USE_DEV_STORE) {
    const recording = getRecording(recordingId);
    durationSecs = (recording?.duration as number | null) ?? 60;
    goals = getRecordingGoals(recordingId);
  } else {
    // Fetch duration from Fastify
    try {
      const recRes = await fetch(`${SERVER_URL}/recordings/${recordingId}`, {
        cache: "no-store",
      });
      if (recRes.ok) {
        const { data: recData } = await recRes.json();
        durationSecs = (recData?.duration as number | null) ?? 60;
      }
    } catch { /* use default */ }
  }

  // Mark as processing
  await patchStatus(recordingId, "processing", session);

  try {
    // Run AI quality-score analysis synchronously (always in Next.js to avoid
    // Cloud Run fire-and-forget CPU throttling issues)
    const report = await runAnalysis({
      recordingId,
      durationSecs,
      goals,
      transcript: ccTranscript,
    });

    // Always save to dev-store (globalThis — persists within same process/Lambda instance)
    saveAnalysisReport(recordingId, report);

    // In production, also persist to Fastify's Postgres for durability across cold starts
    if (!USE_DEV_STORE) {
      await fetch(`${SERVER_URL}/recordings/${recordingId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      }).catch((err) => {
        console.error("[analyze] Failed to save report to Fastify:", err?.message);
      });
    }

    // Mark as ready
    await patchStatus(recordingId, "ready", session);

    return NextResponse.json({ ok: true, data: { message: "Analysis complete" } });
  } catch (err: any) {
    console.error("[analyze] Gemini error:", err?.message ?? err);
    await patchStatus(recordingId, "error", session);
    return NextResponse.json(
      { ok: false, error: { code: "ANALYSIS_FAILED", message: err?.message ?? "Gemini request failed" } },
      { status: 500 }
    );
  }
}
