import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export const metadata = {
  title: "Termos | AutoBot",
  description: "Termos de uso da plataforma AutoBot.",
};

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <header className="sticky top-0 z-30">
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
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl sm:p-8">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Termos de Uso
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Ao acessar ou utilizar o AutoBot, você concorda com os termos abaixo.
            Se não concordar, não utilize a plataforma.
          </p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-white/70">
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">1. Conta e acesso</h2>
              <p>
                Você é responsável por manter a confidencialidade das suas
                credenciais e por todas as atividades realizadas na sua conta.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                2. Uso aceitável
              </h2>
              <p>
                Você concorda em não utilizar o AutoBot para fins ilegais, envio
                de spam, fraude, engenharia social, violação de direitos de
                terceiros ou qualquer atividade que comprometa a plataforma.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                3. Planos e pagamentos
              </h2>
              <p>
                Os recursos disponíveis podem variar conforme o plano. Valores,
                condições e limites podem ser atualizados, respeitando as
                regras e comunicações aplicáveis.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                4. Cancelamento e encerramento
              </h2>
              <p>
                Você pode cancelar a qualquer momento. Também podemos suspender
                ou encerrar o acesso em caso de violação destes termos ou por
                necessidade de segurança e estabilidade do serviço.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">
                5. Limitação de responsabilidade
              </h2>
              <p>
                O AutoBot é disponibilizado “como está”. Não garantimos operação
                ininterrupta ou ausência total de falhas. Na máxima extensão
                permitida, não nos responsabilizamos por perdas indiretas,
                lucros cessantes ou danos consequenciais.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">6. Contato</h2>
              <p>
                Em caso de dúvidas, entre em contato pelo e-mail{" "}
                <span className="font-semibold text-white/85">
                  heybrotherscolaboradores@gmail.com
                </span>
                .
              </p>
            </section>
          </div>

          <div className="mt-10 h-px bg-white/10" />

          <div className="mt-6 text-xs text-white/45">
            Estes termos podem ser atualizados para refletir melhorias e ajustes
            operacionais do serviço.
          </div>
        </div>
      </main>
    </div>
  );
}
