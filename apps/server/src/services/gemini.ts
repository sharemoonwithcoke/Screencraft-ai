import { GoogleGenerativeAI } from "@google/generative-ai";
import { StorageService } from "./storage.js";

// ── Shared output types ───────────────────────────────────────────────────────

export interface LiveCoachOutput {
  action: "warn_speed" | "next_line" | "reset_position";
  at_second: number;
  message: string;
}

export interface VisualIssue {
  start: string;
  end: string;
  type: "erratic mouse" | "unexplained click" | "no zoom" | "too fast";
  severity: "high" | "medium" | "low";
  suggestion: string;
}

export interface AudioIssue {
  start: string;
  end: string;
  type: "too fast" | "insufficient pause" | "filler words" | "unclear explanation";
  severity: "high" | "medium" | "low";
  suggestion: string;
}

export interface EditInstruction {
  action: "delete" | "insert_silence" | "insert_tts";
  start?: string;
  end?: string;
  at?: string;
  duration_seconds?: number;
  text?: string;
  voice?: string;
  reason?: string;
}

export interface EditPlan {
  edit_instructions: EditInstruction[];
  summary: string;
}

export interface ScriptLine {
  text: string;
  estimated_seconds: number;
  action_hint: string;
  emphasis: string[];
}

export interface StuckHint {
  hint: string;
  can_insert_to_script: boolean;
  detected_ui: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function parseJson<T>(text: string, fallback: T): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class GeminiService {
  private client: GoogleGenerativeAI;
  private storage: StorageService;

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.storage = new StorageService();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🔴 LIVE API — called during recording
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Prompt 1 — Real-time speech coach.
   * Streams JSON actions as the user speaks.
   * Trigger: continuous audio listening during recording.
   */
  async *streamLiveCoach(audioBuffer: Buffer): AsyncGenerator<LiveCoachOutput> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are a real-time speech coach monitoring a user recording a software demo video.
Rules:
- Speaking rate exceeds 150 words/min → trigger warn_speed
- Silence exceeds 3 seconds → trigger next_line
- User restarts or says "no wait" / "let me redo" → trigger reset_position
Requirements: Respond within 500ms. No long explanations. Output JSON only.
Output format:
{
  "action": "warn_speed" | "next_line" | "reset_position",
  "at_second": 23,
  "message": "Short message shown to user, max 8 words"
}`;

    const result = await model.generateContentStream([
      {
        inlineData: {
          mimeType: "audio/webm",
          data: audioBuffer.toString("base64"),
        },
      },
      prompt,
    ]);

    let buffer = "";
    for await (const chunk of result.stream) {
      buffer += chunk.text();
      // Try to extract a complete JSON object from the accumulated buffer
      const match = buffer.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          yield JSON.parse(match[0]) as LiveCoachOutput;
        } catch {
          // Incomplete JSON — keep buffering
        }
        buffer = buffer.slice((match.index ?? 0) + match[0].length);
      }
    }
  }

  /**
   * Prompt 6 — Stuck moment hint generator.
   * Trigger: silence > 3 seconds during recording.
   * Input: current screenshot + last spoken sentence.
   */
  async generateStuckHint(
    screenshotBuffer: Buffer,
    lastSpoken: string,
    currentScriptLine: string
  ): Promise<StuckHint> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are a demo presentation assistant. The user is recording a software demo and just paused for over 3 seconds — they may be stuck.
Input:
- Last thing the user said: ${lastSpoken}
- Current teleprompter line: ${currentScriptLine}
Task:
Based on the screenshot, identify what feature is being demonstrated and generate a natural hint to help the user continue.
Requirements:
- Maximum two sentences
- Conversational tone, like naturally introducing a product
- Pick up naturally from what the user last said
- If the screenshot shows an error page, prompt the user to address the error first
Output JSON only, no additional commentary.
Output format:
{
  "hint": "This input box is the chat area — you can demo it by typing a question to show how it responds",
  "can_insert_to_script": true,
  "detected_ui": "chat input interface"
}`;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/png",
          data: screenshotBuffer.toString("base64"),
        },
      },
      prompt,
    ]);

    return parseJson<StuckHint>(result.response.text(), {
      hint: "Take a moment, then continue with the next feature.",
      can_insert_to_script: false,
      detected_ui: "unknown",
    });
  }

  /**
   * Rule-based zoom trigger — no AI call needed.
   * Trigger: mouse idle > X seconds, or voice keywords detected.
   */
  detectZoomTrigger(
    transcript: string,
    cursorX: number,
    cursorY: number
  ): { shouldZoom: boolean; zoomX: number; zoomY: number; scale: number; shouldReset: boolean } {
    const zoomPhrases = [
      "let's take a look", "let me show you", "here you can see",
      "zoom in", "focus on",
    ];
    const resetPhrases = ["back to", "zoom out", "full screen", "let's continue"];

    const lower = transcript.toLowerCase();
    return {
      shouldZoom: zoomPhrases.some((p) => lower.includes(p)),
      zoomX: cursorX,
      zoomY: cursorY,
      scale: 2.0,
      shouldReset: resetPhrases.some((p) => lower.includes(p)),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🟡 POST-RECORDING ANALYSIS — 3 agents run in sequence
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Prompt 2 — Visual Analyst.
   * Input: video file (via GCS URL). Output: { visual_issues[] }
   */
  async analyzeVisual(recordingId: string): Promise<{ visual_issues: VisualIssue[] }> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-pro" });
    const videoUrl = await this.storage.getRecordingUrl(recordingId);

    const prompt = `You are a professional software demo visual analyst.
Analyze this screen recording and identify the following issues:
- Mouse moving too fast or erratically
- Clicking a button without verbal explanation
- Important UI elements not zoomed in
- Steps that skip too quickly, confusing the viewer
- Screen transitions under 2 seconds
Output JSON only, no additional commentary.
Output format:
{
  "visual_issues": [
    {
      "start": "0:23",
      "end": "0:31",
      "type": "erratic mouse" | "unexplained click" | "no zoom" | "too fast",
      "severity": "high" | "medium" | "low",
      "suggestion": "specific improvement advice"
    }
  ]
}`;

    const result = await model.generateContent([
      { text: `Video URL: ${videoUrl}` },
      prompt,
    ]);

    return parseJson<{ visual_issues: VisualIssue[] }>(
      result.response.text(),
      { visual_issues: [] }
    );
  }

  /**
   * Prompt 3 — Speech Analyst.
   * Input: transcript text (from streamTranscript). Output: { audio_issues[] }
   */
  async analyzeSpeech(transcript: string): Promise<{ audio_issues: AudioIssue[] }> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-pro" });

    const prompt = `You are a professional speech rhythm analyst.
Below is a transcript from a software demo video. Please analyze:
- Segments where speaking rate exceeds 150 words/min
- Insufficient pauses between feature transitions (should be 1.5+ seconds)
- Filler words overused (e.g. "um", "like", "so" more than 3x/minute)
- Segments where explanation is unclear
Output JSON only, no additional commentary.
Transcript input: ${transcript}
Output format:
{
  "audio_issues": [
    {
      "start": "1:05",
      "end": "1:12",
      "type": "too fast" | "insufficient pause" | "filler words" | "unclear explanation",
      "severity": "high" | "medium" | "low",
      "suggestion": "specific improvement advice"
    }
  ]
}`;

    const result = await model.generateContent([prompt]);

    return parseJson<{ audio_issues: AudioIssue[] }>(
      result.response.text(),
      { audio_issues: [] }
    );
  }

  /**
   * Prompt 4 — Edit Decision Agent.
   * Input: results from analyzeVisual + analyzeSpeech.
   * Output: { edit_instructions[] } → passed to FFmpeg for execution.
   */
  async generateEditPlan(
    visualIssues: { visual_issues: VisualIssue[] },
    audioIssues: { audio_issues: AudioIssue[] }
  ): Promise<EditPlan> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-pro" });

    const prompt = `You are a professional video editor.
Below are two analysis reports for the same demo video:
Visual analysis result: ${JSON.stringify(visualIssues)}
Audio analysis result: ${JSON.stringify(audioIssues)}
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
    },
    {
      "action": "insert_silence",
      "at": "1:05",
      "duration_seconds": 1.5
    },
    {
      "action": "insert_tts",
      "at": "2:10",
      "text": "Now let's look at the submit feature",
      "voice": "en-US"
    }
  ],
  "summary": "X issues found. Y segments deleted, Z pauses inserted."
}`;

    const result = await model.generateContent([prompt]);

    return parseJson<EditPlan>(result.response.text(), {
      edit_instructions: [],
      summary: "No edits generated.",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🔵 REAL-TIME CHUNK ANALYSIS — called by AiCueService per audio chunk
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Per-chunk real-time speech analysis (distinct from post-recording analyzeSpeech).
   * Called by AiCueService every few seconds with a raw audio buffer.
   * Uses gemini-1.5-flash for lowest latency.
   */
  async analyzeSpeechChunk(audioBuffer: Buffer): Promise<{
    wpm: number;
    fillerWords: string[];
    pauseDetected: boolean;
    monotone: boolean;
    transcript: string;
  }> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "audio/webm",
          data: audioBuffer.toString("base64"),
        },
      },
      `Analyze this short audio chunk from a live screen recording session.
Return JSON only:
{
  "wpm": 120,
  "fillerWords": ["um", "like"],
  "pauseDetected": false,
  "monotone": false,
  "transcript": "exact words spoken"
}`,
    ]);

    return parseJson(result.response.text(), {
      wpm: 0,
      fillerWords: [],
      pauseDetected: false,
      monotone: false,
      transcript: "",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🟢 TELEPROMPTER ASSISTANT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Prompt 5 — Script Optimizer.
   * Input: user's raw teleprompter script. Output: { script_lines[] }
   */
  async optimizeScript(userScript: string): Promise<{
    script_lines: ScriptLine[];
    total_estimated_seconds: number;
  }> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-pro" });

    const prompt = `You are a demo script optimization assistant.
The user has provided a teleprompter script. Please:
- Break it into short natural phrases (max 15 words each)
- Mark words that should be spoken slowly (key terms)
- Estimate reading time per line (in seconds)
- Suggest where mouse actions should accompany speech
Output JSON only, no additional commentary.
User script input: ${userScript}
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

    const result = await model.generateContent([prompt]);

    return parseJson(result.response.text(), {
      script_lines: [],
      total_estimated_seconds: 0,
    });
  }

  /**
   * Utility — Audio → Text transcription.
   * NOT a standalone prompt; output is fed into analyzeSpeech().
   */
  async *streamTranscript(
    recordingId: string,
    language = "en"
  ): AsyncGenerator<string> {
    const model = this.client.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContentStream(
      `Transcribe the audio from this recording (ID: ${recordingId}) in ${language}. ` +
      `Return only the spoken text with timestamps in [MM:SS] format, no metadata.`
    );

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }
}
