export interface ApiSuccess<T> {
    ok: true;
    data: T;
}
export interface ApiError {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
export interface CreateRecordingRequest {
    title: string;
    region: import("./recording").RecordingRegion;
    resolution?: string;
    teleprompterContent?: string;
}
export interface UpdateRecordingRequest {
    title?: string;
    status?: import("./recording").RecordingStatus;
}
export interface UploadChunkRequest {
    recordingId: string;
    index: number;
    totalChunks: number;
}
export interface AnalyzeRequest {
    scriptContent?: string;
}
export interface ExportRequest {
    format: "mp4" | "webm" | "gif";
    quality: "720p" | "1080p" | "4k";
    includeHighlight?: boolean;
    includeCaptions?: boolean;
}
export interface TranscriptStreamRequest {
    recordingId: string;
    language?: string;
}
export interface SuggestEditsRequest {
    recordingId: string;
    analysisReportId: string;
}
//# sourceMappingURL=api.d.ts.map