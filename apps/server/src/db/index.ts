import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

// Use connection pooling in production, single connection in dev
const client = postgres(connectionString, {
  max: process.env.NODE_ENV === "production" ? 10 : 1,
});

export const db = drizzle(client, { schema });

export type DB = typeof db;
