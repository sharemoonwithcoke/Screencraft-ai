import ffmpeg from "fluent-ffmpeg";
import { StorageService } from "./storage.js";
import { db } from "../db/index.js";
import { recordingChunks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { writeFile, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export class FFmpegService {
  private storage: StorageService;

  constructor() {
    this.storage = new StorageService();
  }

  // ── Assemble chunks into final MP4 ────────────────────────────────────────

  async assembleChunks(recordingId: string): Promise<string> {
    // Fetch all chunk s3Keys in order
    const chunks = await db
      .select()
      .from(recordingChunks)
      .where(eq(recordingChunks.recordingId, recordingId))
      .orderBy(recordingChunks.index);

    const tmpDir = tmpdir();
    const chunkPaths: string[] = [];

    // Download all chunks to temp files
    for (const chunk of chunks) {
      const buffer = await this.storage.downloadChunk(chunk.s3Key);
      const tmpPath = join(tmpDir, `chunk-${chunk.index}.webm`);
      await writeFile(tmpPath, buffer);
      chunkPaths.push(tmpPath);
    }

    // Write concat manifest
    const concatListPath = join(tmpDir, `${recordingId}-concat.txt`);
    const concatContent = chunkPaths.map((p) => `file '${p}'`).join("\n");
    await writeFile(concatListPath, concatContent);

    const outputPath = join(tmpDir, `${recordingId}-output.mp4`);

    // Run FFmpeg concat
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f concat", "-safe 0"])
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-movflags +faststart"])
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // Upload assembled output to S3
    const outputBuffer = await readFile(outputPath);
    const s3Key = `recordings/${recordingId}/output.mp4`;
    await this.storage.uploadChunk(recordingId, -1, outputBuffer);

    // Cleanup temp files
    await Promise.all([
      ...chunkPaths.map((p) => unlink(p).catch(() => {})),
      unlink(concatListPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ]);

    return s3Key;
  }

  // ── Export with quality/format settings ──────────────────────────────────

  async exportRecording(
    recordingId: string,
    options: {
      format: "mp4" | "webm";
      quality: "720p" | "1080p" | "4k";
      includeCaptions?: boolean;
    }
  ): Promise<string> {
    const resolutionMap = { "720p": "1280x720", "1080p": "1920x1080", "4k": "3840x2160" };
    const targetResolution = resolutionMap[options.quality];

    const inputUrl = await this.storage.getRecordingUrl(recordingId);
    const tmpOutput = join(tmpdir(), `${recordingId}-export.${options.format}`);

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inputUrl)
        .size(targetResolution)
        .outputOptions(["-movflags +faststart"]);

      if (options.format === "mp4") {
        cmd.videoCodec("libx264").audioCodec("aac");
      } else {
        cmd.videoCodec("libvpx-vp9").audioCodec("libopus");
      }

      cmd.output(tmpOutput).on("end", resolve).on("error", reject).run();
    });

    const buffer = await readFile(tmpOutput);
    const s3Key = `recordings/${recordingId}/exports/export-${Date.now()}.${options.format}`;
    await this.storage.uploadChunk(recordingId, -1, buffer);
    await unlink(tmpOutput).catch(() => {});

    return s3Key;
  }

  // ── Extract a frame at a given timestamp ─────────────────────────────────

  async extractFrame(recordingId: string, timestampMs: number): Promise<Buffer> {
    const inputUrl = await this.storage.getRecordingUrl(recordingId);
    const tmpPath = join(tmpdir(), `${randomUUID()}.jpg`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputUrl)
        .seekInput(timestampMs / 1000)
        .frames(1)
        .output(tmpPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    const buffer = await readFile(tmpPath);
    await unlink(tmpPath).catch(() => {});
    return buffer;
  }
}
