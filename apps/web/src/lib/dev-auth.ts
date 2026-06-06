import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

const DEV_SESSION = {
  user: { name: "Dev User", email: "dev@local", image: null },
  expires: "2099-01-01T00:00:00.000Z",
  // Mirrors what the real NextAuth session callback attaches
  accessToken: "dev-bypass-token",
};

/**
 * Returns a real NextAuth session in production.
 * When DEV_BYPASS_AUTH=true (local dev only), returns a stub session so
 * all auth gates are skipped without touching the login page code.
 */
export async function getSession() {
  if (process.env.DEV_BYPASS_AUTH === "true") return DEV_SESSION;
  return getServerSession(authOptions);
}
