import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { createRecording, getRecordings } from "@/lib/dev-store";
import type { CreateRecordingRequest } from "@screencraft/shared";

const SERVER_URL = process.env.SERVER_URL!;
const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  if (DEV_MODE) {
    const recordings = getRecordings();
    return NextResponse.json({ ok: true, data: recordings, meta: { total: recordings.length, page: 1, limit: 20 } });
  }

  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") ?? "1";
  const limit = searchParams.get("limit") ?? "20";

  const res = await fetch(
    `${SERVER_URL}/recordings?page=${page}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${(session as any).accessToken}` } }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const body: CreateRecordingRequest = await req.json();

  if (DEV_MODE) {
    const rec = createRecording(body.title ?? "Untitled recording", body.region ?? "fullscreen");
    return NextResponse.json({ ok: true, data: rec });
  }

  const res = await fetch(`${SERVER_URL}/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${(session as any).accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
