import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { createHash } from "crypto";

// ── In-memory user store (local dev / testing) ──────────────────────────────
// Persists for the lifetime of the Next.js server process.
// Replace with a real DB lookup when you have a database connected.
interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

const userStore = new Map<string, StoredUser>();

function hashPassword(password: string): string {
  return createHash("sha256").update(`screencraft:${password}`).digest("hex");
}

export function registerUser(email: string, password: string, name: string) {
  if (userStore.has(email)) throw new Error("Email already registered");
  const id = `local_${Date.now()}`;
  userStore.set(email, { id, email, name, passwordHash: hashPassword(password) });
  return { id, email, name };
}

// ── NextAuth config ──────────────────────────────────────────────────────────
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email:    { label: "Email",    type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = userStore.get(credentials.email);
        if (!user) return null;
        if (user.passwordHash !== hashPassword(credentials.password)) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/login",
    error: "/auth/error",
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) token.accessToken = account.access_token;
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
};
