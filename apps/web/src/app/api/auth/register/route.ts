import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
    }

    // Production: delegate to Fastify which owns the DB
    const serverUrl = process.env.SERVER_URL;
    if (serverUrl) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(`${serverUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
        signal: ac.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data.error ?? "Registration failed" }, { status: res.status });
      }
      return NextResponse.json({ ok: true, user: data.user }, { status: 201 });
    }

    // Local dev fallback (no SERVER_URL): use in-memory store
    const user = registerUser(email, password, name);
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Registration failed" }, { status: 400 });
  }
}
