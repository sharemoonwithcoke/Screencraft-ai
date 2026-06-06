import type { Recording, AnalysisReport, RecordingGoals } from "@screencraft/shared";

/**
 * In-memory recording store for local dev (DEV_BYPASS_AUTH=true).
 * Uses globalThis so the same Map is shared across all Next.js module
 * contexts (Route Handlers, Server Components, etc.) within one process.
 * Replace with real DB queries when backend is connected.
 */

const g = globalThis as any;
if (!g.__devRecordingStore) g.__devRecordingStore = new Map<string, Recording>();
const store: Map<string, Recording> = g.__devRecordingStore;

export function createRecording(title: string, region: string): Recording {
  const id = `dev_${Date.now()}`;
  const now = new Date().toISOString();
  const rec: Recording = {
    id,
    userId: "dev_user",
    title,
    status: "recording",
    duration: null,
    resolution: null,
    thumbnailUrl: null,
    createdAt: now,
    updatedAt: now,
  };
  store.set(id, rec);
  return rec;
}

export function getRecordings(): Recording[] {
  return [...store.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getRecording(id: string): Recording | null {
  return store.get(id) ?? null;
}

export function updateRecording(id: string, updates: Partial<Recording>): Recording | null {
  const rec = store.get(id);
  if (!rec) return null;
  const updated = { ...rec, ...updates, updatedAt: new Date().toISOString() };
  store.set(id, updated);
  return updated;
}

// ── Analysis report store ────────────────────────────────────────────────────

const gReports = globalThis as any;
if (!gReports.__devAnalysisStore) gReports.__devAnalysisStore = new Map<string, AnalysisReport>();
const reportStore: Map<string, AnalysisReport> = gReports.__devAnalysisStore;

export function saveAnalysisReport(recordingId: string, report: AnalysisReport): void {
  reportStore.set(recordingId, report);
}

export function getAnalysisReport(recordingId: string): AnalysisReport | null {
  return reportStore.get(recordingId) ?? null;
}

// ── Recording goals store ────────────────────────────────────────────────────

const gGoals = globalThis as any;
if (!gGoals.__devGoalsStore) gGoals.__devGoalsStore = new Map<string, RecordingGoals>();
const goalsStore: Map<string, RecordingGoals> = gGoals.__devGoalsStore;

export function saveRecordingGoals(recordingId: string, goals: RecordingGoals): void {
  goalsStore.set(recordingId, goals);
}

export function getRecordingGoals(recordingId: string): RecordingGoals | null {
  return goalsStore.get(recordingId) ?? null;
}

