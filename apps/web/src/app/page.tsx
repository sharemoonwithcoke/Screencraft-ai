import Link from "next/link";
import { Video, Zap, BarChart2, Scissors } from "lucide-react";

const features = [
  {
    icon: Video,
    title: "Smart Recording",
    description:
      "Real-time AI coaching on speech pace, filler words, and teleprompter coverage while you record.",
  },
  {
    icon: Zap,
    title: "Lens Focus",
    description:
      "Camera auto-zooms to what you're talking about. Voice-triggered or hover-triggered smooth zoom & pan.",
  },
  {
    icon: BarChart2,
    title: "Quality Analysis",
    description:
      "Post-recording scorecard across speech clarity, content coverage, pacing, and visual quality.",
  },
  {
    icon: Scissors,
    title: "AI Editing",
    description:
      "One-click silence removal, auto-captions, highlight reel, and cover frame recommendations.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-brand-950 to-slate-900 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center">
            <Video className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">
            ScreenCraft AI
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/auth/login"
            className="text-sm text-slate-400 hover:text-white transition-colors duration-200"
          >
            Sign in
          </Link>
          <Link
            href="/auth/login"
            className="text-sm bg-brand-500 hover:bg-brand-600 px-4 py-2 rounded-xl font-medium transition-all duration-200"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-16">
        <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/30 rounded-full px-4 py-1.5 text-xs text-brand-300 font-medium mb-8">
          <Zap className="w-3 h-3" />
          Powered by Gemini AI
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 max-w-4xl">
          Record smarter.{" "}
          <span className="text-brand-400">Present better.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mb-10">
          ScreenCraft AI coaches you in real time while you record, then
          analyzes and edits your video — so every demo lands perfectly.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/auth/login?callbackUrl=/recorder"
            className="bg-brand-500 hover:bg-brand-600 text-white px-8 py-3.5 rounded-2xl font-semibold text-base transition-all duration-200 shadow-lg shadow-brand-500/25"
          >
            Start recording
          </Link>
          <Link
            href="/dashboard"
            className="bg-white/10 hover:bg-white/15 text-white px-8 py-3.5 rounded-2xl font-medium text-base transition-all duration-200"
          >
            View dashboard
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 sm:grid-cols-2 gap-6">
        {features.map(({ icon: Icon, title, description }) => (
          <div
            key={title}
            className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/8 transition-all duration-200"
          >
            <div className="w-10 h-10 rounded-xl bg-brand-500/20 flex items-center justify-center mb-4">
              <Icon className="w-5 h-5 text-brand-400" />
            </div>
            <h3 className="font-semibold text-base mb-2">{title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              {description}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
