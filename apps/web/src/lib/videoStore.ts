// Module-level store — survives client-side navigation within the same tab.
// Blobs are lost on hard refresh, which is fine since the recording detail page
// shows a placeholder when no local blob is available.
const store = new Map<string, Blob>();

export function storeVideo(id: string, blob: Blob): void {
  store.set(id, blob);
}

export function getVideo(id: string): Blob | null {
  return store.get(id) ?? null;
}
