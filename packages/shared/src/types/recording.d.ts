export type RecordingStatus = "idle" | "recording" | "paused" | "processing" | "ready" | "error";
export type RecordingRegion = "fullscreen" | "window" | "custom";
export type CameraShape = "circle" | "square";
export interface User {
    id: string;
    email: string;
    name: string;
    plan: "free" | "pro" | "enterprise";
    createdAt: string;
}
export interface Recording {
    id: string;
    userId: string;
    title: string;
    status: RecordingStatus;
    duration: number | null;
    resolution: string | null;
    thumbnailUrl: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface RecordingChunk {
    id: string;
    recordingId: string;
    index: number;
    s3Key: string;
    duration: number;
    createdAt: string;
}
export interface TeleprompterScript {
    id: string;
    recordingId: string;
    content: string;
    format: "plaintext" | "markdown";
    createdAt: string;
}
export type IssueTag = "critical" | "warning" | "suggestion";
export interface AnalysisIssue {
    timestampMs: number;
    tag: IssueTag;
    category: "speech" | "audio_video_sync" | "content_coverage" | "visual" | "pacing" | "opening_closing";
    title: string;
    description: string;
}
export interface AnalysisScore {
    total: number;
    speechClarity: number;
    contentCoverage: number;
    presentationFlow: number;
    visualQuality: number;
    openingClosing: number;
}
export interface AnalysisReport {
    id: string;
    recordingId: string;
    score: AnalysisScore;
    issues: AnalysisIssue[];
    speechStats: SpeechStats;
    contentCoveragePercent: number;
    createdAt: string;
}
export interface SpeechStats {
    avgWpm: number;
    wpmTimeline: Array<{
        timestampMs: number;
        wpm: number;
    }>;
    fillerWordCount: Record<string, number>;
    pauseCount: number;
    avgPauseDurationMs: number;
    signalToNoiseRatio: number;
}
export interface Cut {
    id: string;
    startMs: number;
    endMs: number;
    reason: string;
    applied: boolean;
}
export interface CoverFrame {
    timestampMs: number;
    thumbnailUrl: string;
    score: number;
}
export interface EditSession {
    id: string;
    recordingId: string;
    cuts: Cut[];
    chapters: Chapter[];
    coverFrames: CoverFrame[];
    subtitleUrl: string | null;
    highlightExportUrl: string | null;
    createdAt: string;
}
export interface Chapter {
    id: string;
    title: string;
    startMs: number;
    endMs: number;
}
//# sourceMappingURL=recording.d.ts.map