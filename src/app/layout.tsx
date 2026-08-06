import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { ScheduleProvider } from "@/components/providers/ScheduleProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "threadsPlan AI — Adaptive Production Scheduling",
  description:
    "Intelligent apparel manufacturing planning with adaptive auto-scheduling, ripple cascades, and AI co-pilot optimization.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen antialiased">
        <Suspense fallback={null}>
          <ScheduleProvider>
            <AppShell>{children}</AppShell>
          </ScheduleProvider>
        </Suspense>
      </body>
    </html>
  );
}
