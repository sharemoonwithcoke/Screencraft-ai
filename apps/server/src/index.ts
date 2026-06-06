import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { recordingsRoutes } from "./routes/recordings.js";
import { aiRoutes } from "./routes/ai.js";
import { uploadRoutes } from "./routes/upload.js";
import { authRoutes } from "./routes/auth.js";
import { registerSocketHandlers } from "./plugins/websocket.js";

const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 4000);

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  "https://screencraft-web-996567442414.asia-east1.run.app",
];

async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  });

  await fastify.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per chunk
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await fastify.register(recordingsRoutes, { prefix: "/recordings" });
  await fastify.register(aiRoutes, { prefix: "/ai" });
  await fastify.register(uploadRoutes, { prefix: "/upload" });
  await fastify.register(authRoutes, { prefix: "/auth" });

  fastify.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  // ── Ready: attach Socket.IO to Fastify's underlying HTTP server ───────────
  // Must be called after fastify.ready() so fastify.server is fully initialised.
  await fastify.ready();

  const io = new Server(fastify.server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      credentials: true,
    },
    maxHttpBufferSize: 50 * 1024 * 1024, // 50MB per WS message (video chunks)
  });

  registerSocketHandlers(io);

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
