"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoadingCredentials(true);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoadingCredentials(false);
    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push("/dashboard");
    }
  };

  const handleGoogle = async () => {
    setLoadingGoogle(true);
    await signIn("google", { callbackUrl: "/dashboard" });
  };

  const isLoading = loadingCredentials || loadingGoogle;

  return (
    <div className="flex flex-col gap-4">
      {/* Credentials form */}
      <form onSubmit={handleCredentials} className="flex flex-col gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
          />
        </div>

        {error && (
          <p className="text-xs text-red-500 text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-xl transition-all duration-200 shadow-sm disabled:opacity-50"
        >
          {loadingCredentials ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400">or</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Google */}
      <button
        onClick={handleGoogle}
        disabled={isLoading}
        className="flex items-center justify-center gap-3 w-full py-2.5 px-4 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all duration-200 shadow-sm disabled:opacity-50"
      >
        <GoogleIcon />
        {loadingGoogle ? "Redirecting…" : "Continue with Google"}
      </button>

      {/* Register link */}
      <p className="text-center text-sm text-slate-500">
        First time?{" "}
        <Link href="/auth/register" className="font-medium text-brand-500 hover:text-brand-600">
          Create an account
        </Link>
      </p>
    </div>
  );
}
