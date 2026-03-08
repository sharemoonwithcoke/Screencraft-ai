import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";

const SERVER_URL = process.env.SERVER_URL!;

async function proxyToServer(
  req: NextRequest,
  path: string,
  method: string,
  body?: unknown
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(session as any).accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

interface Params { params: { id: string } }

export async function GET(_: NextRequest, { params }: Params) {
  return proxyToServer(_, `/recordings/${params.id}`, "GET");
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const body = await req.json();
  return proxyToServer(req, `/recordings/${params.id}`, "PATCH", body);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  return proxyToServer(_, `/recordings/${params.id}`, "DELETE");
}
