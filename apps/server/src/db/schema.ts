import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  varchar,
  pgEnum,
  real,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────────

export const recordingStatusEnum = pgEnum("recording_status", [
  "idle",
  "recording",
  "paused",
  "processing",
  "ready",
  "error",
]);

export const planEnum = pgEnum("user_plan", ["free", "pro", "enterprise"]);

export const teleprompterFormatEnum = pgEnum("teleprompter_format", [
  "plaintext",
  "markdown",
]);

// ── Tables ─────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 200 }),
  plan: planEnum("plan").notNull().default("free"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const recordings = pgTable("recordings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  status: recordingStatusEnum("status").notNull().default("idle"),
  duration: integer("duration"), // seconds
  resolution: varchar("resolution", { length: 20 }), // e.g. "1920x1080"
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const recordingChunks = pgTable("recording_chunks", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  s3Key: text("s3_key").notNull(),
  duration: real("duration").notNull(), // seconds
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * ai_events — full log of every AI event emitted during a recording session.
 * Used for post-recording report generation and debugging.
 */
export const aiEvents = pgTable("ai_events", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  timestampMs: integer("timestamp_ms").notNull(),
  payload: jsonb("payload").notNull(), // full typed payload
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const analysisReports = pgTable("analysis_reports", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  score: jsonb("score").notNull(), // AnalysisScore JSON
  issuesJson: jsonb("issues_json").notNull(), // AnalysisIssue[]
  speechStatsJson: jsonb("speech_stats_json"), // SpeechStats JSON
  contentCoveragePercent: real("content_coverage_percent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const editSessions = pgTable("edit_sessions", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  cutsJson: jsonb("cuts_json").notNull().default([]), // Cut[]
  chaptersJson: jsonb("chapters_json").notNull().default([]), // Chapter[]
  exportsJson: jsonb("exports_json").notNull().default([]),
  subtitleUrl: text("subtitle_url"),
  highlightExportUrl: text("highlight_export_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const teleprompterScripts = pgTable("teleprompter_scripts", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  format: teleprompterFormatEnum("format").notNull().default("plaintext"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
