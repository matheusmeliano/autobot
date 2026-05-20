import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan, planLabel } from "@/lib/plans";
import { MercadoPagoRecurringButton } from "@/components/app/MercadoPagoRecurringButton";
import { MercadoPagoCheckoutButton } from "@/components/app/MercadoPagoCheckoutButton";

function dateBR(v: string | null) {
  if (!v) return "-";
  const s = v.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);
}

export default async function AssinaturaPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user?.id
    ? await supabase.from("profiles").select("plano").eq("user_id", user.id).maybeSingle()
    : { data: null };

  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select("plano, status, vencimento, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Assinatura
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar. Verifique se a migration foi aplicada.
        </div>
      </div>
    );
  }

  const plan = normalizePlan(profile?.plano ?? subscription?.plano ?? "teste");
  const rawStatus = String(subscription?.status ?? "").toLowerCase();
  const status = rawStatus === "pausado" || rawStatus === "past_due" ? "cancelado" : rawStatus;
  const vencimento = subscription?.vencimento ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const isExpired =
    typeof vencimento === "string" &&
    vencimento.length >= 10 &&
    vencimento.slice(0, 10) < today;
  const isBlocked = status === "cancelado" || (plan !== "vitalicio" && isExpired);

  return (
    <div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
        Assinatura
      </h1>
      <div className="mt-2 text-sm text-white/60">
        Aqui você acompanha seu plano e o status da sua assinatura.
      </div>

      {isBlocked ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-semibold">Seu teste gratuito terminou.</div>
          <div className="mt-1 text-amber-100/90">
            Para reativar o acesso completo, escolha um plano abaixo. Assim que
            ativar, todas as funcionalidades do sistema serão liberadas
            novamente.
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Plano</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {planLabel(plan)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Vencimento</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {plan === "vitalicio" ? "-" : dateBR(vencimento)}
          </div>
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-4 min-[1301px]:grid-cols-3">
        <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Básico</div>
              <div className="mt-2 whitespace-nowrap text-[clamp(1.25rem,7vw,2.25rem)] font-semibold tracking-tight leading-none">
                R$ 49/mês
              </div>
            </div>
          </div>
          <ul className="mt-6 flex-1 space-y-3 text-sm text-white/70">
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Conexão via Z-API</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Até 15 cadastros</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Templates e variáveis</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Agendamento automático</div>
            </li>
          </ul>
          <div className="mt-6">
            <MercadoPagoRecurringButton
              plan="basico"
              amount={49}
              userEmail={user?.email ?? null}
              disabled={plan === "basico" || plan === "vitalicio"}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/85 hover:bg-white/[0.06] disabled:opacity-60"
            >
              {plan === "basico"
                ? "Plano atual"
                : plan === "vitalicio"
                  ? "Indisponível"
                  : "Assinar"}
            </MercadoPagoRecurringButton>
          </div>
        </div>

        <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Pro</div>
              <div className="mt-2 whitespace-nowrap text-[clamp(1.25rem,7vw,2.25rem)] font-semibold tracking-tight leading-none">
                R$ 99/mês
              </div>
            </div>
            <div className="shrink-0 whitespace-nowrap rounded-full bg-indigo-500/15 px-3 py-1 text-[11px] font-semibold text-indigo-200 ring-1 ring-indigo-400/20">
              Mais escolhido
            </div>
          </div>
          <ul className="mt-6 flex-1 space-y-3 text-sm text-white/70">
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Tudo do Básico</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Cadastro ilimitado</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Relatório completo</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Suporte prioritário</div>
            </li>
          </ul>
          <div className="mt-6">
            <MercadoPagoRecurringButton
              plan="pro"
              amount={99}
              userEmail={user?.email ?? null}
              disabled={plan === "pro" || plan === "vitalicio"}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
            >
              {plan === "pro"
                ? "Plano atual"
                : plan === "vitalicio"
                  ? "Indisponível"
                  : "Assinar"}
            </MercadoPagoRecurringButton>
          </div>
        </div>

        <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Vitalício</div>
              <div className="mt-2 whitespace-nowrap text-[clamp(1.25rem,7vw,2.25rem)] font-semibold tracking-tight leading-none">
                R$ 2.490/único
              </div>
            </div>
          </div>
          <ul className="mt-6 flex-1 space-y-3 text-sm text-white/70">
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Tudo do Básico e Pro</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Sem mensalidades. Seu para sempre!</div>
            </li>
          </ul>
          <div className="mt-6">
            <MercadoPagoCheckoutButton
              plan="vitalicio"
              disabled={plan === "vitalicio"}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/85 hover:bg-white/[0.06] disabled:opacity-60"
            >
              {plan === "vitalicio" ? "Plano atual" : "Comprar vitalício"}
            </MercadoPagoCheckoutButton>
          </div>
        </div>
      </div>

      {plan !== "vitalicio" ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          Está com problemas com a assinatura mensal?{" "}
          <a
            href="https://wa.me/5565996933336"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-white underline decoration-white/20 underline-offset-4 hover:decoration-white/40"
          >
            Entre em contato
          </a>{" "}
          que ajudaremos você.
        </div>
      ) : null}
    </div>
  );
}
