"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-280px] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.30),rgba(99,102,241,0)_55%)]" />
        <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.22),rgba(16,185,129,0)_55%)]" />
        <div className="absolute left-[-240px] top-[520px] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.18),rgba(59,130,246,0)_55%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white/70 hover:text-white"
        >
          <Logo />
          AutoBot
        </Link>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <div className="text-center">
            <div className="text-2xl font-semibold tracking-tight">{title}</div>
            <div className="mt-2 text-sm text-white/60">{subtitle}</div>
          </div>

          <div className="mt-6">{children}</div>
        </div>

        <div className="mt-6 text-center text-sm text-white/60">{footer}</div>
      </div>
    </div>
  );
}

