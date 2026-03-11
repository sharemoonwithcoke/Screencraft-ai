import type { Recording } from "@screencraft/shared";

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
