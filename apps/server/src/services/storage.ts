import { Storage } from "@google-cloud/storage";

export class StorageService {
  private storage: Storage;
  private bucket: string;

  constructor() {
    this.storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      // If GCS_KEY_FILE is set, use it; otherwise falls back to
      // Application Default Credentials (ADC) — ideal for Cloud Run / GCE
      ...(process.env.GCS_KEY_FILE ? { keyFilename: process.env.GCS_KEY_FILE } : {}),
    });
    this.bucket = process.env.GCS_BUCKET!;
  }

  // ── Upload a raw video chunk ─────────────────────────────────────────────

  async uploadChunk(
    recordingId: string,
    index: number,
    buffer: Buffer
  ): Promise<string> {
    const name = `recordings/${recordingId}/chunks/${String(index).padStart(6, "0")}.webm`;

    await this.storage.bucket(this.bucket).file(name).save(buffer, {
      contentType: "video/webm",
      // Server-side encryption is always on by default in GCS
    });

    return name;
  }

  // ── Download a chunk for AI processing ──────────────────────────────────

  async downloadChunk(gcsName: string): Promise<Buffer> {
    const [buffer] = await this.storage.bucket(this.bucket).file(gcsName).download();
    return buffer;
  }

  // ── Get a signed URL for video playback (1-hour expiry) ────────────────

  async getRecordingUrl(recordingId: string): Promise<string> {
    const name = `recordings/${recordingId}/output.mp4`;

    const [url] = await this.storage.bucket(this.bucket).file(name).getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    return url;
  }

  // ── Assemble chunks into a single file (delegates to FFmpegService) ─────

  async assembleChunks(recordingId: string, _totalChunks: number): Promise<string> {
    // Returns the output key path; actual assembly done in FFmpegService
    return `recordings/${recordingId}/output.mp4`;
  }

  // ── Upload finished output file ──────────────────────────────────────────

  async uploadOutput(recordingId: string, buffer: Buffer): Promise<string> {
    const name = `recordings/${recordingId}/output.mp4`;

    await this.storage.bucket(this.bucket).file(name).save(buffer, {
      contentType: "video/mp4",
    });

    return name;
  }
}
