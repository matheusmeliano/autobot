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

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl sm:p-8">
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
