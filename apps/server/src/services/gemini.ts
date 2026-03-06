import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AnalysisReport, AnalysisScore, AnalysisIssue, Cut, Chapter } from "@screencraft/shared";
import { db } from "../db/index.js";
import { analysisReports, recordings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { StorageService } from "./storage.js";

export class GeminiService {
  private client: GoogleGenerativeAI;
  private storage: StorageService;

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.storage = new StorageService();
  }

  // ── Video quality analysis ───────────────────────────────────────────────

  async analyzeRecording(
    recordingId: string,
    scriptContent?: string
  ): Promise<{ score: AnalysisScore; issues: AnalysisIssue[] }> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-pro" });

    // Get video URL from storage
    const videoUrl = await this.storage.getRecordingUrl(recordingId);

    const prompt = `
You are a video quality analyzer for a screen recording tool. Analyze the provided recording and return a JSON object with:
1. A score breakdown (speechClarity /30, contentCoverage /25, presentationFlow /20, visualQuality /15, openingClosing /10)
2. A list of issues with: timestampMs, tag (critical|warning|suggestion), category, title, description

${scriptContent ? `Script to compare against:\n${scriptContent}` : ""}

Return ONLY valid JSON matching this shape:
{
  "score": { "total": 0, "speechClarity": 0, "contentCoverage": 0, "presentationFlow": 0, "visualQuality": 0, "openingClosing": 0 },
  "issues": [],
  "speechStats": { "avgWpm": 0, "wpmTimeline": [], "fillerWordCount": {}, "pauseCount": 0, "avgPauseDurationMs": 0, "signalToNoiseRatio": 0 },
  "contentCoveragePercent": 0
}
`;

    const result = await model.generateContent([prompt]);
    const text = result.response.text();

    // Parse JSON from model response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Gemini returned no parseable JSON");
    }

    return JSON.parse(jsonMatch[0]);
  }

  // ── Live transcript streaming ────────────────────────────────────────────

  async *streamTranscript(
    recordingId: string,
    language = "en"
  ): AsyncGenerator<string> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContentStream(
      `Transcribe the audio from recording ${recordingId} in ${language}. Return only the spoken text, no metadata.`
    );

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }

  // ── Edit suggestions ─────────────────────────────────────────────────────

  async generateEditSuggestions(
    recordingId: string,
    analysisReportId: string
  ): Promise<{ cuts: Cut[]; chapters: Chapter[] }> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-pro" });

    const [report] = await db
      .select()
      .from(analysisReports)
      .where(eq(analysisReports.id, analysisReportId));

    if (!report) {
      throw new Error("Analysis report not found");
    }

    const prompt = `
Based on this analysis report, suggest specific edit cuts and chapter markers.
Report: ${JSON.stringify(report.issuesJson)}

Return ONLY valid JSON:
{
  "cuts": [{ "id": "uuid", "startMs": 0, "endMs": 0, "reason": "string", "applied": false }],
  "chapters": [{ "id": "uuid", "title": "string", "startMs": 0, "endMs": 0 }]
}
`;

    const result = await model.generateContent([prompt]);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON from Gemini");

    return JSON.parse(jsonMatch[0]);
  }

  // ── Real-time speech analysis (called per chunk) ─────────────────────────

  async analyzeSpeechChunk(audioBuffer: Buffer): Promise<{
    wpm: number;
    fillerWords: string[];
    pauseDetected: boolean;
    monotone: boolean;
    transcript: string;
  }> {
    // Uses Gemini Flash for low-latency real-time analysis
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "audio/webm",
          data: audioBuffer.toString("base64"),
        },
      },
      `Analyze this audio chunk. Return JSON: { "wpm": 0, "fillerWords": [], "pauseDetected": false, "monotone": false, "transcript": "" }`,
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { wpm: 0, fillerWords: [], pauseDetected: false, monotone: false, transcript: "" };
    }
    return JSON.parse(jsonMatch[0]);
  }

  // ── Zoom trigger detection ───────────────────────────────────────────────

  async detectZoomTrigger(transcript: string, cursorX: number, cursorY: number): Promise<{
    shouldZoom: boolean;
    zoomX: number;
    zoomY: number;
    scale: number;
    shouldReset: boolean;
  }> {
    // Check for voice-triggered zoom keywords
    const zoomPhrases = ["let's take a look", "let me show you", "here you can see", "zoom in", "focus on"];
    const resetPhrases = ["back to", "zoom out", "full screen", "let's continue"];

    const lowerTranscript = transcript.toLowerCase();
    const shouldZoom = zoomPhrases.some((p) => lowerTranscript.includes(p));
    const shouldReset = resetPhrases.some((p) => lowerTranscript.includes(p));

    return {
      shouldZoom,
      zoomX: cursorX,
      zoomY: cursorY,
      scale: 2.0,
      shouldReset,
    };
  }
}
