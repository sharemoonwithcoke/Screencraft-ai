import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class StorageService {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
      forcePathStyle: !!process.env.S3_ENDPOINT, // needed for MinIO
    });
    this.bucket = process.env.S3_BUCKET!;
  }

  // ── Upload a raw video chunk ────────────────────────────────────────────

  async uploadChunk(
    recordingId: string,
    index: number,
    buffer: Buffer
  ): Promise<string> {
    const key = `recordings/${recordingId}/chunks/${String(index).padStart(6, "0")}.webm`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: "video/webm",
        ServerSideEncryption: "AES256",
      })
    );

    return key;
  }

  // ── Download a chunk for AI processing ───────────────────────────────────

  async downloadChunk(s3Key: string): Promise<Buffer> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key })
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // ── Get a presigned URL for video playback ─────────────────────────────

  async getRecordingUrl(recordingId: string): Promise<string> {
    const key = `recordings/${recordingId}/output.mp4`;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 }
    );
  }

  // ── Assemble chunks into a single file (post-recording) ───────────────────

  async assembleChunks(recordingId: string, totalChunks: number): Promise<string> {
    // List and download all chunks in order, then concatenate
    // Full S3 multipart assembly or FFmpeg concat is handled in FFmpegService
    // This method just returns the assembled key path
    const outputKey = `recordings/${recordingId}/output.mp4`;
    // Assembly delegated to FFmpegService.assembleChunks()
    return outputKey;
  }
}
