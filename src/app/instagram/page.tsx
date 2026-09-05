import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export const metadata = {
  title: "Instagram | AutoBot",
  description: "Página do Instagram do AutoBot.",
};

export default function InstagramPage() {
  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#070A10]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2">
            <Logo />
            <div className="truncate text-sm font-semibold tracking-tight">AutoBot</div>
          </Link>

          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl sm:p-8">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Instagram
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Em breve, esta página vai apontar para o perfil oficial do AutoBot no
            Instagram. Enquanto isso, você pode falar com a gente por e-mail.
          </p>

          <div className="mt-8 grid gap-3">
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
