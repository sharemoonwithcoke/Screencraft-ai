import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const SERVER_URL = process.env.SERVER_URL!;

// Chunked upload relay: forwards binary blob to server with metadata headers
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const recordingId = req.headers.get("x-recording-id");
  const chunkIndex = req.headers.get("x-chunk-index");
  const totalChunks = req.headers.get("x-total-chunks");

  if (!recordingId || chunkIndex === null || totalChunks === null) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Missing chunk metadata headers" } },
      { status: 400 }
    );
  }

  const blob = await req.blob();

  const formData = new FormData();
  formData.append("chunk", blob, `chunk-${chunkIndex}.webm`);
  formData.append("recordingId", recordingId);
  formData.append("index", chunkIndex);
  formData.append("totalChunks", totalChunks);

  const res = await fetch(`${SERVER_URL}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.user}` },
    body: formData,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
