// ── WebSocket event types (shared between client & server) ─────────────────
// Naming convention: <direction>:<domain>:<action>
// Server → Client: ai:* | recorder:*
// Client → Server: recorder:chunk | recorder:control

// ── Server → Client (AI Cue Events) ───────────────────────────────────────

export interface AISpeechRateEvent {
  event: "ai:speech:rate";
  payload: {
    wpm: number;
    level: "ok" | "fast" | "slow";
  };
}

export interface AITeleprompterMissEvent {
  event: "ai:teleprompter:miss";
  payload: {
    lineIndex: number;
    text: string;
  };
}

export interface AIZoomTriggerEvent {
  event: "ai:zoom:trigger";
  payload: {
    x: number; // 0–1 normalized screen coordinate
    y: number;
    scale: number; // e.g. 2.0 for 2x
    duration: number; // transition duration ms
    trigger: "keyword" | "hover" | "voice_command";
  };
}

export interface AIZoomResetEvent {
  event: "ai:zoom:reset";
  payload: {
    duration: number;
  };
}

export interface AINoiseDetectedEvent {
  event: "ai:noise:detected";
  payload: {
    type: "keyboard" | "background" | "echo";
    intensity: "low" | "medium" | "high";
  };
}

export interface AIFillerWordEvent {
  event: "ai:filler:detected";
  payload: {
    word: string;
    count: number; // consecutive count
  };
}

export interface AIPauseEvent {
  event: "ai:pause:detected";
  payload: {
    durationMs: number;
  };
}

export interface AIMonotoneEvent {
  event: "ai:monotone:detected";
  payload: {
    durationMs: number;
    suggestion: string;
  };
}

export interface AIChapterMarkerEvent {
  event: "ai:chapter:marker";
  payload: {
    timestampMs: number;
    suggestedTitle: string;
  };
}

export interface AIClickRippleEvent {
  event: "ai:click:ripple";
  payload: {
    x: number;
    y: number;
  };
}

export interface AIBlurEvent {
  event: "ai:blur:toggle";
  payload: {
    active: boolean;
    reason: "thinking_pause" | "hold_on";
  };
}

// ── Client → Server ────────────────────────────────────────────────────────

export interface RecorderChunkEvent {
  event: "recorder:chunk";
  payload: {
    blob: ArrayBuffer;
    timestamp: number;
    index: number;
    recordingId: string;
  };
}

export interface RecorderControlEvent {
  event: "recorder:control";
  payload: {
    action: "start" | "pause" | "resume" | "stop";
    recordingId: string;
  };
}

// ── Union types ────────────────────────────────────────────────────────────

export type ServerToClientEvent =
  | AISpeechRateEvent
  | AITeleprompterMissEvent
  | AIZoomTriggerEvent
  | AIZoomResetEvent
  | AINoiseDetectedEvent
  | AIFillerWordEvent
  | AIPauseEvent
  | AIMonotoneEvent
  | AIChapterMarkerEvent
  | AIClickRippleEvent
  | AIBlurEvent;

export type ClientToServerEvent = RecorderChunkEvent | RecorderControlEvent;
