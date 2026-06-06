import Link from "next/link";
import { Video } from "lucide-react";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-500 flex items-center justify-center mb-4 shadow-md shadow-brand-500/30">
            <Video className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
          <p className="text-sm text-slate-500 mt-1">Record smarter. Present better.</p>
        </div>

        <RegisterForm />

        <p className="text-center text-xs text-slate-400 mt-6">
          By registering you agree to our{" "}
          <Link href="/terms" className="underline hover:text-slate-600">Terms</Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-slate-600">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}
