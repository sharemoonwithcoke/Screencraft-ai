import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { createServer } from "http";
import { recordingsRoutes } from "./routes/recordings.js";
import { aiRoutes } from "./routes/ai.js";
import { uploadRoutes } from "./routes/upload.js";
import { registerSocketHandlers } from "./plugins/websocket.js";

const PORT = Number(process.env.SERVER_PORT ?? 4000);

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
    origin: [process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"],
    credentials: true,
  });

  await fastify.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per chunk
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await fastify.register(recordingsRoutes, { prefix: "/recordings" });
  await fastify.register(aiRoutes, { prefix: "/ai" });
  await fastify.register(uploadRoutes, { prefix: "/upload" });

  fastify.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  // ── HTTP server (shared with Socket.io) ───────────────────────────────────
  const httpServer = createServer(fastify.server);

  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      credentials: true,
    },
    maxHttpBufferSize: 50 * 1024 * 1024, // 50MB per WS message (video chunks)
  });

  registerSocketHandlers(io);

  await fastify.ready();

  httpServer.listen({ port: PORT, host: "0.0.0.0" }, () => {
    fastify.log.info(`ScreenCraft server listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
