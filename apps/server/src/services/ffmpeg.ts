import ffmpeg from "fluent-ffmpeg";
import { StorageService } from "./storage.js";
import { db } from "../db/index.js";
import { recordingChunks, analysisReports } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { writeFile, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";
import { randomUUID } from "crypto";

/** Parse "M:SS" or "H:MM:SS" into total seconds. */
function parseSecs(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * Invert a sorted, non-overlapping list of delete ranges into the segments to keep.
 * Returns wall-clock {start, end} pairs in seconds from the original video.
 */
function computeKeepSegments(
  deletions: Array<{ start: string; end: string }>,
  totalDuration: number
): Array<{ start: number; end: number }> {
  const keeps: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const del of deletions) {
    const delStart = parseSecs(del.start);
    const delEnd = Math.min(parseSecs(del.end), totalDuration);
    if (delStart > cursor + 0.05) {
      keeps.push({ start: cursor, end: delStart });
    }
    cursor = Math.max(cursor, delEnd);
  }

  if (cursor < totalDuration - 0.05) {
    keeps.push({ start: cursor, end: totalDuration });
  }

  return keeps;
}

export class FFmpegService {
  private storage: StorageService;

  constructor() {
    this.storage = new StorageService();
  }

  // ── Assemble chunks into final MP4 ────────────────────────────────────────

  async assembleChunks(recordingId: string): Promise<string> {
    const chunks = await db
      .select()
      .from(recordingChunks)
      .where(eq(recordingChunks.recordingId, recordingId))
      .orderBy(recordingChunks.index);

    const tmpDir = tmpdir();
    const chunkPaths: string[] = [];

    for (const chunk of chunks) {
      const buffer = await this.storage.downloadChunk(chunk.s3Key);
      const ext = extname(chunk.s3Key) || ".webm";
      const tmpPath = join(tmpDir, `chunk-${chunk.index}${ext}`);
      await writeFile(tmpPath, buffer);
      chunkPaths.push(tmpPath);
    }

    const concatListPath = join(tmpDir, `${recordingId}-concat.txt`);
    const concatContent = chunkPaths.map((p) => `file '${p}'`).join("\n");
    await writeFile(concatListPath, concatContent);

    const outputPath = join(tmpDir, `${recordingId}-output.mp4`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f concat", "-safe 0"])
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-movflags +faststart"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    const outputBuffer = await readFile(outputPath);
    const s3Key = await this.storage.uploadOutput(recordingId, outputBuffer);

    await Promise.all([
      ...chunkPaths.map((p) => unlink(p).catch(() => {})),
      unlink(concatListPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ]);

    return s3Key;
  }

  // ── Export with edit plan application ─────────────────────────────────────

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

    // Load the most recent analysis report to get the edit plan
    const [report] = await db
      .select()
      .from(analysisReports)
      .where(eq(analysisReports.recordingId, recordingId))
      .orderBy(analysisReports.createdAt)
      .limit(1);

    type IssuesJson = {
      edit_plan?: {
        edit_instructions: Array<{
          action: string;
          start?: string;
          end?: string;
          reason?: string;
        }>;
      };
    };

    const issuesJson = (report?.issuesJson ?? {}) as IssuesJson;
    const deleteInstructions = (issuesJson.edit_plan?.edit_instructions ?? [])
      .filter(
        (i): i is { action: "delete"; start: string; end: string; reason?: string } =>
          i.action === "delete" &&
          typeof i.start === "string" &&
          typeof i.end === "string"
      )
      .sort((a, b) => parseSecs(a.start) - parseSecs(b.start));

    // Download the assembled video to a temp file
    const inputBuffer = await this.storage.downloadOutput(recordingId);
    const tmpDir = tmpdir();
    const inputPath = join(tmpDir, `${recordingId}-input.mp4`);
    await writeFile(inputPath, inputBuffer);

    const tmpOutput = join(tmpDir, `${recordingId}-export.${options.format}`);

    try {
      if (deleteInstructions.length === 0) {
        // No edit plan deletions — straight re-encode to target quality
        await this.reEncodeVideo(inputPath, tmpOutput, options.format, targetResolution);
      } else {
        const duration = await this.getVideoDuration(inputPath);
        const keeps = computeKeepSegments(deleteInstructions, duration);

        if (keeps.length === 0) {
          // Edit plan deletes everything — fall back to full re-encode
          await this.reEncodeVideo(inputPath, tmpOutput, options.format, targetResolution);
        } else {
          // Extract keep segments then concat + re-encode
          await this.cutAndEncode(inputPath, tmpOutput, keeps, options.format, targetResolution);
        }
      }

      const buffer = await readFile(tmpOutput);
      const s3Key = await this.storage.uploadOutput(recordingId, buffer);
      return s3Key;
    } finally {
      await Promise.all([
        unlink(inputPath).catch(() => {}),
        unlink(tmpOutput).catch(() => {}),
      ]);
    }
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
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    const buffer = await readFile(tmpPath);
    await unlink(tmpPath).catch(() => {});
    return buffer;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) return reject(err);
        resolve(data.format.duration ?? 0);
      });
    });
  }

  private reEncodeVideo(
    inputPath: string,
    outputPath: string,
    format: "mp4" | "webm",
    resolution: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = ffmpeg(inputPath)
        .size(resolution)
        .outputOptions(["-movflags +faststart"]);

      if (format === "mp4") {
        cmd.videoCodec("libx264").audioCodec("aac");
      } else {
        cmd.videoCodec("libvpx-vp9").audioCodec("libopus");
      }

      cmd.output(outputPath).on("end", () => resolve()).on("error", reject).run();
    });
  }

  /**
   * Apply delete-based edits and re-encode.
   *
   * Step 1: extract each keep segment with fast stream copy (-c copy).
   *   Stream copy is keyframe-aligned (GOP-accurate), which is fast and avoids
   *   re-encoding twice. Cut points will snap to the nearest preceding keyframe,
   *   which is acceptable for filler/pause removal (typically ±1-2 frames).
   *
   * Step 2: concat all segments + re-encode to the target format and resolution.
   *   The final encode is frame-accurate and removes any GOP boundary artefacts
   *   left by the stream-copy step.
   */
  private async cutAndEncode(
    inputPath: string,
    outputPath: string,
    keeps: Array<{ start: number; end: number }>,
    format: "mp4" | "webm",
    resolution: string
  ): Promise<void> {
    const tmpDir = tmpdir();
    const segmentPaths: string[] = [];

    // Step 1: stream-copy each keep segment to a temp file
    for (let i = 0; i < keeps.length; i++) {
      const { start, end } = keeps[i];
      const segPath = join(tmpDir, `${randomUUID()}-seg${i}.mp4`);
      segmentPaths.push(segPath);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(start)
          .duration(end - start)
          .outputOptions(["-c copy", "-avoid_negative_ts make_zero"])
          .output(segPath)
          .on("end", () => resolve())
          .on("error", reject)
          .run();
      });
    }

    // Step 2: concat all segments and re-encode to target format + resolution
    const concatListPath = join(tmpDir, `${randomUUID()}-concat.txt`);
    await writeFile(concatListPath, segmentPaths.map((p) => `file '${p}'`).join("\n"));

    try {
      await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg()
          .input(concatListPath)
          .inputOptions(["-f concat", "-safe 0"])
          .size(resolution)
          .outputOptions(["-movflags +faststart"]);

        if (format === "mp4") {
          cmd.videoCodec("libx264").audioCodec("aac");
        } else {
          cmd.videoCodec("libvpx-vp9").audioCodec("libopus");
        }

        cmd.output(outputPath).on("end", () => resolve()).on("error", reject).run();
      });
    } finally {
      await Promise.all([
        ...segmentPaths.map((p) => unlink(p).catch(() => {})),
        unlink(concatListPath).catch(() => {}),
      ]);
    }
  }
}
