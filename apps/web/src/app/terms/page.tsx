import Link from "next/link";
import { Video } from "lucide-react";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shadow-md shadow-brand-500/30">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-slate-900">ScreenCraft AI</span>
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-400 mb-10">Last updated: January 1, 2025</p>

        <div className="prose prose-slate max-w-none space-y-8 text-sm text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using ScreenCraft AI ("Service"), you agree to be bound by these Terms of
              Service. If you do not agree, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">2. Use of the Service</h2>
            <p>
              You may use the Service only for lawful purposes and in accordance with these Terms. You agree
              not to use the Service to record or distribute content you do not have rights to, or to
              violate the privacy of any third party.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. User Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials and for
              all activity that occurs under your account. Notify us immediately if you believe your account
              has been compromised.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">4. Content</h2>
            <p>
              You retain ownership of all content you record or upload. By using the Service, you grant us
              a limited licence to process your content solely to provide the AI analysis and editing
              features described in the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">5. AI Features</h2>
            <p>
              Our Service uses Google Gemini AI to provide real-time coaching, transcription, and editing
              suggestions. AI outputs are provided as-is and may not always be accurate. You are responsible
              for reviewing any AI-generated content before publishing or sharing.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">6. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, ScreenCraft AI shall not be liable for any indirect,
              incidental, or consequential damages arising out of your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">7. Changes to Terms</h2>
            <p>
              We reserve the right to update these Terms at any time. Continued use of the Service after
              changes constitutes your acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">8. Contact</h2>
            <p>
              For questions about these Terms, please contact us at{" "}
              <a href="mailto:support@screencraft.ai" className="text-brand-500 hover:text-brand-600">
                support@screencraft.ai
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-200 flex items-center justify-between text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition">← Back to home</Link>
          <Link href="/privacy" className="hover:text-slate-600 transition">Privacy Policy</Link>
        </div>
      </div>
    </main>
  );
}
