import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export const metadata = {
  title: "LinkedIn | AutoBot",
  description: "Página do LinkedIn do AutoBot.",
};

export default function LinkedInPage() {
  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-280px] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.30),rgba(99,102,241,0)_55%)]" />
        <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.22),rgba(16,185,129,0)_55%)]" />
        <div className="absolute left-[-240px] top-[520px] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.18),rgba(59,130,246,0)_55%)]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#070A10]/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Logo />
            <div className="text-sm font-semibold tracking-tight">AutoBot</div>
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl sm:p-8">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            LinkedIn
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Em breve, esta página vai apontar para o perfil oficial do AutoBot no
            LinkedIn. Enquanto isso, você pode falar com a gente por e-mail.
          </p>

          <div className="mt-8 grid gap-3">
            <a
              href="https://www.linkedin.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
            >
              Abrir LinkedIn <ArrowUpRight className="h-4 w-4" />
            </a>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/70">
              Contato:{" "}
              <span className="font-semibold text-white/85">
                heybrotherscolaboradores@gmail.com
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
