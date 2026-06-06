import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  max: process.env.NODE_ENV === "production" ? 10 : 5,
  idle_timeout: 20,       // close idle connections after 20s
  connect_timeout: 10,    // fail fast if DB unreachable
  max_lifetime: 1800,     // recycle connections every 30 min
});

export const db = drizzle(client, { schema });

export type DB = typeof db;
