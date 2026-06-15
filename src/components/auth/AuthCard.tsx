"use client";

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
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-start px-6 pb-16 pt-10 md:justify-center md:py-16">
        <a
          href="/"
          className="mb-8 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white/70"
        >
          <Logo />
          AutoBot
        </a>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
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
