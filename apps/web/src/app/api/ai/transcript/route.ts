import { NextRequest } from "next/server";
import { getSession } from "@/lib/dev-auth";

const SERVER_URL = process.env.SERVER_URL!;

// Streaming route — proxies Gemini live transcript stream to client
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
    });
  }

  const body = await req.json();

  const upstream = await fetch(`${SERVER_URL}/ai/transcript`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.user}`,
    },
    body: JSON.stringify(body),
  });

  // Pass the ReadableStream through directly for SSE/streaming
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
