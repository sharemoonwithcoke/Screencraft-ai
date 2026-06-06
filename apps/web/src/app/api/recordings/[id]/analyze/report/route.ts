import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/dev-auth";
import { getAnalysisReport } from "@/lib/dev-store";

const SERVER_URL = process.env.SERVER_URL;
const USE_DEV_STORE = !SERVER_URL || process.env.DEV_BYPASS_AUTH === "true";

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  // Check dev-store first — the analyze route always writes here (same process/Lambda)
  const devReport = getAnalysisReport(params.id);
  if (devReport) {
    return NextResponse.json({ ok: true, data: devReport });
  }

  // In production, fall back to Fastify's Postgres (durable across cold starts / Lambda recycling)
  if (!USE_DEV_STORE) {
    try {
      const res = await fetch(
        `${SERVER_URL}/recordings/${params.id}/report`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const { data } = await res.json();
        if (data) return NextResponse.json({ ok: true, data });
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({ ok: true, data: null });
}
