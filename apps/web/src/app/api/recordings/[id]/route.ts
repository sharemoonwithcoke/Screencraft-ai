import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { getRecording, updateRecording } from "@/lib/dev-store";

const SERVER_URL = process.env.SERVER_URL!;
const DEV_MODE = process.env.DEV_BYPASS_AUTH === "true";

interface Params { params: { id: string } }

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });

  if (DEV_MODE) {
    const rec = getRecording(params.id);
    if (!rec) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: rec });
  }

  const res = await fetch(`${SERVER_URL}/recordings/${params.id}`, {
    headers: { Authorization: `Bearer ${(session as any).accessToken}` },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });

  const body = await req.json();

  if (DEV_MODE) {
    const rec = updateRecording(params.id, body);
    if (!rec) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: rec });
  }

  const res = await fetch(`${SERVER_URL}/recordings/${params.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${(session as any).accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });

  if (DEV_MODE) {
    return NextResponse.json({ ok: true });
  }

  const res = await fetch(`${SERVER_URL}/recordings/${params.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${(session as any).accessToken}` },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
