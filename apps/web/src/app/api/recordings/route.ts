import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import type { CreateRecordingRequest, ApiResponse } from "@screencraft/shared";

const SERVER_URL = process.env.SERVER_URL!;

const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, { status: 401 });
  }

  // Local dev: no backend running, return empty list
  if (DEV_MODE) {
    return NextResponse.json({ ok: true, data: [], meta: { total: 0, page: 1, limit: 20 } });
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
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, { status: 401 });
  }

  const body: CreateRecordingRequest = await req.json();

  // Local dev: return a mock recording so the recorder flow works without a backend
  if (DEV_MODE) {
    const mockId = `dev_${Date.now()}`;
    return NextResponse.json({ ok: true, data: { id: mockId, title: body.title, region: body.region, status: "recording" } });
  }

  const res = await fetch(`${SERVER_URL}/recordings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(session as any).accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
