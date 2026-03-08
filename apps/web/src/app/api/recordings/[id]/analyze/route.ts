import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";

const SERVER_URL = process.env.SERVER_URL!;

interface Params { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const body = await req.json();

  const res = await fetch(`${SERVER_URL}/recordings/${params.id}/analyze`, {
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
