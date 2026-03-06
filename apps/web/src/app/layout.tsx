import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "ScreenCraft AI",
    template: "%s | ScreenCraft AI",
  },
  description:
    "AI-enhanced screen recording for product demos and presentations. Real-time coaching, smart zoom, and automated editing.",
  keywords: ["screen recorder", "AI", "product demo", "presentation", "loom"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
