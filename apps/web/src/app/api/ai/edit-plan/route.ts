import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { getAnalysisReport, getRecording } from "@/lib/dev-store";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Allow up to 5 minutes — large video uploads + Gemini processing take time
export const maxDuration = 300;

export interface EditCut {
  startMs: number;
  endMs: number;
  reason: string;
}

export interface TocEntry {
  timestampMs: number;
  title: string;
  durationMs: number;
}

export interface HighlightClip {
  startMs: number;
  endMs: number;
  reason: string;
}

export interface EditPlan {
  cuts: EditCut[];
  captions: Array<{ timestampMs: number; text: string }>;
  tableOfContents: TocEntry[];
  highlights: HighlightClip[];
  coverFrameMs: number;
  summary: string;
  appliedEdits: string[];
  durationMs?: number;
}

// ── Video upload helper ───────────────────────────────────────────────────────

async function uploadVideoToGemini(videoFile: File): Promise<string> {
  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
  const bytes = await videoFile.arrayBuffer();
  const mimeType = videoFile.type.split(";")[0] || "video/webm";
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  const tmpPath = path.join(os.tmpdir(), `sc-editplan-${Date.now()}.${ext}`);
  fs.writeFileSync(tmpPath, Buffer.from(bytes));

  try {
    const result = await fileManager.uploadFile(tmpPath, {
      mimeType,
      displayName: `edit-plan-${Date.now()}`,
    });
    let file = result.file;
    while (file.state === "PROCESSING") {
      await new Promise((r) => setTimeout(r, 3000));
      file = await fileManager.getFile(file.name);
    }
    if (file.state === "FAILED") throw new Error("Gemini video processing failed");
    return file.uri;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

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

  // Parse request — FormData when video is attached, JSON otherwise
  let recordingId: string;
  let videoFile: File | null = null;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    recordingId = fd.get("recordingId") as string;
    videoFile = fd.get("video") as File | null;
  } else {
    ({ recordingId } = await req.json() as { recordingId: string });
  }

  const recording = getRecording(recordingId);
  const durationSecs = (recording?.duration as number | null) ?? 120;
  const durationMs = durationSecs * 1000;
  const mm = String(Math.floor(durationSecs / 60)).padStart(2, "0");
  const ss = String(Math.round(durationSecs % 60)).padStart(2, "0");

  // Upload video to Gemini Files API if the client provided it
  let fileUri: string | null = null;
  let uploadedMime = "video/webm";
  if (videoFile && videoFile.size > 0) {
    try {
      fileUri = await uploadVideoToGemini(videoFile);
      uploadedMime = videoFile.type.split(";")[0] || "video/webm";
    } catch (err: any) {
      console.warn("[edit-plan] Video upload failed, falling back to metadata:", err?.message);
    }
  }

  // Analysis report context (used in both paths as supplementary info)
  const report = getAnalysisReport(recordingId);
  const reportContext = report
    ? `Prior analysis — Score: ${report.score.total}/100 | ` +
      `Speech: ${report.speechStats.avgWpm} WPM avg, ${report.speechStats.pauseCount} pauses, ` +
      `fillers: ${JSON.stringify(report.speechStats.fillerWordCount)}`
    : "No prior analysis available.";

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const jsonSchema = `{
  "cuts": [{ "startMs": <int>, "endMs": <int>, "reason": "<string>" }],
  "captions": [{ "timestampMs": <int>, "text": "<string>" }],
  "tableOfContents": [{ "timestampMs": <int>, "title": "<string>", "durationMs": <int> }],
  "highlights": [{ "startMs": <int>, "endMs": <int>, "reason": "<string>" }],
  "coverFrameMs": <int>,
  "summary": "<string>",
  "appliedEdits": ["silence removal", "auto captions", "table of contents", "highlight reel", "cover frame"]
}`;

  const strictRules = `STRICT RULES (violations cause rejection):
1. ALL timestampMs / startMs / endMs MUST be integers in [0, ${durationMs}]. Never exceed ${durationMs}.
2. cuts: startMs < endMs, no overlapping ranges.
3. tableOfContents: timestampMs must increase monotonically.
4. coverFrameMs: single integer in [0, ${durationMs}].`;

  // ── Path A: Gemini watches the actual video ───────────────────────────────
  if (fileUri) {
    const prompt = `You are a professional video editor AI. Watch this entire ${mm}:${ss} screen-recording carefully — audio and video.

${strictRules}

Based solely on what you actually see and hear, generate a complete edit package.
Return JSON only (no markdown fences):
${jsonSchema}

WHAT TO LOOK AND LISTEN FOR:
CUTS — be aggressive, remove every instance of:
  • Silences ≥1.5 s with no speech or useful audio
  • Audio stutters: repeated syllables or words ("I-I mean", "the the the", "w-we"), incomplete words, mid-word breaks
  • False starts and restarts: speaker begins a sentence then abandons it ("I was going to— so let me…")
  • Dense filler clusters: two or more consecutive fillers (um, uh, like, so, you know)
  • Background noise dominance: sections where room tone, keyboard clicks, HVAC, or external noise is clearly louder than or mixed with any speech
  • Dead air with screen activity: screen is loading or mouse is moving but presenter says nothing for >3 s
CAPTIONS — 8–15 subtitle lines with exact timestamps matching what is spoken.
TABLEOFCONTENTS — 3–5 chapters at genuine topic/scene transitions you observe.
HIGHLIGHTS — 2–3 clips (each 10–30 s) showing the clearest, most compelling demo moments — prefer segments where the presenter speaks confidently and the UI responds cleanly.
COVERFRAMEMS — a frame where the UI is fully loaded, clearly visible, and representative of the recording's key topic (avoid blank screens, loading spinners, and transitions).
SUMMARY — one sentence describing what the recording demonstrates.

${reportContext}`;

    try {
      const result = await model.generateContent([
        { fileData: { mimeType: uploadedMime, fileUri } },
        prompt,
      ]);
      return buildResponse(result.response.text(), durationMs);
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: { code: "AI_ERROR", message: err.message ?? "Gemini request failed" } },
        { status: 500 }
      );
    }
  }

  // ── Path B: Metadata-only fallback (no video uploaded) ───────────────────
  const prompt = `You are a professional video editor AI. Generate a plausible edit package for a ${mm}:${ss} (${durationSecs}s) software demo recording.
NOTE: No video file was provided — generate realistic timestamps based on typical demo pacing.

${strictRules}

Context: ${reportContext}

Return JSON only (no markdown fences):
${jsonSchema}

Guidelines:
- cuts: 3–6 segments targeting likely silences, filler words, or restarts
- captions: 8–15 subtitle lines spread across the recording
- tableOfContents: 3–5 chapters (intro → main features → conclusion)
- highlights: 2–3 best clips, each 10–30 s
- coverFrameMs: best thumbnail moment (avoid first/last 5 s)`;

  try {
    const result = await model.generateContent(prompt);
    return buildResponse(result.response.text(), durationMs);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "AI_ERROR", message: err.message ?? "Gemini request failed" } },
      { status: 500 }
    );
  }
}

// ── Shared post-parse validation ──────────────────────────────────────────────

function buildResponse(text: string, durationMs: number): NextResponse {
  let plan: EditPlan;
  try {
    plan = JSON.parse(text) as EditPlan;
  } catch {
    const m = text.match(/\{[\s\S]*\}/s);
    plan = m ? JSON.parse(m[0]) : ({} as EditPlan);
  }

  const clamp = (v: number) => Math.max(0, Math.min(durationMs, Math.round(v)));

  const validCuts = (plan.cuts ?? [])
    .map((c) => ({ ...c, startMs: clamp(c.startMs), endMs: clamp(c.endMs) }))
    .filter((c) => c.startMs < c.endMs)
    .sort((a, b) => a.startMs - b.startMs)
    .reduce<EditCut[]>((acc, cut) => {
      const last = acc[acc.length - 1];
      if (!last || cut.startMs >= last.endMs) acc.push(cut);
      return acc;
    }, []);

  return NextResponse.json({
    ok: true,
    data: {
      ...plan,
      cuts: validCuts,
      captions: (plan.captions ?? []).map((c) => ({ ...c, timestampMs: clamp(c.timestampMs) })),
      tableOfContents: (plan.tableOfContents ?? []).map((c) => ({ ...c, timestampMs: clamp(c.timestampMs) })),
      highlights: (plan.highlights ?? [])
        .map((h) => ({ ...h, startMs: clamp(h.startMs), endMs: clamp(h.endMs) }))
        .filter((h) => h.startMs < h.endMs),
      coverFrameMs: clamp(plan.coverFrameMs ?? Math.round(durationMs * 0.1)),
      durationMs,
    },
  });
}
