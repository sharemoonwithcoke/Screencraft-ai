import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
  type:
    | "erratic mouse"
    | "unexplained click"
    | "no zoom"
    | "too fast"
    | "no pause after transition"
    | "audio-visual mismatch"
    | "insufficient hold"
    | "skipped context"
    | "dead pause";
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  suggestion: string;
}

export interface AudioIssue {
  start: string;
  end: string;
  type:
    | "too fast"
    | "too slow"
    | "insufficient pause"
    | "filler words"
    | "unclear explanation"
    | "restart"
    | "monotone"
    | "jargon without explanation"
    | "narration ahead of screen"
    | "narration behind screen"
    | "stutter"
    | "repeated phrase"
    | "dead pause";
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  suggestion: string;
}

export interface ChapterMarker {
  start: string;    // M:SS
  title: string;    // 3–5 words
  summary: string;  // one sentence
}

export interface EditInstruction {
  action: "delete" | "insert_silence" | "insert_tts" | "insert_title_card";
  start?: string;
  end?: string;
  at?: string;
  duration_seconds?: number;
  text?: string;
  title?: string;
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
  // null when the screenshot shows a blank/loading/error state
  hint: string | null;
  can_insert_to_script: boolean;
  detected_ui: string;
}

/** Combined output from a single audio chunk analysis call. */
export interface AudioChunkAnalysis {
  // Live coach fields — null when no coaching action needed
  // warn_speed is computed from wpm in code, not by the model
  action: "warn_speed" | "next_line" | "reset_position" | null;
  at_second: number | null;
  message: string | null;
  // Per-chunk speech metrics
  wpm: number;
  fillerWords: string[];
  pauseDetected: boolean;
  monotone: boolean;
  transcript: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJson<T>(text: string, fallback: T): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

/** Parse "M:SS" or "H:MM:SS" into total seconds. */
function parseSecs(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

// Gemini Files API URIs are valid for 48 h; evict at 47 h to avoid stale reads
const FILE_URI_TTL_MS = 47 * 60 * 60 * 1000;

// ── Service ───────────────────────────────────────────────────────────────────

export class GeminiService {
  private client: GoogleGenerativeAI;
  private fileManager: GoogleAIFileManager;
  private storage: StorageService;

  // Deduplicates video uploads: analyzeVisual + streamTranscript called back-to-back
  // for the same recording reuse the same Gemini Files API URI, subject to TTL.
  private fileUriCache = new Map<string, { promise: Promise<string>; expiresAt: number }>();
  // Maps recordingId → Gemini file name (e.g. "files/abc123") for cleanup.
  private fileNameCache = new Map<string, string>();

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
    this.storage = new StorageService();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🔴 LIVE API — called during recording
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Unified real-time audio analysis.
   * Replaces the two separate streamLiveCoach + analyzeSpeechChunk calls that
   * previously consumed the same audioBuffer twice (doubling latency + API cost).
   * Callers destructure the fields they need.
   *
   * warn_speed is NOT delegated to the model — the model cannot reliably
   * calculate WPM from a short audio chunk. Instead, we compute it from the
   * returned wpm field here and set action = "warn_speed" when wpm > 150.
   */
  async analyzeAudioChunk(audioBuffer: Buffer): Promise<AudioChunkAnalysis> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: {
          type: "object",
          properties: {
            action:        { type: "string", enum: ["next_line", "reset_position"], nullable: true },
            at_second:     { type: "number",  nullable: true },
            message:       { type: "string",  nullable: true },
            wpm:           { type: "integer" },
            fillerWords:   { type: "array", items: { type: "string" } },
            pauseDetected: { type: "boolean" },
            monotone:      { type: "boolean" },
            transcript:    { type: "string" },
          },
          required: ["wpm", "fillerWords", "pauseDetected", "monotone", "transcript"],
        } as any,
      },
    });

    const result = await model.generateContent([
      { inlineData: { mimeType: "audio/webm", data: audioBuffer.toString("base64") } },
      `Real-time speech coach + audio analyst.
Analyze the audio chunk and return a single JSON object:
- "action": null or one of "next_line" (silence >3s), "reset_position" (restart/redo)
- "at_second": timestamp in seconds if action is non-null, else null
- "message": ≤8 word user-facing message if action is non-null, else null
- "wpm": speaking rate in words per minute (integer)
- "fillerWords": array of detected filler words in this chunk
- "pauseDetected": true if meaningful silence detected
- "monotone": true if pitch variation is low
- "transcript": exact words spoken in this chunk`,
    ]);

    const out = parseJson<AudioChunkAnalysis>(result.response.text(), {
      action: null, at_second: null, message: null,
      wpm: 0, fillerWords: [], pauseDetected: false, monotone: false, transcript: "",
    });

    // Threshold check done in code — model cannot reliably compute WPM from raw audio
    if (!out.action && out.wpm > 150) {
      out.action = "warn_speed";
      out.message = "Slow down a little";
    }

    return out;
  }

  /** @deprecated Use analyzeAudioChunk(). Kept for backwards compatibility. */
  async *streamLiveCoach(audioBuffer: Buffer): AsyncGenerator<LiveCoachOutput> {
    const out = await this.analyzeAudioChunk(audioBuffer);
    if (out.action) {
      yield { action: out.action as LiveCoachOutput["action"], at_second: out.at_second ?? 0, message: out.message ?? "" };
    }
  }

  /** @deprecated Use analyzeAudioChunk(). Kept for backwards compatibility. */
  async analyzeSpeechChunk(audioBuffer: Buffer) {
    const { wpm, fillerWords, pauseDetected, monotone, transcript } = await this.analyzeAudioChunk(audioBuffer);
    return { wpm, fillerWords, pauseDetected, monotone, transcript };
  }

  /**
   * Prompt 6 — Stuck moment hint generator.
   * Trigger: silence > 3 seconds during recording.
   * Returns hint: null when screenshot shows a blank/loading/error state.
   */
  async generateStuckHint(
    screenshotBuffer: Buffer,
    spokenSoFar: string,
    currentScriptLine: string,
    fullScript: string,
    videoType = "PRODUCT_DEMO",
    mimeType: "image/jpeg" | "image/png" = "image/jpeg"
  ): Promise<StuckHint> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: {
          type: "object",
          properties: {
            hint:                { type: "string", nullable: true },
            can_insert_to_script: { type: "boolean" },
            detected_ui:         { type: "string" },
          },
          required: ["hint", "can_insert_to_script", "detected_ui"],
        } as any,
      },
    });

    const result = await model.generateContent([
      { inlineData: { mimeType, data: screenshotBuffer.toString("base64") } },
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

    return parseJson<StuckHint>(result.response.text(), {
      hint: "Take a moment, then continue with the next feature.",
      can_insert_to_script: false,
      detected_ui: "unknown",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🟡 POST-RECORDING ANALYSIS — 3 agents run in sequence
  // ─────────────────────────────────────────────────────────────────────────

  /** Prompt 2 — Visual Analyst. */
  async analyzeVisual(recordingId: string, videoType = "PRODUCT_DEMO", audience = "mixed"): Promise<{ visual_issues: VisualIssue[] }> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            visual_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start:      { type: "string" },
                  end:        { type: "string" },
                  type:       { type: "string" },
                  severity:   { type: "string" },
                  confidence: { type: "string" },
                  suggestion: { type: "string" },
                },
                required: ["start", "end", "type", "severity", "confidence", "suggestion"],
              },
            },
          },
          required: ["visual_issues"],
        } as any,
      },
    });
    const fileUri = await this.uploadRecordingToGemini(recordingId);

    const prompt = `You are a professional video editor reviewing a screen recording.
The video type is: ${videoType} (one of: PRODUCT_DEMO, TECHNICAL_DEMO, TUTORIAL, PRESENTATION)
The target audience is: ${audience} (one of: Technical, Non-technical, Mixed)

EDITORIAL GOAL BY VIDEO TYPE:

If video_type is PRODUCT_DEMO:
The goal of this video is to impress and persuade. The final edit should feel confident,
polished, and fast-moving. Every second should either demonstrate value or build toward it.
Flag anything that makes the presenter look hesitant, unprepared, or slow. Prioritize a
smooth, energetic pace over completeness — it is better to cut a mediocre explanation than
to keep it and lose the viewer's attention.

If video_type is TECHNICAL_DEMO:
The goal of this video is to be accurate and reproducible. The final edit should feel
methodical and trustworthy. Every step must be visible and narrated. Do NOT prioritize
pace over clarity — it is better to keep a slow but clear explanation than to cut it for
speed. Only flag issues that genuinely confuse or mislead a technical viewer.

If video_type is TUTORIAL:
The goal of this video is to help a new user successfully complete a task by following
along. The final edit must be sequential, patient, and complete. Never cut a step even
if it seems slow — a missing step will break the viewer's ability to follow. Flag only
content that is genuinely incorrect, confusing, or redundant. Pace is the lowest priority
here — clarity and completeness come first.

If video_type is PRESENTATION:
The goal of this video is to communicate a clear narrative and leave the viewer with a
specific takeaway. The final edit should feel structured and purposeful. Each section
should connect to the next. Flag anything that breaks the narrative flow, repeats a
point already made, or causes the viewer to lose track of the main argument. Pacing
matters but story coherence matters more.

Each type has different quality standards:

PRODUCT_DEMO:
- Pacing is confident and smooth — no hesitation, no backtracking
- Every feature shown has a clear "here's the value" moment
- Mouse movement is slow and deliberate, guiding attention
- Key UI elements are zoomed in or cursor-dwelt upon
- Transitions between features have 1.5–2s pause
- Audio and on-screen action are perfectly in sync

TECHNICAL_DEMO:
- Steps are reproducible — viewer can follow along
- Terminal output, code, or config changes are held on screen long enough to read
- Each command or action is narrated before or as it happens
- Errors or unexpected states are acknowledged, not ignored
- Do NOT flag rapid keyboard shortcuts (Ctrl+C, Ctrl+Z, Ctrl+V, etc.) as
  "unexplained click" — these are expected behaviour for technical audiences.

TUTORIAL:
- Every single click is preceded by the mouse visibly moving to the target
- After each action, there is a 2s hold before moving on
- Nothing happens on screen without being narrated
- Steps are sequential with no skipped context
- Viewer should never have to pause and rewatch

PRESENTATION:
- Each slide is held for at least the time needed to read the key point
- Speaker references what is on screen — no mismatch between words and slide content
- Transitions between slides have a natural pause
- No slide is skipped or rushed under 3s

Universal standards (all types):
- No erratic or fast mouse movement
- No unexplained clicks
- No abrupt cuts without context
- Audio-visual sync maintained throughout

DEFINITION OF ISSUE TYPES:
- "erratic mouse" is defined as: cursor moving more than 30% of screen width
  within 1 second without stopping, OR changing direction more than 3 times
  within 2 seconds without clicking anything.
- "no zoom" applies when: a UI element smaller than 15% of the screen width
  is being discussed or clicked, and the screen does not zoom in or the cursor
  does not dwell on it for at least 1.5 seconds.
- If the same UI element or feature is demonstrated more than once in an
  identical way within 60 seconds, flag the first instance as severity "medium"
  type "skipped context" with suggestion "duplicate demonstration — consider
  keeping only the cleaner take".

MAXIMUM DELETION LENGTH:
- A single delete segment must never exceed 8 seconds in length.
- If a problematic segment is longer than 8 seconds, do NOT flag it for
  deletion. Instead, flag severity "low" with suggestion to manually review,
  or identify the specific 1–3 second sub-segment that is the actual problem
  and flag only that.
- If continuous fluent speech is detected for more than 5 seconds with no
  filler words, no restarts, and no silence — this is high-quality content
  and must never be flagged for deletion regardless of any other rule.
- Never flag a segment for deletion if the speaker is mid-explanation —
  defined as: the sentence before the segment ends without a period or
  natural conclusion, OR the segment itself ends mid-sentence.
- If the total duration of all delete instructions would exceed 50% of the
  total recording length, keep only the highest-severity deletions that fit
  within the 50% limit and discard the rest.

SCREEN CHANGE PROTECTION:
- Any moment where the screen content changes (page navigation, tab switch,
  new UI element appearing, form submission, modal opening, any visual state
  change) creates a protected window: 3 seconds before the change and 3
  seconds after the change must never be flagged for deletion.
- Do NOT use any screen change moment as a "start" or "end" boundary for
  deletion. Deletion boundaries must fall within a single continuous
  uninterrupted screen state.
- Do NOT flag or delete any segment that spans a screen change. If an issue
  starts before a change and ends after it, discard it entirely.

LONG STATIC PAUSE DELETION:
- If the screen has had no visual change for more than 10 seconds AND there
  is no speech during that period, this is a dead pause and MUST be flagged
  as severity "high" for deletion. This rule overrides SCREEN CHANGE
  PROTECTION since there is no screen change occurring.
- If the user appears to be waiting for AI or a system process to complete
  (loading spinner visible, progress bar, cursor blinking in an input field
  with no other activity), do NOT flag the pause — the user is intentionally
  waiting and this context is meaningful to the viewer.
- Static pauses between 5–10 seconds with no speech and no screen change:
  flag as severity "medium" with suggestion to trim or speed up.

CRITICAL BOUNDARY RULES:
- "start" must be at a natural boundary — beginning of a sentence or after a
  complete phrase. Never mid-sentence.
- "end" must be at a natural boundary — end of a sentence or end of a complete
  phrase. Never mid-sentence.
- If the problematic segment starts or ends mid-sentence, extend the boundary
  to the nearest complete sentence boundary.
- Do NOT flag any segment that occurs during an active on-screen operation
  (click in progress, page loading, form submission). Wait until the operation
  completes before the boundary can begin.
- BOUNDARY RULES do not apply to filler and stutter deletions. Filler
  deletions always use exact audio boundaries, not sentence boundaries.
- Do not flag a segment that overlaps with another issue you have already
  flagged in this same analysis. Each moment in the video should appear in
  at most one issue entry.

CONTINUITY CHECK:
- If the segment contains a transition phrase connecting two topics (e.g.
  "and now", "next", "as you can see"), do NOT flag it for deletion.
- If deleting this segment would cause the viewer to lose context, mark
  severity as "low" and note in suggestion: "deletion would break context
  — consider trimming only".
- Do NOT flag the first sentence or last sentence of any feature section
  — these are context anchors.
- Do NOT create a deletion boundary between a question and its answer.
- Do NOT flag or delete any segment that spans a screen change. If an issue
  starts before a change and ends after it, discard it entirely.
- Exception: if the first or last sentence of a section is itself a restart
  or incomplete sentence, it is not protected — delete the restart and keep
  only the clean take.
- Exception: if the segment consists entirely of filler sounds (um, uh, er,
  ah, mm), CONTINUITY CHECK does not apply — delete unconditionally.

All timestamps must use M:SS format. Never use seconds-only format.
If you cannot complete the analysis, return the same JSON structure with an
empty array and an "error" field explaining why. Never return plain text.

Return JSON only:
{
  "visual_issues": [
    {
      "start": "M:SS",
      "end": "M:SS",
      "type": "erratic mouse" | "unexplained click" | "no zoom" | "too fast" |
              "no pause after transition" | "audio-visual mismatch" |
              "insufficient hold" | "skipped context" | "dead pause",
      "severity": "high" | "medium" | "low",
      "confidence": "high" | "medium" | "low",
      "suggestion": "specific, actionable fix"
    }
  ]
}`;

    const result = await model.generateContent([
      { fileData: { mimeType: "video/mp4", fileUri } },
      prompt,
    ]);

    return parseJson<{ visual_issues: VisualIssue[] }>(result.response.text(), { visual_issues: [] });
  }

  /**
   * Prompt 3 — Speech Analyst.
   * Receives a [MM:SS]-timestamped transcript from streamTranscript().
   * Only references timestamps that actually appear in the input — no hallucination.
   */
  async analyzeSpeech(transcript: string, videoType = "PRODUCT_DEMO", audience = "mixed"): Promise<{ audio_issues: AudioIssue[] }> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            audio_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start:      { type: "string" },
                  end:        { type: "string" },
                  type:       { type: "string" },
                  severity:   { type: "string" },
                  confidence: { type: "string" },
                  suggestion: { type: "string" },
                },
                required: ["start", "end", "type", "severity", "confidence", "suggestion"],
              },
            },
          },
          required: ["audio_issues"],
        } as any,
      },
    });

    // Guard: transcript too sparse for reliable analysis
    const timestampCount = (transcript.match(/\[\d+:\d+\]/g) ?? []).length;
    if (timestampCount < 3) {
      return { audio_issues: [] };
    }

    const prompt = `You are a professional video editor reviewing the spoken narration of a screen recording.
The video type is: ${videoType}
The target audience is: ${audience}

EDITORIAL GOAL BY VIDEO TYPE:

If video_type is PRODUCT_DEMO:
The goal of this video is to impress and persuade. The final edit should feel confident,
polished, and fast-moving. Every second should either demonstrate value or build toward it.
Flag anything that makes the presenter sound hesitant, unprepared, or slow. Prioritize a
smooth, energetic pace — it is better to cut a mediocre explanation than to keep it and
lose the viewer's attention.

If video_type is TECHNICAL_DEMO:
The goal of this video is to be accurate and reproducible. The final edit should feel
methodical and trustworthy. Do NOT prioritize pace over clarity — it is better to keep a
slow but clear explanation than to cut it for speed. Only flag speech issues that genuinely
confuse or mislead a technical viewer.

If video_type is TUTORIAL:
The goal of this video is to help a new user successfully complete a task. The final edit
must be sequential, patient, and complete. Never flag an explanation as "too slow" — in a
tutorial, patience is a feature. Flag only content that is genuinely incorrect, confusing,
or redundant. Completeness comes first.

If video_type is PRESENTATION:
The goal of this video is to communicate a clear narrative. The final edit should feel
structured and purposeful. Flag anything that breaks narrative flow, repeats a point
already made, or causes the viewer to lose track of the main argument.

Speaking rate is calculated as a 10-second sliding window average — short bursts of fast speech
within a slow section are not a problem. Only flag "too fast" when the sustained window average
exceeds the threshold for that video type, not for individual rapid phrases.

Each type has different narration standards:

PRODUCT_DEMO:
- Speaking rate: 120–150 WPM. Confident, energetic tone throughout.
- Key benefits and feature names are emphasized (slower, clearer).
- No filler words more than 2 per minute.
- Each feature is introduced before being shown — never demo first, explain later.
- Sections separated by a clear 1.5s pause.

TECHNICAL_DEMO:
- Speaking rate: 100–140 WPM. Precise and methodical.
- Every command, parameter, or config value is read aloud as it appears.
- Pauses are acceptable and expected when waiting for processes to complete.
- Do NOT flag silences during loading, compiling, or running commands.
- Silence periods during loading, compiling, or running commands do not count toward monotone duration calculation.
- If audience is Technical, do NOT flag domain-specific terminology as unclear.

TUTORIAL:
- Speaking rate: 100–130 WPM. Patient and clear.
- Every action narrated step by step — "now click", "then type", "you should see".
- 2s pause after each instruction to let the viewer follow along.
- Pauses between individual steps under 2s must be flagged. "Do not flag intentional pauses" applies only to pauses between major feature sections, not between individual tutorial steps.
- If audience is Non-technical, flag any unexplained jargon as "unclear explanation".
- Restarts or corrections must be clean — no half-sentences left in.

PRESENTATION:
- Speaking rate: 110–140 WPM. Varies with emphasis.
- Speaker references slide content explicitly.
- Natural pauses at slide transitions (1.5–2s).
- Monotone delivery for more than 15s is a problem.

Universal standards (all types):
- Filler words (um, uh, like, so, you know) fewer than 2 per minute.
- No mid-sentence restarts left in the final video.
- No half-completed thoughts.
- Sustained monotone over 20s flagged regardless of type.
- Do NOT flag intentional pauses between major feature sections.
- Do NOT flag language switches. A speaker switching between languages mid-recording is
  intentional behavior. Never flag a language switch as "unclear explanation",
  "jargon without explanation", or any other issue type.
- Intentional emphasis is NOT a repeated phrase. "very very fast" or "really really good"
  is a deliberate rhetorical device, not a stutter. Only flag a phrase as "repeated phrase"
  if the same phrase appears twice with more than 0.5 seconds of silence between occurrences.

FILLER & STUTTER REMOVAL RULES:
- Filler sounds (um, uh, er, ah, mm) are never considered meaningful content. They are never context anchors, never transition phrases, and never part of a question-answer pair. FILLER REMOVAL RULES always take priority over CONTINUITY CHECK for these sounds.
- Filler sounds are grouped regardless of pitch or tone variation. "uh" rising, "uh" falling, and "uh" flat are all the same filler type and must be evaluated together. Tone difference does not make them separate instances.
- Evaluate fillers in groups: if multiple fillers occur within any 3-second window and their combined duration totals ≥1 second, flag the entire group as "high" severity.
- A single filler under 1 second that occurs naturally between sentences (between two complete thoughts): ignore.
- A single filler under 1 second that interrupts a mid-sentence flow: flag as "medium".
- Any filler or group of fillers must be flagged as "high" and deleted if ANY of the following conditions are met:
  - The group total duration is 1 second or more within a 3-second window
  - The filler or group is preceded AND followed by silence of 3 seconds or more
  - The filler or group itself lasts 3 seconds or more in total
  A filler surrounded by silence on both sides has no connective function and must always be deleted regardless of duration.
- A segment that consists entirely of filler sounds must always be deleted regardless of its position.
- Stuttered or repeated words (e.g. "the the", "and and") must be flagged — keep only the final clean instance.
- Repeated phrases (e.g. "so basically... so basically...") must be flagged — always keep the final clean instance regardless of position. The first instance is never a context anchor if a cleaner repetition follows it.
- If removing a filler leaves the sentence grammatically complete and naturally flowing, flag as "high".
- If removing it would create an unnatural jump, flag as "medium" with suggestion to insert a short silence instead of deleting.
- BOUNDARY RULES do not apply to filler and stutter deletions. Filler deletions always use exact audio boundaries, not sentence boundaries.

NARRATION SYNC RULES:
- "narration ahead of screen": flag when the speaker describes or names a UI element before it is visible on screen and the gap is more than 2s. Severity "medium". Suggestion: trim the narration or insert a brief pause.
- "narration behind screen": flag when an on-screen action completes but the speaker has not acknowledged it within 3s. Severity "medium". Suggestion: move the explanation earlier or add a brief narration cue.

SCREEN CHANGE PROTECTION:
- Any moment where the screen content changes (page navigation, tab switch, new UI element
  appearing, form submission, modal opening, any visual state change) creates a protected
  window: 3 seconds before the change and 3 seconds after the change must never be flagged
  for deletion.
- Do NOT flag or delete any segment that spans a screen change. If an issue starts before a
  change and ends after it, discard it entirely.
- Deletion boundaries must fall within a single continuous uninterrupted screen state.

LONG STATIC PAUSE DELETION:
- If there is a period of silence with no speech for more than 10 seconds AND no screen
  changes are occurring AND no loading indicator is visible, this is a dead pause and MUST
  be flagged as type "dead pause", severity "high".
- If the user appears to be waiting for AI or a system process to complete (loading spinner
  visible, progress bar, terminal running), do NOT flag the pause — this is intentional and
  meaningful to the viewer.
- Silence between 5–10 seconds with no speech and no loading indicator: flag as
  type "dead pause", severity "medium".

MAXIMUM DELETION LENGTH:
- A single delete segment must never exceed 8 seconds in length.
- If a problematic segment is longer than 8 seconds, do NOT flag it for deletion. Instead,
  flag severity "low" with suggestion to manually review, or identify the specific 1–3 second
  sub-segment that is the actual problem and flag only that.
- If continuous fluent speech is detected for more than 5 seconds with no filler words, no
  restarts, and no silence — this is high-quality content and must never be flagged for
  deletion regardless of any other rule.
- Never flag a segment for deletion if the speaker is mid-explanation — defined as: the
  sentence before the segment ends without a period or natural conclusion, OR the segment
  itself ends mid-sentence.
- If the total duration of all delete instructions would exceed 50% of the total recording
  length, keep only the highest-severity deletions that fit within the 50% limit.

CRITICAL BOUNDARY RULES:
- "start" must be at a natural speech boundary — beginning of a sentence, or after a complete phrase. Never mid-sentence.
- "end" must be at a natural speech boundary — end of a sentence, or end of a complete phrase. Never mid-sentence.
- If the problematic segment starts or ends mid-sentence, extend to the nearest complete sentence boundary.
- If extending would include content necessary for the viewer to understand the next segment, do NOT flag this segment.
- BOUNDARY RULES do not apply to filler and stutter deletions. Filler deletions always use exact audio boundaries, not sentence boundaries.
- Do not flag a segment that overlaps with another issue you have already flagged in this same analysis. Each moment in the audio should appear in at most one issue entry.

CONTINUITY CHECK:
- If the segment contains a transition phrase connecting two topics (e.g. "and now", "next", "as you can see"), do NOT flag it for deletion.
- If deleting this segment would cause the viewer to lose context, mark severity as "low" and note: "deletion would break context — consider trimming only".
- Do NOT flag the first or last sentence of any feature section — these are context anchors.
- Do NOT create a deletion boundary between a question and its answer.
- Exception: if the first or last sentence of a section is itself a restart or incomplete sentence, it is not protected — delete the restart and keep only the clean take.
- Exception: if the segment consists entirely of filler sounds (um, uh, er, ah, mm), CONTINUITY CHECK does not apply — delete unconditionally.

Transcript (format "[MM:SS] text" — only use timestamps present in this input, never invent new ones):
${transcript}

If you cannot complete the analysis, return the same JSON structure with an empty array and an "error" field explaining why. Never return plain text.

Return JSON only:
{
  "audio_issues": [
    {
      "start": "M:SS",
      "end": "M:SS",
      "type": "too fast" | "too slow" | "insufficient pause" | "filler words" | "unclear explanation" | "restart" | "monotone" | "jargon without explanation" | "narration ahead of screen" | "narration behind screen" | "stutter" | "repeated phrase" | "dead pause",
      "severity": "high" | "medium" | "low",
      "confidence": "high" | "medium" | "low",
      "suggestion": "specific, actionable fix"
    }
  ]
}`;

    const result = await model.generateContent([prompt]);

    return parseJson<{ audio_issues: AudioIssue[] }>(result.response.text(), { audio_issues: [] });
  }

  /**
   * Prompt 4 — Edit Decision Agent.
   *
   * Deterministic TypeScript — no LLM call needed:
   *   • Sort all issues by start time
   *   • Merge adjacent high-severity delete ranges with < 2s gap between them
   *   • After each filler/stutter deletion, insert 0.3s silence
   *   • Insert silence for "insufficient pause" (medium+)
   *   • Insert TTS narration for "unclear explanation" / "jargon without explanation"
   */
  generateEditPlan(
    visualIssues: { visual_issues: VisualIssue[] },
    audioIssues: { audio_issues: AudioIssue[] },
    recordingDurationSeconds: number,
    screenChangeTimestamps: number[],
    chapters?: ChapterMarker[],
    insertTitleCards = false
  ): EditPlan {
    const FILLER_TYPES = new Set<string>(["filler words", "stutter", "repeated phrase", "restart"]);

    // Returns true when [s, e] overlaps the ±3s protected window around any screen change
    const isScreenChangeProtected = (s: number, e: number): boolean =>
      screenChangeTimestamps.some((t) => s < t + 3 && e > t - 3);

    type Tagged = (VisualIssue | AudioIssue) & { _src: "visual" | "audio" };

    const all: Tagged[] = [
      ...visualIssues.visual_issues.map((i) => ({ ...i, _src: "visual" as const })),
      ...audioIssues.audio_issues.map((i) => ({ ...i, _src: "audio" as const })),
    ].sort((a, b) => parseSecs(a.start) - parseSecs(b.start));

    const toTs = (secs: number): string => {
      const m = Math.floor(secs / 60);
      const s = Math.round(secs % 60);
      return `${m}:${String(s).padStart(2, "0")}`;
    };

    const instructions: EditInstruction[] = [];
    let deleted = 0, pauses = 0, tts = 0;

    // ── Collect high-severity delete candidates ───────────────────────────
    type Candidate = { s: number; e: number; isFiller: boolean; reasons: string[] };
    const candidates: Candidate[] = [];

    for (const issue of all) {
      if (issue.severity !== "high") continue;
      const s = parseSecs(issue.start);
      const e = parseSecs(issue.end);

      // Low-confidence issues never produce delete instructions
      if (issue.confidence === "low") {
        if (issue._src === "audio") {
          instructions.push({
            action: "insert_silence",
            at: issue.start,
            duration_seconds: 0.5,
            reason: `Low-confidence suggestion: ${issue.suggestion}`,
          });
          pauses++;
        }
        // Visual low-confidence → skip
        continue;
      }

      // Skip segments that fall within a screen change protected window
      if (isScreenChangeProtected(s, e)) continue;

      const isFiller = issue._src === "audio" && FILLER_TYPES.has((issue as AudioIssue).type);
      candidates.push({ s, e, isFiller, reasons: [issue.suggestion] });
    }

    // ── Merge adjacent ranges with < 2s gap ───────────────────────────────
    candidates.sort((a, b) => a.s - b.s);
    type Merged = { s: number; e: number; isFiller: boolean; reasons: string[] };
    const merged: Merged[] = [];
    for (const cand of candidates) {
      const prev = merged[merged.length - 1];
      if (prev && cand.s - prev.e < 2) {
        prev.e = Math.max(prev.e, cand.e);
        prev.isFiller = prev.isFiller && cand.isFiller;
        prev.reasons.push(...cand.reasons);
      } else {
        merged.push({ ...cand, reasons: [...cand.reasons] });
      }
    }

    // ── Apply 50% total deletion cap (greedy, chronological) ─────────────
    const maxDeleteSeconds = recordingDurationSeconds > 0 ? recordingDurationSeconds * 0.5 : Infinity;
    let totalDeletedSeconds = 0;
    const cappedMerged: Merged[] = [];
    for (const range of merged) {
      const duration = range.e - range.s;
      if (totalDeletedSeconds + duration > maxDeleteSeconds) continue;
      totalDeletedSeconds += duration;
      cappedMerged.push(range);
    }

    // ── Emit delete instructions ──────────────────────────────────────────
    for (const range of cappedMerged) {
      instructions.push({
        action: "delete",
        start: toTs(range.s),
        end: toTs(range.e),
        reason: range.reasons.join(" | "),
      });
      deleted++;

      // After filler/stutter removal, insert a short gap so the cut sounds natural
      if (range.isFiller) {
        instructions.push({
          action: "insert_silence",
          at: toTs(range.e),
          duration_seconds: 0.3,
          reason: "Natural gap after filler removal",
        });
        pauses++;
      }
    }

    // ── Process non-high issues ───────────────────────────────────────────
    for (const issue of all) {
      if (issue.severity === "high") continue;
      if (issue._src !== "audio") continue;
      const ai = issue as AudioIssue;

      if (ai.type === "insufficient pause" && issue.severity !== "low") {
        instructions.push({ action: "insert_silence", at: issue.start, duration_seconds: 1.5, reason: issue.suggestion });
        pauses++;
      } else if (ai.type === "unclear explanation" || ai.type === "jargon without explanation") {
        instructions.push({ action: "insert_tts", at: issue.end, text: issue.suggestion, voice: "en-US", reason: ai.type });
        tts++;
      }
    }

    // ── Optional: emit insert_title_card instructions from chapter markers ────
    let titleCards = 0;
    if (insertTitleCards && chapters?.length) {
      for (const ch of chapters) {
        instructions.push({
          action: "insert_title_card",
          at: ch.start,
          title: ch.title,
          duration_seconds: 2,
          reason: `Chapter: ${ch.title}`,
        });
        titleCards++;
      }
    }

    // Sort final instructions chronologically — handles both `start` (delete) and `at` (insert) fields
    const getTime = (i: EditInstruction) => parseSecs(i.start ?? i.at ?? "0:00");
    instructions.sort((a, b) => getTime(a) - getTime(b));

    const titleCardNote = titleCards > 0 ? `, ${titleCards} title card${titleCards !== 1 ? "s" : ""} added` : "";
    return {
      edit_instructions: instructions,
      summary: `${all.length} issues found. ${deleted} segment${deleted !== 1 ? "s" : ""} deleted, ${pauses} pause${pauses !== 1 ? "s" : ""} inserted, ${tts} TTS narration${tts !== 1 ? "s" : ""} added${titleCardNote}.`,
    };
  }

  /** Generate chapter markers from a timestamped transcript. Metadata only — not embedded in video. */
  async generateChapters(transcript: string, videoType = "PRODUCT_DEMO"): Promise<{ chapters: ChapterMarker[] }> {
    // A recording shorter than ~90s can't produce two 30s chapters — return a single overview
    const timestamps = transcript.match(/\[(\d+):(\d+)\]/g) ?? [];
    if (timestamps.length > 0) {
      const last = timestamps[timestamps.length - 1].match(/\[(\d+):(\d+)\]/)!;
      const totalSecs = Number(last[1]) * 60 + Number(last[2]);
      if (totalSecs < 90) {
        const firstTs = (timestamps[0] ?? "[0:00]").replace(/[\[\]]/g, "");
        return { chapters: [{ start: firstTs, title: "Full recording", summary: "Complete recording — too short to split into chapters." }] };
      }
    }
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            chapters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start:   { type: "string" },
                  title:   { type: "string" },
                  summary: { type: "string" },
                },
                required: ["start", "title", "summary"],
              },
            },
          },
          required: ["chapters"],
        } as any,
      },
    });

    const prompt = `You are a professional video editor creating a chapter structure for a screen recording.
The video type is: ${videoType}

EDITORIAL GOAL BY VIDEO TYPE:

If video_type is PRODUCT_DEMO:
Chapters should map to distinct product features or value moments. Each chapter is a
self-contained "here is what this does and why it matters" unit. A viewer should be able
to jump to any chapter and immediately understand what feature is being shown. Aim for
3–6 chapters. Chapter titles should sound like feature names or benefit statements:
"Automating your workflow", "Real-time collaboration", "One-click export".

If video_type is TECHNICAL_DEMO:
Chapters should map to distinct technical steps or system components. Each chapter should
be reproducible in isolation — a viewer following along should be able to jump to any
chapter and continue from there. Aim for chapters that match natural implementation phases.
Titles should be precise and action-oriented: "Configuring the environment",
"Running the migration", "Verifying the output".

If video_type is TUTORIAL:
Chapters should map to individual tasks or steps in the workflow. Each chapter is one
thing the user will learn to do. Chapters should be granular — err on the side of more
chapters rather than fewer. A viewer who gets stuck should be able to find exactly where
they went wrong. Titles should be task-oriented: "Creating your first project",
"Inviting team members", "Setting permissions".

If video_type is PRESENTATION:
Chapters should map to the main arguments or sections of the narrative. Each chapter
represents one distinct point the speaker is making. Aim for chapters that follow the
presentation's logical flow. Titles should reflect the argument or insight:
"The problem we're solving", "Why existing solutions fall short", "Our approach".

CHAPTER RULES (all types):
- Each chapter must start at a sentence boundary
- Each chapter must be at least 30 seconds long
- Each chapter must have a distinct topic that differs from the previous chapter
- Title must be 3–5 words, action-oriented and specific to content
- Do not create a chapter for content that is a direct continuation of the previous
  chapter's topic

Transcript (format "[MM:SS] text"):
${transcript}

If you cannot complete the analysis, return the same JSON structure with an empty array and an "error" field explaining why. Never return plain text.

Return JSON only:
{
  "chapters": [
    {
      "start": "M:SS",
      "title": "3–5 word summary",
      "summary": "one sentence description of what this section covers"
    }
  ]
}`;

    const result = await model.generateContent([prompt]);
    return parseJson<{ chapters: ChapterMarker[] }>(result.response.text(), { chapters: [] });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🟢 TELEPROMPTER ASSISTANT
  // ─────────────────────────────────────────────────────────────────────────

  async optimizeScript(userScript: string, videoType = "PRODUCT_DEMO", audience = "mixed"): Promise<{ script_lines: ScriptLine[]; total_estimated_seconds: number }> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: {
          type: "object",
          properties: {
            script_lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text:               { type: "string" },
                  estimated_seconds:  { type: "number" },
                  action_hint:        { type: "string" },
                  emphasis:           { type: "array", items: { type: "string" } },
                },
                required: ["text", "estimated_seconds", "action_hint", "emphasis"],
              },
            },
            total_estimated_seconds: { type: "number" },
          },
          required: ["script_lines", "total_estimated_seconds"],
        } as any,
      },
    });

    const result = await model.generateContent([
      `You are a professional script editor and presentation coach.
The video type is: ${videoType}
The target audience is: ${audience}

EDITORIAL GOAL BY VIDEO TYPE:

If video_type is PRODUCT_DEMO:
The goal is to impress and persuade. Every line should either demonstrate value or build
toward it. Optimize for confidence and momentum — short, punchy sentences that move fast.
Cut any line that hedges, over-explains, or slows the energy. Highlight benefit language:
"this means you can...", "instead of spending hours...", "with one click...".

If video_type is TECHNICAL_DEMO:
The goal is to be accurate and reproducible. Every command, parameter, and config value
must have its own line. Optimize for precision — the viewer may be following along and
needs to read each value clearly. Do not compress technical steps for brevity. Use clear
sequential language: "first...", "then...", "this will output...".

If video_type is TUTORIAL:
The goal is to help a new user successfully complete a task. Every line must map to
exactly one action. Optimize for clarity and patience — never combine two steps into one
sentence. Use instructional language: "now click...", "you should see...", "if you don't
see this, check that...". Assume the viewer will pause and follow along after each line.

If video_type is PRESENTATION:
The goal is to communicate a clear narrative and leave the viewer with a specific
takeaway. Every line should connect to the main argument. Optimize for story flow — each
sentence should feel like it leads naturally to the next. Use transitional and rhetorical
language: "this is why...", "which brings us to...", "the key insight here is...".

OPTIMIZATION RULES (all types):
- Break the script into short natural phrases (max 15 words each)
- Mark words that should be spoken slowly or with emphasis (key terms, numbers, product
  names, action words)
- Estimate reading time per line in seconds
- Suggest where mouse actions or screen interactions should accompany speech
- Each line should be speakable in one breath
- Respond in the same language as the user's input script

User script: ${userScript}`,
    ]);

    return parseJson(result.response.text(), { script_lines: [], total_estimated_seconds: 0 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🔵 TRANSCRIPTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Streams a [MM:SS]-timestamped transcript line by line.
   * Raw stream chunks are buffered so callers never receive a split mid-token
   * "[MM:SS]" line — downstream analyzeSpeech gets well-formed timestamps.
   */
  async *streamTranscript(recordingId: string, language = "en"): AsyncGenerator<string> {
    const model = this.client.getGenerativeModel({ model: "gemini-2.5-flash" });
    const fileUri = await this.uploadRecordingToGemini(recordingId);

    const result = await model.generateContentStream([
      { fileData: { mimeType: "video/mp4", fileUri } },
      `Transcribe all spoken audio from this screen recording in ${language}. ` +
      `Format each sentence or phrase as "[MM:SS] spoken text" on its own line. ` +
      `Use actual timestamps from the video. No metadata, no commentary — only the timestamped transcript.`,
    ]);

    let buffer = "";
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (!text) continue;
      buffer += text;
      const lines = buffer.split("\n");
      // Last element may be an incomplete line — keep it in the buffer
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield line + "\n";
      }
    }
    // Flush any remaining complete content
    if (buffer.trim()) yield buffer;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🔒 PRIVATE
  // ─────────────────────────────────────────────────────────────────────────

  private uploadRecordingToGemini(recordingId: string): Promise<string> {
    const cached = this.fileUriCache.get(recordingId);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = this._doUpload(recordingId);
    this.fileUriCache.set(recordingId, { promise, expiresAt: Date.now() + FILE_URI_TTL_MS });
    // Remove stale entry on failure so next caller gets a fresh attempt
    promise.catch(() => this.fileUriCache.delete(recordingId));
    return promise;
  }

  /** Wraps _doUploadOnce with up to 3 attempts and exponential backoff (2 s, 4 s). */
  private async _doUpload(recordingId: string): Promise<string> {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
      try {
        return await this._doUploadOnce(recordingId);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  private async _doUploadOnce(recordingId: string): Promise<string> {
    const videoBuffer = await this.storage.downloadOutput(recordingId);

    const tmpPath = path.join(os.tmpdir(), `sc-${recordingId}-${Date.now()}.mp4`);
    fs.writeFileSync(tmpPath, videoBuffer);

    try {
      const uploadResult = await this.fileManager.uploadFile(tmpPath, {
        mimeType: "video/mp4",
        displayName: `recording-${recordingId}`,
      });

      let file = uploadResult.file;
      while (file.state === "PROCESSING") {
        await new Promise((r) => setTimeout(r, 3000));
        file = await this.fileManager.getFile(file.name);
      }

      if (file.state === "FAILED") {
        throw new Error(`Gemini file processing failed for recording ${recordingId}`);
      }

      // Store file name for deferred cleanup (deleteFile requires the name, not the URI)
      this.fileNameCache.set(recordingId, file.name);
      return file.uri;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  /**
   * Delete the Gemini-uploaded file for this recording and clear the URI cache.
   * Call after the full analysis pipeline completes to free quota.
   * Best-effort — swallows errors if the file already expired or was deleted.
   */
  async cleanupRecording(recordingId: string): Promise<void> {
    this.fileUriCache.delete(recordingId);
    const fileName = this.fileNameCache.get(recordingId);
    if (!fileName) return;
    this.fileNameCache.delete(recordingId);
    try {
      await this.fileManager.deleteFile(fileName);
    } catch {
      // Best-effort — file may have expired or already been deleted
    }
  }
}
