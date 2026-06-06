import type { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

function hashPassword(password: string): string {
  return createHash("sha256").update(`screencraft:${password}`).digest("hex");
}

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/register
  fastify.post<{ Body: { email: string; password: string; name?: string } }>(
    "/register",
    async (req, reply) => {
      const { email, password, name } = req.body ?? {};
      if (!email || !password) {
        reply.code(400);
        return { ok: false, error: "Email and password are required" };
      }

      try {
        const [existing] = await db.select().from(users).where(eq(users.email, email));
        const displayName = name?.trim() || email.split("@")[0];
        const passwordHash = hashPassword(password);

        if (existing) {
          if (existing.passwordHash) {
            // Full account already exists — don't overwrite
            reply.code(409);
            return { ok: false, error: "Email already registered" };
          }
          // Shadow account (created by OAuth / resolveUserId with no password).
          // Let the user claim it by setting a password now.
          await db
            .update(users)
            .set({ passwordHash, name: displayName, updatedAt: new Date() })
            .where(eq(users.email, email));
          return { ok: true, user: { id: existing.id, email, name: displayName } };
        }

        const id = createHash("sha256").update(email).digest("hex").slice(0, 32);
        await db.insert(users).values({ id, email, name: displayName, passwordHash });

        reply.code(201);
        return { ok: true, user: { id, email, name: displayName } };
      } catch (err: any) {
        fastify.log.error({ err }, "Register failed");
        reply.code(500);
        return { ok: false, error: err?.message ?? "Registration failed" };
      }
    }
  );

  // POST /auth/login
  fastify.post<{ Body: { email: string; password: string } }>(
    "/login",
    async (req, reply) => {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        reply.code(400);
        return { ok: false, error: "Email and password are required" };
      }

      try {
        const [user] = await db.select().from(users).where(eq(users.email, email));

        if (!user || !user.passwordHash || user.passwordHash !== hashPassword(password)) {
          reply.code(401);
          return { ok: false, error: "Invalid email or password" };
        }

        return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
      } catch (err: any) {
        fastify.log.error({ err }, "Login failed");
        reply.code(500);
        return { ok: false, error: err?.message ?? "Login failed" };
      }
    }
  );
}
