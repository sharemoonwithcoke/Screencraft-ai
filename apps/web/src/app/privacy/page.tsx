import Link from "next/link";
import { Video } from "lucide-react";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shadow-md shadow-brand-500/30">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-slate-900">ScreenCraft AI</span>
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-400 mb-10">Last updated: January 1, 2025</p>

        <div className="prose prose-slate max-w-none space-y-8 text-sm text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">1. Information We Collect</h2>
            <p>We collect information you provide directly to us, including:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Account information (name, email address, password hash)</li>
              <li>Screen recordings and audio you create using the Service</li>
              <li>Usage data and interaction logs within the app</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">2. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Provide, maintain, and improve the Service</li>
              <li>Process your recordings through AI analysis (Google Gemini)</li>
              <li>Send you service-related communications</li>
              <li>Monitor and analyse usage patterns to improve performance</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. AI Processing</h2>
            <p>
              Your recordings and audio are sent to Google Gemini AI for processing (transcription,
              coaching, and editing suggestions). This processing is governed by Google's Privacy Policy.
              We do not use your content to train AI models.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">4. Data Storage</h2>
            <p>
              Your recordings are stored in Google Cloud Storage. We retain your data for as long as your
              account is active. You can request deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">5. Information Sharing</h2>
            <p>
              We do not sell or rent your personal information to third parties. We may share information
              with trusted service providers (Google Cloud, Google Gemini) solely to operate the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">6. Cookies</h2>
            <p>
              We use session cookies for authentication via NextAuth.js. These are necessary for the
              Service to function and do not track you across other sites.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">7. Your Rights</h2>
            <p>
              Depending on your location, you may have the right to access, correct, or delete your
              personal data. To exercise these rights, contact us at{" "}
              <a href="mailto:privacy@screencraft.ai" className="text-brand-500 hover:text-brand-600">
                privacy@screencraft.ai
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">8. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material changes
              by posting the new policy on this page and updating the "last updated" date.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-200 flex items-center justify-between text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition">← Back to home</Link>
          <Link href="/terms" className="hover:text-slate-600 transition">Terms of Service</Link>
        </div>
      </div>
    </main>
  );
}
