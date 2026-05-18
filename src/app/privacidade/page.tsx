import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export const metadata = {
  title: "Privacidade | AutoBot",
  description: "Política de privacidade da plataforma AutoBot.",
};

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-280px] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.30),rgba(99,102,241,0)_55%)]" />
        <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.22),rgba(16,185,129,0)_55%)]" />
        <div className="absolute left-[-240px] top-[520px] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.18),rgba(59,130,246,0)_55%)]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#070A10]/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <div className="text-sm font-semibold tracking-tight">AutoBot</div>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] sm:p-8">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Política de Privacidade
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Esta política descreve como coletamos, usamos e protegemos informações
            ao utilizar o AutoBot.
          </p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-white/70">
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                1. Dados coletados
              </h2>
              <p>
                Podemos coletar dados de cadastro (como nome e e-mail), dados de
                uso da plataforma e informações operacionais inseridas por você
                (por exemplo, clientes e cobranças), quando aplicável.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                2. Como usamos os dados
              </h2>
              <p>
                Usamos os dados para fornecer o serviço, melhorar a experiência,
                manter a segurança, cumprir obrigações legais e oferecer suporte.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                3. Compartilhamento
              </h2>
              <p>
                Não vendemos seus dados. Podemos compartilhar informações apenas
                quando necessário para operar o serviço (ex.: provedores de
                infraestrutura) ou por obrigação legal.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                4. Segurança
              </h2>
              <p>
                Adotamos medidas técnicas e organizacionais para proteger os
                dados. Mesmo assim, nenhum sistema é 100% infalível; por isso,
                recomendamos boas práticas de senha e controle de acesso.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                5. Seus direitos
              </h2>
              <p>
                Você pode solicitar acesso, correção ou exclusão de dados, quando
                aplicável. Para isso, entre em contato pelo e-mail abaixo.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">6. Contato</h2>
              <p>
                Fale com a gente em{" "}
                <span className="font-semibold text-white/85">
                  heybrotherscolaboradores@gmail.com
                </span>
                .
              </p>
            </section>
          </div>

          <div className="mt-10 h-px bg-white/10" />

          <div className="mt-6 text-xs text-white/45">
            Esta política pode ser atualizada para refletir melhorias e ajustes
            operacionais do serviço.
          </div>
        </div>
      </main>
    </div>
  );
}

